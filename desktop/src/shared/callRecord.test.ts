import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CallActivityRows,
  UNKNOWN_NUMBER,
  callHistoryName,
  callLogWho,
  numberTail,
} from './callRecord';
import type { CallEnded, IncomingCall } from './protocol';

/**
 * The Mac's call-data rules (`docs/protocol.md` → Calls → *What a Mac may keep about a call*),
 * asserted against the one module that implements them.
 *
 * Every assertion is about **one value** — a line, a row, a stored detail — never a likeness between
 * two (`CLAUDE.md`, the fourth test variety). "No row contains a number" is checked row by row.
 */

const RINGING: IncomingCall = {
  callId: 'c17',
  number: '+15551234567',
  contactName: 'Ada Lovelace',
  startedAtMs: 1756300000000,
  state: 'ringing',
};

const NAMELESS: IncomingCall = {
  callId: 'c18',
  number: '+15559998888',
  startedAtMs: 1756300100000,
  state: 'ringing',
};

/** A run of three digits is enough to call a stored detail a number, or part of one. */
const DIGIT_RUN = /\d{3,}/;

// ---- The log's name for a call -----------------------------------------------------------------

test('a number is reduced to its last two digits, and a number with fewer has no tail', () => {
  assert.equal(numberTail('+15551234567'), '…67');
  assert.equal(numberTail(' +1 (555) 12-34 '), '…34', 'formatting is not digits');
  assert.equal(numberTail('7'), null);
  assert.equal(numberTail(''), null);
  assert.equal(numberTail(undefined), null);
});

test('the log names a call by its tail, never by its number or its contact', () => {
  const named = callLogWho(RINGING);
  assert.equal(named, 'number …67');
  assert.doesNotMatch(named, /5551234567/, 'the full number reached a log line');
  assert.doesNotMatch(named, /Ada/, 'a contact name reached a log line');
  assert.equal(callLogWho({ number: '' }), 'no number');
  assert.equal(callLogWho({}), 'no number');
});

// ---- The history's name for a call -------------------------------------------------------------

test('history keeps a contact name, including one with digits in it', () => {
  // The control for every "Unknown number" below: a rule that answered Unknown for everything
  // would satisfy all of them and be a broken pane. Digits in a name are not a number.
  assert.equal(callHistoryName('Ada Lovelace'), 'Ada Lovelace');
  assert.equal(callHistoryName('  R. Sharma '), 'R. Sharma');
  assert.equal(callHistoryName('Room 101'), 'Room 101');
  assert.equal(callHistoryName('Plumber 24/7'), 'Plumber 24/7');
  assert.equal(callHistoryName('Flat 2B, Tower 14'), 'Flat 2B, Tower 14');
});

test('history never keeps a number, and never keeps a blank', () => {
  for (const raw of ['+15551234567', '9800000001', '+91 98000 00001', '(555) 123-4567', '121', '', '   ', 'unknown', undefined, null]) {
    assert.equal(callHistoryName(raw), UNKNOWN_NUMBER, `stored ${JSON.stringify(raw)} as itself`);
  }
});

test('a name carrying a phone number is not kept, however it is written', () => {
  assert.equal(callHistoryName('Mom 9800000001'), UNKNOWN_NUMBER);
  assert.equal(callHistoryName('Office +1 (555) 123-4567'), UNKNOWN_NUMBER);
});

test('leakage of the call\'s own number is caught directly, against that number', () => {
  // A contact the phone has no name for is displayed by its number, and a contact name can be the
  // number written another way. The direct test compares digits with the number on the call.
  assert.equal(callHistoryName('98000 00001', '+919800000001'), UNKNOWN_NUMBER);
  assert.equal(callHistoryName('Ravi 800-00001', '+919800000001'), UNKNOWN_NUMBER);
  // The control: a name whose digits are not the number survives the same comparison.
  assert.equal(callHistoryName('Flat 0001', '+919800000001'), 'Flat 0001');
});

// ---- Activity rows -----------------------------------------------------------------------------

test('a ringing call with a contact is recorded by name', () => {
  const rows = new CallActivityRows();
  assert.deepEqual(rows.changed(RINGING), { kind: 'Call ringing', detail: 'Ada Lovelace' });
});

test('a ringing call with no contact is "Unknown number", never its number', () => {
  // The defect: `c.name ?? c.number`. The payload field is `contactName`, so `name` was always
  // undefined and every row stored the raw number — or "" for a withheld one.
  const rows = new CallActivityRows();
  const row = rows.changed(NAMELESS);
  assert.ok(row, 'control: a new call produces a row');
  assert.equal(row.detail, UNKNOWN_NUMBER);
  assert.doesNotMatch(row.detail, DIGIT_RUN);
});

test('a withheld number is "Unknown number", never a blank detail', () => {
  const rows = new CallActivityRows();
  const row = rows.changed({ ...NAMELESS, number: '' });
  assert.ok(row);
  assert.equal(row.detail, UNKNOWN_NUMBER);
});

test('the same call in the same state is one row, and a new state is another', () => {
  const rows = new CallActivityRows();
  assert.ok(rows.changed(RINGING), 'control: the first event is recorded');
  // The phone re-sends call.incoming when the inbound number arrives late (defect 45's correction).
  assert.equal(rows.changed({ ...RINGING }), null, 'a re-sent event is not a second row');
  assert.deepEqual(rows.changed({ ...RINGING, state: 'active' }), {
    kind: 'Call in progress',
    detail: 'Ada Lovelace',
  });
  assert.deepEqual(rows.changed({ ...NAMELESS, state: 'dialing' }), {
    kind: 'Call dialling',
    detail: UNKNOWN_NUMBER,
  });
});

test('a cleared card is not a row', () => {
  const rows = new CallActivityRows();
  assert.equal(rows.changed(null), null);
});

test('an ended call is recorded, and a missed one says so', () => {
  const ended = (disposition: CallEnded['disposition']): CallEnded => ({
    callId: 'c17',
    number: '+15551234567',
    durationMs: 0,
    disposition,
  });
  const rows = new CallActivityRows();
  assert.deepEqual(rows.ended(ended('missed'), RINGING), { kind: 'Missed call', detail: 'Ada Lovelace' });
  assert.deepEqual(rows.ended(ended('answered'), RINGING), { kind: 'Call ended', detail: 'Ada Lovelace' });
  assert.deepEqual(rows.ended(ended('rejected'), RINGING), { kind: 'Call rejected', detail: 'Ada Lovelace' });
  assert.deepEqual(rows.ended(ended('declined'), RINGING), {
    kind: 'Call ended — other side hung up',
    detail: 'Ada Lovelace',
  });
  // An end the Mac had no card for — a late event, or one after a reconnect — still names nobody.
  assert.deepEqual(rows.ended(ended('missed'), null), { kind: 'Missed call', detail: UNKNOWN_NUMBER });
});

test('a call that ended and rings again with the same id is a new row', () => {
  // Ids restart at c1 when the phone process restarts, so an id is unique per episode, not forever.
  const rows = new CallActivityRows();
  assert.ok(rows.changed(RINGING));
  rows.ended({ callId: 'c17', number: '', durationMs: 0, disposition: 'missed' }, RINGING);
  assert.ok(rows.changed(RINGING), 'the next episode with a reused id was swallowed');
});

test('no row from a whole call carries a run of digits', () => {
  const rows = new CallActivityRows();
  const produced = [
    rows.changed(NAMELESS),
    rows.changed({ ...NAMELESS, state: 'active' }),
    rows.ended({ callId: 'c18', number: '+15559998888', durationMs: 42_000, disposition: 'answered' }, NAMELESS),
  ];
  assert.equal(produced.filter(Boolean).length, 3, 'control: three rows were produced');
  for (const row of produced) {
    assert.ok(row);
    assert.doesNotMatch(row.detail, DIGIT_RUN, `${row.kind} stored ${row.detail}`);
    assert.doesNotMatch(row.kind, DIGIT_RUN, `${row.kind} carries digits in its kind`);
  }
});

// ---- P2: reconnects, replays and reused ids, in production order ------------------------------
//
// The order is main.ts's: on a drop the status leaves `connected` and `calls.clear()` emits a
// `changed(null)`; on the next session the phone replays the call in progress (`CallFeature.replayTo`
// builds it from the same episode, so `callId` **and** `startedAtMs` are the original ones). A call
// that ends while the link is down produces **no** `call.ended` — the phone only sends to live
// sessions — and ids restart at `c1` when the phone process restarts.

test('a call replayed after a reconnect is not a second row', () => {
  const rows = new CallActivityRows();
  assert.ok(rows.changed(RINGING), 'control: the first sighting is a row');
  assert.equal(rows.changed(null), null, 'the disconnect clears the card');
  assert.equal(rows.changed({ ...RINGING }), null, 'the replay of the same call was recorded again');
  assert.ok(rows.changed({ ...RINGING, state: 'active' }), 'control: a real state change still records');
  assert.equal(rows.changed(null), null);
  assert.equal(rows.changed({ ...RINGING, state: 'active' }), null, 'the replay of the active call was recorded again');
});

/**
 * **Finding, not fixed in this batch** (P0 behaviour, outside P1 — held for approval).
 *
 * c1 rings; the link drops; c1 ends while it is down, so no `call.ended` arrives; the phone process
 * restarts, so ids restart; a *different* call rings as c1. It carries a different `startedAtMs`,
 * which is the only field that tells the two apart — and `CallActivityRows` keys on `(callId,
 * state)`, so the second call is swallowed as a replay of the first. The smallest fix keys on
 * `(callId, startedAtMs, state)`, using a field the production event already carries.
 */
test('a different call that reuses an id after a phone restart is a new row', { todo: 'held for approval: key rows on startedAtMs too' }, () => {
  const rows = new CallActivityRows();
  assert.ok(rows.changed(RINGING), 'control: the first call is a row');
  rows.changed(null); // the link drops; RINGING ends unseen
  const reused = { ...RINGING, contactName: 'R. Sharma', number: '+919800000002', startedAtMs: RINGING.startedAtMs + 3_600_000 };
  assert.ok(rows.changed(reused), 'a different call with a reused id was swallowed');
});
