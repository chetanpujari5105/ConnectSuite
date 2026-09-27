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
 * The real `ShareWindowView` over the DOM double. What the double cannot show — the window's
 * placement, whether it took focus from another app, layout, the reduced-motion query — is not
 * claimed here: the first two are `shareDecision.test.ts` reading `shareWindow.ts`, the rest are
 * readings against the running window, recorded in docs/testing.md.
 */

const g = globalThis as Record<string, any>;
const ShareWindowView = g.ShareWindowView as new (n: unknown, bridge: unknown) => { update(p: unknown): void };
const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';

const offer = (over: Record<string, unknown> = {}) => ({
  offerId: id, from: 'Galaxy S25 Ultra', name: 'IMG_2041.jpg', mime: 'image/jpeg', bytes: 3874112,
  folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: 0, savedAs: null, reason: null, priorCopy: null,
  ...over,
});

function setup(answer: { ok: boolean; reason?: string } = { ok: true }) {
  const names = ['root', 'close', 'tile', 'eyebrow', 'title', 'meta', 'place', 'placeLabel', 'placeValue', 'detail', 'note', 'actions', 'live', 'progress', 'fill', 'progressLabel'];
  const n = Object.fromEntries(names.map((k) => [k, new FakeElement(k === 'close' ? 'button' : 'div')])) as Record<string, FakeElement>;
  n.root!.append(n.close!, n.tile!, n.eyebrow!, n.title!, n.meta!, n.progress!, n.place!, n.detail!, n.note!, n.actions!);
  const calls: string[] = [];
  let release: () => void = () => undefined;
  const bridge = {
    shareDecide: (offerId: string, decision: string) => {
      calls.push(`${offerId}:${decision}`);
      return new Promise((ok) => { release = () => ok(answer); });
    },
    shareWindowClose: () => calls.push('close'),
    shareAct: (action: string, offerId: string) => {
      calls.push(`${action}:${offerId}`);
      return new Promise((ok) => { release = () => ok(answer); });
    },
  };
  const view = new ShareWindowView(n, bridge);
  const draw = (over: Record<string, unknown> = {}, phone: string | null = 'Galaxy S25 Ultra', thumb: string | null = null) =>
    view.update({ subject: id, offers: [offer(over)], phone, thumb });
  const button = (action: string) => n.actions!.queryAll('button').find((b) => b.dataset.action === action);
  return { n, view, calls, draw, button, release: () => release() };
}

const settle = () => new Promise((ok) => setImmediate(ok));

test('a waiting offer: who, the file, type and exact bytes, where — then Decline before Accept', () => {
  const t = setup();
  t.draw();
  assert.equal(t.n.eyebrow!.textContent, 'Galaxy S25 Ultra wants to send a file');
  assert.equal(t.n.title!.textContent, 'IMG_2041.jpg');
  assert.equal(t.n.meta!.textContent, 'JPEG image · 3.9 MB (3,874,112 bytes)');
  assert.equal(t.n.placeValue!.textContent, '~/Downloads/Sidekick');
  assert.deepEqual(t.n.actions!.queryAll('button').map((b) => b.dataset.action), ['decline', 'accept']);
  assert.equal(t.n.root!.dataset.state, 'awaiting-decision');
});

test('arrival is announced politely, once, and nothing is focused', () => {
  const t = setup();
  t.draw();
  assert.match(t.n.live!.textContent, /Galaxy S25 Ultra wants to send IMG_2041\.jpg, 3,874,112 bytes/);
  t.n.live!.textContent = '';
  t.draw();
  assert.equal(t.n.live!.textContent, '', 'a republished snapshot is not announced again');
  for (const b of [t.n.close!, ...t.n.actions!.queryAll('button')]) assert.equal(b.focusCount, 0);
});

test('closing a waiting offer hides the window and declines nothing — and says so', () => {
  const t = setup();
  t.draw();
  assert.match(t.n.close!.getAttribute('aria-label') ?? '', /keeps waiting/);
  t.n.close!.click();
  assert.deepEqual(t.calls, ['close'], 'close, and no decision');
});

test('Accept sends the offer id and a word, disables both while pending; a refusal is shown and it keeps waiting', async () => {
  const t = setup({ ok: false, reason: 'not accepted: the window is not in front; the offer is still waiting' });
  t.draw();
  t.button('accept')!.click();
  assert.deepEqual(t.calls, [`${id}:accept`]);
  assert.equal(t.button('accept')!.disabled, true);
  assert.equal(t.button('decline')!.disabled, true);
  t.button('accept')!.click();
  assert.equal(t.calls.length, 1, 'a second click while pending sends nothing');
  t.release();
  await settle();
  assert.equal(t.n.note!.hidden, false);
  assert.match(t.n.note!.textContent, /still waiting/);
  assert.equal(t.button('accept')!.disabled, false);
});

test('Escape declines a waiting offer and closes a finished one', () => {
  const a = setup();
  a.draw();
  a.n.root!.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual(a.calls, [`${id}:decline`]);

  const b = setup();
  b.draw({ state: 'expired' });
  b.n.root!.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual(b.calls, ['close']);
});

test('while receiving: the Mac’s own count, a Cancel, and nothing that says Saved', () => {
  const t = setup();
  t.draw({ state: 'receiving', receivedBytes: 1937056 });
  assert.equal(t.n.eyebrow!.textContent, 'Receiving from Galaxy S25 Ultra…');
  assert.equal(t.n.progress!.hidden, false);
  assert.equal(t.n.progressLabel!.textContent, '1.9 MB of 3.9 MB · 50%');
  assert.equal(t.n.fill!.style.transform, 'scaleX(0.5)');
  assert.equal(t.n.progress!.getAttribute('aria-valuenow'), '1937056');
  assert.equal(t.n.progress!.getAttribute('aria-valuemax'), '3874112');
  assert.deepEqual(t.n.actions!.queryAll('button').map((b) => b.dataset.action), ['cancel']);
  assert.doesNotMatch(`${t.n.eyebrow!.textContent} ${t.n.detail!.textContent}`, /\bSaved\b/);
});

test('before the phone starts there is no fill and no aria value — nothing is guessed', () => {
  const t = setup();
  t.draw({ state: 'accepting' });
  assert.equal(t.n.progress!.dataset.indeterminate, 'true');
  assert.equal(t.n.progress!.getAttribute('aria-valuenow'), null);
});

test('Cancel sends the offer id and a word; a refusal is stated', async () => {
  const t = setup({ ok: false, reason: 'There is nothing running to cancel.' });
  t.draw({ state: 'receiving', receivedBytes: 10 });
  t.button('cancel')!.click();
  assert.deepEqual(t.calls, [`cancel:${id}`]);
  t.release();
  await settle();
  assert.equal(t.n.note!.hidden, false);
  assert.match(t.n.note!.textContent, /nothing running/);
});

test('a saved file: Show in Finder, Open — and the picture only of the verified file', () => {
  const t = setup();
  t.draw({ state: 'saved', savedAs: 'IMG_2041.jpg' }, 'Galaxy S25 Ultra', 'data:image/png;base64,AAAA');
  assert.deepEqual(t.n.actions!.queryAll('button').map((b) => b.dataset.action), ['reveal', 'open']);
  assert.equal(t.n.progress!.hidden, true);
  const img = t.n.tile!.queryAll('img');
  assert.equal(img.length, 1);
  t.button('open')!.click();
  assert.deepEqual(t.calls, [`open:${id}`]);
});

test('a thumbnail sent for a file that is not saved is not drawn', () => {
  const t = setup();
  t.draw({ state: 'receiving', receivedBytes: 1 }, 'Galaxy S25 Ultra', 'data:image/png;base64,AAAA');
  assert.equal(t.n.tile!.queryAll('img').length, 0);
  assert.equal(t.n.tile!.dataset.glyph, 'photos');
});

test('a finished, unsaved offer closes itself after 8 s — unless the pointer is on it', () => {
  const t = setup();
  const before = win.timers.length;
  t.draw({ state: 'declined' });
  const timer = win.timers[win.timers.length - 1]!;
  assert.equal(win.timers.length, before + 1, 'control: a timer was scheduled');
  assert.equal(timer.delay, 8000);
  t.n.root!.dispatch('pointerenter');
  win.fireTimer(timer.id);
  assert.deepEqual(t.calls, [], 'hovered: left for the person to close');

  const u = setup();
  u.draw({ state: 'declined' });
  win.fireTimer(win.timers[win.timers.length - 1]!.id);
  assert.deepEqual(u.calls, ['close']);
});

test('a saved file does not close itself', () => {
  const t = setup();
  const before = win.timers.length;
  t.draw({ state: 'saved', savedAs: 'IMG_2041.jpg' });
  assert.equal(win.timers.length, before);
});

test('text from the phone is text: a name or `from` carrying markup draws no element', () => {
  const t = setup();
  t.draw({ name: '<img src=x onerror=alert(1)>.jpg', from: '<b>x</b>' });
  assert.equal(t.n.root!.queryAll('img').length, 0);
  assert.equal(t.n.title!.textContent, '<img src=x onerror=alert(1)>.jpg');
  assert.match(t.n.detail!.textContent, /The phone calls itself “<b>x<\/b>”/);
});

test('the tile draws the type glyph by MIME, and nothing that looks like a preview', () => {
  const t = setup();
  t.draw({ mime: 'video/mp4', name: 'clip.jpg' });
  assert.equal(t.n.tile!.dataset.glyph, 'video');
  assert.equal(t.n.tile!.queryAll('img').length, 0);
});

test('the arrival sentence is cleared once the offer ends — and stays for a refusal, which is its own announcement', () => {
  const t = setup();
  t.draw();
  assert.match(t.n.live!.textContent, /wants to send IMG_2041\.jpg/, 'control: announced');
  t.draw({ state: 'saved', savedAs: 'IMG_2041.jpg' });
  assert.equal(t.n.live!.textContent, '');
  const r = setup();
  r.draw({ state: 'refused', reason: 'no-space' });
  const said = r.n.live!.textContent;
  assert.notEqual(said, '', 'control: a refusal is announced');
  r.draw({ state: 'refused', reason: 'no-space' });
  assert.equal(r.n.live!.textContent, said);
  const gone = setup();
  gone.draw();
  gone.view.update({ subject: id, offers: [], phone: 'Galaxy S25 Ultra', thumb: null });
  assert.equal(gone.n.live!.textContent, '', 'the offer gone from the snapshot');
});
