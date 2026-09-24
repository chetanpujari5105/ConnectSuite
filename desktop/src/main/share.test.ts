import assert from 'node:assert/strict';
import test from 'node:test';

import { ShareReceiver, type ShareLink } from './share';

const now = 1_790_000_000_000;
const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';

function offer(offerId = id): Record<string, unknown> {
  return {
    offerId,
    rootId: `share:${offerId}`,
    from: 'Galaxy S25 Ultra',
    item: { itemId: '0', name: 'x.bin', mime: 'application/octet-stream', size: 1, sha256: 'b'.repeat(64) },
    expiresAtMs: now + 600_000,
  };
}

function fakeLink(negotiated: Record<string, number> = { 'share.file': 1 }) {
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  const link: ShareLink = {
    request: async (type, payload) => {
      sent.push({ type, payload });
      return { payload: { offerId: payload.offerId, state: 'declined' } };
    },
    negotiated: () => negotiated,
    token: () => 'token-A',
  };
  return { link, sent };
}

test('a valid offer is declined with the not-available stub — never accepted', () => {
  const { link, sent } = fakeLink();
  new ShareReceiver(link, false, () => now).onOffer(offer());
  assert.deepEqual(sent, [{ type: 'share.respond', payload: { offerId: id, decision: 'decline', reason: 'not-available' } }]);
});

test('no request of this receiver ever carries decision accept', () => {
  const { link, sent } = fakeLink();
  const r = new ShareReceiver(link, false, () => now);
  r.onOffer(offer());
  r.onOffer(offer('s-BBBBBBBBBBBBBBBBBBBBBB'));
  r.onOffer({ ...offer('s-CCCCCCCCCCCCCCCCCCCCCC'), rootId: 'wrong' });
  assert.ok(sent.length === 3);
  assert.ok(sent.every((s) => s.payload.decision === 'decline'));
});

test('an old phone (nothing negotiated) is declined not-negotiated', () => {
  const { link, sent } = fakeLink({});
  new ShareReceiver(link, false, () => now).onOffer(offer());
  assert.equal(sent[0]?.payload.reason, 'not-negotiated');
});

test('a replay is not answered a second time', () => {
  const { link, sent } = fakeLink();
  const r = new ShareReceiver(link, false, () => now);
  r.onOffer(offer());
  r.onOffer(offer());
  assert.equal(sent.length, 1);
});

test('silent (debug) validates and holds without answering; the phone cancel then ends it', () => {
  const { link, sent } = fakeLink();
  const r = new ShareReceiver(link, true, () => now);
  r.onOffer(offer());
  assert.equal(sent.length, 0);
  r.onCancel({ offerId: id, reason: 'expired' });
  // Control: after the cancel, a new offer on the same session is not busy.
  r.onOffer(offer('s-BBBBBBBBBBBBBBBBBBBBBB'));
  assert.equal(sent.length, 0, 'still silent, but it was held rather than refused busy');
  r.onSessionEnded('token-A');
});

test('one offer that expires on the Mac and is then cancelled expired by the phone counts once', async () => {
  const { link } = fakeLink();
  let t = now;
  const r = new ShareReceiver(link, true, () => t);
  r.onOffer({ ...offer(), expiresAtMs: now + 20 });
  t = now + 20;
  await new Promise((resolve) => setTimeout(resolve, 40)); // the Mac's own expiry timer fires
  assert.equal(r.counts().expired, 1);
  r.onCancel({ offerId: id, reason: 'expired' }); // the phone's cancel for the same ending
  assert.equal(r.counts().expired, 1, 'the same ending must not be counted twice');
});

test('a phone expiry for an offer the Mac still holds counts once', () => {
  const { link } = fakeLink();
  const r = new ShareReceiver(link, true, () => now);
  r.onOffer(offer());
  r.onCancel({ offerId: id, reason: 'expired' });
  assert.equal(r.counts().expired, 1);
});

test('a malformed offer in silent mode is still refused out loud', () => {
  const { link, sent } = fakeLink();
  new ShareReceiver(link, true, () => now).onOffer({ ...offer(), rootId: 'x' });
  assert.equal(sent[0]?.payload.reason, 'malformed-offer');
});
