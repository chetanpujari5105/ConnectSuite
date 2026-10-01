/**
 * Fixtures for `check-suites-run.mjs`.
 *
 * **The first test is the one that matters: the verbatim situation that got through.** A guard
 * written after a failure and never run against that failure has not been tested against the only
 * case it is known to have missed — the same rule `check-debt-claims.test.mjs` carries. Here that
 * case is a commit touching `core/.../protocol/Messages.kt` with a green `desktop/.test-run.json`
 * beside a phone results set that is either absent or red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  halfOf,
  halvesTouched,
  verdictFor,
  readPhoneEvidence,
  readMacEvidence,
  GRADLE_MODULES,
} from './check-suites-run.mjs';

// ---- the classification ------------------------------------------------------------------------

test('the verbatim commit that got through touches the phone half', () => {
  // STORAGE_STATE landed here, and only the Mac suite was run.
  assert.equal(halfOf('core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt'), 'phone');
  assert.equal(halfOf('desktop/src/shared/protocol.ts'), 'mac');
  const halves = halvesTouched([
    'core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt',
    'desktop/src/shared/protocol.ts',
    'docs/protocol.md',
  ]);
  assert.deepEqual([...halves].sort(), ['mac', 'phone']);
});

test('a docs-only commit touches neither half, so nothing is demanded of it', () => {
  // Control for the test above: if this returned a half, the guard would fire on every doc edit
  // and be routed around inside a week.
  const halves = halvesTouched(['docs/testing.md', 'docs/defects.md', 'CLAUDE.md', 'README.md']);
  assert.equal(halves.size, 0);
});

test('scripts and evidence are not a half either', () => {
  assert.equal(halfOf('scripts/probe.mjs'), null);
  assert.equal(halfOf('docs/evidence/x/y.png'), null);
  assert.equal(halfOf('desktop/src/renderer/index.html'), 'mac');
  // A Kotlin file outside an included module cannot be run by Gradle and is check-orphan-tests'
  // subject, not this one.
  assert.equal(halfOf('tools/Scratch.kt'), null);
  for (const m of GRADLE_MODULES) {
    assert.equal(halfOf(`${m}/src/main/java/A.kt`), 'phone');
  }
});

// ---- the verdicts ------------------------------------------------------------------------------

const NOW = 1_000_000;

test('THE CASE THAT GOT THROUGH — the phone half touched with no results at all', () => {
  const v = verdictFor({ touched: true, evidence: null, newestSourceMs: NOW });
  assert.equal(v.state, 'unrun');
});

test('control for the above — the same half with a fresh green artifact passes', () => {
  const v = verdictFor({
    touched: true,
    evidence: { newestMs: NOW + 1, tests: 442, failures: 0 },
    newestSourceMs: NOW,
  });
  assert.equal(v.state, 'green');
});

test('a red artifact is red, and is not the same finding as an absent one', () => {
  const v = verdictFor({
    touched: true,
    evidence: { newestMs: NOW + 1, tests: 442, failures: 1 },
    newestSourceMs: NOW,
  });
  assert.equal(v.state, 'red');
  // `unrun` and `red` must stay distinct: one half has said nothing, the other has said something
  // bad, and they need different sentences. Collapsing them is the empty-versus-failed mistake.
  assert.notEqual(v.state, 'unrun');
});

test('an artifact older than the change is stale, which is the memory the stale-XML rule names', () => {
  const v = verdictFor({
    touched: true,
    evidence: { newestMs: NOW - 60_000, tests: 442, failures: 0 },
    newestSourceMs: NOW,
  });
  assert.equal(v.state, 'stale');
  assert.match(v.detail, /older than the newest changed source/);
});

test('an untouched half is reported as not checked rather than as passing', () => {
  // The whole ask: say plainly which half was not checked. `untouched` is not `green`, and the
  // renderer prints it as "NOT CHECKED, and it did not need to be".
  const v = verdictFor({ touched: false, evidence: null, newestSourceMs: 0 });
  assert.equal(v.state, 'untouched');
  assert.notEqual(v.state, 'green');
});

test('an artifact whose count cannot be read is unrun, not zero failures', () => {
  // A tally that ran over nothing is not a count of zero.
  const v = verdictFor({
    touched: true,
    evidence: { newestMs: NOW + 1, tests: null, failures: null },
    newestSourceMs: NOW,
  });
  assert.equal(v.state, 'unrun');
});

// ---- the readers, against fake trees ------------------------------------------------------------

function fakeFs(files) {
  return {
    existsSync: (p) => Object.keys(files).some((f) => f === p || f.startsWith(p + '/')),
    readdirSync: (p) =>
      Object.keys(files)
        .filter((f) => f.startsWith(p + '/'))
        .map((f) => f.slice(p.length + 1)),
    readFileSync: (p) => files[p].body,
    statSync: (p) => ({ mtimeMs: files[p].mtimeMs }),
  };
}

test('the phone reader sums across modules and names the ones with no results at all', () => {
  const dir = (m) => `/r/${m}/build/test-results/testDebugUnitTest`;
  const files = {
    [`${dir('core')}/TEST-a.xml`]: { body: '<testsuite tests="126" failures="0" errors="0">', mtimeMs: 500 },
    [`${dir('app')}/TEST-b.xml`]: { body: '<testsuite tests="11" failures="1" errors="0">', mtimeMs: 900 },
  };
  const e = readPhoneEvidence('/r', fakeFs(files));
  assert.equal(e.tests, 137);
  assert.equal(e.failures, 1);
  assert.equal(e.newestMs, 900);
  assert.deepEqual(e.modulesSeen.sort(), ['app', 'core']);
  // The modules that contributed nothing are named rather than silently absent from the sum —
  // a module with no results is invisible in a total, which is the failure one level down.
  assert.deepEqual(e.modulesMissing.sort(), ['camera-module', 'input-module', 'mirror-module', 'sync-module']);
});

test('the phone reader returns null rather than a zero when nothing has ever run', () => {
  assert.equal(readPhoneEvidence('/r', fakeFs({})), null);
});

test('errors count as failures, so a module that blew up is not read as green', () => {
  const dir = '/r/core/build/test-results/testDebugUnitTest';
  const e = readPhoneEvidence('/r', fakeFs({
    [`${dir}/TEST-a.xml`]: { body: '<testsuite tests="3" failures="0" errors="2">', mtimeMs: 1 },
  }));
  assert.equal(e.failures, 2);
});

test('the Mac reader believes the exit code, not the counts', () => {
  const rec = (o) => fakeFs({ '/r/desktop/.test-run.json': { body: JSON.stringify(o), mtimeMs: 1 } });
  const red = readMacEvidence('/r', rec({ ranAtMs: 5, green: false, counts: { tests: 623, fail: 2 } }));
  assert.equal(red.failures, 2);
  const green = readMacEvidence('/r', rec({ ranAtMs: 5, green: true, counts: { tests: 623, fail: 0 } }));
  assert.equal(green.failures, 0);
  // A record the wrapper never finished writing is not a reading.
  assert.equal(readMacEvidence('/r', rec({ green: true })), null);
  assert.equal(readMacEvidence('/r', fakeFs({})), null);
});

test('a truncated record is refused rather than parsed into a pass', () => {
  const fs = fakeFs({ '/r/desktop/.test-run.json': { body: '{"ranAtMs": 5,', mtimeMs: 1 } });
  assert.equal(readMacEvidence('/r', fs), null);
});
