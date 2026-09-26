import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeElement, installFakeDocument, installFakeWindow } from './domDouble.testkit';

installFakeDocument();
const win = installFakeWindow();
require('./icons');
require('../shared/shareReceiveCopy');
require('../shared/shareWindowModel');
import './shareWindow';

/**
 * The real `ShareQueueView` (version 3, PROPOSED — reachable only at a negotiated `share.file` 3,
 * which nothing advertises) over the DOM double. What the double cannot show — layout, scrolling,
 * real focus — is not claimed here.
 */

const g = globalThis as Record<string, any>;
const ShareQueueView = g.ShareQueueView as new (n: unknown, bridge: unknown) => { update(p: unknown): void; isActive(): boolean; escape(): boolean };
const A = 's-AAAAAAAAAAAAAAAAAAAAAA';
const B = 's-BBBBBBBBBBBBBBBBBBBBBB';
const C = 's-CCCCCCCCCCCCCCCCCCCCCC';

const offer = (offerId: string, seq: number, over: Record<string, unknown> = {}) => ({
  offerId, from: 'Galaxy S25 Ultra', name: 'IMG_1.jpg', mime: 'image/jpeg', bytes: 100_718,
  folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: 0, savedAs: null, reason: null, priorCopy: null,
  queueMode: true, arrivalSeq: seq, arrivedAtMs: 0, filesAhead: null,
  ...over,
});

function setup(answer: { ok: boolean; reason?: string } = { ok: true }) {
  const n = {
    root: new FakeElement('main'), one: new FakeElement('div'), queue: new FakeElement('ol'),
    close: new FakeElement('button'), live: new FakeElement('div'),
  };
  n.root.append(n.close, n.one, n.queue);
  const calls: string[] = [];
  const pending: (() => void)[] = [];
  const reply = () => new Promise((ok) => { pending.push(() => ok(answer)); });
  const bridge = {
    shareDecide: (offerId: string, decision: string) => { calls.push(`${decision}:${offerId}`); return reply(); },
    shareAct: (action: string, offerId: string) => { calls.push(`${action}:${offerId}`); return reply(); },
    shareWindowClose: () => calls.push('close-window'),
  };
  const view = new ShareQueueView(n, bridge);
  const draw = (offers: Record<string, unknown>[], subject: string | null = null) => view.update({ subject, offers, phone: 'Galaxy S25 Ultra', thumb: null });
  const cards = () => n.queue.queryAll('li');
  const card = (offerId: string) => cards().find((c) => c.dataset.offerId === offerId);
  const button = (offerId: string, action: string) => card(offerId)?.queryAll('button').find((b) => b.dataset.action === action);
  return { n, view, calls, draw, cards, card, button, releaseAll: () => pending.splice(0).forEach((f) => f()) };
}

const settle = () => new Promise((ok) => setImmediate(ok));
const focus = (el: FakeElement | null) => {
  (globalThis.document as unknown as { activeElement: FakeElement | null }).activeElement = el;
};

test('version 2 snapshots leave the list inactive and hidden — the one-file window is untouched', () => {
  const t = setup();
  t.draw([offer(A, 1, { queueMode: false })]);
  assert.equal(t.view.isActive(), false);
  assert.equal(t.n.queue.hidden, true);
  assert.equal(t.n.one.hidden, false);
  assert.equal(t.cards().length, 0);
});

test('two waiting offers with one name: two cards in arrival order, each with its own Decline and Accept', () => {
  const t = setup();
  t.draw([offer(B, 2), offer(A, 1)]);
  assert.equal(t.view.isActive(), true);
  assert.equal(t.n.one.hidden, true);
  assert.deepEqual(t.cards().map((c) => c.dataset.offerId), [A, B], 'arrival order, not snapshot order');
  for (const id of [A, B]) {
    assert.deepEqual(t.card(id)!.queryAll('button').map((b) => b.dataset.action), ['decline', 'accept']);
    for (const b of t.card(id)!.queryAll('button')) assert.equal(b.dataset.offerId, id, 'every button carries its own card’s id');
  }
  const labels = [A, B].map((id) => t.button(id, 'accept')!.getAttribute('aria-label'));
  assert.notEqual(labels[0], labels[1], 'same file name, different accessible names');
  for (const b of t.n.root.queryAll('button')) assert.equal(b.focusCount, 0, 'nothing is focused by an arrival');
});

test('Accept on the second card sends that card’s id only, and pends only that card', async () => {
  const t = setup();
  t.draw([offer(A, 1), offer(B, 2)]);
  t.button(B, 'accept')!.click();
  assert.deepEqual(t.calls, [`accept:${B}`]);
  assert.equal(t.button(B, 'accept')!.disabled, true);
  assert.equal(t.button(A, 'accept')!.disabled, false, 'the other card stays usable');
  t.button(B, 'accept')!.click();
  assert.equal(t.calls.length, 1, 'a second click while pending sends nothing');
  t.button(A, 'decline')!.click();
  assert.deepEqual(t.calls, [`accept:${B}`, `decline:${A}`]);
  t.releaseAll();
  await settle();
});

test('a list re-rendered between drawing and clicking cannot retarget an action — it is bound to the id', () => {
  const t = setup();
  t.draw([offer(A, 1), offer(B, 2)]);
  const acceptA = t.button(A, 'accept')!;
  t.draw([offer(C, 3), offer(B, 2), offer(A, 1)]);
  acceptA.click();
  assert.deepEqual(t.calls, [`accept:${A}`]);
  assert.deepEqual(t.cards().map((c) => c.dataset.offerId), [A, B, C]);
});

test('a refusal is stated on its own card and the offer keeps waiting', async () => {
  const t = setup({ ok: false, reason: 'not accepted: the window is not in front; the offer is still waiting' });
  t.draw([offer(A, 1), offer(B, 2)]);
  t.button(A, 'accept')!.click();
  t.releaseAll();
  await settle();
  const noteOf = (id: string) => t.card(id)!.queryAll('p').find((p) => p.className === 'sw-note')!;
  assert.equal(noteOf(A).hidden, false);
  assert.match(noteOf(A).textContent, /still waiting/);
  assert.equal(noteOf(B).hidden, true);
  assert.equal(t.button(A, 'accept')!.disabled, false);
});

test('queued: says accepted and waiting, how many are ahead, with a Cancel bound to it; it never says saved', () => {
  const t = setup();
  t.draw([offer(A, 1, { state: 'receiving', receivedBytes: 50_000 }), offer(B, 2, { state: 'queued', filesAhead: 1 })]);
  assert.deepEqual(t.card(B)!.queryAll('button').map((b) => b.dataset.action), ['cancel']);
  assert.match(t.card(B)!.textContent, /1 transfer is ahead of it/);
  assert.doesNotMatch(t.card(B)!.textContent, /\bSaved\b/);
  t.button(B, 'cancel')!.click();
  assert.deepEqual(t.calls, [`cancel:${B}`]);
});

test('Escape declines only the focused card’s waiting offer; with no card focused it hides the window', () => {
  const t = setup();
  t.draw([offer(A, 1), offer(B, 2)]);
  focus(t.button(B, 'accept')!);
  t.n.root.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual(t.calls, [`decline:${B}`]);
  focus(null);
  t.n.root.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual(t.calls, [`decline:${B}`, 'close-window'], 'hides; declines nothing');
});

test('Escape on a focused queued card declines nothing and cancels nothing', () => {
  const t = setup();
  t.draw([offer(A, 1, { state: 'queued', filesAhead: 1 }), offer(B, 2)]);
  focus(t.button(A, 'cancel')!);
  t.n.root.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual(t.calls, ['close-window']);
  focus(null);
});

test('a saved card stays with Open and Show in Finder; a new window does not replay it, but Show draws it', () => {
  const t = setup();
  t.draw([offer(A, 1)]);
  t.draw([offer(A, 1, { state: 'saved', savedAs: 'IMG_1.jpg' })]);
  assert.deepEqual(t.cards().map((c) => c.dataset.offerId), [A]);
  assert.deepEqual(t.card(A)!.queryAll('button').map((b) => b.dataset.action), ['reveal', 'open']);
  const fresh = setup();
  fresh.draw([offer(A, 1, { state: 'saved', savedAs: 'IMG_1.jpg' })]);
  assert.equal(fresh.cards().length, 0, 'a reopened window does not replay the run');
  fresh.draw([offer(A, 1, { state: 'saved', savedAs: 'IMG_1.jpg' })], A);
  assert.equal(fresh.cards().length, 1, 'but Show for that file draws it');
});

test('a declined card lingers, then leaves the list; the window closes when nothing is left', () => {
  const t = setup();
  t.draw([offer(A, 1), offer(B, 2)]);
  const before = win.timers.length;
  t.draw([offer(A, 1, { state: 'declined' }), offer(B, 2)]);
  assert.equal(win.timers.length, before + 1, 'control: one linger timer, for the finished card only');
  win.fireTimer(win.timers[win.timers.length - 1]!.id);
  assert.deepEqual(t.cards().map((c) => c.dataset.offerId), [B]);
  assert.ok(!t.calls.includes('close-window'), 'one card is still waiting');
  t.draw([offer(A, 1, { state: 'declined' }), offer(B, 2, { state: 'expired' })]);
  win.fireTimer(win.timers[win.timers.length - 1]!.id);
  assert.equal(t.cards().length, 0);
  assert.deepEqual(t.calls, ['close-window']);
});

test('the header close is labelled to say waiting files keep waiting', () => {
  const t = setup();
  t.draw([offer(A, 1), offer(B, 2, { state: 'queued', filesAhead: 1 })]);
  assert.match(t.n.close.getAttribute('aria-label') ?? '', /keep waiting/);
});

test('text from the phone is text in every card', () => {
  const t = setup();
  t.draw([offer(A, 1, { name: '<img src=x onerror=alert(1)>.jpg' })]);
  assert.equal(t.card(A)!.queryAll('img').length, 0);
  assert.match(t.card(A)!.textContent, /<img src=x/);
});

test('two cards of one name have two different accessible names, and each draws which file it is', () => {
  const t = setup();
  const t0 = new Date(2026, 8, 26, 6, 41, 12).getTime();
  t.draw([offer(A, 1, { arrivedAtMs: t0 }), offer(B, 2, { arrivedAtMs: t0 + 3000 }), offer(C, 3, { name: 'notes.txt', mime: 'text/plain' })]);
  assert.equal(t.card(A)!.getAttribute('aria-label'), 'IMG_1.jpg (file 1, arrived 06:41:12)');
  assert.equal(t.card(B)!.getAttribute('aria-label'), 'IMG_1.jpg (file 2, arrived 06:41:15)');
  const arrival = (id: string) => t.card(id)!.queryAll('p').find((p) => p.className === 'sw-arrival')!;
  assert.equal(arrival(A).hidden, false);
  assert.equal(arrival(A).textContent, 'File 1 · arrived 06:41:12');
  assert.equal(arrival(B).textContent, 'File 2 · arrived 06:41:15');
  assert.equal(arrival(C).hidden, true, 'control: a name that appears once shows no note');
  assert.equal(arrival(C).textContent, '');
  assert.match(t.card(C)!.getAttribute('aria-label')!, /^notes\.txt \(file 3, arrived /, 'a unique name still says which file');
});

test('when its twin leaves the list, a card drops its arrival note', () => {
  const t = setup();
  t.draw([offer(A, 1), offer(B, 2)]);
  const arrival = (id: string) => t.card(id)!.queryAll('p').find((p) => p.className === 'sw-arrival')!;
  assert.equal(arrival(B).hidden, false, 'control: noted while both are listed');
  t.draw([offer(A, 1, { state: 'declined' }), offer(B, 2)]);
  t.card(A)!.queryAll('button').find((b) => b.dataset.action === 'close')?.click();
  t.draw([offer(A, 1, { state: 'declined' }), offer(B, 2)]);
  if (t.card(A)) return assert.fail('the declined card was expected to leave the list after its Close');
  assert.equal(arrival(B).hidden, true);
});

test('escape() from outside the list: hides with nothing focused, and acts on nothing while the list does not own the window', () => {
  const t = setup();
  t.draw([offer(A, 1, { queueMode: false })]);
  assert.equal(t.view.escape(), false, 'version 2: not the list’s to handle');
  assert.deepEqual(t.calls, []);
  t.draw([offer(A, 1), offer(B, 2)]);
  focus(null);
  assert.equal(t.view.escape(), true);
  assert.deepEqual(t.calls, ['close-window'], 'hides; declines nothing');
});

test('the header’s Hide draws its glyph in the list view too, once, however many snapshots arrive', () => {
  const t = setup();
  assert.equal(t.n.close.queryAll('svg').length, 0, 'control: nothing is drawn before the list owns the window');
  t.draw([offer(A, 1, { queueMode: false })]);
  assert.equal(t.n.close.queryAll('svg').length, 0, 'version 2: the one-file view draws it, not the list');
  t.draw([offer(A, 1), offer(B, 2)]);
  t.draw([offer(A, 1), offer(B, 2), offer(C, 3)]);
  assert.equal(t.n.close.queryAll('svg').length, 1);
  assert.equal(t.n.close.dataset.icon, 'close');
  assert.equal(t.n.close.getAttribute('aria-label'), 'Hide this window. Waiting files keep waiting until they expire.');
});
