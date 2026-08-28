import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CallClient } from './calls';
import { resetDebugSwitchesForTests } from './debugSwitches';
import type { LinkClient } from './link';

beforeEach(() => {
  delete process.env.CONNECTSUITE_DEBUG_SWITCHES;
  resetDebugSwitchesForTests();
});

function fakePhone(reply: Record<string, unknown> = {}) {
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const link = {
    isConnected: () => true,
    request: (type: string, payload: Record<string, unknown> = {}) => {
      sent.push({ type, payload });
      return Promise.resolve({ v: 1, id: 'x', type: 'ack', ts: 0, payload: reply });
    },
  } as unknown as LinkClient;
  return { link, sent };
}

const RINGING = {
  callId: 'c17',
  number: '+15551234567',
  contactName: 'Ada Lovelace',
  startedAtMs: 1756300000000,
  state: 'ringing',
};

const NEXT_CALL = {
  callId: 'c18',
  number: '+15559998888',
  startedAtMs: 1756300100000,
  state: 'ringing',
};

/**
 * Step 61's clause that actually matters.
 *
 * `call.reject` accepts an omitted `callId` meaning "the call in progress". If the Mac used that
 * shape, a Reject clicked on a stale card would decline **whoever is ringing now** — a different
 * person, who sees their call declined by someone trying to decline somebody else's. The id is
 * always sent, so the phone can tell the two apart and refuse.
 */
test('reject names the call it is aimed at, never "whatever is ringing"', async () => {
  const { link, sent } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming({ ...RINGING });

  await calls.reject();

  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.type, 'call.reject');
  assert.deepEqual(sent[0]!.payload, { callId: 'c17' });
  assert.ok('callId' in sent[0]!.payload, 'an omitted id would mean "the call in progress"');
});

test('answer names the call too', async () => {
  const { link, sent } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming({ ...RINGING });

  await calls.answer();

  assert.deepEqual(sent[0]!.payload, { callId: 'c17' });
});

/**
 * The stale-card scenario end to end: the first call ends, a second one starts, and the action
 * still names the first.
 *
 * With `stallCallEnded` the card never updates, which is the state a missed or late `call.ended`
 * puts the Mac in for real. The request must still carry `c17` — the phone then refuses it as a
 * different call rather than hanging up on `c18`.
 */
test('a stale card rejects the call it shows, not the one now ringing', async () => {
  process.env.CONNECTSUITE_DEBUG_SWITCHES = 'stallCallEnded';
  resetDebugSwitchesForTests();
  const { link, sent } = fakePhone();
  const calls = new CallClient(() => link);

  calls.onIncoming({ ...RINGING });
  calls.onEnded({ callId: 'c17', number: RINGING.number, durationMs: 0, disposition: 'missed' });

  await calls.reject();

  assert.equal(calls.currentCall()?.callId, 'c17', 'the switch is what keeps the card stale');
  assert.deepEqual(
    sent[0]!.payload,
    { callId: 'c17' },
    'the stale card must aim at its own call, so the phone can refuse it',
  );
  assert.notDeepEqual(sent[0]!.payload, { callId: 'c18' });
  assert.notDeepEqual(sent[0]!.payload, {}, 'an empty payload would hang up on whoever is ringing');
});

/** Without the switch, `call.ended` clears the card, which is the ordinary path. */
test('call.ended clears the card it describes', () => {
  const { link } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming({ ...RINGING });

  calls.onEnded({ callId: 'c17', number: RINGING.number, durationMs: 4200, disposition: 'answered' });

  assert.equal(calls.currentCall(), null);
});

/**
 * A late `call.ended` for a previous call must not blank the card describing the current one.
 *
 * The same aiming mistake as step 61, pointed the other way: acting on an id-less assumption about
 * "the call", this time by clearing. The user would watch a ringing call's card vanish.
 */
test('an ended event for an older call leaves the current card alone', () => {
  const { link } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming({ ...RINGING });
  calls.onEnded({ callId: 'c17', number: RINGING.number, durationMs: 1, disposition: 'missed' });
  calls.onIncoming({ ...NEXT_CALL });

  // The first call's `ended` arrives again, late and out of order.
  calls.onEnded({ callId: 'c17', number: RINGING.number, durationMs: 1, disposition: 'missed' });

  assert.equal(calls.currentCall()?.callId, 'c18', 'the ringing call keeps its card');
});

/** With no card there is nothing to aim at, and nothing crosses the link. */
test('reject with no call showing is refused here', async () => {
  const { link, sent } = fakePhone();
  const calls = new CallClient(() => link);

  const result = await calls.reject();

  assert.equal(result.ok, false);
  assert.equal(sent.length, 0, 'a request with no id would mean "whatever is ringing"');
});

/**
 * A `NO_ACTIVE_CALL` refusal drops the card.
 *
 * The phone has just said the card is describing a call that is over. Leaving it up would invite
 * the same click against the same dead id indefinitely — a control that can only ever fail.
 */
test('a NO_ACTIVE_CALL refusal takes the stale card down', async () => {
  const refusing = {
    isConnected: () => true,
    request: () =>
      Promise.reject(
        Object.assign(new Error('NO_ACTIVE_CALL: gone'), {
          code: 'NO_ACTIVE_CALL',
          phoneMessage: 'That was aimed at a call the phone has already finished.',
        }),
      ),
  } as unknown as LinkClient;
  const calls = new CallClient(() => refusing);
  calls.onIncoming({ ...RINGING });

  const result = await calls.reject();

  assert.equal(result.ok, false);
  assert.equal(calls.currentCall(), null, 'the card was wrong and the phone said so');
});

/** A call with no id cannot be acted on safely, so it is not shown at all. */
test('an incoming call with no id is dropped rather than drawn', () => {
  const { link } = fakePhone();
  const calls = new CallClient(() => link);

  calls.onIncoming({ number: '+15551234567', state: 'ringing' });

  assert.equal(calls.currentCall(), null, 'a card with no id could only act as "whatever is ringing"');
});

/** Defect 25's rule again: a card that outlives its link is not actionable. */
test('the card is dropped when the link goes', () => {
  const { link } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming({ ...RINGING });

  calls.clear();

  assert.equal(calls.currentCall(), null);
});

/** Dialling carries the number and refuses an empty one without a round trip. */
test('dial sends the number, and refuses an empty one here', async () => {
  const { link, sent } = fakePhone({ callId: 'c19' });
  const calls = new CallClient(() => link);

  const empty = await calls.dial('   ');
  assert.equal(empty.ok, false);
  assert.equal(sent.length, 0);

  const placed = await calls.dial(' +15551234567 ');
  assert.equal(placed.ok, true);
  assert.deepEqual(sent[0]!.payload, { number: '+15551234567' });
});

/**
 * The call log is read from `entries`, which is the key docs/protocol.md specifies.
 *
 * This shipped wrong. The client read `calls` — the feature's name rather than the payload's key —
 * and `rows()` answers a missing key with an empty array, so the Mac drew "There are no calls in
 * the phone's log" against a phone holding 1,999 of them. No error, no warning, nothing to debug:
 * a well-formed empty list is indistinguishable from an empty log.
 *
 * What caught it was the pair of logs disagreeing about one event — the phone's
 * `call.log → 50 entries` beside the Mac's `call.log → 0 entries`. That is the argument for
 * logging the count on both sides of a request rather than only where it is convenient.
 */
test('the call log is read from the key the protocol names', async () => {
  const entry = {
    id: '5521',
    number: '+15551234567',
    contactName: 'Ada Lovelace',
    type: 'missed',
    dateMs: 1756298000000,
    durationMs: 0,
  };
  const { link } = fakePhone({ entries: [entry], hasMore: true });
  const calls = new CallClient(() => link);

  const result = await calls.log({ limit: 50 });

  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.data.calls.length, 1, 'the phone sent one entry');
  assert.equal(result.ok === true && result.data.calls[0]!.id, '5521');
});

/**
 * A reply keyed the way the bug expected must come back empty, not silently work.
 *
 * Pins the direction of the fix: if someone later makes the client accept either key "to be
 * lenient", the disagreement between the two sides stops being visible and the next mismatch of
 * this kind goes unnoticed again.
 */
test('a reply keyed "calls" is not quietly accepted', async () => {
  const { link } = fakePhone({ calls: [{ id: '1', number: '+1', type: 'missed', dateMs: 1, durationMs: 0 }], hasMore: false });
  const calls = new CallClient(() => link);

  const result = await calls.log({});

  assert.equal(result.ok === true && result.data.calls.length, 0, 'only the documented key is read');
});

/**
 * `hasMore` is the phone's, and it disagreeing with an empty page is a signal worth keeping.
 *
 * `0 entries, hasMore=true` is exactly the shape the key bug produced, and it is contradictory on
 * its face — which is what made it noticeable. Inferring `hasMore` from the page length here would
 * have made the bug produce a perfectly consistent, perfectly wrong "no calls, nothing more".
 */
test('hasMore comes from the phone even when the page is empty', async () => {
  const { link } = fakePhone({ entries: [], hasMore: true });
  const calls = new CallClient(() => link);

  const result = await calls.log({});

  assert.equal(result.ok === true && result.data.calls.length, 0);
  assert.equal(result.ok === true && result.data.hasMore, true, 'a contradiction worth surfacing');
});
