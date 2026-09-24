import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { debugSwitches, resetDebugSwitchesForTests } from './debugSwitches';

/**
 * These switches weaken guards. The property worth pinning is not that they work — it is that they
 * are **off** unless someone typed them, because the guards they open protect a reply landing in
 * somebody else's conversation, a pane that lies about what is on the shade, and a transport
 * command sent to a player that has said it cannot obey it.
 */
beforeEach(() => {
  delete process.env.CONNECTSUITE_DEBUG_SWITCHES;
  resetDebugSwitchesForTests();
});

/**
 * The one test that must be edited when a switch is added, and the reason the others need not be.
 *
 * These assertions used to spell out the whole switch object six times over, so adding the third
 * switch broke all six at once with six identical diffs — noise that buries the one question worth
 * asking, which is whether the new switch defaults to off. Now that question is asked here, in one
 * place, and every other test builds its expectation from [allOff] instead.
 */
test('the known switches are exactly these, and every one defaults to off', () => {
  const all = debugSwitches();

  assert.deepEqual(
    Object.keys(all).sort(),
    [
      'bypassRemoteGuard',
      'bypassReplyGuard',
      // Added 2026-09-13 for defect 105. Confirmed off by default by the assertion below, and it is
      // the only switch here that exists to prove a fix rather than to reach an unreachable error
      // path — it forces the float's start race to lose, which no machine tried here would do.
      'delayFloatListeners',
      'forceRecipientMismatch',
      // Added 2026-09-24 for Feature A slice 2, both off by default (asserted below): an old-peer
      // `hello` with no `ext`, and an offer held unanswered so the phone's expiry can be watched.
      // Added 2026-09-24 for Feature A slice 3d, both off by default (asserted below) and forced off
      // in a packaged build by main.ts: accept synthetic probe offers only; receive into the dev
      // scratch folder instead of the configured one.
      'shareAcceptProbe',
      'shareDevReceive',
      'shareOmitExt',
      'shareSilent',
      // Added 2026-09-24 for Feature A's pre-live gate, off by default (asserted below): the request
      // to advertise share.file 2, which shareActivation.ts refuses without the other two switches.
      'shareV2',
      'stallCallEnded',
      'stallRemoved',
    ],
    'a switch was added or removed — confirm it defaults to off, then list it here',
  );
  assert.deepEqual(
    Object.values(all),
    Object.values(all).map(() => false),
    'a switch that is on by default is not a switch, it is a weakened guard',
  );
});

/** Every switch off, derived from the module rather than spelled out. */
function allOff(): Record<string, boolean> {
  const off: Record<string, boolean> = {};
  for (const name of Object.keys(debugSwitches())) off[name] = false;
  return off;
}

/** Every switch off except the named ones. */
function only(...on: string[]): Record<string, boolean> {
  const expected = allOff();
  for (const name of on) {
    assert.ok(name in expected, `${name} is not a known switch`);
    expected[name] = true;
  }
  return expected;
}

function switchesFor(value: string | undefined): Record<string, boolean> {
  if (value === undefined) delete process.env.CONNECTSUITE_DEBUG_SWITCHES;
  else process.env.CONNECTSUITE_DEBUG_SWITCHES = value;
  resetDebugSwitchesForTests();
  return debugSwitches() as unknown as Record<string, boolean>;
}

test('every switch is off when the variable is unset', () => {
  assert.deepEqual(switchesFor(undefined), allOff());
});

test('an empty variable turns nothing on', () => {
  assert.deepEqual(switchesFor(''), allOff());
});

test('naming one switch turns on exactly that one', () => {
  assert.deepEqual(switchesFor('stallRemoved'), only('stallRemoved'));
  assert.deepEqual(switchesFor('bypassRemoteGuard'), only('bypassRemoteGuard'));
});

test('several can be on at once, with whitespace tolerated', () => {
  assert.deepEqual(
    switchesFor(' stallRemoved , bypassReplyGuard '),
    only('stallRemoved', 'bypassReplyGuard'),
  );
  assert.deepEqual(
    switchesFor('stallRemoved,bypassReplyGuard,bypassRemoteGuard'),
    only('stallRemoved', 'bypassReplyGuard', 'bypassRemoteGuard'),
  );
});

/** A typo must not silently enable something, and must not enable everything either. */
test('an unknown name turns nothing on', () => {
  assert.deepEqual(switchesFor('stallRemovd,allTheThings'), allOff());
});

/**
 * A near-miss must not drag its neighbour on with it.
 *
 * `bypassReplyGuard` and `bypassRemoteGuard` differ by two letters, and a matcher written as a
 * prefix or `includes` test would enable the wrong one from a typo of the other — a guard opened
 * by accident, which is the one outcome this module exists to prevent.
 */
test('two switches with similar names are not confused for each other', () => {
  assert.deepEqual(switchesFor('bypassReplyGuard'), only('bypassReplyGuard'));
  assert.deepEqual(switchesFor('bypassRemoteGuard'), only('bypassRemoteGuard'));
  assert.deepEqual(switchesFor('bypassRe'), allOff());
  assert.deepEqual(switchesFor('bypassReplyGuardExtra'), allOff());
});

/** Truthiness is not the contract — the switch must be named. */
test('a truthy value that is not a switch name turns nothing on', () => {
  for (const value of ['1', 'true', 'yes', 'on', 'all']) {
    assert.deepEqual(switchesFor(value), allOff(), `"${value}" must not enable anything`);
  }
});
