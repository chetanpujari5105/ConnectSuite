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

// ---- The pane's pure rules, rebuilt with it 2026-09-05 --------------------------------------------

const smsRules = (globalThis as Record<string, unknown>).__smsRules as {
  filterThreads(threads: ReadonlyArray<Record<string, unknown>>, tab: string): unknown[];
  threadWho(thread: Record<string, unknown>): string;
  threadInitials(thread: Record<string, unknown>): string;
  personFacts(thread: Record<string, unknown>): Array<[string, string]>;
  withDaySeparators(
    messages: ReadonlyArray<{ dateMs: number; id: string }>,
  ): Array<{ kind: string; label?: string; message?: { id: string } }>;
  dayLabelOf(dateMs: number, nowMs: number): string;
  SMS_TABS: ReadonlyArray<{ id: string; label: string }>;
  SMS_PERSON_REFUSAL: string;
};

const row = (over: Record<string, unknown> = {}) => ({
  threadId: '1',
  addresses: ['+919800000001'],
  snippet: 'hello',
  dateMs: new Date(2024, 4, 15, 12).getTime(),
  unread: 0,
  messageCount: 12,
  ...over,
});

test('the strip is two tabs, and neither of the design’s other two is faked', () => {
  // `sms.threads` carries no kind, so "SMS" would need every conversation opened to label the list;
  // "Chat" means RCS, which this app does not implement. `unread` is on every row, so it is real.
  assert.deepEqual(smsRules.SMS_TABS.map((t) => t.id), ['all', 'unread']);
  assert.deepEqual(smsRules.SMS_TABS.map((t) => t.label), ['All', 'Unread']);
  for (const forbidden of ['sms', 'chat', 'rcs']) {
    assert.ok(
      !smsRules.SMS_TABS.some((t) => t.id === forbidden || t.label.toLowerCase() === forbidden),
      `a "${forbidden}" tab cannot be answered from sms.threads`,
    );
  }
});

test('Unread filters on the field the wire actually sends', () => {
  const threads = [row({ threadId: 'a', unread: 3 }), row({ threadId: 'b', unread: 0 }), row({ threadId: 'c', unread: 1 })];
  assert.equal(smsRules.filterThreads(threads, 'all').length, 3);
  assert.equal(smsRules.filterThreads(threads, 'unread').length, 2);
  // A copy, not the array itself — a filter that hands back its input lets a caller sort the
  // pane's own state by accident.
  assert.notEqual(smsRules.filterThreads(threads, 'all'), threads);
});

test('who a conversation is with is never blank, and empty is not nullish', () => {
  assert.equal(smsRules.threadWho(row({ contactName: 'R. Sharma' })), 'R. Sharma');
  assert.equal(smsRules.threadWho(row()), '+919800000001');
  // Defect 35's rule: `"" ?? x` is `""`, so a phone reporting an empty name must not walk past the
  // fallback chain written to catch exactly this.
  assert.equal(smsRules.threadWho(row({ contactName: '' })), '+919800000001');
  assert.equal(smsRules.threadWho(row({ contactName: '   ' })), '+919800000001');
  assert.equal(smsRules.threadWho(row({ contactName: '', addresses: [] })), 'Unknown number');
  assert.equal(smsRules.threadWho(row({ addresses: [''] })), 'Unknown number');
});

test('initials come from the name, and a bare number gets a hash rather than digits', () => {
  assert.equal(smsRules.threadInitials(row({ contactName: 'R. Sharma' })), 'RS');
  // A single word gives two letters, which is what the design draws and what tells this phone's
  // machine sender ids apart — first-letter-per-word drew a column of `A`, `V`, `C`.
  assert.equal(smsRules.threadInitials(row({ contactName: 'Mom' })), 'MO');
  assert.equal(smsRules.threadInitials(row({ contactName: 'AD-SUJAMK-P' })), 'AD');
  assert.equal(smsRules.threadInitials(row({ contactName: 'VM-TNSBIC-P' })), 'VM');
  assert.equal(smsRules.threadInitials(row({ contactName: 'X' })), 'X');
  assert.equal(smsRules.threadInitials(row()), '#');
  assert.equal(smsRules.threadInitials(row({ contactName: '', addresses: [] })), '#');
});

test('the person card draws only facts the wire holds', () => {
  const labels = smsRules.personFacts(row()).map(([l]) => l);
  assert.deepEqual(labels, ['Messages', 'Latest']);
  // Unread only when there is some, and recipients only for a group — a row reading "Unread 0" or
  // "Recipients 1" is a number nobody needs.
  assert.ok(!smsRules.personFacts(row()).some(([l]) => l === 'Unread'));
  assert.ok(smsRules.personFacts(row({ unread: 4 })).some(([l]) => l === 'Unread'));
  assert.ok(!smsRules.personFacts(row()).some(([l]) => l === 'Recipients'));
  assert.ok(
    smsRules.personFacts(row({ addresses: ['+911', '+912'] })).some(([l]) => l === 'Recipients'),
  );
  // `messageCount` is the phone's total, not the rows this Mac has paged in.
  assert.match(smsRules.personFacts(row({ messageCount: 318 })).find(([l]) => l === 'Messages')![1], /318/);
});

test('the person refusal names what is gone, not what is offered, and claims nothing has failed', () => {
  // Frame 32:4382's sentence. Calling left this list on 2026-09-19 when the column gained *Call this
  // number* — a refusal naming a control drawn two inches above it would contradict the column.
  const line = smsRules.SMS_PERSON_REFUSAL;
  for (const word of ['Muting', 'blocking']) {
    assert.ok(line.toLowerCase().includes(word.toLowerCase()), `the refusal does not name ${word}`);
  }
  assert.doesNotMatch(line, /call/i, 'the refusal names calling, which the column now offers');
  assert.doesNotMatch(line, /fail|error|unavailable|try again/i);
});

test('a date separator opens the conversation and appears wherever the day changes', () => {
  const at = (d: number, h = 12) => new Date(2024, 4, d, h).getTime();
  const items = smsRules.withDaySeparators([
    { id: 'a', dateMs: at(14, 9) },
    { id: 'b', dateMs: at(14, 18) },
    { id: 'c', dateMs: at(15, 9) },
  ]);
  assert.deepEqual(
    items.map((i) => (i.kind === 'day' ? 'day' : i.message!.id)),
    ['day', 'a', 'b', 'day', 'c'],
  );
  // The first message always gets one. A conversation opening mid-day with no heading reads as
  // though the messages above it were cut off.
  assert.equal(items[0]!.kind, 'day');
});

test('day headings cross midnight by the local day, not by subtracting 24 hours', () => {
  const NOW = new Date(2024, 4, 15, 14, 30).getTime();
  const at = (d: number, h = 12) => new Date(2024, 4, d, h).getTime();
  assert.equal(smsRules.dayLabelOf(at(15, 9), NOW), 'Today');
  assert.equal(smsRules.dayLabelOf(at(14, 23), NOW), 'Yesterday');
  // One millisecond before midnight is emphatically not today to the person who was there.
  assert.equal(smsRules.dayLabelOf(new Date(2024, 4, 15, 0, 0, 0, 0).getTime() - 1, NOW), 'Yesterday');
  assert.match(smsRules.dayLabelOf(at(11), NOW), /May/);
  assert.match(smsRules.dayLabelOf(new Date(2023, 4, 11, 12).getTime(), NOW), /2023/);
  // A day is not always 24 hours, so the boundary is computed from local midnight rather than by
  // arithmetic on milliseconds.
  const justAfterMidnight = new Date(2024, 4, 15, 0, 0, 1).getTime();
  assert.equal(smsRules.dayLabelOf(justAfterMidnight, new Date(2024, 4, 15, 0, 0, 30).getTime()), 'Today');
  assert.equal(
    smsRules.dayLabelOf(justAfterMidnight - 23 * 3600 * 1000, new Date(2024, 4, 15, 0, 0, 30).getTime()),
    'Yesterday',
  );
});
