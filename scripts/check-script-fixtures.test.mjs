/**
 * Fixtures for `check-script-fixtures.mjs`, each carrying its opposite.
 *
 * A matcher without fixtures is a rule you are guessing about — `no-force-stop.sh`'s lesson. The
 * first case here is the shape that actually shipped: a suite that exits non-zero while the guard
 * it belongs to passes, because the guard's scope no longer includes the deleted file its control
 * named.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, 'check-script-fixtures.mjs');

const run = (root, floor = 2) =>
  spawnSync(process.execPath, [GUARD], {
    encoding: 'utf8',
    env: { ...process.env, SCRIPT_FIXTURE_ROOT: root, SCRIPT_FIXTURE_FLOOR: String(floor) },
  });

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'script-fixtures-'));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, { mode: name.endsWith('.sh') ? 0o755 : 0o644 });
  }
  return dir;
}

const PASSES = 'process.exit(0);\n';
const FAILS = 'console.log("the control this names was deleted with its caller");\nprocess.exit(1);\n';

test('fixture — a red suite denies, and the guard says which and why', () => {
  const dir = tree({ 'a.test.mjs': PASSES, 'b.test.mjs': FAILS, 'c.test.mjs': PASSES });
  try {
    const r = run(dir);
    assert.equal(r.status, 1, 'a red suite must deny');
    assert.match(r.stdout, /2 of 3 fixture suites green/);
    assert.match(r.stdout, /RED {2}.*b\.test\.mjs/);
    assert.match(r.stdout, /deleted with its caller/, 'the output, not just the count');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('control — an all-green tree passes, or this denies everything and gets deleted', () => {
  const dir = tree({ 'a.test.mjs': PASSES, 'b.test.mjs': PASSES });
  try {
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /2 of 2 fixture suites green/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fixture — a shell suite is discovered and run too, not only the .mjs half', () => {
  const dir = tree({ 'a.test.mjs': PASSES, 'b.test.sh': '#!/bin/bash\necho "shell said no"\nexit 1\n' });
  try {
    const r = run(dir);
    assert.equal(r.status, 1, 'both extensions are suites');
    assert.match(r.stdout, /b\.test\.sh/);
    assert.match(r.stdout, /shell said no/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fixture — nested directories are walked, which is where the hook fixtures live', () => {
  const dir = tree({ 'a.test.mjs': PASSES, 'hooks/b.test.sh': '#!/bin/bash\nexit 1\n' });
  try {
    assert.equal(run(dir).status, 1, 'a red suite one level down must still deny');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('control — a file that merely mentions a test is not a suite', () => {
  const dir = tree({
    'a.test.mjs': PASSES,
    'b.test.mjs': PASSES,
    // Named for tests, exits non-zero, and is not a `*.test.*` file. If discovery were a text
    // match rather than a filename rule this would deny and the guard would be unusable.
    'run-tests.mjs': 'process.exit(1);\n',
    'notes-about-test.md': '# b.test.mjs is red\n',
  });
  try {
    const r = run(dir);
    assert.equal(r.status, 0, 'only *.test.mjs and *.test.sh are suites');
    assert.match(r.stdout, /2 of 2 fixture suites green/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the floor — a discovery that finds nothing is an instrument failure, not a pass', () => {
  const dir = tree({ 'readme.md': 'no suites here\n' });
  try {
    const r = run(dir);
    assert.equal(r.status, 1, 'zero discovered must refuse');
    assert.match(r.stdout, /REFUSED/);
    assert.match(r.stdout, /below the floor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the floor — and a root that does not exist refuses rather than reporting zero red', () => {
  const r = run(join(tmpdir(), 'script-fixtures-does-not-exist-' + Date.now()));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /REFUSED/);
  assert.match(r.stdout, /does not exist/);
});

test('against the real tree — the floor is below the real count and above zero', () => {
  /*
   * `--list`, not a run. This suite is one of the nineteen the guard runs, so spawning a real run
   * from inside it recurses — it did, and had to be killed. Discovery is the part this test is
   * about; whether the suites pass is what the hook is for.
   */
  const r = spawnSync(process.execPath, [GUARD, '--list'], { encoding: 'utf8' });
  const m = r.stdout.match(/(\d+) fixture suites discovered \(floor (\d+)\)/);
  assert.ok(m, `the guard did not report a count: ${r.stdout}`);
  const [, total, floor] = m.map(Number);
  assert.ok(total > Number(floor), `the floor ${floor} must sit below the real count ${total}`);
  assert.ok(Number(floor) > 0, 'a floor of 0 is not a floor');
  assert.match(r.stdout, /check-script-fixtures\.test\.mjs/, 'the guard must discover its own suite');
});
