import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan, HOMES, PATTERNS } from './check-clip-echo.mjs';

/**
 * Fixtures for the interlock scan, each carrying its opposite.
 *
 * `CLAUDE.md`: *a matcher without fixtures is a rule you are guessing about* — written after the
 * force-stop hook's first matcher denied every command that merely **talked** about force-stop,
 * including the commit writing the argument for the rule. This scan has the identical hazard in a
 * sharper form: the words `lastReceived` and `lastSent` appear dozens of times in the comments
 * explaining why they may appear only twice, including inside the checker itself. A matcher that
 * counted mentions would forbid documenting the thing it guards.
 *
 * So every "must fail" fixture below is paired with a "must pass" one that contains the same words
 * in a form that is not a declaration.
 */

function withTree(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'clip-echo-scan-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const path = join(root, rel);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, body);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a second TypeScript home is caught', () => {
  const { findings } = withTree(
    { 'desktop/src/main/clipboard.ts': 'class C {\n  private lastReceived: string | null = null;\n}\n' },
    (root) => scan(root),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, 'lastReceived');
  assert.equal(findings[0].line, 2);
});

test('a second Kotlin home is caught', () => {
  const { findings } = withTree(
    {
      'sync-module/src/main/java/x/ClipFeature.kt':
        'object F {\n    @Volatile\n    private var lastSent: String? = null\n}\n',
    },
    (root) => scan(root),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, 'lastSent');
});

test('the echo rule restated as a free function is caught, in either language', () => {
  const { findings } = withTree(
    {
      'desktop/src/shared/clipboardHistory.ts':
        'export function shouldSend(text: string, last: string | null) { return text !== last; }\n',
      'sync-module/src/main/java/x/ClipboardPayloads.kt':
        '    fun shouldSend(text: String, lastReceived: String?): Boolean = text != lastReceived\n',
    },
    (root) => scan(root),
  );
  // Two findings, one per language — and the Kotlin file's *parameter* named `lastReceived` is not
  // a third: a parameter is not a home, and matching it would forbid the rule's own signature.
  assert.equal(findings.length, 2);
  assert.deepEqual(new Set(findings.map((f) => f.name)), new Set(['shouldSend']));
});

test('CONTROL — prose about the interlock is not a declaration', () => {
  // The force-stop fixture, in this file's own terms. Every line here says the forbidden names and
  // none of them is a second home; a checker that flagged these could not have been written.
  const { findings } = withTree(
    {
      'desktop/src/main/clipboard.ts': [
        '// `lastReceived` is armed before the write, and `lastSent` clears on a link drop.',
        '/** See ClipEcho: lastReceived survives, lastSent does not. shouldSend used to live here. */',
        'const decision = this.echo.maySend(text, "user");',
        'this.echo.arrived(text);',
      ].join('\n'),
    },
    (root) => scan(root),
  );
  assert.deepEqual(findings, []);
});

test('CONTROL — the display fields that legitimately carry the same prefix are not homes', () => {
  // `PhoneState.lastSentPreview` is what the phone's card draws. It holds clipboard text and is not
  // the interlock, and a scan that could not tell them apart would push somebody into renaming a
  // display field to get a commit through — which is how a guard starts being worked around.
  const { findings } = withTree(
    {
      'sync-module/src/main/java/x/ClipFeature.kt': [
        '    data class PhoneState(',
        '        val lastSentPreview: String? = null,',
        '        val lastSentAtMs: Long = 0L,',
        '        val lastReceivedPreview: String? = null,',
        '        val lastReceivedApplied: Boolean = false,',
        '    )',
      ].join('\n'),
    },
    (root) => scan(root),
  );
  assert.deepEqual(findings, []);
});

test('the real repository passes, and the scan proves it read enough to mean it', () => {
  // A clean pass from a scan that read nothing is CLAUDE.md's eleventh row: a confident number
  // about a run that did not happen. The count is the control on the verdict.
  const { findings, filesRead } = scan();
  assert.deepEqual(findings, []);
  assert.ok(filesRead > 150, `only ${filesRead} files read — the scan is looking in the wrong place`);
});

test('the homes are exempt, and are exempt because they are named rather than because they are empty', () => {
  assert.equal(HOMES.length, 2);
  assert.ok(PATTERNS.length >= 3);
  // The exemption is doing work: run the same patterns over a home's content and they fire.
  const home = 'class ClipEcho {\n  private lastReceived: string | null = null;\n}\n';
  const hits = PATTERNS.flatMap(({ re }) => [...home.matchAll(new RegExp(re.source, re.flags))]);
  assert.equal(hits.length, 1, 'if this is 0 the exemption is meaningless and so is the scan');
});
