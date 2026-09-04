import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';

/**
 * Fixtures for both directions, because a matcher without them is a rule you are guessing about.
 *
 * The one that matters is the first: **the actual sentence that got past the actual debt list.**
 * A guard written after a failure and never run against that failure is a guard nobody has tested
 * against the only case it is known to have missed.
 */
const FIXTURE_DIR = 'docs/.debt-claim-fixtures';

function run() {
  try {
    return { code: 0, out: execFileSync('node', ['scripts/check-debt-claims.mjs'], { encoding: 'utf8' }) };
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function withFixture(name, body, fn) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(`${FIXTURE_DIR}/${name}.md`, body);
  try {
    return fn();
  } finally {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
}

/** Put a type back on the debt list for the length of one check. */
function withDebt(type, fn) {
  const path = 'scripts/check-protocol-spec.mjs';
  const held = readFileSync(path, 'utf8');
  const patched = held.replace(
    /const UNSPECIFIED = \{/,
    `const UNSPECIFIED = {\n  '${type}': 'fixture — restored for one test run',`,
  );
  writeFileSync(path, patched);
  try {
    return fn();
  } finally {
    writeFileSync(path, held);
  }
}

test('DENIES the sentence that actually got through — RESUME.md, 2026-09-04', () => {
  // Verbatim from the handoff that started the O4 sitting on a false premise. The debt list held
  // battery.state the whole time and printed it on every run.
  const result = withDebt('battery.state', () =>
    withFixture('resume', 'O4, the Device status rings. The last genuinely unbuilt design row whose data already exists on the wire — `battery.state` and `net.state` are both already on the wire, so no protocol work.', run),
  );
  assert.equal(result.code, 1, 'the sentence that cost a sitting was not caught');
  assert.match(result.out, /battery\.state/);
});

test('ALLOWS the sentence that records the debt', () => {
  // The exculpatory case, and the reason this guard needs a discriminator at all: a checker that
  // matched the type name alone would deny the paragraph explaining why the type is owed.
  const result = withDebt('battery.state', () =>
    withFixture('record', '`battery.state` sat in the inventory, specified nowhere and with no handler on either side, since Phase 2.', run),
  );
  assert.equal(result.code, 0, 'the guard denied its own record of the debt');
});

test('ALLOWS a claim about a type that is NOT on the debt list', () => {
  const result = withFixture('other', '`clip.push` is implemented on both sides and is sent whenever the phone is focused.', run);
  assert.equal(result.code, 0);
});

test('DENIES a second claim phrasing, so the list is not one string wide', () => {
  const result = withDebt('battery.state', () =>
    withFixture('second', 'The Device status card works today because `battery.state` is handled on both sides.', run),
  );
  assert.equal(result.code, 1);
});

test('reports its own instrument failure rather than passing silently', () => {
  // If the debt list cannot be read, nothing was checked — and that must not look like a pass.
  const path = 'scripts/check-protocol-spec.mjs';
  const held = readFileSync(path, 'utf8');
  writeFileSync(path, held.replace(/const UNSPECIFIED\s*=\s*\{/, 'const RENAMED_AWAY = {'));
  try {
    const result = run();
    assert.equal(result.code, 0);
    assert.match(result.out, /INSTRUMENT FAILURE/);
  } finally {
    writeFileSync(path, held);
  }
});
