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

test('history keeps a contact name', () => {
  // The control for every "Unknown number" below: a rule that answered Unknown for everything
  // would satisfy all of them and be a broken pane.
  assert.equal(callHistoryName('Ada Lovelace'), 'Ada Lovelace');
  assert.equal(callHistoryName('  R. Sharma '), 'R. Sharma');
});

test('history never keeps a number, and never keeps a blank', () => {
  for (const raw of ['+15551234567', '9800000001', '+91 98000 00001', '', '   ', 'unknown', undefined, null]) {
    assert.equal(callHistoryName(raw), UNKNOWN_NUMBER, `stored ${JSON.stringify(raw)} as itself`);
  }
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
