import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CallClient, whoLine } from './calls';
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

/**
 * Defect 43 — a call with no number logged as `from ,`.
 *
 * Reached for the first time on 2026-08-29, minutes after defect 42 was fixed. Until then a
 * phone-placed outgoing call always arrived carrying the previous call's number, so the branch
 * never ran; the honest blank that 42's fix produces walked straight into it. The observed line:
 *
 *   call.incoming c2 (dialing) from , no contact name — 26 rang / 18 ended / …
 *
 * `from ,` is the string defect 35 is named for, in a different file, eleven defects later.
 */
test('a call is named in the log by its last two digits, never by its number or contact', () => {
  // `docs/protocol.md` → Calls → *What a Mac may keep about a call*: the rotating log carries the
  // call id, the state, and at most the last two digits. The contact name is not on that list.
  assert.equal(whoLine({ contactName: 'Contact D', number: '8800000004' }), 'number …04');
  assert.equal(whoLine({ number: '8800000004' }), 'number …04');
  assert.equal(whoLine({ contactName: 'Contact D' }), 'no number');

  // Defect 43's case still has a sentence rather than an empty slot.
  assert.equal(whoLine({ number: '', contactName: '' }), 'no number');
  assert.equal(whoLine({}), 'no number');
  for (const shape of [{ number: '', contactName: '' }, {}, { number: '   ' }]) {
    assert.ok(!whoLine(shape).includes('from ,'), `must never render "from ,": ${whoLine(shape)}`);
  }
  for (const shape of [{ contactName: 'Contact D', number: '8800000004' }, { number: '8800000004' }]) {
    assert.doesNotMatch(whoLine(shape), /8800000004|Contact D/, `leaked: ${whoLine(shape)}`);
  }
});

/*
 * Defect 53: every refusal that moves the counter leaves a line.
 *
 * The assertion is deliberately a **count equality** rather than four separate string checks.
 * Four checks prove the four sites that exist today are wired; the equality is what a fifth site
 * has to satisfy, and a fifth site incrementing silently is precisely how this defect arrived.
 *
 * What it does not reach: the file. `log.warn` is spied at the module object, so this proves the
 * call was made with the right shape, not that anything was written to disk.
 */
import { log } from './logger';

function captureWarnings(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = log.warn;
  log.warn = (where: string, message: string) => {
    lines.push(`${where}|${message}`);
  };
  return { lines, restore: () => { log.warn = original; } };
}

/**
 * Only the lines CallClient itself wrote about a refusal.
 *
 * The shared `ask` helper logs its own failure line, so a bare count of warnings is not the
 * discriminator — it counts two different subsystems. The client's refusal lines are the ones
 * carrying its tally, which is exactly the sentence defect 53 says must accompany the increment.
 */
function refusalLines(lines: string[]): string[] {
  return lines.filter((l) => l.startsWith('calls|') && / refused since launch/.test(l));
}

/** The refusal count, read out of the tally the client writes rather than a second copy of it. */
function refusedFrom(lines: string[]): number {
  const own = refusalLines(lines);
  const last = own[own.length - 1] ?? '';
  const m = last.match(/(\d+) refused since launch/);
  return m ? Number(m[1]) : -1;
}

test('defect 53: a dial with no number logs the refusal it counts', async () => {
  const { link } = fakePhone();
  const calls = new CallClient(() => link);
  const cap = captureWarnings();
  try {
    const result = await calls.dial('   ');
    assert.equal(result.ok, false);
    const own = refusalLines(cap.lines);
    assert.equal(own.length, 1, 'the refusal must leave exactly one line of its own');
    assert.match(own[0], /no number was given/i);
  } finally {
    cap.restore();
  }
});

test('defect 53: a dial the phone refuses logs the phone reason', async () => {
  const link = {
    isConnected: () => true,
    request: () => Promise.reject(new Error('the phone said no')),
  } as unknown as LinkClient;
  const calls = new CallClient(() => link);
  const cap = captureWarnings();
  try {
    const result = await calls.dial('+15551234567');
    assert.equal(result.ok, false);
    const own = refusalLines(cap.lines);
    assert.equal(own.length, 1, `expected one line of its own, got: ${cap.lines.join(' // ')}`);
    assert.match(own[0], /call\.dial refused by the phone/);
    // A refusal is about a specific attempt, so it names one — by the tail the rule allows.
    assert.match(own[0], /…67/, 'a refusal is about a specific attempt');
    assert.doesNotMatch(own[0], /5551234567/, 'the full number reached the log');
  } finally {
    cap.restore();
  }
});

test('defect 53: acting with no call showing logs its refusal', async () => {
  const { link } = fakePhone();
  const calls = new CallClient(() => link);
  const cap = captureWarnings();
  try {
    await calls.reject();
    const own = refusalLines(cap.lines);
    assert.equal(own.length, 1);
    assert.match(own[0], /no call is showing/);
  } finally {
    cap.restore();
  }
});

test('defect 53: the counter and the lines cannot diverge across every refusal path', async () => {
  const badLink = {
    isConnected: () => true,
    request: () => Promise.reject(new Error('nope')),
  } as unknown as LinkClient;
  const calls = new CallClient(() => badLink);
  const cap = captureWarnings();
  try {
    await calls.dial('');                       // refused here, empty number
    await calls.dial('+15550000000');           // refused by the phone
    await calls.reject();                       // refused here, no call showing
    calls.onIncoming(RINGING as never);
    await calls.reject();                       // refused by the phone, live call

    // Every refusal produced a line, and the client's own tally agrees with how many lines there
    // are. Neither number is written twice in this test: the count comes from the spy, the total
    // comes from the sentence the client composed.
    const own = refusalLines(cap.lines);
    assert.equal(own.length, 4, `expected four refusal lines, got: ${cap.lines.join(' // ')}`);
    assert.equal(
      refusedFrom(cap.lines),
      own.length,
      'the tally must agree with the number of refusal lines written',
    );
  } finally {
    cap.restore();
  }
});

/**
 * The privacy rule across every line this client writes, on every path that names a call.
 *
 * Asserted per line, never as a likeness between lines (the fourth test variety): each line is
 * checked for the full number and the contact name on its own. The control is that the tail the rule
 * allows does appear, so a client that logged nothing at all could not pass.
 */
test('no line this client logs carries a full number or a contact name', async () => {
  const lines: string[] = [];
  const keep = { info: log.info, warn: log.warn };
  log.info = (where: string, message: string) => void lines.push(`${where}|${message}`);
  log.warn = (where: string, message: string) => void lines.push(`${where}|${message}`);
  try {
    const { link } = fakePhone({ callId: 'c19' });
    const calls = new CallClient(() => link);
    calls.onIncoming(RINGING as never);
    await calls.answer();
    await calls.reject();
    calls.onIncoming(RINGING as never);
    calls.onEnded({ callId: 'c17', number: '+15551234567', durationMs: 4000, disposition: 'answered' });
    await calls.dial('+15551234567');

    const refusing = new CallClient(() => ({
      isConnected: () => true,
      request: () => Promise.reject(new Error('nope')),
    }) as unknown as LinkClient);
    await refusing.dial('+15551234567');

    const own = lines.filter((l) => l.startsWith('calls|'));
    assert.ok(own.length >= 6, `control: the client logged its paths (${own.length} lines)`);
    assert.ok(own.some((l) => l.includes('…67')), 'control: the permitted tail is present');
    for (const l of own) {
      assert.doesNotMatch(l, /5551234567/, `full number in: ${l}`);
      assert.doesNotMatch(l, /Ada|Lovelace/, `contact name in: ${l}`);
    }
  } finally {
    log.info = keep.info;
    log.warn = keep.warn;
  }
});

// ---- P2: reconnects, in main.ts's order ---------------------------------------------------------
//
// On a drop main.ts calls `calls.clear()`; on the next session the phone replays the call in progress
// with its original `callId` and `startedAtMs` (`CallFeature.replayTo`). A call that ends while the
// link is down sends no `call.ended`. Late frames from the old connection cannot reach this client at
// all: `link.ts` destroys the old socket at teardown (`linkSessionEnded.test.ts`).

test('a call replayed after a reconnect is shown again, and actions aim at it', async () => {
  const { link, sent } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming(RINGING as never);
  calls.clear();
  assert.equal(calls.currentCall(), null, 'control: the drop cleared the card');
  calls.onIncoming({ ...RINGING } as never);
  assert.equal(calls.currentCall()?.callId, 'c17');
  await calls.reject();
  assert.deepEqual(sent.at(-1), { type: 'call.reject', payload: { callId: 'c17' } });
});

test('a different call reusing an id after a phone restart replaces the card entirely', async () => {
  const { link, sent } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming({ ...RINGING, callId: 'c1' } as never);
  calls.clear(); // the call ends while the link is down: no call.ended ever arrives
  const reused = { ...NEXT_CALL, callId: 'c1', startedAtMs: RINGING.startedAtMs + 3_600_000 };
  calls.onIncoming(reused as never);
  assert.equal(calls.currentCall()?.number, NEXT_CALL.number, 'the old call’s number survived');
  assert.equal(calls.currentCall()?.startedAtMs, reused.startedAtMs);
  assert.equal(calls.currentCall()?.contactName, undefined, 'the old call’s name survived');
  await calls.answer();
  assert.deepEqual(sent.at(-1), { type: 'call.answer', payload: { callId: 'c1' } });
});

test('a replayed call that then ends clears the card and hands the ended event its card', () => {
  const { link } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming(RINGING as never);
  calls.clear();
  calls.onIncoming({ ...RINGING, state: 'active' } as never);
  const seen: Array<{ id: string; card: string | null }> = [];
  calls.on('ended', (ended: { callId: string }, card: { callId: string } | null) =>
    seen.push({ id: ended.callId, card: card?.callId ?? null }));
  calls.onEnded({ callId: 'c17', number: '', durationMs: 60_000, disposition: 'answered' });
  assert.equal(calls.currentCall(), null);
  assert.deepEqual(seen, [{ id: 'c17', card: 'c17' }]);
});

test('an ended event for a call the Mac never showed in this session leaves the card alone', () => {
  const { link } = fakePhone();
  const calls = new CallClient(() => link);
  calls.onIncoming(RINGING as never);
  calls.clear();
  calls.onIncoming(NEXT_CALL as never); // the new session's call
  let card: unknown = 'unset';
  calls.on('ended', (_e: unknown, c: unknown) => { card = c; });
  calls.onEnded({ callId: 'c17', number: '', durationMs: 0, disposition: 'missed' });
  assert.equal(calls.currentCall()?.callId, 'c18', 'the current call was cleared by another call’s end');
  assert.equal(card, null, 'the ended event was handed a card it does not describe');
});
