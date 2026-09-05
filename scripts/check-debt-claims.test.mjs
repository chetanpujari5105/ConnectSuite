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

function run(env = {}) {
  try {
    return {
      code: 0,
      out: execFileSync('node', ['scripts/check-debt-claims.mjs'], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
      }),
    };
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

/**
 * Put a type back on the debt list for the length of one check, **in a copy**.
 *
 * This wrote the patched source over the real `check-protocol-spec.mjs` and restored it in a
 * `finally`. That is correct in isolation and wrong under `node --test`, which runs test *files* in
 * parallel: `check-protocol-spec.test.mjs` reads the same path, and for the few milliseconds the
 * patch was on disk it saw a debt list with `battery.state` on it and failed with a perfectly
 * accurate message about a file nobody wrote.
 *
 * The fixture now writes its own copy and points the subprocess at it with `DEBT_SOURCE`. Nothing
 * shared is mutated, so the ordering of the suite cannot change the result.
 */
function withDebt(type, fn) {
  const held = readFileSync('scripts/check-protocol-spec.mjs', 'utf8');
  const copy = `${FIXTURE_DIR}/spec-with-${type.replace(/\W/g, '-')}.mjs`;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(
    copy,
    held.replace(
      /const UNSPECIFIED = \{/,
      `const UNSPECIFIED = {\n  '${type}': 'fixture — restored for one test run',`,
    ),
  );
  try {
    return fn(copy);
  } finally {
    rmSync(copy, { force: true });
  }
}

test('DENIES the sentence that actually got through — RESUME.md, 2026-09-04', () => {
  // Verbatim from the handoff that started the O4 sitting on a false premise. The debt list held
  // battery.state the whole time and printed it on every run.
  const result = withDebt('battery.state', (spec) =>
    withFixture('resume', 'O4, the Device status rings. The last genuinely unbuilt design row whose data already exists on the wire — `battery.state` and `net.state` are both already on the wire, so no protocol work.', () => run({ DEBT_SOURCE: spec })),
  );
  assert.equal(result.code, 1, 'the sentence that cost a sitting was not caught');
  assert.match(result.out, /battery\.state/);
});

test('ALLOWS the sentence that records the debt', () => {
  // The exculpatory case, and the reason this guard needs a discriminator at all: a checker that
  // matched the type name alone would deny the paragraph explaining why the type is owed.
  const result = withDebt('battery.state', (spec) =>
    withFixture('record', '`battery.state` sat in the inventory, specified nowhere and with no handler on either side, since Phase 2.', () => run({ DEBT_SOURCE: spec })),
  );
  assert.equal(result.code, 0, 'the guard denied its own record of the debt');
});

test('ALLOWS a claim about a type that is NOT on the debt list', () => {
  const result = withFixture('other', '`clip.push` is implemented on both sides and is sent whenever the phone is focused.', run);
  assert.equal(result.code, 0);
});

test('DENIES a second claim phrasing, so the list is not one string wide', () => {
  const result = withDebt('battery.state', (spec) =>
    withFixture('second', 'The Device status card works today because `battery.state` is handled on both sides.', () => run({ DEBT_SOURCE: spec })),
  );
  assert.equal(result.code, 1);
});

test('reports its own instrument failure rather than passing silently', () => {
  // If the debt list cannot be read, nothing was checked — and that must not look like a pass.
  //
  // Against a **copy** with the block renamed away, for the same reason as `withDebt`: this used to
  // rename `UNSPECIFIED` in the real `check-protocol-spec.mjs`, which the sibling test file reads
  // in parallel.
  const held = readFileSync('scripts/check-protocol-spec.mjs', 'utf8');
  const broken = `${FIXTURE_DIR}/spec-with-no-debt-block.mjs`;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(broken, held.replace(/const UNSPECIFIED\s*=\s*\{/, 'const RENAMED_AWAY = {'));
  try {
    const result = run({ DEBT_SOURCE: broken });
    assert.equal(result.code, 0);
    assert.match(result.out, /INSTRUMENT FAILURE/);
  } finally {
    rmSync(broken, { force: true });
  }
});
