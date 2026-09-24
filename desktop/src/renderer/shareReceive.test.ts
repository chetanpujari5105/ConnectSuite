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
const Tray = g.ShareReceiveTray as new (root: FakeElement, live: FakeElement, decide: (id: string, d: string) => Promise<{ ok: boolean; reason?: string }>) => {
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
  const tray = new Tray(root, live, (offerId, decision) => {
    calls.push(`${offerId}:${decision}`);
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

test('a waiting card shows who, what, the exact bytes and where — and offers Decline then Accept', () => {
  const t = setup();
  t.tray.update([data()]);
  assert.equal(t.root.hidden, false);
  const text = t.card().textContent;
  for (const want of ['IMG_2041.jpg', 'Galaxy S25 Ultra', 'image/jpeg', '3,874,112 bytes', '~/Downloads/Sidekick', 'Wants to send you a file']) {
    assert.ok(text.includes(want), want);
  }
  const visible = t.card().queryAll('button').filter((b) => !b.hidden).map((b) => b.dataset.action);
  assert.deepEqual(visible, ['decline', 'accept'], 'Decline first in the tab order; no Dismiss while waiting');
  assert.equal(t.button('accept').getAttribute('aria-label'), 'Accept IMG_2041.jpg from Galaxy S25 Ultra and save it to ~/Downloads/Sidekick');
  assert.equal(t.card().getAttribute('role'), 'group');
});

test('arrival is announced politely and focus is not moved', () => {
  const t = setup();
  t.tray.update([data()]);
  assert.match(t.live.textContent, /Galaxy S25 Ultra wants to send IMG_2041\.jpg, 3,874,112 bytes/);
  for (const b of t.card().queryAll('button')) assert.equal(b.focusCount, 0);
});

test('Accept sends the offer id and a word — nothing else — and disables both buttons while pending', async () => {
  const t = setup();
  t.tray.update([data()]);
  t.button('accept').click();
  assert.deepEqual(t.calls, [`${id}:accept`]);
  assert.equal(t.button('accept').disabled, true);
  assert.equal(t.button('decline').disabled, true);
  t.button('accept').click();
  assert.equal(t.calls.length, 1, 'a second click while pending sends nothing');
  t.release();
  await settle();
  t.tray.update([data({ state: 'receiving' })]);
  assert.equal(t.button('accept').hidden, true);
  assert.equal(t.button('dismiss').hidden, true, 'a live transfer cannot be dismissed');
});

test('Decline, and Escape inside a waiting card, both decline', () => {
  const a = setup();
  a.tray.update([data()]);
  a.button('decline').click();
  assert.deepEqual(a.calls, [`${id}:decline`]);

  const b = setup();
  b.tray.update([data()]);
  b.card().dispatch('keydown', { key: 'Escape' });
  assert.deepEqual(b.calls, [`${id}:decline`]);
  b.card().dispatch('keydown', { key: 'Enter' });
  assert.equal(b.calls.length, 1, 'only Escape is bound');
});

test('a refused Accept (hidden window) is shown on the card and the card keeps waiting', async () => {
  const t = setup({ ok: false, reason: 'not accepted: the window is hidden; the offer is still waiting' });
  t.tray.update([data()]);
  t.button('accept').click();
  t.release();
  await settle();
  const note = t.card().queryAll('p').find((p) => p.className === 'share-card-note')!;
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /still waiting/);
  assert.equal(t.button('accept').disabled, false);
  assert.equal(t.button('accept').hidden, false);
});

test('expired reads Expired, never Declined, and can be dismissed; Escape dismisses a finished card', () => {
  const t = setup();
  t.tray.update([data({ state: 'expired' })]);
  const words = statusOf(t.card());
  assert.ok(words.includes('Expired'), words);
  assert.doesNotMatch(words, /Declin/);
  assert.equal(t.button('accept').hidden, true);
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
