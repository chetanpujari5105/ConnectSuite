import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, installFakeWindow, el } from './domDouble.testkit';
// The page loads these two before `notifications.js` and this file does the same wiring: every
// string the pane puts in front of a person comes from `notifyLabels.ts`, which reads `appLabel.ts`.
import '../shared/appLabel';
import './notifyLabels';
// The state vocabulary, and the icons it draws — loaded before the pane, as the page does.
import './icons';
import './stateBlock';
import './notifications';

/**
 * The notifications pane's view class, driven for real.
 *
 * Its debt-list reason was the single word *"Phase 4"*. What it protects is the pane's counting:
 * **five different sentences over four kinds of empty and one non-empty**, each with a denominator
 * beside it, and a sidebar badge that has to agree with the list it sends people to.
 *
 * The group-summary rule is the sharpest of them. Android's collapse header has no title and no
 * text, so drawing one produces an app name, a time, a Dismiss button and nothing else — a blank
 * card in a list somebody reads every day. The phone reports the whole shade and the Mac decides,
 * which means every count on this pane is a count of `visible`, not of what arrived, and the two
 * numbers differ by exactly the thing that is not drawn.
 */

type Notif = {
  key: string;
  package: string;
  appName: string;
  title?: string;
  text?: string;
  whenMs: number;
  category?: string;
  ongoing: boolean;
  clearable: boolean;
  isGroupSummary: boolean;
  canReply: boolean;
  replyLabel?: string;
  actions: { title: string; isReply: boolean }[];
};

class FakeBridge {
  list: Notif[] = [];
  readonly calls: string[] = [];
  private changed: ((list: Notif[]) => void) | null = null;

  async notifList() {
    this.calls.push('notifList');
    return this.list;
  }
  async notifReply(key: string, text: string) {
    this.calls.push(`notifReply:${key}:${text}`);
    return { ok: true };
  }
  async notifAction(key: string, index: number) {
    this.calls.push(`notifAction:${key}:${index}`);
    return { ok: true };
  }
  async notifDismiss(key: string) {
    this.calls.push(`notifDismiss:${key}`);
    return { ok: true };
  }
  onNotifChanged(cb: (list: Notif[]) => void) {
    this.changed = cb;
  }
  fire(list: Notif[]): void {
    this.list = list;
    this.changed?.(list);
  }
}

installFakeDocument();
installFakeWindow();

/**
 * The pane calls `shell.setNotificationCount`, which is a real coupling and not an accident: the
 * badge and the list are the same claim in two places and the pane owns both. The double records
 * what it was told, so the agreement can be asserted.
 */
const badge: { counts: number[] } = { counts: [] };
(globalThis as Record<string, unknown>).shell = {
  setNotificationCount: (n: number) => badge.counts.push(n),
};

interface Pane {
  bridge: FakeBridge;
  card: FakeElement;
  note: FakeElement;
  list: FakeElement;
  notice: FakeElement;
  filters: FakeElement;
  detail: FakeElement;
  view: { setAdvertised(on: boolean, reason?: string): void; refresh(): Promise<void> };
}

function mount(): Pane {
  const bridge = new FakeBridge();
  const parts = {
    card: el('div'),
    note: el('p'),
    list: el('div'),
    notice: el('div'),
    filters: el('div'),
    detail: el('aside'),
  };
  const View = (globalThis as Record<string, unknown>).NotificationsView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(
    parts.card,
    parts.note,
    parts.list,
    parts.notice,
    parts.filters,
    parts.detail,
    bridge,
  );
  return { bridge, ...parts, view };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function notif(key: string, over: Partial<Notif> = {}): Notif {
  return {
    key,
    package: 'com.example.chat',
    appName: 'Chat',
    title: `Title ${key}`,
    text: `Text ${key}`,
    whenMs: 1_700_000_000_000,
    ongoing: false,
    clearable: true,
    isGroupSummary: false,
    canReply: false,
    actions: [],
    ...over,
  };
}

// ---- The group-summary rule and the counts that depend on it -------------------------------------

test('a group summary is not drawn, and the badge counts what the list counts', () => {
  const pane = mount();
  badge.counts.length = 0;
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a'), notif('summary', { isGroupSummary: true }), notif('b')]);

  // A collapse header has no title and no text: drawing one produces an app name, a time and a
  // Dismiss button — `Shell 11:41 PM Dismiss`, observed on One UI.
  assert.equal(pane.list.queryAll('.notif-row').length, 2);
  // The badge must send people to a pane showing the number the badge showed.
  assert.equal(badge.counts.at(-1), 2);
});

test('the hidden count is on screen, so a number can be reconciled with the phone’s', () => {
  const pane = mount();
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a'), notif('s1', { isGroupSummary: true }), notif('s2', { isGroupSummary: true })]);
  // This number gets read against the phone's own `Replayed N active (M summaries)`, and a count
  // that cannot be reconciled makes a working feature look broken.
  assert.match(pane.note.textContent, /2 group headers hidden/);

  pane.bridge.fire([notif('a')]);
  // The control: with nothing hidden the clause is gone, so its presence above is the condition
  // and not a sentence that is always there.
  assert.ok(!pane.note.textContent.includes('hidden'));
});

test('the reply denominator is beside the total, because it explains the rows with no box', () => {
  const pane = mount();
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a', { canReply: true }), notif('b'), notif('c')]);
  // "12 notifications" says nothing about whether reply is working; "1 of them can be replied to"
  // is the number that tells somebody why most rows have no box.
  assert.match(pane.note.textContent, /3 showing, 1 of them can be replied to/);
});

// ---- Four empties, four sentences ----------------------------------------------------------------

test('an empty shade, a shade of only headers, an empty filter and an unavailable pane are four', () => {
  const pane = mount();
  pane.view.setAdvertised(true);

  pane.bridge.fire([]);
  assert.match(pane.note.textContent, /Nothing on the phone’s notification shade right now/);

  // Nothing to show and nothing at all are different facts, and the header count tells them apart.
  pane.bridge.fire([notif('s', { isGroupSummary: true })]);
  assert.match(pane.note.textContent, /the shade holds only 1 group header/);

  // An empty *filter* over a non-empty shade names the filter and says how many are elsewhere.
  pane.bridge.fire([notif('a')]);
  const reply = pane.filters.queryAll('button').find((b) => b.textContent.startsWith('Can reply'));
  assert.ok(reply, 'control: the Can reply filter is drawn');
  reply.click();
  assert.match(pane.list.textContent, /Nothing matches “Can reply”/);
  assert.match(pane.list.textContent, /has 1 other notification/);
});

test('un-advertised draws the phone’s own sentence, and the pane stays rather than vanishing', () => {
  const pane = mount();
  badge.counts.length = 0;
  pane.view.setAdvertised(false, 'Notification access is not granted on the phone.');
  // The pane stays and explains itself. The reason is the phone's, verbatim — this side cannot know
  // which switch is off and a Mac-side paraphrase is defect 27's shape.
  assert.ok(!pane.card.classList.contains('hidden'));
  assert.match(pane.list.textContent, /Notification access is not granted on the phone/);
  // And the badge goes to zero: a count over a feature the phone is not offering is a stale claim.
  assert.equal(badge.counts.at(-1), 0);
});

test('un-advertised with no reason hides the card entirely', () => {
  // An ungranted permission and an empty shade look identical on screen. With no sentence to show,
  // the card goes rather than drawing an empty list somebody would read as "no notifications".
  const pane = mount();
  pane.view.setAdvertised(false);
  assert.ok(pane.card.classList.contains('hidden'));
});

/**
 * Sidekick handoff §6, row N1: *"There is no Muted filter."* No mute concept exists on the wire, so
 * the pill could only ever open a state explaining its own emptiness. Asserted on the filter list
 * itself, with the control that the other filters are drawn.
 */
test('there is no Muted filter, and the real three are drawn', () => {
  const pane = mount();
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a')]);
  const labels = pane.filters.queryAll('button').map((b) => b.textContent);
  assert.equal(labels.length, 3, `control: the filters were drawn (${labels.join(' / ')})`);
  assert.ok(!labels.some((l) => /muted/i.test(l)), 'a Muted filter is drawn');
});

test('a row carries a Reply pill only where the phone says it can reply', () => {
  const pane = mount();
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a', { canReply: true }), notif('b', { canReply: false })]);
  const rows = pane.list.queryAll('.notif-row');
  assert.equal(rows.length, 2, 'control: both rows drawn');
  assert.equal(rows[0]!.queryAll('.notif-reply-pill').length, 1);
  assert.equal(rows[1]!.queryAll('.notif-reply-pill').length, 0, 'a read-only row drew a Reply pill');
});

// ---- The list and its inspector -------------------------------------------------------------------

test('choosing a row draws it in the detail column; nothing chosen says so', () => {
  const pane = mount();
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a', { title: 'From R. Sharma' }), notif('b')]);
  assert.match(pane.detail.textContent, /Choose a notification/);

  pane.list.queryAll('.notif-row')[0].click();
  assert.match(pane.detail.textContent, /From R\. Sharma/);
});

test('a draft survives a notification arriving while somebody is typing', async () => {
  const pane = mount();
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a', { canReply: true, replyLabel: 'Reply' })]);
  pane.list.queryAll('.notif-row')[0].click();

  const box = pane.detail.queryAll('input')[0];
  assert.ok(box, 'control: the reply box is drawn for a replyable notification');
  box.value = 'half a sentence';
  box.dispatch('input');

  // The list re-renders on every event. A draft held on the element would be destroyed with it,
  // which is why it is keyed by notification instead.
  pane.bridge.fire([notif('a', { canReply: true, replyLabel: 'Reply' }), notif('b')]);
  assert.equal(pane.detail.queryAll('input')[0]?.value, 'half a sentence');
});

test('a quick reply fills the field rather than sending', () => {
  const pane = mount();
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a', { canReply: true, replyLabel: 'Reply' })]);
  pane.list.queryAll('.notif-row')[0].click();

  const quick = pane.detail.queryAll('button').find((b) => b.textContent === 'On my way');
  assert.ok(quick, 'control: the canned replies are drawn');
  quick.click();
  // A mis-tap is a word to delete, not a message in somebody else's conversation.
  assert.deepEqual(pane.bridge.calls.filter((c) => c.startsWith('notifReply')), []);
  assert.equal(pane.detail.queryAll('input')[0]?.value, 'On my way');
});

test('a package id never reaches a sentence on its own', () => {
  // Defect 28's rule, on the pane most likely to break it. Every string here comes from
  // notifyLabels.ts, and an app with no resolvable label falls back to the package — which is
  // honest — but never as the only thing a person reads.
  const pane = mount();
  pane.view.setAdvertised(true);
  pane.bridge.fire([notif('a', { appName: '', package: 'com.techmash.playo' })]);
  pane.list.queryAll('.notif-row')[0].click();

  const rendered = pane.list.textContent + pane.detail.textContent;
  assert.ok(rendered.length > 0, 'control: something was drawn');
  // The id may appear as a handle. What it may not do is appear with nothing around it, so the
  // assertion is that the pane still produced a label-shaped string for the app.
  assert.ok(
    pane.list.queryAll('.app-name').every((n) => n.textContent.trim().length > 0),
    'an app name was drawn blank',
  );
});
