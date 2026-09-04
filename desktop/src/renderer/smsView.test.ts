import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, installFakeWindow, el } from './domDouble.testkit';
import './sms';

/**
 * The SMS pane's view class, driven for real.
 *
 * Its debt-list reason was *"Phase 4, proven on hardware across 5 pager pages; retro-fitting is
 * Phase 6 work"*, and the hardware run is genuinely the stronger evidence for the **pager** — a
 * provider's paging behaviour is not something a double can model, and `CLAUDE.md` is explicit that
 * a test reaching a provider by a path the app never takes can pass forever over a feature that has
 * never worked.
 *
 * So this file deliberately does **not** re-enact the pager. What it covers is the half the
 * hardware run could not isolate: the de-duplication that a repeated row triggers, the two
 * conditions on `openThread` that discard a stale reply, the fallback chain that must never draw a
 * blank name, and defect 30's rule that the pane opens **the thread the phone names** rather than
 * one it assumes it created.
 */

type Thread = {
  threadId: string;
  addresses: string[];
  contactName?: string;
  snippet: string;
  dateMs: number;
  unread: number;
  messageCount: number;
};
type Message = { id: string; threadId: string; body: string; dateMs: number; incoming: boolean };

class FakeBridge {
  threads: Thread[] = [];
  threadsHasMore = false;
  /** Keyed by thread id, so a stale reply for a thread nobody is looking at can be constructed. */
  messages = new Map<string, Message[]>();
  readonly calls: string[] = [];
  sendNewResult: { ok: boolean; threadId?: string; reason?: string } = { ok: true, threadId: 't-real' };
  /** Set to hold the next `smsMessages`, so a reply can be made to land after the reader moved on. */
  holdMessages: (() => void) | null = null;
  private received: ((e: { threadId: string; message: Message }) => void) | null = null;

  async smsThreads(options: { before?: number }) {
    this.calls.push(`smsThreads:${options.before ?? 'first'}`);
    return { ok: true as const, data: { threads: this.threads, hasMore: this.threadsHasMore } };
  }
  async smsMessages(threadId: string, options: { before?: number }) {
    this.calls.push(`smsMessages:${threadId}:${options.before ?? 'first'}`);
    if (this.holdMessages) await new Promise<void>((resolve) => (this.holdMessages = resolve));
    return {
      ok: true as const,
      data: { threadId, messages: this.messages.get(threadId) ?? [], hasMore: false },
    };
  }
  async smsSend(threadId: string, body: string) {
    this.calls.push(`smsSend:${threadId}:${body}`);
    return { ok: true };
  }
  async smsSendNew(addresses: string[], body: string) {
    this.calls.push(`smsSendNew:${addresses.join(',')}:${body}`);
    return this.sendNewResult;
  }
  onSmsReceived(cb: (e: { threadId: string; message: Message }) => void) {
    this.received = cb;
  }
  fireReceived(threadId: string, message: Message): void {
    this.received?.({ threadId, message });
  }
}

installFakeDocument();
installFakeWindow();

interface Pane {
  bridge: FakeBridge;
  card: FakeElement;
  note: FakeElement;
  body: FakeElement;
  notice: FakeElement;
  view: { setAdvertised(on: boolean): void; refresh(): Promise<void> };
}

function mount(threads: Thread[] = []): Pane {
  const bridge = new FakeBridge();
  bridge.threads = threads;
  const parts = { card: el('div'), note: el('p'), body: el('div'), notice: el('div') };
  const View = (globalThis as Record<string, unknown>).SmsView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(parts.card, parts.note, parts.body, parts.notice, bridge);
  return { bridge, ...parts, view };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function thread(id: string, over: Partial<Thread> = {}): Thread {
  return {
    threadId: id,
    addresses: [`+9198000000${id}`],
    snippet: `snippet ${id}`,
    dateMs: 2_000_000 - Number(id) * 1000,
    unread: 0,
    messageCount: 3,
    ...over,
  };
}

function message(id: string, threadId: string, dateMs: number, incoming = true): Message {
  return { id, threadId, body: `body ${id}`, dateMs, incoming };
}

// ---- Names, which must never be blank ------------------------------------------------------------

test('a thread shows a name, then a number, and never nothing', async () => {
  const pane = mount([
    thread('1', { contactName: 'R. Sharma' }),
    thread('2'),
    thread('3', { addresses: [] }),
  ]);
  pane.view.setAdvertised(true);
  await settle();

  assert.deepEqual(pane.body.queryAll('.sms-who').map((w) => w.textContent), [
    'R. Sharma',
    '+91980000002',
    // The fallback chain is written out rather than defaulted, so an empty `addresses` still
    // produces words. Defect 35 is the same rule one pane over.
    'Unknown number',
  ]);
});

test('the list count carries what it is a count of, both numbers', async () => {
  const pane = mount([thread('1', { contactName: 'R. Sharma', unread: 2 }), thread('2')]);
  pane.view.setAdvertised(true);
  await settle();
  // A count of threads says nothing about whether contact resolution is working, which is the
  // thing this pane's hardware step was actually checking.
  assert.match(pane.note.textContent, /2 conversations, 1 showing a contact name, 2 unread/);
});

test('an unread count reaches a screen reader, not only a coloured pill', async () => {
  // Defect 26's rule. The pill is a colour; the number has to be in the accessible name.
  const pane = mount([thread('1', { unread: 3 })]);
  pane.view.setAdvertised(true);
  await settle();
  const badge = pane.body.queryAll('.sms-unread')[0];
  assert.ok(badge, 'control: the badge is drawn');
  assert.match(badge.textContent, /3 unread/);
});

// ---- The de-duplication a real provider forces ---------------------------------------------------

test('a thread repeated across a page boundary appears once, keeping the newer row', async () => {
  // `content://mms-sms/conversations` yields a row per *message*, not per thread, so a conversation
  // with messages either side of a page boundary comes back on both pages — 11 of 50 did, on
  // hardware, before the dedupe existed. The first occurrence is kept because the pages walk
  // newest-first, so it carries the thread's most recent snippet and unread count.
  const pane = mount([thread('1', { snippet: 'newest' }), thread('2')]);
  pane.bridge.threadsHasMore = true;
  pane.view.setAdvertised(true);
  await settle();
  assert.equal(pane.body.queryAll('.sms-thread').length, 2, 'control: page one drew two');

  pane.bridge.threads = [thread('2'), thread('1', { snippet: 'stale repeat' }), thread('3')];
  pane.bridge.threadsHasMore = false;
  pane.body.queryAll('button').find((b) => b.id === 'sms-older-threads')?.click();
  await settle();

  const ids = pane.body.queryAll('.sms-thread').map((t) => t.dataset.threadId);
  assert.deepEqual(ids, ['1', '2', '3']);
  assert.match(pane.body.textContent, /newest/);
  assert.ok(!pane.body.textContent.includes('stale repeat'), 'the later, staler row won');
});

test('a fresh load replaces rather than appends', async () => {
  // Appending on a refresh would double every thread already held, the first time anybody pressed
  // refresh after paging.
  const pane = mount([thread('1'), thread('2')]);
  pane.view.setAdvertised(true);
  await settle();
  await pane.view.refresh();
  assert.equal(pane.body.queryAll('.sms-thread').length, 2);
});

test('the control that lifts the limit is drawn beside the sentence describing it', async () => {
  // Defect 32: the prose said older conversations were not shown and the reader had nowhere to go.
  // A sentence describing a limit is not a control that lifts it.
  const pane = mount([thread('1')]);
  pane.bridge.threadsHasMore = true;
  pane.view.setAdvertised(true);
  await settle();
  assert.match(pane.note.textContent, /Older conversations are not shown yet/);
  assert.ok(pane.body.queryAll('button').some((b) => b.id === 'sms-older-threads'));

  pane.bridge.threadsHasMore = false;
  await pane.view.refresh();
  // The control on that assertion: with nothing more to load the button is gone, so its presence
  // above is the condition working rather than a button that is always there.
  assert.ok(!pane.body.queryAll('button').some((b) => b.id === 'sms-older-threads'));
});

// ---- A reply that arrives after the reader moved on ----------------------------------------------

test('a slow thread load does not draw over the thread now open', async () => {
  const pane = mount([thread('1'), thread('2')]);
  pane.bridge.messages.set('1', [message('a', '1', 100)]);
  pane.bridge.messages.set('2', [message('b', '2', 200)]);
  pane.view.setAdvertised(true);
  await settle();

  // Open thread 1 and hold its reply; go back; open thread 2 and let it answer. Thread 1's reply
  // lands last and must be discarded — `openThreadId !== threadId` is the guard, and without it the
  // pane shows one conversation's messages under another's name.
  //
  // The back step is not optional and the first version of this test skipped it: opening a thread
  // *replaces* the list, so the second click went to a `.sms-thread` that was no longer in the tree.
  // With `?.click()` that did nothing and reported nothing, which is the decoration fault — an
  // action that silently does not happen while the run carries on. Every click below is asserted to
  // exist first.
  pane.bridge.holdMessages = () => undefined;
  const first = pane.body.queryAll('.sms-thread')[0];
  assert.ok(first, 'control: thread 1 is clickable');
  first.click();
  await settle();

  const release = pane.bridge.holdMessages;
  pane.bridge.holdMessages = null;
  const back = pane.body.queryAll('button').find((b) => b.textContent.includes('All conversations'));
  assert.ok(back, 'control: the back link is drawn while a thread is open');
  back.click();

  const second = pane.body.queryAll('.sms-thread')[1];
  assert.ok(second, 'control: thread 2 is clickable again');
  second.click();
  await settle();
  release?.();
  await settle();

  assert.match(pane.note.textContent, /\+91980000002/, 'thread 2 is the one open');
  assert.ok(pane.body.textContent.includes('body b'));
  assert.ok(!pane.body.textContent.includes('body a'), 'a stale reply drew over the open thread');
});

test('a message arriving in the open thread is appended; one arriving elsewhere refreshes the list', async () => {
  const pane = mount([thread('1'), thread('2')]);
  pane.bridge.messages.set('1', [message('a', '1', 100)]);
  pane.view.setAdvertised(true);
  await settle();
  pane.body.queryAll('.sms-thread')[0].click();
  await settle();

  pane.bridge.fireReceived('1', message('c', '1', 300));
  await settle();
  assert.ok(pane.body.textContent.includes('body c'));

  // One arriving elsewhere must still move the list's snippet and unread count. A pane that only
  // updated the open thread would leave the list quietly wrong.
  const before = pane.bridge.calls.filter((c) => c.startsWith('smsThreads')).length;
  pane.bridge.fireReceived('2', message('d', '2', 400));
  await settle();
  assert.equal(pane.bridge.calls.filter((c) => c.startsWith('smsThreads')).length, before + 1);
});

// ---- Defect 30: a first message to a number with no thread ---------------------------------------

test('a new conversation opens the thread the PHONE names, not one the pane assumed', async () => {
  // A first message to a number that already has a thread is merged into that thread by the
  // provider. Opening a thread we invented would show an empty pane over a message that was sent.
  const pane = mount([thread('1')]);
  pane.bridge.sendNewResult = { ok: true, threadId: 't-real' };
  pane.bridge.messages.set('t-real', [message('m', 't-real', 500, false)]);
  pane.view.setAdvertised(true);
  await settle();

  pane.body.queryAll('button').find((b) => b.id === 'sms-new')?.click();
  const to = pane.body.queryAll('input').find((i) => i.id === 'sms-new-to');
  const body = pane.body.queryAll('input').find((i) => i.id === 'sms-new-body');
  assert.ok(to && body, 'control: the compose surface is drawn');
  to.value = '+919800000009';
  to.dispatch('input');
  body.value = 'first message';
  body.dispatch('input');
  pane.body.queryAll('button').find((b) => b.id === 'sms-new-send')?.click();
  await settle();
  await settle();

  assert.ok(pane.bridge.calls.includes('smsSendNew:+919800000009:first message'));
  assert.ok(
    pane.bridge.calls.some((c) => c.startsWith('smsMessages:t-real')),
    'the pane opened a thread other than the one the phone named',
  );
});

test('un-advertised forgets the open thread as well as the list', () => {
  const pane = mount([thread('1')]);
  pane.view.setAdvertised(true);
  pane.view.setAdvertised(false);
  assert.ok(pane.card.classList.contains('hidden'));
  assert.equal(pane.body.queryAll('.sms-thread').length, 0);
  // Back to "reading", not to "there are no conversations" — a pane that has stopped knowing must
  // not claim the phone has nothing.
  assert.match(pane.note.textContent, /Reading the phone’s conversations…/);
});
