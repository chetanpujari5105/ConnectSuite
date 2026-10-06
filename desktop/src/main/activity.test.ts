import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityStore } from './activity';

/**
 * The persisted Activity history must never retain a raw phone number — `docs/protocol.md` →
 * Calls → *What a Mac may keep about a call*.
 *
 * These reach the **file**, not only the in-memory list, because the rule is about what is on
 * disk. The store is pointed at a temporary directory through `initAt`, the same path `init()`
 * takes with the real profile directory.
 */

const FULL = '+15551234567';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'activity-test-'));
}

function line(seq: number, category: string, kind: string, detail: string): string {
  return JSON.stringify({ seq, at: 1756300000000 + seq, category, kind, detail });
}

test('a calls row recorded with a number is stored as "Unknown number"', () => {
  const where = dir();
  const store = new ActivityStore();
  store.initAt(where);
  store.record('calls', 'Call ringing', FULL);

  const stored = store.all().at(-1);
  assert.ok(stored, 'control: the row was recorded');
  assert.equal(stored.detail, 'Unknown number');
  const onDisk = readFileSync(join(where, 'activity.jsonl'), 'utf8');
  assert.ok(onDisk.includes('Call ringing'), 'control: the file holds the row');
  assert.ok(!onDisk.includes('5551234567'), 'the file holds the raw number');
});

test('a calls row recorded with a contact name keeps the name', () => {
  const store = new ActivityStore();
  store.initAt(dir());
  store.record('calls', 'Call ringing', 'Ada Lovelace');
  assert.equal(store.all().at(-1)?.detail, 'Ada Lovelace');
});

test('a row of another category is stored exactly as given', () => {
  // The scope of the rule is calls. A thread id or a byte count is not a phone number, and a
  // scrubber that reached every category would quietly destroy the rest of the history.
  const store = new ActivityStore();
  store.initAt(dir());
  store.record('messages', 'Message received', 'thread 12345');
  assert.equal(store.all().at(-1)?.detail, 'thread 12345');
});

test('history written before the rule is rewritten on load, in both files', () => {
  const where = dir();
  const main = join(where, 'activity.jsonl');
  const old = `${main}.old`;
  writeFileSync(
    main,
    [
      line(1, 'calls', 'Call ringing', FULL),
      line(2, 'messages', 'Message received', 'thread 12345'),
      line(3, 'calls', 'Call active', ''),
      line(4, 'calls', 'Call ringing', 'unknown'),
      '{"seq":5,"at":17563000', // a half-written last line, the expected corruption
    ].join('\n') + '\n',
  );
  writeFileSync(old, line(0, 'calls', 'Call ringing', '+919800000001') + '\n');

  const store = new ActivityStore();
  store.initAt(where);

  const calls = store.all().filter((e) => e.category === 'calls');
  assert.equal(calls.length, 3, 'control: every readable call row was read');
  for (const event of calls) assert.equal(event.detail, 'Unknown number', `row ${event.seq}`);
  assert.equal(
    store.all().find((e) => e.category === 'messages')?.detail,
    'thread 12345',
    'a non-call row survived the rewrite untouched',
  );

  const mainText = readFileSync(main, 'utf8');
  assert.ok(mainText.includes('Message received'), 'control: the rewritten file kept its rows');
  assert.ok(!mainText.includes('5551234567'), 'the raw number survived on disk');
  assert.ok(existsSync(old), 'control: the old half still exists');
  assert.ok(!readFileSync(old, 'utf8').includes('9800000001'), 'the raw number survived in .old');
});

test('a clean history is not rewritten', () => {
  const where = dir();
  const main = join(where, 'activity.jsonl');
  const clean = [line(1, 'calls', 'Call ringing', 'Ada Lovelace'), line(2, 'calls', 'Missed call', 'Unknown number')]
    .join('\n') + '\n';
  writeFileSync(main, clean);
  const store = new ActivityStore();
  store.initAt(where);
  assert.equal(store.all().length, 2, 'control: both rows were read');
  assert.equal(readFileSync(main, 'utf8'), clean, 'a file with nothing to scrub was rewritten');
});

// ---------------------------------------------------------------------------------------------
// The one-time rewrite is irreversible by design — a backup would keep the numbers it removes — so
// it may touch only what the call-data rule is about. Synthetic rows only; nothing here reads a
// real profile.

test('an unreadable line that cannot hold call data is kept, and the file is left byte for byte', () => {
  const where = dir();
  const main = join(where, 'activity.jsonl');
  const text = [
    line(1, 'messages', 'Message received', 'thread 7'),
    '{"seq":2,"at":17563000', // a hard quit's half-written last line, cut before any detail
    line(3, 'files', 'Pulled', 'a.txt'),
  ].join('\n') + '\n';
  writeFileSync(main, text);
  const store = new ActivityStore();
  store.initAt(where);
  assert.equal(store.all().length, 2, 'control: the two readable rows were read');
  assert.equal(store.stats().skipped, 1, 'control: the half line was seen and skipped');
  assert.equal(readFileSync(main, 'utf8'), text, 'a file with no call data in it was rewritten');
});

test('an unreadable line that may hold call data is dropped from disk, and counted', () => {
  const where = dir();
  const main = join(where, 'activity.jsonl');
  writeFileSync(
    main,
    [
      line(1, 'messages', 'Message received', 'thread 7'),
      '{"seq":2,"at":1756300000002,"category":"calls","kind":"Call ringing","detail":"+1555123', // cut
    ].join('\n') + '\n',
  );
  const store = new ActivityStore();
  store.initAt(where);
  const onDisk = readFileSync(main, 'utf8');
  assert.ok(onDisk.includes('Message received'), 'control: the readable row survived');
  assert.ok(!onDisk.includes('1555123'), 'a half-written call row kept its number on disk');
});

test('a non-call row is preserved byte for byte when call rows around it are rewritten', () => {
  const where = dir();
  const main = join(where, 'activity.jsonl');
  // A field this build does not know, and a spacing it would not write. Both are a newer or older
  // writer's business, not the call-data rule's.
  const foreign = '{"seq":2, "at":1756300000002, "category":"files", "kind":"Pulled", "detail":"a.txt", "bytes":42}';
  writeFileSync(main, [line(1, 'calls', 'Call ringing', FULL), foreign].join('\n') + '\n');
  const store = new ActivityStore();
  store.initAt(where);
  const lines = readFileSync(main, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'control: both rows are still on disk');
  assert.ok(!lines[0]!.includes('5551234567'), 'control: the call row was rewritten');
  assert.equal(lines[1], foreign, 'the non-call row was re-serialised and lost what the parser does not read');
});

test('a rewrite that cannot be written leaves the history readable', () => {
  const where = dir();
  const main = join(where, 'activity.jsonl');
  const old = `${main}.old`;
  writeFileSync(main, [line(1, 'messages', 'Message received', 'thread 7'), line(2, 'calls', 'Call ringing', FULL)].join('\n') + '\n');
  writeFileSync(old, line(0, 'calls', 'Call ringing', '+919800000001') + '\n');
  // The rewrite's temporary path is occupied by a directory, so writing it fails — a full disk or
  // a permissions change, without needing either.
  mkdirSync(`${old}.rewrite`);
  mkdirSync(`${main}.rewrite`);
  const store = new ActivityStore();
  store.initAt(where);
  assert.equal(store.error(), null, 'a failed rewrite of a readable file was reported as an unreadable log');
  assert.equal(store.all().length, 2, 'the history was not loaded because a rewrite failed');
  assert.equal(store.all().find((e) => e.category === 'calls')?.detail, 'Unknown number', 'the screen showed the number');
});

test('an event recorded after a half-written last line is readable on the next launch', () => {
  const where = dir();
  const main = join(where, 'activity.jsonl');
  writeFileSync(main, line(1, 'messages', 'Message received', 'thread 7') + '\n{"seq":2,"at":17563000'); // no newline
  const first = new ActivityStore();
  first.initAt(where);
  first.record('files', 'Pulled', 'b.txt');
  const second = new ActivityStore();
  second.initAt(where);
  assert.ok(
    second.all().some((e) => e.kind === 'Pulled' && e.detail === 'b.txt'),
    'the new event was appended onto the broken line and became unreadable too',
  );
});

// ---------------------------------------------------------------------------------------------
// Verification-prep finding, 2026-10-06 (docs/evidence/verification-prep-2026-10-06/
// activity-rewrite-synthetic.txt): the rewrite re-serialised every call row from its five parsed
// fields. A call row with an extra field lost it; a call row in another key order was rewritten
// with nothing to redact. These are those exact synthetic rows.

const EXTRA_FIELD_NAME = '{"seq":4,"at":1003,"category":"calls","kind":"Call ended","detail":"Test Contact B","extra":"x"}';
const OTHER_KEY_ORDER = '{"at":1004,"seq":4.5,"category":"calls","kind":"Call ringing","detail":"Test Contact C"}';
const NUMBER_WITH_EXTRA = '{"at":1001,"seq":2,"category":"calls","kind":"Missed call","detail":"+91 98000 00001","extra":"x","n":1.5}';
const UNKNOWN_FIELD_NUMBER = '{"seq":9,"at":1009,"category":"calls","kind":"Missed call","detail":"Test Contact D","callerNumber":"+91 98000 00002"}';

function loadCapturingLog(lines: string[]): { text: string; logs: string[]; store: ActivityStore; path: string } {
  const where = dir();
  const path = join(where, 'activity.jsonl');
  writeFileSync(path, lines.join('\n') + '\n');
  const logs: string[] = [];
  const real = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  const store = new ActivityStore();
  try {
    store.initAt(where);
  } finally {
    console.log = real;
  }
  return { text: readFileSync(path, 'utf8'), logs, store, path };
}

test('prep finding: a call row with an unknown field and nothing to redact is kept byte for byte', () => {
  const { text, store } = loadCapturingLog([EXTRA_FIELD_NAME]);
  assert.equal(store.all().length, 1, 'control: the row was read');
  assert.equal(text, EXTRA_FIELD_NAME + '\n');
});

test('prep finding: a call row in another key order with nothing to redact is kept byte for byte', () => {
  const { text, store } = loadCapturingLog([OTHER_KEY_ORDER]);
  assert.equal(store.all()[0]?.detail, 'Test Contact C', 'control: the row was read');
  assert.equal(text, OTHER_KEY_ORDER + '\n');
});

test('prep finding: redaction changes only `detail` — every other field, value and key order survives', () => {
  const { text, store } = loadCapturingLog([NUMBER_WITH_EXTRA]);
  assert.equal(store.all()[0]?.detail, 'Unknown number');
  assert.ok(!text.includes('98000'), 'the number survived on disk');
  const written = JSON.parse(text) as Record<string, unknown>;
  const original = JSON.parse(NUMBER_WITH_EXTRA) as Record<string, unknown>;
  assert.deepEqual(Object.keys(written), Object.keys(original), 'key order changed');
  assert.deepEqual({ ...written, detail: original.detail }, original, 'a field other than detail changed');
  assert.equal(written.detail, 'Unknown number');
});

test('prep finding: an unknown field that may hold call data is kept and reported, never silently deleted', () => {
  const { text, logs } = loadCapturingLog([UNKNOWN_FIELD_NUMBER]);
  assert.equal(text, UNKNOWN_FIELD_NUMBER + '\n', 'the row was changed — the policy question is not ours to answer silently');
  const reported = logs.filter((l) => l.includes('unknown field') && l.includes('callerNumber'));
  assert.equal(reported.length, 1, `not reported: ${JSON.stringify(logs)}`);
  assert.ok(!reported[0]!.includes('98000'), 'the report carried the value');
});

test('prep finding: the fixed rewrite is idempotent over all four rows, and non-call rows stay exact', () => {
  const nonCall = '{"seq":5,"at":1005,"category":"files","kind":"Sent to phone","detail":"synthetic.bin","note":"kept"}';
  const first = loadCapturingLog([EXTRA_FIELD_NAME, OTHER_KEY_ORDER, NUMBER_WITH_EXTRA, UNKNOWN_FIELD_NUMBER, nonCall]);
  assert.ok(first.text.includes(nonCall + '\n'), 'a non-call row changed');
  const second = loadCapturingLog(first.text.trimEnd().split('\n'));
  assert.equal(second.text, first.text, 'a second launch changed the file');
  assert.ok(!second.logs.some((l) => l.includes('Rewrote')), 'a second launch rewrote');
});
