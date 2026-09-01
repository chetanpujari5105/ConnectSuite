import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan, UNCOVERED } from './check-renderer-views.mjs';

/**
 * Fixtures for the renderer-view scan, each carrying its opposite.
 *
 * The hazard here is the one `check-protocol-spec.mjs` had: the easy check is a **name match**, and
 * a name match reports the whole renderer covered on the day it is covered by nothing. Every class
 * below is named in prose in a file that does not construct it, which is the case that must not
 * pass.
 */

function withTree(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'renderer-view-scan-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const path = join(root, 'desktop/src/renderer', rel);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, body);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a view constructed by a test counts as covered', () => {
  const { views, covered } = withTree(
    {
      'thing.ts': 'class ThingView {\n  draw() {}\n}\n',
      'thing.test.ts': "import './thing';\nconst v = new ThingView(a, b);\n",
    },
    (root) => scan(root),
  );
  assert.deepEqual([...views.keys()], ['ThingView']);
  assert.deepEqual([...covered], ['ThingView']);
});

test('the globalThis lookup the renderer forces on us also counts', () => {
  // The renderer loads as plain scripts, so a view reaches its test through
  // `(globalThis as Record<string, unknown>)['ThingView']` rather than an import. A checker that
  // only understood `new ThingView(` would report the one covered pane as uncovered and push
  // somebody to change working code to satisfy it.
  const { covered } = withTree(
    {
      'thing.ts': 'class ThingView {}\n',
      'thing.test.ts': "const View = (globalThis as R)['ThingView'] as new () => unknown;\nnew View();\n",
    },
    (root) => scan(root),
  );
  assert.deepEqual([...covered], ['ThingView']);
});

test('CONTROL — naming a view without constructing it does not count', () => {
  // The failure mode this file exists for. Every view class in this repo is named in prose
  // somewhere, including inside the checker itself.
  const { views, covered } = withTree(
    {
      'thing.ts': 'class ThingView {}\n',
      'thing.test.ts': "// ThingView draws the pane; see ThingView's comment for why.\nassert.ok(true);\n",
    },
    (root) => scan(root),
  );
  assert.deepEqual([...views.keys()], ['ThingView']);
  assert.deepEqual([...covered], [], 'a mention is not a construction');
});

test('CONTROL — a class defined inside a test file is not a view under test', () => {
  // Test doubles are named `FakeBridge`, `FakeView`, and so on. If the scan collected classes from
  // test files it would invent views that do not exist and then demand tests for them.
  const { views } = withTree(
    {
      'thing.ts': 'class ThingView {}\n',
      'thing.test.ts': 'class StubView {}\nnew ThingView();\n',
    },
    (root) => scan(root),
  );
  assert.deepEqual([...views.keys()], ['ThingView']);
});

test('the debt list is prunable, which is the property that keeps it honest', () => {
  // An allowlist nobody prunes is how a guard stops guarding, so a covered view still sitting on
  // the list is a failure. Asserted here as the data the runner acts on.
  const { covered } = withTree(
    {
      'thing.ts': 'class ThingView {}\n',
      'thing.test.ts': 'new ThingView();\n',
    },
    (root) => scan(root),
  );
  const stale = [...covered].filter((name) => UNCOVERED.has(name));
  assert.deepEqual(stale, [], 'nothing covered should still be excused');
});

test('the real repository is fully accounted for, and the scan read enough to mean it', () => {
  const { views, covered, testFiles } = scan();
  const unaccounted = [...views.keys()].filter((n) => !covered.has(n) && !UNCOVERED.has(n));
  assert.deepEqual(unaccounted, []);
  assert.ok(views.size >= 8, `only ${views.size} views found — the scan is looking in the wrong place`);
  assert.ok(testFiles >= 5, `only ${testFiles} test files read`);
  // And the thing this whole file is about: the pane where two of the three defects lived is the
  // one that is covered, not merely the one that is easiest.
  assert.ok(covered.has('ClipboardView'));
});
