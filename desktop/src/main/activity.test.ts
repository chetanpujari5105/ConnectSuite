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
