import assert from 'node:assert/strict';
import test from 'node:test';

import { EXPIRY_SKEW_MS, OFFER_TTL_MS, ShareOfferBook, type OfferVerdict } from './shareOffer';

const now = 1_790_000_000_000;
const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const ctx = { negotiated: true, sessionKey: 'token-A', nowMs: now };

function offer(over: Record<string, unknown> = {}, item: Record<string, unknown> = {}): Record<string, unknown> {
  const offerId = (over.offerId as string) ?? id;
  return {
    offerId,
    rootId: `share:${offerId}`,
    from: 'Galaxy S25 Ultra',
    item: { itemId: '0', name: 'sidekick-offer-probe-100000.bin', mime: 'application/octet-stream', size: 100_000, sha256: 'a'.repeat(64), ...item },
    expiresAtMs: now + OFFER_TTL_MS,
    ...over,
  };
}

function declineReason(v: OfferVerdict): string {
  assert.equal(v.kind, 'decline', JSON.stringify(v));
  return (v as { reason: string }).reason;
}

test('a well-formed offer on a negotiated session is valid, with the Mac expiry capped at ten minutes', () => {
  const v = new ShareOfferBook().receive(offer({ expiresAtMs: now + OFFER_TTL_MS + 60_000 }), ctx);
  assert.equal(v.kind, 'valid');
  assert.equal((v as { macExpiresAtMs: number }).macExpiresAtMs, now + OFFER_TTL_MS);
});

test('a zero-byte offer is valid', () => {
  assert.equal(new ShareOfferBook().receive(offer({}, { size: 0 }), ctx).kind, 'valid');
});

test('not negotiated is declined not-negotiated, before any field is judged', () => {
  const v = new ShareOfferBook().receive(offer({ rootId: 'nonsense' }), { ...ctx, negotiated: false });
  assert.equal(declineReason(v), 'not-negotiated');
});

test('every broken field is declined malformed-offer — one case per rule', () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['rootId mismatch', { rootId: 'share:s-AAAAAAAAAAAAAAAAAAAAAA' }, {}],
    ['invalid root prefix', { rootId: `fs:${id}` }, {}],
    ['from empty', { from: '' }, {}],
    ['from too long', { from: 'x'.repeat(129) }, {}],
    ['item an array', { item: [] }, {}],
    ['itemId not 0', {}, { itemId: '1' }],
    ['name empty', {}, { name: '' }],
    ['name over 255 bytes', {}, { name: 'é'.repeat(128) }],
    ['mime without slash', {}, { mime: 'octetstream' }],
    ['mime too long', {}, { mime: 'a/' + 'b'.repeat(126) }],
    ['size negative', {}, { size: -1 }],
    ['size fractional', {}, { size: 1.5 }],
    ['size beyond 2^53-1', {}, { size: Number.MAX_SAFE_INTEGER + 2 }],
    ['size a string', {}, { size: '100' }],
    ['sha256 uppercase', {}, { sha256: 'A'.repeat(64) }],
    ['sha256 short', {}, { sha256: 'a'.repeat(63) }],
    ['expiry already past', { expiresAtMs: now }, {}],
    ['expiry beyond ten minutes plus skew', { expiresAtMs: now + OFFER_TTL_MS + EXPIRY_SKEW_MS + 1 }, {}],
    ['expiry not an integer', { expiresAtMs: 'soon' }, {}],
  ];
  for (const [why, over, item] of cases) {
    assert.equal(declineReason(new ShareOfferBook().receive(offer(over, item), ctx)), 'malformed-offer', why);
  }
});

test('the skew boundary is inclusive: exactly ten minutes plus five is still valid', () => {
  assert.equal(new ShareOfferBook().receive(offer({ expiresAtMs: now + OFFER_TTL_MS + EXPIRY_SKEW_MS }), ctx).kind, 'valid');
});

test('a replayed offerId is not answered again, even on a later session', () => {
  const book = new ShareOfferBook();
  assert.equal(book.receive(offer(), ctx).kind, 'valid');
  assert.deepEqual(book.receive(offer(), ctx), { kind: 'replay', offerId: id });
  assert.deepEqual(book.receive(offer(), { ...ctx, sessionKey: 'token-B' }), { kind: 'replay', offerId: id });
});

test('an offer with no usable offerId is unanswerable, never a decline naming a guessed id', () => {
  const book = new ShareOfferBook();
  assert.equal(book.receive(offer({ offerId: 'share:1' }), ctx).kind, 'unanswerable');
  assert.equal(book.receive(null, ctx).kind, 'unanswerable');
  assert.equal(book.receive([offer()], ctx).kind, 'unanswerable');
});

test('a second live offer on one session is declined busy; another session is not affected', () => {
  const book = new ShareOfferBook();
  const first = book.receive(offer(), ctx) as { macExpiresAtMs: number };
  book.hold(id, 'token-A', first.macExpiresAtMs);
  const second = 's-BBBBBBBBBBBBBBBBBBBBBB';
  assert.equal(declineReason(book.receive(offer({ offerId: second }), ctx)), 'busy');
  const third = 's-CCCCCCCCCCCCCCCCCCCCCC';
  assert.equal(book.receive(offer({ offerId: third }), { ...ctx, sessionKey: 'token-B' }).kind, 'valid');
});

test('a held offer ends by cancel, by expiry, or with its session — and only then', () => {
  const book = new ShareOfferBook();
  book.hold(id, 'token-A', now + 1000);
  assert.deepEqual(book.expire(now + 999), []);
  assert.deepEqual(book.expire(now + 1000), [id]);
  book.hold(id, 'token-A', now + 1000);
  assert.equal(book.cancelled(id), true);
  assert.equal(book.cancelled(id), false);
  book.hold(id, 'token-A', now + 1000);
  assert.deepEqual(book.sessionEnded('token-B'), []);
  assert.deepEqual(book.sessionEnded('token-A'), [id]);
  assert.equal(book.isHeld(id), false);
});

// ---- Version 3 foundation (PROPOSED, not advertised): the live limit is a parameter ---------------

/** A distinct valid offer id per index — `s-` + 22 base64url characters. */
const idN = (n: number): string => `s-${String(n).padStart(22, 'Q')}`;

test('v3 foundation: with a limit of 10, ten offers on one session are live and the eleventh is busy', () => {
  const book = new ShareOfferBook();
  const c = { ...ctx, maxLiveOffers: 10 };
  for (let n = 1; n <= 10; n += 1) {
    const v = book.receive(offer({ offerId: idN(n) }), c);
    assert.equal(v.kind, 'valid', `offer ${n}`);
    book.hold(idN(n), 'token-A', now + OFFER_TTL_MS);
  }
  assert.equal(declineReason(book.receive(offer({ offerId: idN(11) }), c)), 'busy');
  assert.equal(book.receive(offer({ offerId: idN(12) }), { ...c, sessionKey: 'token-B' }).kind, 'valid', 'another session is not affected');
});

test('v3 foundation: an offer that ends frees its slot, and the first ten are untouched by the refusal', () => {
  const book = new ShareOfferBook();
  const c = { ...ctx, maxLiveOffers: 2 };
  for (const n of [1, 2]) { book.receive(offer({ offerId: idN(n) }), c); book.hold(idN(n), 'token-A', now + OFFER_TTL_MS); }
  assert.equal(declineReason(book.receive(offer({ offerId: idN(3) }), c)), 'busy');
  assert.equal(book.isHeld(idN(1)) && book.isHeld(idN(2)), true, 'a busy refusal alters nothing held');
  book.cancelled(idN(1));
  assert.equal(book.receive(offer({ offerId: idN(4) }), c).kind, 'valid');
});

test('v3 foundation: no limit given is the version-2 contract — one live offer per session', () => {
  const book = new ShareOfferBook();
  book.receive(offer({ offerId: idN(1) }), ctx);
  book.hold(idN(1), 'token-A', now + OFFER_TTL_MS);
  assert.equal(declineReason(book.receive(offer({ offerId: idN(2) }), ctx)), 'busy');
  assert.equal(declineReason(book.receive(offer({ offerId: idN(3) }), { ...ctx, maxLiveOffers: 1 })), 'busy');
});

test('v3 foundation: a limit that is not a positive integer is refused, never read as "unlimited"', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new ShareOfferBook().receive(offer(), { ...ctx, maxLiveOffers: bad }), TypeError, String(bad));
  }
});

test('v3: a queued offer extended past its offer TTL still counts toward the live limit', () => {
  const book = new ShareOfferBook();
  const c = { ...ctx, maxLiveOffers: 1 };
  book.receive(offer({ offerId: idN(1) }), c);
  book.hold(idN(1), 'token-A', now + OFFER_TTL_MS);
  assert.equal(book.extend(idN(1), now + 60 * 60 * 1000), true);
  const later = { ...c, nowMs: now + OFFER_TTL_MS + 1 };
  assert.equal(declineReason(book.receive(offer({ offerId: idN(2), expiresAtMs: later.nowMs + 60_000 }), later)), 'busy');
  assert.equal(book.extend('s-NOTHELDNOTHELDNOTHELD', now), false, 'extending nothing held changes nothing');
});
