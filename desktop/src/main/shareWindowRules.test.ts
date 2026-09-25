import assert from 'node:assert/strict';
import test from 'node:test';

import type { ShareCardSnapshot } from './share';
import {
  SHARE_WINDOW_INSET,
  SHARE_WINDOW_MAX_HEIGHT,
  SHARE_WINDOW_MIN_HEIGHT,
  SHARE_WINDOW_WIDTH,
  clampShareWindowHeight,
  newlyNeedingAttention,
  parseOfferRequest,
  shareWindowBounds,
} from './shareWindowRules';

const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const id2 = 's-AAAAAAAAAAAAAAAAAAAAAA';

const snap = (offerId: string, state: ShareCardSnapshot['state']): ShareCardSnapshot => ({
  offerId, from: 'Galaxy', name: 'a.jpg', mime: 'image/jpeg', bytes: 1, folder: '~/Downloads/Sidekick',
  state, expiresAtMs: 0, savedAs: null, reason: null, priorCopy: null,
});

test('placed top right of the work area, inset, below the menu bar — on a second display too', () => {
  const b = shareWindowBounds({ x: 0, y: 25, width: 1512, height: 920 }, 210);
  assert.deepEqual(b, { x: 1512 - SHARE_WINDOW_WIDTH - SHARE_WINDOW_INSET, y: 25 + SHARE_WINDOW_INSET, width: SHARE_WINDOW_WIDTH, height: 210 });
  const right = shareWindowBounds({ x: 1512, y: 0, width: 1920, height: 1055 }, 210);
  assert.equal(right.x, 1512 + 1920 - SHARE_WINDOW_WIDTH - SHARE_WINDOW_INSET);
});

test('a work area smaller than the window keeps the window on it', () => {
  const b = shareWindowBounds({ x: 100, y: 0, width: 300, height: 100 }, 400);
  assert.equal(b.x, 100);
  assert.equal(b.width, 300);
  assert.equal(b.height, 100);
  assert.equal(b.y, 0);
});

test('the page-reported height is clamped, and garbage is ignored rather than obeyed', () => {
  assert.equal(clampShareWindowHeight(10), SHARE_WINDOW_MIN_HEIGHT);
  assert.equal(clampShareWindowHeight(99_999), SHARE_WINDOW_MAX_HEIGHT);
  assert.equal(clampShareWindowHeight(233.4), 233);
  for (const bad of [NaN, Infinity, '300', null, undefined, {}]) assert.equal(clampShareWindowHeight(bad), null);
});

test('an offer needs attention once — a republished snapshot never re-presents a closed window', () => {
  const seen = new Set<string>();
  assert.deepEqual(newlyNeedingAttention(seen, [snap(id, 'awaiting-decision')]), [id]);
  assert.deepEqual(newlyNeedingAttention(seen, [snap(id, 'awaiting-decision')]), [], 'the same offer again');
  assert.deepEqual(newlyNeedingAttention(seen, [snap(id, 'receiving')]), [], 'a progress update');
  assert.deepEqual(newlyNeedingAttention(seen, [snap(id2, 'refused'), snap(id, 'saved')]), [id2], 'a refusal is shown');
});

test('an offer first seen already past its decision does not present the window (a reload)', () => {
  const seen = new Set<string>();
  assert.deepEqual(newlyNeedingAttention(seen, [snap(id, 'saved'), snap(id2, 'expired')]), []);
});

test('an offer request is {offerId} and nothing else', () => {
  assert.deepEqual(parseOfferRequest({ offerId: id }), { ok: true, offerId: id });
  assert.equal(parseOfferRequest({ offerId: id, path: '/etc/passwd' }).ok, false);
  assert.equal(parseOfferRequest({ offerId: '../x' }).ok, false);
  assert.equal(parseOfferRequest([id]).ok, false);
  assert.equal(parseOfferRequest(null).ok, false);
  assert.equal(parseOfferRequest({}).ok, false);
});
