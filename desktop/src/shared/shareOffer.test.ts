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
