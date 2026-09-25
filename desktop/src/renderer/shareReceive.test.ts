import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeElement, installFakeDocument, installFakeWindow } from './domDouble.testkit';

installFakeDocument();
installFakeWindow();
require('../shared/shareReceiveCopy');
import './shareReceive';

/**
 * The real `ShareReceiveTray` over the DOM double. What the double cannot show — layout, the cascade,
 * real focus, the reduced-motion media query — is not claimed here; see `domDouble.testkit.ts`.
 */

const g = globalThis as Record<string, any>;
const Tray = g.ShareReceiveTray as new (root: FakeElement, live: FakeElement, show: (id: string) => Promise<{ ok: boolean; reason?: string }>) => {
  update(list: unknown[]): void;
};

const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const data = (over: Record<string, unknown> = {}) => ({
  offerId: id, from: 'Galaxy S25 Ultra', name: 'IMG_2041.jpg', mime: 'image/jpeg', bytes: 3874112,
  folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: 0, savedAs: null, reason: null, priorCopy: null,
  ...over,
});

function setup(answer: { ok: boolean; reason?: string } = { ok: true }) {
  const root = new FakeElement('div');
  const live = new FakeElement('div');
  const calls: string[] = [];
  let release: () => void = () => undefined;
  const tray = new Tray(root, live, (offerId) => {
    calls.push(offerId);
    return new Promise((ok) => { release = () => ok(answer); });
  });
  const card = () => root.children[0]!;
  const button = (action: string) => card().queryAll('button').find((b) => b.dataset.action === action)!;
  return { root, live, calls, tray, card, button, release: () => release() };
}

const settle = () => new Promise((ok) => setImmediate(ok));

/**
 * The card's status words only — headline and detail. Not the card's whole text: that includes the
 * button labels, and a hidden "Decline" button would match a search for "Declined".
 */
const statusOf = (card: FakeElement): string =>
  card.descendants().filter((e) => e.className === 'share-card-headline' || e.className === 'share-card-detail').map((e) => e.textContent).join(' ');

test('a waiting card shows who, what, the exact bytes and where — and points at the receive window', () => {
  const t = setup();
  t.tray.update([data()]);
  assert.equal(t.root.hidden, false);
  const text = t.card().textContent;
  for (const want of ['IMG_2041.jpg', 'Galaxy S25 Ultra', 'image/jpeg', '3,874,112 bytes', '~/Downloads/Sidekick', 'Wants to send you a file', 'Incoming file window']) {
    assert.ok(text.includes(want), want);
  }
  const visible = t.card().queryAll('button').filter((b) => !b.hidden).map((b) => b.dataset.action);
  assert.deepEqual(visible, ['show'], 'Show only; no Dismiss while waiting');
  assert.equal(t.button('show').getAttribute('aria-label'), 'Show IMG_2041.jpg in the Incoming file window');
  assert.equal(t.card().getAttribute('role'), 'group');
});

test('one decision surface: the card has no Accept or Decline in any state', () => {
  const t = setup();
  for (const state of ['awaiting-decision', 'accepting', 'receiving', 'saved', 'saved-unacknowledged', 'failed', 'declined', 'expired', 'cancelled', 'ended', 'refused']) {
    t.tray.update([data({ state, savedAs: state.startsWith('saved') ? 'IMG_2041.jpg' : null })]);
    const actions = t.card().queryAll('button').map((b) => b.dataset.action);
    assert.ok(actions.length > 0, `control: the card's buttons were read (${state})`);
    assert.ok(!actions.includes('accept') && !actions.includes('decline'), `${state}: ${actions.join(',')}`);
  }
});

test('arrival is announced politely and focus is not moved', () => {
  const t = setup();
  t.tray.update([data()]);
  assert.match(t.live.textContent, /Galaxy S25 Ultra wants to send IMG_2041\.jpg, 3,874,112 bytes/);
  for (const b of t.card().queryAll('button')) assert.equal(b.focusCount, 0);
});

test('Show sends the offer id and nothing else, and is disabled while pending', async () => {
  const t = setup();
  t.tray.update([data()]);
  t.button('show').click();
  assert.deepEqual(t.calls, [id]);
  assert.equal(t.button('show').disabled, true);
  t.button('show').click();
  assert.equal(t.calls.length, 1, 'a second click while pending sends nothing');
  t.release();
  await settle();
  t.tray.update([data({ state: 'receiving' })]);
  assert.equal(t.button('show').hidden, false, 'a live transfer can still be shown');
  assert.equal(t.button('dismiss').hidden, true, 'a live transfer cannot be dismissed');
});

test('Escape does nothing to a waiting card — there is nothing to dismiss and it cannot decline', () => {
  const t = setup();
  t.tray.update([data()]);
  t.card().dispatch('keydown', { key: 'Escape' });
  assert.deepEqual(t.calls, []);
  assert.equal(t.root.children.length, 1);
});

test('a refused Show is stated on the card', async () => {
  const t = setup({ ok: false, reason: 'no such offer' });
  t.tray.update([data()]);
  t.button('show').click();
  t.release();
  await settle();
  const note = t.card().queryAll('p').find((p) => p.className === 'share-card-note')!;
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /no such offer/);
  assert.equal(t.button('show').disabled, false);
});

test('expired reads Expired, never Declined, and can be dismissed; Escape dismisses a finished card', () => {
  const t = setup();
  t.tray.update([data({ state: 'expired' })]);
  const words = statusOf(t.card());
  assert.ok(words.includes('Expired'), words);
  assert.doesNotMatch(words, /Declin/);
  assert.equal(t.button('show').hidden, true);
  assert.equal(t.button('dismiss').hidden, false);
  t.card().dispatch('keydown', { key: 'Escape' });
  assert.equal(t.root.children.length, 0);
  assert.equal(t.root.hidden, true);
  assert.deepEqual(t.calls, [], 'dismissing sends nothing');
  t.tray.update([data({ state: 'expired' })]);
  assert.equal(t.root.children.length, 0, 'a dismissed card stays dismissed');
});

test('saved but unacknowledged is drawn as such — never as an unqualified success', () => {
  const t = setup();
  t.tray.update([data({ state: 'saved-unacknowledged', savedAs: 'IMG_2041.jpg' })]);
  assert.ok(statusOf(t.card()).startsWith('Saved on this Mac; confirmation to phone unknown'));
  assert.equal(t.card().dataset.tone, 'warning');
  assert.ok(t.card().textContent.includes('~/Downloads/Sidekick/IMG_2041.jpg'), 'where it actually is');
});

test('nothing says Saved while receiving', () => {
  const t = setup();
  t.tray.update([data({ state: 'receiving' })]);
  const words = statusOf(t.card());
  assert.ok(words.includes('Receiving'), `control: the status was read at all — ${words}`);
  assert.doesNotMatch(words, /Saved/);
});

test('a phone name carrying markup is drawn as text', () => {
  const t = setup();
  t.tray.update([data({ from: '<img src=x onerror=alert(1)>' })]);
  assert.equal(t.card().queryAll('img').length, 0);
  assert.ok(t.card().textContent.includes('<img src=x onerror=alert(1)>'));
});

test('a card whose offer is gone from the snapshot is removed', () => {
  const t = setup();
  t.tray.update([data()]);
  t.tray.update([]);
  assert.equal(t.root.children.length, 0);
  assert.equal(t.root.hidden, true);
});

// ---- the card review (docs/testing.md → Feature A card review, P1 and P2) -----------------------

const rowsOf = (card: FakeElement): string[] =>
  card.descendants().filter((e) => e.tagName?.toLowerCase() === 'dt').map((e) => e.textContent);

test('a waiting card keeps every row the decision needs; a finished one keeps who and, if saved, where', () => {
  const t = setup();
  t.tray.update([data()]);
  assert.deepEqual(rowsOf(t.card()), ['From', 'Type', 'Size', 'Save to']);
  for (const [state, want] of [
    ['receiving', ['From', 'Type', 'Size', 'Save to']],
    ['saved', ['From', 'Saved as']],
    ['saved-unacknowledged', ['From', 'Saved as']],
    ['expired', ['From']],
    ['failed', ['From']],
    ['declined', ['From']],
  ] as const) {
    t.tray.update([data({ state, savedAs: state.startsWith('saved') ? 'IMG_2041 (2).jpg' : null, reason: 'checksum' })]);
    assert.deepEqual(rowsOf(t.card()), want, state);
  }
});

test('a saved-but-unacknowledged, renamed card says the saved name once — in its row (P1)', () => {
  const t = setup();
  t.tray.update([data({ state: 'saved-unacknowledged', savedAs: 'IMG_2041 (2).jpg' })]);
  const text = t.card().textContent;
  assert.equal(text.split('IMG_2041 (2).jpg').length - 1, 1, text);
  assert.ok(text.includes('~/Downloads/Sidekick/IMG_2041 (2).jpg'), 'control: the row says where it is');
});

test('a new offer is drawn above earlier finished cards, and the tray is scrolled to it', () => {
  const t = setup();
  const older = 's-OLDoLDoLDoLDoLDoLDoLDo';
  t.tray.update([data({ offerId: older, state: 'saved', savedAs: 'IMG_2041.jpg' })]);
  t.root.scrollTop = 400; // as if the person had scrolled the tray
  t.tray.update([data(), data({ offerId: older, state: 'saved', savedAs: 'IMG_2041.jpg' })]);
  assert.equal(t.root.children.length, 2, 'control: both cards are drawn');
  assert.deepEqual(t.root.children.map((c) => c.dataset.state), ['awaiting-decision', 'saved']);
  assert.equal(t.root.scrollTop, 0);
});

test('one update carrying several new cards (a reload) draws them newest first', () => {
  const t = setup();
  const ids = ['s-NEWnEWnEWnEWnEWnEWnEWn', 's-MIDmIDmIDmIDmIDmIDmIDm', 's-OLDoLDoLDoLDoLDoLDoLDo'];
  t.tray.update([
    data({ offerId: ids[0] }),
    data({ offerId: ids[1], state: 'saved', savedAs: 'IMG_2041.jpg' }),
    data({ offerId: ids[2], state: 'expired' }),
  ]);
  assert.deepEqual(t.root.children.map((c) => c.dataset.offerId), ids);
});

