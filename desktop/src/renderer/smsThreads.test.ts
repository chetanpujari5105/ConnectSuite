/**
 * Defect 32's second half: the thread pager must not repeat conversations across pages.
 *
 * The pager itself was the easy part — the phone has always accepted `before` and this Mac never
 * sent one. What the defect record did not know, because it was written from the Mac's side, is
 * that `content://mms-sms/conversations` yields a row per **message**, not per thread. A
 * conversation with messages either side of a page boundary therefore arrives on both pages.
 * Measured on hardware before this rule existed: **page 2 repeated 11 of page 1's 50 threads.**
 *
 * Shown to fail: with `dedupeByThread` replaced by an identity function the paging test below goes
 * red at 100 instead of 89, which is the exact number the device produced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

require('./sms.ts');
const dedupeByThread = (globalThis as unknown as {
  dedupeByThread: <T extends { threadId: string }>(rows: T[]) => T[];
}).dedupeByThread;

const thread = (id: string, dateMs: number) => ({ threadId: id, dateMs });

test('a conversation appearing on two pages is kept once', () => {
  const page1 = [thread('1', 900), thread('2', 800), thread('3', 700)];
  const page2 = [thread('3', 650), thread('4', 600)];

  const merged = dedupeByThread([...page1, ...page2]);

  assert.deepEqual(merged.map((t) => t.threadId), ['1', '2', '3', '4']);
});

test('the first occurrence wins, because the pages walk newest first', () => {
  // Thread 3's page-1 row carries its most recent message — the snippet, date and unread count a
  // person expects to see. Keeping the page-2 row would silently age the row on screen.
  const merged = dedupeByThread([thread('3', 700), thread('3', 650)]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.dateMs, 700, 'the newer row is the one the list is meant to show');
});

test('the device’s own numbers: 50 + 50 with 11 repeats is 89', () => {
  // The regression this is really guarding. These are the counts read off the phone on
  // 2026-08-31, not invented ones.
  const page1 = Array.from({ length: 50 }, (_, i) => thread(`t${i}`, 1000 - i));
  const page2 = [
    ...page1.slice(0, 11).map((t) => ({ ...t, dateMs: t.dateMs - 500 })),
    ...Array.from({ length: 39 }, (_, i) => thread(`u${i}`, 400 - i)),
  ];

  assert.equal(dedupeByThread([...page1, ...page2]).length, 89);
});

test('control_the assertion can see a duplicate', () => {
  // Without this, every test above would pass against a dedupe that silently dropped everything,
  // or against one that did nothing on inputs that happened to be unique.
  assert.equal(dedupeByThread([thread('1', 1), thread('1', 2)]).length, 1);
  assert.equal(dedupeByThread([thread('1', 1), thread('2', 2)]).length, 2);
});
