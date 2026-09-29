import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { negotiate, SHARE_WAIT, SHARE_WAIT_MINUTES } from './extensions';
import { EXPIRY_SKEW_MS, OFFER_TTL_MS, ShareOfferBook, offerWaitMs } from './shareOffer';

/**
 * `share.wait` (PROPOSED, development-only): a waiting offer may live 30 minutes when **both** sides
 * advertise it, and exactly 10 when either does not. The phone's `ShareOffer.ttlFor` is held to the
 * same fixture, so the two rules cannot drift apart.
 */

const fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'fixtures', 'share-wait.json'), 'utf8')) as {
  cases: Array<{ negotiated: number | null; waitMs: number; why: string }>;
};

test('offerWaitMs follows the shared fixture, case by case', () => {
  assert.ok(fixture.cases.length >= 5, 'control: the fixture was read');
  for (const c of fixture.cases) assert.equal(offerWaitMs(c.negotiated), c.waitMs, c.why);
});

test('an older peer on either side negotiates nothing, so offers wait 10 minutes', () => {
  const newMac = { 'share.file': 3, 'share.ask': 1, [SHARE_WAIT]: SHARE_WAIT_MINUTES };
  const oldPhone = { 'share.file': 3, 'share.ask': 1 };
  assert.equal(negotiate(newMac, oldPhone, SHARE_WAIT), null);
  assert.equal(offerWaitMs(negotiate(newMac, oldPhone, SHARE_WAIT)), OFFER_TTL_MS);
  assert.equal(offerWaitMs(negotiate(newMac, { ...oldPhone, [SHARE_WAIT]: 30 }, SHARE_WAIT)), 30 * 60_000);
});

const id = (n: number) => `s-${String(n).padStart(22, 'A')}`;
function offer(n: number, expiresAtMs: number) {
  return {
    offerId: id(n), rootId: `share:${id(n)}`, from: 'Phone',
    item: { itemId: '0', name: 'a.jpg', mime: 'image/jpeg', size: 1, sha256: 'a'.repeat(64) },
    expiresAtMs,
  };
}

test('a 30-minute offer is valid only on a session that agreed 30 minutes, and the Mac expires it by its own clock too', () => {
  const now = 1_790_000_000_000;
  const thirty = offerWaitMs(30);
  const ctx = { negotiated: true, sessionKey: 'k', nowMs: now };
  // Agreed 30: valid, and the Mac's own expiry is the earlier of the two clocks.
  const v = new ShareOfferBook().receive(offer(1, now + thirty), { ...ctx, waitMs: thirty });
  assert.equal(v.kind, 'valid');
  assert.equal((v as { macExpiresAtMs: number }).macExpiresAtMs, now + thirty);
  // A phone clock running ahead cannot stretch the Mac's hold past received + agreed wait.
  const ahead = new ShareOfferBook().receive(offer(2, now + thirty + EXPIRY_SKEW_MS), { ...ctx, waitMs: thirty });
  assert.equal((ahead as { macExpiresAtMs: number }).macExpiresAtMs, now + thirty);
  // Not agreed (older phone, or policy off): the same offer is refused as too far ahead — fails closed.
  const refused = new ShareOfferBook().receive(offer(3, now + thirty), ctx);
  assert.equal(refused.kind, 'decline');
  assert.equal((refused as { why: string }).why, 'expiresAtMs is too far ahead');
  // And beyond 30 minutes plus skew is refused even when agreed: never indefinite.
  const tooLong = new ShareOfferBook().receive(offer(4, now + thirty + EXPIRY_SKEW_MS + 1), { ...ctx, waitMs: thirty });
  assert.equal(tooLong.kind, 'decline');
});
