import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, installFakeWindow, el } from './domDouble.testkit';
import './icons';
import './stateBlock';
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
  sendResult: { ok: boolean; reason?: string } = { ok: true };
  /** Set to hold the next `smsMessages`, so a reply can be made to land after the reader moved on. */
  holdMessages: (() => void) | null = null;
  private received: ((e: { threadId: string; message: Message }) => void) | null = null;

  /** Set to hold every `smsThreads` until it resolves, so an event can land mid-load. */
  threadsGate: Promise<void> | null = null;

  /** When set, `sms.threads` is refused with this sentence. */
  threadsRefusal: string | null = null;
  async smsThreads(options: { before?: number }) {
    this.calls.push(`smsThreads:${options.before ?? 'first'}`);
    if (this.threadsGate) await this.threadsGate;
    if (this.threadsRefusal) return { ok: false as const, reason: this.threadsRefusal, fixHint: 'Synthetic hint.' };
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
    return this.sendResult;
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
  notice: FakeElement;
  tabs: FakeElement;
  list: FakeElement;
  chatHead: FakeElement;
  chatBody: FakeElement;
  composer: FakeElement;
  person: FakeElement;
  newPanel: FakeElement;
  newButton: FakeElement;
  newCancel: FakeElement;
  newTo: FakeElement;
  newBody: FakeElement;
  newSend: FakeElement;
  view: {
    setAdvertised(on: boolean): void;
    setLinkState(connected: boolean, advertised: boolean, reason: string | null): void;
    refresh(): Promise<void>;
  };
  state: FakeElement;
  threadsFoot: FakeElement;
  called: string[];
}

/**
 * The pane draws into four regions rather than one body as of 2026-09-05.
 *
 * `body` is gone from this mount on purpose: keeping it as an alias for one of the new regions
 * would let a test go on asserting against "the pane's output" without saying which column it
 * meant — and the whole point of the rebuild is that the thread list, the conversation and the
 * person are three different lifetimes.
 */
function mount(threads: Thread[] = []): Pane {
  const bridge = new FakeBridge();
  bridge.threads = threads;
  const parts = {
    card: el('div'),
    note: el('p'),
    notice: el('div'),
    tabs: el('div'),
    list: el('div'),
    chatHead: el('div'),
    chatBody: el('div'),
    composer: el('div'),
    person: el('aside'),
    newPanel: el('div'),
    newButton: el('button'),
    newCancel: el('button'),
    newTo: el('input'),
    newBody: el('input'),
    newSend: el('button'),
    state: el('div'),
    threadsFoot: el('p'),
  };
  const called: string[] = [];
  const View = (globalThis as Record<string, unknown>).SmsView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(
    parts.card,
    parts.note,
    {
      tabs: parts.tabs,
      list: parts.list,
      chatHead: parts.chatHead,
      chatBody: parts.chatBody,
      composer: parts.composer,
      person: parts.person,
      newPanel: parts.newPanel,
      newButton: parts.newButton,
      newCancel: parts.newCancel,
      newTo: parts.newTo,
      newBody: parts.newBody,
      newSend: parts.newSend,
      state: parts.state,
      threadsFoot: parts.threadsFoot,
      callNumber: (number: string) => called.push(number),
    },
    parts.notice,
    bridge,
  );
  return { bridge, ...parts, view, called };
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

  assert.deepEqual(pane.list.queryAll('.sms-who').map((w) => w.textContent), [
    'R. Sharma',
    '+91980000002',
    // The fallback chain is written out rather than defaulted, so an empty `addresses` still
    // produces words. Defect 35 is the same rule one pane over.
    'Unknown number',
  ]);
});

test('a loaded list says nothing about itself, and each of its three real states does', async () => {
  /*
   * This test used to assert the opposite, and the inversion is the point.
   *
   * It read: `2 conversations, 1 showing a contact name, 2 unread` — and every clause of that is a
   * fact about **our implementation**: how many rows one page happens to hold, how well contact
   * resolution is working, and how many are unread when the rows already carry that. It was written
   * to satisfy a hardware step, and it stayed on the screen a user reads.
   *
   * The states that survive are the ones about *the phone*: still reading it, nothing on it, and a
   * filter that matched none of it.
   */
  const pane = mount([thread('1', { contactName: 'R. Sharma', unread: 2 }), thread('2')]);

  // Advertised, and the fetch has not come back yet. This is the moment the loading state exists,
  // and it did not draw at all until `setAdvertised` was made to render before awaiting the bridge.
  pane.view.setAdvertised(true);
  assert.match(pane.note.textContent, /Reading/);

  await settle();
  assert.equal(pane.note.textContent, '', 'a working list explains itself by being a list');
  assert.equal(pane.list.queryAll('.sms-thread').length, 2, 'control: the rows really are drawn');

  // Genuinely empty is a different sentence from a filter matching nothing.
  const none = mount([]);
  none.view.setAdvertised(true);
  await settle();
  assert.match(none.note.textContent, /no conversations on the phone/i);
});

test('the Unread tab filters the list, and an empty filter is not an empty phone', async () => {
  const pane = mount([thread('1', { unread: 2 }), thread('2'), thread('3')]);
  pane.view.setAdvertised(true);
  await settle();

  const tabs = pane.tabs.queryAll('.sms-tab');
  assert.deepEqual(tabs.map((t) => t.dataset.tab), ['all', 'unread'], 'two tabs, not the design\u2019s three');
  assert.equal(pane.list.queryAll('.sms-thread').length, 3, 'control: All shows everything');

  tabs[1].click();
  assert.equal(pane.list.queryAll('.sms-thread').length, 1);
  assert.equal(pane.note.textContent, '', 'a filter with matches says nothing');

  // And with nothing unread it is a different sentence from an empty phone.
  const read = mount([thread('9')]);
  read.view.setAdvertised(true);
  await settle();
  read.tabs.queryAll('.sms-tab')[1].click();
  assert.match(read.note.textContent, /No unread conversations/);
  assert.doesNotMatch(read.note.textContent, /no conversations on the phone/i);
});

test('the preview is drawn, which it had not been since it reached the wire', async () => {
  // Defect 93. `snippet` has been sent by the phone since Phase 4 and rendered by this pane the
  // whole time, at `height: 0` on every row. A DOM double has no layout and cannot see that — this
  // asserts the element and its text exist, and `stylesheets.test.ts` guards the height.
  const pane = mount([thread('1'), thread('2', { snippet: '' })]);
  pane.view.setAdvertised(true);
  await settle();
  const previews = pane.list.queryAll('.sms-preview').map((p) => p.textContent);
  assert.deepEqual(previews, ['snippet 1', 'No preview']);
});

test('an unread count reaches a screen reader, not only a coloured pill', async () => {
  // Defect 26's rule. The pill is a colour; the number has to be in the accessible name.
  const pane = mount([thread('1', { unread: 3 })]);
  pane.view.setAdvertised(true);
  await settle();
  const badge = pane.list.queryAll('.sms-unread')[0];
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
  assert.equal(pane.list.queryAll('.sms-thread').length, 2, 'control: page one drew two');

  pane.bridge.threads = [thread('2'), thread('1', { snippet: 'stale repeat' }), thread('3')];
  pane.bridge.threadsHasMore = false;
  pane.list.queryAll('button').find((b) => b.id === 'sms-older-threads')?.click();
  await settle();

  const ids = pane.list.queryAll('.sms-thread').map((t) => t.dataset.threadId);
  assert.deepEqual(ids, ['1', '2', '3']);
  assert.match(pane.list.textContent, /newest/);
  assert.ok(!pane.list.textContent.includes('stale repeat'), 'the later, staler row won');
});

test('a fresh load replaces rather than appends', async () => {
  // Appending on a refresh would double every thread already held, the first time anybody pressed
  // refresh after paging.
  const pane = mount([thread('1'), thread('2')]);
  pane.view.setAdvertised(true);
  await settle();
  await pane.view.refresh();
  assert.equal(pane.list.queryAll('.sms-thread').length, 2);
});

test('the control that lifts the limit is drawn beside the sentence describing it', async () => {
  // Defect 32: the prose said older conversations were not shown and the reader had nowhere to go.
  // A sentence describing a limit is not a control that lifts it.
  const pane = mount([thread('1')]);
  pane.bridge.threadsHasMore = true;
  pane.view.setAdvertised(true);
  await settle();
  // The sentence that used to sit here is gone — see the note-content test above — and the control
  // is what is left, which is the half that was ever any use.
  assert.equal(pane.note.textContent, '');
  assert.ok(pane.list.queryAll('button').some((b) => b.id === 'sms-older-threads'));

  // Not on a filtered view: paging "older" while showing a subset would append rows the filter then
  // hides, and the button would look broken.
  pane.tabs.queryAll('.sms-tab')[1].click();
  assert.ok(!pane.list.queryAll('button').some((b) => b.id === 'sms-older-threads'));
  pane.tabs.queryAll('.sms-tab')[0].click();
  assert.ok(pane.list.queryAll('button').some((b) => b.id === 'sms-older-threads'), 'control: it comes back');

  pane.bridge.threadsHasMore = false;
  await pane.view.refresh();
  // The control on that assertion: with nothing more to load the button is gone, so its presence
  // above is the condition working rather than a button that is always there.
  assert.ok(!pane.list.queryAll('button').some((b) => b.id === 'sms-older-threads'));
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
  const first = pane.list.queryAll('.sms-thread')[0];
  assert.ok(first, 'control: thread 1 is clickable');
  first.click();
  await settle();

  const release = pane.bridge.holdMessages;
  pane.bridge.holdMessages = null;
  /*
   * No back step any more, and its absence is the improvement rather than a shortcut.
   *
   * The original comment here said the step "is not optional", because opening a thread *replaced*
   * the list and the second click would land on a row no longer in the tree. In three columns the
   * list never goes away, so the second row is clickable without navigating anywhere first — and it
   * is still asserted to exist before being clicked, which is the part that mattered.
   */
  const second = pane.list.queryAll('.sms-thread')[1];
  assert.ok(second, 'control: thread 2 is clickable again');
  second.click();
  await settle();
  release?.();
  await settle();

  assert.match(pane.chatHead.textContent, /\+91980000002/, 'thread 2 is the one open');
  assert.ok(pane.chatBody.textContent.includes('body b'));
  assert.ok(!pane.chatBody.textContent.includes('body a'), 'a stale reply drew over the open thread');
});

test('a message arriving in the open thread is appended; one arriving elsewhere refreshes the list', async () => {
  const pane = mount([thread('1'), thread('2')]);
  pane.bridge.messages.set('1', [message('a', '1', 100)]);
  pane.view.setAdvertised(true);
  await settle();
  pane.list.queryAll('.sms-thread')[0].click();
  await settle();

  pane.bridge.fireReceived('1', message('c', '1', 300));
  await settle();
  assert.ok(pane.chatBody.textContent.includes('body c'));

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

  pane.newButton.click();
  const to = pane.newTo;
  const body = pane.newBody;
  assert.ok(to && body, 'control: the compose surface is drawn');
  to.value = '+919800000009';
  to.dispatch('input');
  body.value = 'first message';
  body.dispatch('input');
  pane.newSend.click();
  await settle();
  await settle();

  assert.ok(pane.bridge.calls.includes('smsSendNew:+919800000009:first message'));
  assert.ok(
    pane.bridge.calls.some((c) => c.startsWith('smsMessages:t-real')),
    'the pane opened a thread other than the one the phone named',
  );
});

/**
 * Defect 30's **no-thread** half, with fakes — no real message is sent (2026-09-29).
 *
 * On a number with no thread the provider creates one *after* the send, asynchronously (699 ms and
 * 1,140 ms measured in step 71), so the phone's ack usually carries no `threadId`, and the message
 * then arrives as `sms.sent`. Before this fix the pane said *Sent.*, refreshed the list and opened
 * nothing — the person's new conversation was a row somewhere in the list rather than the screen
 * they were on, unlike every other path.
 */
async function sendNewWithoutThread(pane: Pane, to: string, text = 'first message'): Promise<void> {
  pane.bridge.sendNewResult = { ok: true };
  pane.newButton.click();
  pane.newTo.value = to;
  pane.newTo.dispatch('input');
  pane.newBody.value = text;
  pane.newBody.dispatch('input');
  pane.newSend.click();
  await settle();
  await settle();
}

function sentRow(id: string, threadId: string, address: string, inbound = false) {
  return { id, threadId, address, body: `body ${id}`, dateMs: 900, inbound, read: true, kind: 'sms', hasAttachments: false } as unknown as Message;
}

test('no-thread: the first sms.sent to the number just addressed opens its new thread', async () => {
  const pane = mount([thread('1')]);
  pane.bridge.messages.set('t-new', [sentRow('n1', 't-new', '+919800000009')]);
  pane.view.setAdvertised(true);
  await settle();
  await sendNewWithoutThread(pane, '9800000009');
  assert.ok(pane.bridge.calls.includes('smsSendNew:9800000009:first message'), 'control: the send was made');
  assert.ok(!pane.bridge.calls.some((c) => c.startsWith('smsMessages:')), 'control: nothing opened before the event');

  // The provider stores the number in international form; the person typed it bare.
  pane.bridge.fireReceived('t-new', sentRow('n1', 't-new', '+919800000009'));
  await settle();
  await settle();
  assert.ok(
    pane.bridge.calls.some((c) => c.startsWith('smsMessages:t-new')),
    'the new conversation the phone created was not opened',
  );
});

test('no-thread: a different number, an inbound message, or a second message does not steer the pane', async () => {
  const pane = mount([thread('1')]);
  pane.view.setAdvertised(true);
  await settle();
  await sendNewWithoutThread(pane, '+919800000009');

  // Someone else texting in, and the handset sending to someone else, both in the same seconds.
  pane.bridge.fireReceived('t-other', sentRow('o1', 't-other', '+919811111111'));
  pane.bridge.fireReceived('t-in', sentRow('i1', 't-in', '+919800000009', true));
  await settle();
  await settle();
  assert.ok(!pane.bridge.calls.some((c) => c.startsWith('smsMessages:')), 'a message that is not ours opened a thread');

  // Ours arrives, is adopted once; a later outbound message to the same number opens nothing more.
  pane.bridge.fireReceived('t-new', sentRow('n1', 't-new', '+919800000009'));
  await settle();
  await settle();
  const opened = pane.bridge.calls.filter((c) => c.startsWith('smsMessages:')).length;
  assert.equal(opened, 1, 'control: our own message opened exactly one thread');
  pane.bridge.fireReceived('t-again', sentRow('n2', 't-again', '+919800000009'));
  await settle();
  await settle();
  assert.equal(pane.bridge.calls.filter((c) => c.startsWith('smsMessages:')).length, opened, 'adopted twice');
});

test('no-thread: an sms.sent that lands while the list is still loading is adopted too', async () => {
  // The provider's write and the list reload race; the marker must exist before the first await.
  const pane = mount([thread('1')]);
  pane.view.setAdvertised(true);
  await settle();
  let release: () => void = () => undefined;
  pane.bridge.threadsGate = new Promise<void>((resolve) => (release = resolve));
  await sendNewWithoutThread(pane, '+919800000009');
  assert.ok(pane.bridge.calls.includes('smsSendNew:+919800000009:first message'), 'control: sent');
  pane.bridge.fireReceived('t-new', sentRow('n1', 't-new', '+919800000009'));
  pane.bridge.threadsGate = null;
  release();
  for (let i = 0; i < 5; i += 1) await settle();
  assert.ok(
    pane.bridge.calls.some((c) => c.startsWith('smsMessages:t-new')),
    'the thread was missed because its message arrived during the list load',
  );
});

test('no-thread: the matching rule, including its window and the too-short numbers it refuses', () => {
  const rule = (globalThis as Record<string, unknown>).smsNewThreadMatches as (
    pending: { digits: string; atMs: number } | null,
    message: { address: string; inbound: boolean },
    nowMs: number,
  ) => boolean;
  const p = { digits: '9800000009', atMs: 1_000 };
  assert.equal(rule(p, { address: '+91 98000-00009', inbound: false }, 2_000), true, 'formatted international form');
  assert.equal(rule(p, { address: '9800000009', inbound: false }, 31_000), true, 'at the 30 s edge');
  assert.equal(rule(p, { address: '9800000009', inbound: false }, 31_001), false, 'past the window');
  assert.equal(rule(p, { address: '9800000009', inbound: true }, 2_000), false, 'inbound');
  assert.equal(rule(p, { address: '+919800000008', inbound: false }, 2_000), false, 'one digit different');
  assert.equal(rule(null, { address: '9800000009', inbound: false }, 2_000), false, 'nothing pending');
  // A short code is a suffix of many numbers; suffix matching needs at least 8 digits on both sides.
  assert.equal(rule({ digits: '12345', atMs: 1_000 }, { address: '+9112345', inbound: false }, 2_000), false, 'short code by suffix');
  assert.equal(rule({ digits: '12345', atMs: 1_000 }, { address: '12345', inbound: false }, 2_000), true, 'short code exactly');
});

test('un-advertised forgets the open thread as well as the list', () => {
  const pane = mount([thread('1')]);
  pane.view.setAdvertised(true);
  pane.view.setAdvertised(false);
  assert.ok(pane.card.classList.contains('hidden'));
  assert.equal(pane.list.queryAll('.sms-thread').length, 0);
  // Back to "reading", not to "there are no conversations" — a pane that has stopped knowing must
  // not claim the phone has nothing.
  assert.match(pane.note.textContent, /Reading the phone’s conversations…/);
});

// ---- Link state: the handoff's Disconnected and Permission rows (2026-09-19) ---------------------

test('a dropped link keeps the conversations on screen and says how old they are', async () => {
  const pane = mount([thread('1', { contactName: 'R. Sharma' }), thread('2')]);
  pane.view.setLinkState(true, true, null);
  await settle();
  assert.equal(pane.list.queryAll('.sms-thread').length, 2, 'control: the list was drawn while live');

  pane.view.setLinkState(false, false, null);
  assert.equal(pane.list.queryAll('.sms-thread').length, 2, 'a disconnect emptied the pane');
  assert.equal(pane.state.hidden, false);
  assert.match(pane.state.textContent, /not connected/);
  assert.match(pane.state.textContent, /as of \d\d:\d\d/);
});

test('a refused grant draws the phone’s own reason, and a permission block rather than a blank', () => {
  const pane = mount([thread('1')]);
  pane.view.setLinkState(true, false, 'SMS permission is off for ConnectSuite.');
  const block = pane.state.queryAll('.state-block')[0];
  assert.ok(block, 'no state block was drawn for a missing permission');
  assert.equal(block!.dataset.kind, 'permission');
  assert.match(block!.textContent, /SMS permission is off for ConnectSuite\./);
});

test('a failed send stays on screen beside the draft it failed to send, with a retry', async () => {
  const pane = mount([thread('1')]);
  pane.bridge.sendResult = { ok: false, reason: 'The phone refused the send.' };
  pane.view.setLinkState(true, true, null);
  await settle();
  pane.list.queryAll('.sms-thread')[0]!.click();
  await settle();
  const input = pane.composer.queryAll('input')[0]!;
  input.value = 'hello';
  input.dispatch('input');
  pane.composer.queryAll('.sms-send')[0]!.click();
  await settle();

  const error = pane.composer.queryAll('.state-block')[0];
  assert.ok(error, 'the failure vanished — it was a toast');
  assert.equal(error!.dataset.kind, 'error');
  assert.match(error!.textContent, /The phone refused the send\./);
  assert.equal(pane.composer.queryAll('input')[0]!.value, 'hello', 'the draft was thrown away');
  assert.equal(error!.queryAll('button').length, 1, 'no retry on a failure that can be retried');
});

test('Call this number fills the dialler and never dials', async () => {
  const pane = mount([thread('1', { contactName: 'R. Sharma' })]);
  pane.view.setLinkState(true, true, null);
  await settle();
  pane.list.queryAll('.sms-thread')[0]!.click();
  await settle();
  const call = pane.person.queryAll('.sms-person-action')[0];
  assert.ok(call, 'control: the action is drawn for a thread with a number');
  call!.click();
  assert.deepEqual(pane.called, ['+91980000001']);
  assert.ok(!pane.bridge.calls.some((c) => /dial/i.test(c)), 'something dialled');
});

/**
 * The New-conversation panel is a modal surface, and until the shell parity sweep read it beside
 * the palette it was a div that stopped being hidden: `{ role: null, modal: null, label: null }`
 * against `{ role: 'dialog', modal: 'true', label: 'Command palette' }`.
 *
 * The markup carries the role, the label and `aria-modal` — asserted by the sweep against the real
 * page, because they are attributes on static HTML and a unit test asserting them here would be
 * asserting its own fixture. What this file covers is the **behaviour**, which is in the view.
 */
test('Escape closes the New-conversation panel and gives focus back', async () => {
  const pane = mount([thread('1')]);
  pane.view.setAdvertised(true);
  await settle();

  pane.newButton.click();
  assert.equal(pane.newPanel.hidden, false, 'control: the panel opened');
  const focusesBefore = pane.newButton.focusCount;

  pane.newPanel.dispatch('keydown', { key: 'Escape' });
  assert.equal(pane.newPanel.hidden, true, 'Escape did not close it');
  assert.equal(
    pane.newButton.focusCount,
    focusesBefore + 1,
    'focus was left inside a hidden subtree, which drops it to the document',
  );
});

test('Cancel returns focus too, and a stray Escape on a closed panel does nothing', async () => {
  const pane = mount([thread('1')]);
  pane.view.setAdvertised(true);
  await settle();

  pane.newButton.click();
  const before = pane.newButton.focusCount;
  pane.newCancel.click();
  assert.equal(pane.newPanel.hidden, true);
  assert.equal(pane.newButton.focusCount, before + 1);

  // Already closed: the guard exists so a second press does not re-focus the opener under someone
  // who has moved on, and does not swallow an Escape meant for the pane behind it.
  const after = pane.newButton.focusCount;
  pane.newPanel.dispatch('keydown', { key: 'Escape' });
  assert.equal(pane.newButton.focusCount, after, 'a closed panel acted on Escape');
});

/** A different key is not a dismissal. Without this, any keydown in the panel would close it. */
test('a key that is not Escape leaves the panel open', async () => {
  const pane = mount([thread('1')]);
  pane.view.setAdvertised(true);
  await settle();
  pane.newButton.click();
  pane.newPanel.dispatch('keydown', { key: 'a' });
  assert.equal(pane.newPanel.hidden, false);
});

// ---- A refused conversation list ---------------------------------------------------------------
//
// Found by the overnight UI harness (2026-10-06), the same defect as the Calls pane's: the refusal
// went to the notice, which hides itself after six seconds, and the list kept saying "Reading the
// phone's conversations…" — a claim about a read that had already been refused, with no way back
// short of a reconnect.

test('a refused conversation list says so in the list, and Try again asks again', async () => {
  const pane = mount([]);
  pane.bridge.threadsRefusal = 'This phone is not sharing its messages.';
  pane.view.setAdvertised(true);
  await settle();
  assert.ok(pane.note.textContent.includes('This phone is not sharing its messages.'), `the list does not say why: "${pane.note.textContent}"`);
  assert.ok(!pane.note.textContent.includes('Reading'), 'the list still claims to be reading');
  const retry = pane.list.children.find((c) => c.tagName.toUpperCase() === 'BUTTON' && c.textContent === 'Try again');
  assert.ok(retry, 'no way to ask again from the list');
  // Control: a phone that answers on the retry draws its list and drops the refusal.
  pane.bridge.threadsRefusal = null;
  pane.bridge.threads = [thread('1')];
  retry.click();
  await settle();
  assert.ok(!pane.note.textContent.includes('not sharing'), `the refusal outlived the list: "${pane.note.textContent}"`);
  assert.ok(pane.list.children.length > 0, 'control: the list was drawn');
});
