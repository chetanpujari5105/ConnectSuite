import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { pullShareWith, type SharePullResult } from './bulk';
import { ShareReceiver, isAcceptableProbe, type ShareDeps, type ShareLink } from './share';
import { checkDestination, publishExclusive, type DestinationVerdict } from './shareDestination';
import { startFakePhone, synthetic, type FakePhone } from './sharePhone.testkit';
import { handleShareDecision, type WindowFacts } from './shareDecision';
import { sanitizeShareName } from '../shared/shareNames';
const { shareReceiveStatus } = require('../shared/shareReceiveCopy') as { shareReceiveStatus: (f: Record<string, unknown>) => { headline: string; savedOnMac: boolean; confirmedByPhone: boolean } };

/**
 * The Mac receiver wired as `main.ts` wires it — the real destination check and exclusive publish on
 * a temporary folder, and the real `pullShareWith` over a local socket to a fake phone. Only the
 * control link is a double, and it records every request the receiver makes.
 */

const now = 1_790_000_000_000;
const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const txA = 'ts-AAAAAAAAAAAAAAAAAAAAAA';
const txB = 'ts-BBBBBBBBBBBBBBBBBBBBBB';

type Sent = { type: string; payload: Record<string, unknown> };

function offer(size: number, sha256: string, over: { name?: string; mime?: string; offerId?: string } = {}): Record<string, unknown> {
  const offerId = over.offerId ?? id;
  return {
    offerId, rootId: `share:${offerId}`, from: 'Galaxy S25 Ultra',
    item: { itemId: '0', name: over.name ?? `sidekick-offer-probe-${size}.bin`, mime: over.mime ?? 'application/octet-stream', size, sha256 },
    expiresAtMs: now + 600_000,
  };
}

class FakeLink implements ShareLink {
  sent: Sent[] = [];
  tokenValue = 'token-A';
  beginIds = [txA, txB];
  onRequest: (s: Sent) => void = () => undefined;
  savedReply: 'ack' | 'error' = 'ack';
  constructor(private readonly version: number, private readonly size: number, readonly sha256: string) {}
  negotiated(): Record<string, number> {
    return this.version > 0 ? { 'share.file': this.version } : {};
  }
  token(): string | null {
    return this.tokenValue;
  }
  async request(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const s = { type, payload };
    this.sent.push(s);
    this.onRequest(s);
    if (type === 'share.respond') return { payload: { offerId: payload.offerId, state: payload.decision === 'accept' ? 'accepted' : 'declined' } };
    if (type === 'fs.transfer.begin') {
      return { payload: { transferId: this.beginIds.shift(), direction: 'pull', size: this.size, sha256: this.sha256, offset: 0 } };
    }
    if (type === 'share.saved') {
      if (this.savedReply === 'error') throw new Error('NOT_FOUND');
      return { payload: { offerId: payload.offerId, state: payload.ok ? 'saved' : 'failed' } };
    }
    return { payload: { stopped: true } };
  }
  types(): string[] {
    return this.sent.map((s) => (s.type === 'share.respond' ? `respond:${s.payload.decision}` : s.type === 'share.saved' ? `saved:${s.payload.ok}` : s.type));
  }
}

function receiver(link: FakeLink, folder: string, phones: FakePhone[], over: Partial<ShareDeps> = {}): ShareReceiver {
  let attempt = 0;
  return new ShareReceiver({
    link,
    receiveFolder: async () => ({ ok: true, folder }),
    checkDestination: (f, size) => checkDestination(f, size),
    pull: (options): Promise<SharePullResult> => pullShareWith(options, phones[Math.min(attempt++, phones.length - 1)]!.open),
    publish: (part, f, name) => publishExclusive(part, f, name),
    now: () => now,
    idleTimeoutMs: 2000,
    version2: { allowed: true, syntheticOnly: false },
    ...over,
  });
}

const folder = (): string => mkdtempSync(join(tmpdir(), 'share-recv-'));
/** The development switch, allow-listing exactly this link's offered digest. */
const allow = (link: FakeLink): ReadonlySet<string> => new Set([link.sha256]);

// ---- the version gate -------------------------------------------------------------------------

test('version 1: a valid offer is declined not-available — no accept, no pull, even with the probe switch on', { timeout: 10_000 }, async () => {
  const data = synthetic(1000);
  const link = new FakeLink(1, 1000, data.sha256);
  const d = folder();
  const r = receiver(link, d, [], { switches: { acceptProbeDigests: allow(link) } });
  await r.onOffer(offer(1000, data.sha256));
  assert.deepEqual(link.types(), ['respond:decline']);
  assert.equal(link.sent[0]!.payload.reason, 'not-available');
  assert.deepEqual(readdirSync(d), []);
});

test('no share.file at all is declined not-negotiated', { timeout: 10_000 }, async () => {
  const link = new FakeLink(0, 1, 'a'.repeat(64));
  await receiver(link, folder(), []).onOffer(offer(1, 'a'.repeat(64)));
  assert.equal(link.sent[0]!.payload.reason, 'not-negotiated');
});

test('version 1 with shareSilent holds without answering (slice 2 behaviour kept)', { timeout: 10_000 }, async () => {
  const link = new FakeLink(1, 1, 'a'.repeat(64));
  const r = receiver(link, folder(), [], { switches: { silent: true } });
  await r.onOffer(offer(1, 'a'.repeat(64)));
  assert.deepEqual(link.sent, []);
  r.onCancel({ offerId: id, reason: 'expired' });
  assert.equal(r.counts().expired, 1);
});

// ---- Ask by default ---------------------------------------------------------------------------

test('version 2, an ordinary offer: held for a decision and never auto-accepted, even with the probe switch on', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 1000, 'a'.repeat(64));
  const d = folder();
  const r = receiver(link, d, [], { switches: { acceptProbeDigests: allow(link) } });
  await r.onOffer(offer(1000, 'a'.repeat(64), { name: 'holiday.jpg', mime: 'image/jpeg' }));
  assert.deepEqual(link.sent, []);
  assert.equal(r.state(id), 'awaiting-decision');
  assert.deepEqual(readdirSync(d), [], 'the destination probe left nothing behind');
});

test('version 2, a probe offer with the switch OFF (the default): held, not accepted', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 1000, 'a'.repeat(64));
  const r = receiver(link, folder(), []);
  await r.onOffer(offer(1000, 'a'.repeat(64)));
  assert.deepEqual(link.sent, []);
  assert.equal(r.state(id), 'awaiting-decision');
});

test('the probe gate needs an allow-listed digest AND the probe name AND the probe MIME', () => {
  const sha = 'a'.repeat(64);
  const on = new Set([sha]);
  assert.equal(isAcceptableProbe(offer(1, sha) as never, on), true);
  assert.equal(isAcceptableProbe(offer(1, sha) as never, new Set()), false, 'an empty list accepts nothing');
  assert.equal(isAcceptableProbe(offer(1, 'b'.repeat(64)) as never, on), false, 'a digest not on the list');
  assert.equal(isAcceptableProbe(offer(1, sha, { name: 'sidekick-offer-probe-1.jpg' }) as never, on), false);
  assert.equal(isAcceptableProbe(offer(1, sha, { mime: 'image/png' }) as never, on), false);
  assert.equal(isAcceptableProbe(offer(1, sha, { name: 'my sidekick-offer-probe-1.bin' }) as never, on), false);
});

test('an untrusted sender using the probe name and MIME is NOT accepted: its digest is not on the list', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 1000, 'c'.repeat(64));
  const r = receiver(link, folder(), [], { switches: { acceptProbeDigests: new Set(['a'.repeat(64)]) } });
  await r.onOffer(offer(1000, 'c'.repeat(64)));
  assert.deepEqual(link.sent, []);
  assert.equal(r.state(id), 'awaiting-decision');
});

test('the probe switch on with an empty list accepts nothing', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 1000, 'a'.repeat(64));
  const r = receiver(link, folder(), [], { switches: { acceptProbeDigests: new Set() } });
  await r.onOffer(offer(1000, 'a'.repeat(64)));
  assert.deepEqual(link.sent, []);
});

// ---- the pre-live activation gate (shareActivation.ts) ----------------------------------------

test('negotiated 2 but version 2 NOT activated on this Mac: answered as version 1, nothing held, nothing pulled', { timeout: 10_000 }, async () => {
  const data = synthetic(1000);
  const link = new FakeLink(2, 1000, data.sha256);
  const d = folder();
  for (const version2 of [undefined, { allowed: false, syntheticOnly: false }]) {
    link.sent = [];
    const r = receiver(link, d, [], { switches: { acceptProbeDigests: allow(link) }, version2 });
    await r.onOffer(offer(1000, data.sha256, { offerId: version2 ? 's-BBBBBBBBBBBBBBBBBBBBBB' : 's-CCCCCCCCCCCCCCCCCCCCCC' }));
    assert.deepEqual(link.types(), ['respond:decline'], `version2 = ${JSON.stringify(version2)}`);
    assert.equal(link.sent[0]!.payload.reason, 'not-available');
  }
  assert.deepEqual(readdirSync(d), [], 'not even the destination probe ran');
});

test('synthetic-only: an ordinary offer is declined not-available at once — never held, never shown for a decision', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 1000, 'a'.repeat(64));
  const d = folder();
  const r = receiver(link, d, [], { switches: { acceptProbeDigests: allow(link) }, version2: { allowed: true, syntheticOnly: true } });
  await r.onOffer(offer(1000, 'a'.repeat(64), { name: 'holiday.jpg', mime: 'image/jpeg' }));
  assert.deepEqual(link.types(), ['respond:decline']);
  assert.equal(link.sent[0]!.payload.reason, 'not-available');
  assert.equal(r.state(id), undefined);
  assert.deepEqual(readdirSync(d), []);
});

test('synthetic-only: an allow-listed probe is still received (the control for the test above)', { timeout: 10_000 }, async () => {
  const data = synthetic(1000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 1000, data.sha256);
  try {
    const r = receiver(link, folder(), [phone], { switches: { acceptProbeDigests: allow(link) }, version2: { allowed: true, syntheticOnly: true } });
    await r.onOffer(offer(1000, data.sha256));
    assert.equal(r.state(id), 'saved');
  } finally {
    await phone.close();
  }
});

test('Accept after version 2 is withdrawn (the session renegotiated at 1) pulls nothing', { timeout: 10_000 }, async () => {
  let v = 2;
  const link = new FakeLink(2, 1, 'a'.repeat(64));
  link.negotiated = () => ({ 'share.file': v });
  const r = receiver(link, folder(), []);
  await r.onOffer(offer(1, 'a'.repeat(64)));
  v = 1;
  await r.decide(id, 'accept');
  assert.deepEqual(link.sent, []);
  assert.equal(r.state(id), 'ended');
});

// ---- the whole receive ------------------------------------------------------------------------

test('version 2 end to end: accept → pull from 0 → verify → exclusive publish → saved:true', { timeout: 10_000 }, async () => {
  const data = synthetic(100_000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 100_000, data.sha256);
  const d = folder();
  try {
    const r = receiver(link, d, [phone], { switches: { acceptProbeDigests: allow(link) } });
    await r.onOffer(offer(100_000, data.sha256));
    assert.deepEqual(link.types(), ['respond:accept', 'fs.transfer.begin', 'saved:true']);
    assert.deepEqual(link.sent[1]!.payload, { direction: 'pull', rootId: `share:${id}`, id: '0' });
    const saved = link.sent[2]!.payload;
    assert.deepEqual(saved, { offerId: id, ok: true, bytes: 100_000, verified: true, savedAs: 'sidekick-offer-probe-100000.bin' });
    assert.deepEqual(readFileSync(join(d, 'sidekick-offer-probe-100000.bin')), data.bytes);
    assert.deepEqual(readdirSync(d), ['sidekick-offer-probe-100000.bin']);
    assert.equal(r.state(id), 'saved');
    assert.deepEqual(phone.seen[0]!.header, { transferId: txA, offset: 0 });
  } finally {
    await phone.close();
  }
});

test('a person accepting an ordinary offer (the future card) goes through the same path', { timeout: 10_000 }, async () => {
  const data = synthetic(2000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 2000, data.sha256);
  const d = folder();
  try {
    const r = receiver(link, d, [phone]);
    await r.onOffer(offer(2000, data.sha256, { name: 'notes/today.txt', mime: 'text/plain' }));
    await r.decide(id, 'accept');
    assert.equal(r.state(id), 'saved');
    assert.equal(r.savedAs(id), 'notes-today.txt', 'the Mac re-sanitises the phone’s name');
  } finally {
    await phone.close();
  }
});

test('a person declining answers decline user and pulls nothing', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 1, 'a'.repeat(64));
  const r = receiver(link, folder(), []);
  await r.onOffer(offer(1, 'a'.repeat(64)));
  await r.decide(id, 'decline');
  assert.deepEqual(link.types(), ['respond:decline']);
  assert.equal(link.sent[0]!.payload.reason, 'user');
});

// ---- destination checks -----------------------------------------------------------------------

test('an unusable destination at the offer declines with its reason before anything moves', { timeout: 10_000 }, async () => {
  for (const reason of ['folder-unavailable', 'insufficient-space', 'unsupported-destination'] as const) {
    const link = new FakeLink(2, 1, 'a'.repeat(64));
    const r = receiver(link, folder(), [], {
      checkDestination: async (): Promise<DestinationVerdict> => ({ ok: false, reason, detail: 'test' }),
      switches: { acceptProbeDigests: allow(link) },
    });
    await r.onOffer(offer(1, 'a'.repeat(64)));
    assert.deepEqual(link.types(), ['respond:decline'], reason);
    assert.equal(link.sent[0]!.payload.reason, reason);
    // The Mac's own screen says why: a `refused` record carrying the reason — never `declined`,
    // which is a person's word, and never nothing, which left the phone's refusal unexplained here.
    assert.equal(r.state(id), 'refused', reason);
    assert.equal(r.snapshots()[0]!.reason, reason);
  }
});

test('the re-check at Accept fails closed: declines, no accept is sent, nothing is pulled', { timeout: 10_000 }, async () => {
  let calls = 0;
  const link = new FakeLink(2, 1, 'a'.repeat(64));
  const r = receiver(link, folder(), [], {
    checkDestination: async (): Promise<DestinationVerdict> =>
      (++calls === 1 ? { ok: true } : { ok: false, reason: 'insufficient-space', detail: 'filled up' }),
    switches: { acceptProbeDigests: allow(link) },
  });
  await r.onOffer(offer(1, 'a'.repeat(64)));
  assert.deepEqual(link.types(), ['respond:decline']);
  assert.equal(link.sent[0]!.payload.reason, 'insufficient-space');
  // The person clicked Accept (here, the probe switch did); the check said no. That is not a Decline.
  assert.equal(r.state(id), 'refused');
  assert.equal(r.snapshots()[0]!.reason, 'insufficient-space');
});

test('a destination check that throws is inconclusive and fails closed as folder-unavailable', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 1, 'a'.repeat(64));
  const r = receiver(link, folder(), [], { checkDestination: async () => { throw new Error('boom'); } });
  await r.onOffer(offer(1, 'a'.repeat(64)));
  assert.equal(link.sent[0]!.payload.reason, 'folder-unavailable');
});

// ---- the pull ack, the session ------------------------------------------------------------------

test('a pull ack that disagrees with the offer (wrong digest, offset, or a Files-style id) cancels instead of pulling', { timeout: 10_000 }, async () => {
  for (const bad of [{ sha256: 'b'.repeat(64) }, { offset: 4096 }, { transferId: 't-7-12345' }]) {
    const link = new FakeLink(2, 10, 'a'.repeat(64));
    const original = link.request.bind(link);
    link.request = async (type, payload) => {
      const reply = (await original(type, payload)) as { payload: Record<string, unknown> };
      return type === 'fs.transfer.begin' ? { payload: { ...reply.payload, ...bad } } : reply;
    };
    const r = receiver(link, folder(), [], { switches: { acceptProbeDigests: allow(link) } });
    await r.onOffer(offer(10, 'a'.repeat(64)));
    assert.deepEqual(link.types(), ['respond:accept', 'fs.transfer.begin', 'share.cancel'], JSON.stringify(bad));
    assert.equal(r.state(id), 'cancelled');
  }
});

test('the session changing after accept means nothing is pulled on the new session', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 10, 'a'.repeat(64));
  link.onRequest = (s) => { if (s.type === 'share.respond') link.tokenValue = 'token-B'; };
  const r = receiver(link, folder(), [], { switches: { acceptProbeDigests: allow(link) } });
  await r.onOffer(offer(10, 'a'.repeat(64)));
  assert.deepEqual(link.types(), ['respond:accept']);
  assert.equal(r.state(id), 'ended');
});

// ---- failures, retry, verdict ------------------------------------------------------------------

test('corruption, then Retry from byte 0 with a fresh transfer id, then saved', { timeout: 10_000 }, async () => {
  const data = synthetic(50_000);
  const bad = await startFakePhone({ bytes: data.bytes, corruptAt: 100 });
  const good = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 50_000, data.sha256);
  const d = folder();
  try {
    const r = receiver(link, d, [bad, good], { switches: { acceptProbeDigests: allow(link) } });
    await r.onOffer(offer(50_000, data.sha256));
    assert.equal(r.state(id), 'failed');
    assert.deepEqual(readdirSync(d), [], 'no partial, no .failed sidecar');
    await r.retry(id);
    assert.equal(r.state(id), 'saved');
    assert.deepEqual(link.types(), ['respond:accept', 'fs.transfer.begin', 'saved:false', 'fs.transfer.begin', 'saved:true']);
    assert.equal(link.sent[2]!.payload.reason, 'checksum');
    assert.deepEqual(bad.seen[0]!.header, { transferId: txA, offset: 0 });
    assert.deepEqual(good.seen[0]!.header, { transferId: txB, offset: 0 });
  } finally {
    await bad.close();
    await good.close();
  }
});

test('Retry after the window has closed expires instead of pulling', { timeout: 10_000 }, async () => {
  const data = synthetic(1000);
  const bad = await startFakePhone({ bytes: data.bytes, corruptAt: 1 });
  let t = now;
  const link = new FakeLink(2, 1000, data.sha256);
  try {
    const r = receiver(link, folder(), [bad], { switches: { acceptProbeDigests: allow(link) }, now: () => t });
    await r.onOffer(offer(1000, data.sha256));
    t = now + 5 * 60 * 1000;
    await r.retry(id);
    assert.equal(r.state(id), 'expired');
    assert.equal(link.types().filter((x) => x === 'fs.transfer.begin').length, 1);
  } finally {
    await bad.close();
  }
});

test('a verdict the phone does not acknowledge is saved-unacknowledged, never claimed as confirmed', { timeout: 10_000 }, async () => {
  const data = synthetic(1000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 1000, data.sha256);
  link.savedReply = 'error';
  const d = folder();
  try {
    const r = receiver(link, d, [phone], { switches: { acceptProbeDigests: allow(link) } });
    await r.onOffer(offer(1000, data.sha256));
    assert.equal(r.state(id), 'saved-unacknowledged');
    assert.equal(existsSync(join(d, 'sidekick-offer-probe-1000.bin')), true, 'the file is on the Mac either way');
  } finally {
    await phone.close();
  }
});

// ---- saved on this Mac, acknowledgement lost (Task B) ---------------------------------------------

test('a lost acknowledgement: the verified file is kept through the phone’s expiry, the session ending, and a Retry', { timeout: 10_000 }, async () => {
  const data = synthetic(1000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 1000, data.sha256);
  link.savedReply = 'error';
  const d = folder();
  try {
    const r = receiver(link, d, [phone], { switches: { acceptProbeDigests: allow(link) } });
    await r.onOffer(offer(1000, data.sha256));
    assert.equal(r.state(id), 'saved-unacknowledged');
    const file = join(d, 'sidekick-offer-probe-1000.bin');
    await r.retry(id);
    r.onCancel({ offerId: id, reason: 'expired' }); // the phone's retry window closing
    r.onSessionEnded('token-A');
    assert.equal(r.state(id), 'saved-unacknowledged', 'still saved-unacknowledged — never demoted to expired or ended');
    assert.deepEqual(readFileSync(file), data.bytes, 'the verified file is on the Mac, byte for byte');
    assert.deepEqual(readdirSync(d), ['sidekick-offer-probe-1000.bin'], 'and nothing else: no partial, no second copy');
    assert.equal(link.types().filter((x) => x === 'fs.transfer.begin').length, 1, 'no second pull');
  } finally {
    await phone.close();
  }
});

test('the same bytes offered again after an unconfirmed save: flagged before Accept, saved under a new name, the first untouched', { timeout: 10_000 }, async () => {
  const data = synthetic(1000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 1000, data.sha256);
  link.savedReply = 'error';
  link.beginIds = [txA, txB];
  const d = folder();
  const second = 's-SECONDxxxxxxxxxxxxxxxx';
  try {
    const r = receiver(link, d, [phone, phone]);
    await r.onOffer(offer(1000, data.sha256, { name: 'report.pdf', mime: 'application/pdf' }));
    await r.decide(id, 'accept');
    assert.equal(r.state(id), 'saved-unacknowledged');
    assert.equal(r.priorCopy(id), null, 'the first offer has no earlier copy');

    link.savedReply = 'ack';
    await r.onOffer(offer(1000, data.sha256, { name: 'report.pdf', mime: 'application/pdf', offerId: second }));
    assert.deepEqual(r.priorCopy(second), { savedAs: 'report.pdf', acknowledged: false });
    await r.decide(second, 'accept');
    assert.equal(r.state(second), 'saved');
    assert.equal(r.savedAs(second), 'report (2).pdf');
    assert.deepEqual(readdirSync(d).sort(), ['report (2).pdf', 'report.pdf']);
    assert.deepEqual(readFileSync(join(d, 'report.pdf')), data.bytes, 'the first copy was not overwritten');
  } finally {
    await phone.close();
  }
});

test('a phone cancel mid-pull stops it, deletes the partial, and sends no verdict', { timeout: 10_000 }, async () => {
  const data = synthetic(100_000);
  const phone = await startFakePhone({ bytes: data.bytes, stallAfter: 20_000, chunkSize: 10_000 });
  const link = new FakeLink(2, 100_000, data.sha256);
  const d = folder();
  try {
    const r = receiver(link, d, [phone], { switches: { acceptProbeDigests: allow(link) } });
    const running = r.onOffer(offer(100_000, data.sha256));
    await new Promise((resolve) => setTimeout(resolve, 150));
    r.onCancel({ offerId: id, reason: 'user' });
    await running;
    assert.equal(r.state(id), 'cancelled');
    assert.deepEqual(readdirSync(d), []);
    assert.equal(link.types().includes('saved:true') || link.types().includes('saved:false'), false);
  } finally {
    await phone.close();
  }
});

test('a replayed offer is not answered a second time', { timeout: 10_000 }, async () => {
  const link = new FakeLink(1, 1, 'a'.repeat(64));
  const r = receiver(link, folder(), []);
  await r.onOffer(offer(1, 'a'.repeat(64)));
  await r.onOffer(offer(1, 'a'.repeat(64)));
  assert.equal(link.sent.length, 1);
});

test('the same expiry reported twice (the Mac timer and the phone cancel) counts once', { timeout: 10_000 }, async () => {
  const link = new FakeLink(1, 1, 'a'.repeat(64));
  const r = receiver(link, folder(), [], { switches: { silent: true } });
  await r.onOffer({ ...offer(1, 'a'.repeat(64)), expiresAtMs: now + 20 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  r.onCancel({ offerId: id, reason: 'expired' });
  assert.equal(r.counts().expired, 1);
});

test('a phone cancel that lands while the file is being published: saved-unacknowledged, no verdict sent', { timeout: 10_000 }, async () => {
  const data = synthetic(10_000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 10_000, data.sha256);
  const d = folder();
  let r: ShareReceiver | null = null;
  try {
    r = receiver(link, d, [phone], {
      switches: { acceptProbeDigests: allow(link) },
      publish: async (part, f, name) => {
        r!.onCancel({ offerId: id, reason: 'user' }); // the cancel arrives mid-publication
        return publishExclusive(part, f, name);
      },
    });
    await r.onOffer(offer(10_000, data.sha256));
    assert.equal(r.state(id), 'saved-unacknowledged');
    assert.equal(link.types().some((t) => t.startsWith('saved:')), false, 'no share.saved for a cancelled offer');
    assert.equal(existsSync(join(d, 'sidekick-offer-probe-10000.bin')), true);
  } finally {
    await phone.close();
  }
});

// ---- the receive card's path: IPC boundary → decide → snapshot (Task C) ----------------------------

const front: WindowFacts = { exists: true, visible: true, minimized: false, focused: true };
const headlineOf = (r: ShareReceiver): string => {
  const snap = r.snapshots()[0]!;
  return shareReceiveStatus({ state: snap.state, wantedName: snap.name, savedAs: snap.savedAs, reason: snap.reason, priorCopy: snap.priorCopy }).headline;
};

test('card: the snapshot is what the card draws — sanitised name, type, exact bytes, the Mac’s own folder — and changes are announced', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 1234, 'a'.repeat(64));
  const d = folder();
  const r = receiver(link, d, []);
  let changes = 0;
  r.onChange(() => { changes += 1; });
  await r.onOffer(offer(1234, 'a'.repeat(64), { name: '../../etc/passwd', mime: 'text/plain' }));
  await new Promise((ok) => setImmediate(ok));
  const snap = r.snapshots()[0]!;
  assert.equal(snap.name, sanitizeShareName('../../etc/passwd'), 'the Mac’s own sanitiser, not the phone’s name');
  assert.doesNotMatch(snap.name, /\//, 'no separator survives');
  assert.equal(snap.mime, 'text/plain');
  assert.equal(snap.bytes, 1234);
  assert.equal(snap.folder, d);
  assert.equal(snap.state, 'awaiting-decision');
  assert.equal(headlineOf(r), 'Wants to send you a file');
  assert.ok(changes >= 1, 'a listener heard the offer arrive');
});

test('card Accept: through the IPC boundary, the destination re-checked, pulled, verified, saved', { timeout: 10_000 }, async () => {
  const data = synthetic(3000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 3000, data.sha256);
  const d = folder();
  let checks = 0;
  try {
    const r = receiver(link, d, [phone], { checkDestination: (f, size) => { checks += 1; return checkDestination(f, size); } });
    await r.onOffer(offer(3000, data.sha256, { name: 'notes.txt', mime: 'text/plain' }));
    assert.equal(checks, 1, 'checked at the offer');
    const res = await handleShareDecision({ offerId: id, decision: 'accept' }, front, r);
    assert.deepEqual(res, { ok: true, state: 'saved' });
    assert.equal(checks, 2, 'and again at Accept, before any byte moved');
    assert.deepEqual(link.types(), ['respond:accept', 'fs.transfer.begin', 'saved:true']);
    assert.equal(headlineOf(r), 'Saved on this Mac');
    assert.deepEqual(readFileSync(join(d, 'notes.txt')), data.bytes);
  } finally {
    await phone.close();
  }
});

test('card Decline: decline user, nothing pulled, nothing written', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 10, 'a'.repeat(64));
  const d = folder();
  const r = receiver(link, d, []);
  await r.onOffer(offer(10, 'a'.repeat(64), { name: 'x.bin' }));
  assert.deepEqual(await handleShareDecision({ offerId: id, decision: 'decline' }, front, r), { ok: true, state: 'declined' });
  assert.deepEqual(link.types(), ['respond:decline']);
  assert.equal(link.sent[0]!.payload.reason, 'user');
  assert.deepEqual(readdirSync(d), []);
  assert.equal(headlineOf(r), 'Declined');
});

test('card expiry: a late Accept after the Mac’s expiry is Expired — never Declined, nothing sent', { timeout: 10_000 }, async () => {
  let t = now;
  const link = new FakeLink(2, 10, 'a'.repeat(64));
  const r = receiver(link, folder(), [], { now: () => t });
  await r.onOffer(offer(10, 'a'.repeat(64), { name: 'x.bin' }));
  t = now + 600_000;
  await handleShareDecision({ offerId: id, decision: 'accept' }, front, r);
  assert.equal(r.state(id), 'expired');
  assert.deepEqual(link.sent, [], 'no accept and no decline went to the phone');
  assert.equal(headlineOf(r), 'Expired');
  const again = await handleShareDecision({ offerId: id, decision: 'accept' }, front, r);
  assert.equal(again.ok, false, 'an expired card cannot be accepted');
});

test('card stale session: Accept after a reconnect pulls nothing on the new session', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 10, 'a'.repeat(64));
  const r = receiver(link, folder(), []);
  await r.onOffer(offer(10, 'a'.repeat(64), { name: 'x.bin' }));
  link.tokenValue = 'token-B';
  await handleShareDecision({ offerId: id, decision: 'accept' }, front, r);
  assert.equal(r.state(id), 'ended');
  assert.deepEqual(link.sent, []);
  assert.equal(headlineOf(r), 'Ended with the connection');
});

test('card hidden window: an Accept is refused, nothing is sent, and the offer still waits for a person', { timeout: 10_000 }, async () => {
  const link = new FakeLink(2, 10, 'a'.repeat(64));
  const r = receiver(link, folder(), []);
  await r.onOffer(offer(10, 'a'.repeat(64), { name: 'x.bin' }));
  const res = await handleShareDecision({ offerId: id, decision: 'accept' }, { ...front, visible: false }, r);
  assert.equal(res.ok, false);
  assert.deepEqual(link.sent, []);
  assert.equal(r.state(id), 'awaiting-decision');
});

test('card saved but unacknowledged: the card says so, never an unqualified success', { timeout: 10_000 }, async () => {
  const data = synthetic(500);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 500, data.sha256);
  link.savedReply = 'error';
  try {
    const r = receiver(link, folder(), [phone]);
    await r.onOffer(offer(500, data.sha256, { name: 'a.bin' }));
    const res = await handleShareDecision({ offerId: id, decision: 'accept' }, front, r);
    assert.deepEqual(res, { ok: true, state: 'saved-unacknowledged' });
    const snap = r.snapshots()[0]!;
    const status = shareReceiveStatus({ state: snap.state, wantedName: snap.name, savedAs: snap.savedAs, reason: snap.reason, priorCopy: snap.priorCopy });
    assert.equal(status.headline, 'Saved on this Mac; confirmation to phone unknown');
    assert.equal(status.savedOnMac, true);
    assert.equal(status.confirmedByPhone, false);
  } finally {
    await phone.close();
  }
});

// ---- the receive window: progress, Cancel, and the publication record (step 4) ------------------

test('progress is what this Mac received: rising, never past the size, and the size before any Saved', { timeout: 10_000 }, async () => {
  const data = synthetic(300_000);
  const phone = await startFakePhone({ bytes: data.bytes, chunkSize: 10_000 });
  const link = new FakeLink(2, 300_000, data.sha256);
  try {
    const r = receiver(link, folder(), [phone]);
    const seen: { state: string; received: number | null }[] = [];
    r.onChange(() => {
      const s = r.snapshots()[0]!;
      seen.push({ state: s.state, received: s.receivedBytes });
    });
    await r.onOffer(offer(300_000, data.sha256, { name: 'clip.bin' }));
    assert.equal(r.snapshots()[0]!.receivedBytes, null, 'no count before a pull');
    await r.decide(id, 'accept');
    await new Promise((ok) => setImmediate(ok));
    const receiving = seen.filter((x) => x.state === 'receiving').map((x) => x.received ?? -1);
    assert.ok(receiving.length >= 2, `control: progress was published while receiving (${receiving.join(',')})`);
    for (let i = 1; i < receiving.length; i += 1) assert.ok(receiving[i]! >= receiving[i - 1]!, 'never goes backwards');
    assert.ok(receiving.every((n) => n >= 0 && n <= 300_000));
    assert.equal(r.state(id), 'saved');
    assert.equal(r.snapshots()[0]!.receivedBytes, 300_000);
  } finally {
    await phone.close();
  }
});

test('Mac Cancel mid-pull: share.cancel user is sent, the partial is deleted, no verdict, nothing kept', { timeout: 10_000 }, async () => {
  const data = synthetic(100_000);
  const phone = await startFakePhone({ bytes: data.bytes, stallAfter: 20_000, chunkSize: 10_000 });
  const link = new FakeLink(2, 100_000, data.sha256);
  const d = folder();
  try {
    const r = receiver(link, d, [phone]);
    await r.onOffer(offer(100_000, data.sha256, { name: 'a.bin' }));
    const running = r.decide(id, 'accept');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(r.state(id), 'receiving', 'control: it was mid-pull');
    assert.equal(await r.cancel(id), true);
    await running;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(r.state(id), 'cancelled');
    assert.deepEqual(link.sent.filter((s) => s.type === 'share.cancel').map((s) => s.payload), [{ offerId: id, reason: 'user' }]);
    assert.equal(link.types().some((t) => t.startsWith('saved:')), false);
    assert.deepEqual(readdirSync(d), []);
  } finally {
    await phone.close();
  }
});

test('Cancel while the accept is in flight pulls nothing', { timeout: 10_000 }, async () => {
  const data = synthetic(1000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 1000, data.sha256);
  const d = folder();
  try {
    const r = receiver(link, d, [phone]);
    await r.onOffer(offer(1000, data.sha256, { name: 'a.bin' }));
    link.onRequest = (s) => {
      if (s.type === 'share.respond' && s.payload.decision === 'accept') void r.cancel(id);
    };
    await r.decide(id, 'accept');
    assert.equal(r.state(id), 'cancelled');
    assert.equal(link.types().includes('fs.transfer.begin'), false);
    assert.equal(phone.seen.length, 0, 'the bulk port was never opened');
    assert.deepEqual(readdirSync(d), []);
  } finally {
    await phone.close();
  }
});

test('a published offer cannot be cancelled; Open resolves only the very file that was saved', { timeout: 10_000 }, async () => {
  const data = synthetic(4096);
  const phone = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 4096, data.sha256);
  const d = folder();
  try {
    const r = receiver(link, d, [phone]);
    await r.onOffer(offer(4096, data.sha256, { name: 'photo.jpg', mime: 'image/jpeg' }));
    assert.deepEqual(await r.publishedFile(id), { ok: false, why: 'nothing was saved for that offer' });
    await r.decide(id, 'accept');
    assert.equal(r.state(id), 'saved');
    assert.equal(await r.cancel(id), false);
    assert.deepEqual(await r.publishedFile(id), { ok: true, path: join(d, 'photo.jpg') });
    assert.equal(await r.publishedFile('s-AAAAAAAAAAAAAAAAAAAAAA').then((x) => x.ok), false, 'an unknown id');
  } finally {
    await phone.close();
  }
});

test('Open refuses a saved file that was replaced, grown, or swapped for a symlink since it was saved', { timeout: 10_000 }, async () => {
  const { writeFileSync, unlinkSync, symlinkSync, appendFileSync } = await import('node:fs');
  for (const tamper of ['replace', 'grow', 'symlink', 'delete'] as const) {
    const data = synthetic(2048);
    const phone = await startFakePhone({ bytes: data.bytes });
    const link = new FakeLink(2, 2048, data.sha256);
    const d = folder();
    try {
      const r = receiver(link, d, [phone]);
      await r.onOffer(offer(2048, data.sha256, { name: 'x.bin' }));
      await r.decide(id, 'accept');
      const path = join(d, 'x.bin');
      assert.equal((await r.publishedFile(id)).ok, true, `control (${tamper})`);
      if (tamper === 'replace') { unlinkSync(path); writeFileSync(path, data.bytes); }
      if (tamper === 'grow') appendFileSync(path, 'x');
      if (tamper === 'symlink') { unlinkSync(path); writeFileSync(join(d, 'other'), data.bytes); symlinkSync(join(d, 'other'), path); }
      if (tamper === 'delete') unlinkSync(path);
      assert.equal((await r.publishedFile(id)).ok, false, tamper);
    } finally {
      await phone.close();
    }
  }
});

test('a failed attempt inside its window can be retried — and Cancel then gives it up and tells the phone', { timeout: 10_000 }, async () => {
  const data = synthetic(50_000);
  const bad = await startFakePhone({ bytes: data.bytes, corruptAt: 10 });
  const link = new FakeLink(2, 50_000, data.sha256);
  const d = folder();
  try {
    const r = receiver(link, d, [bad]);
    await r.onOffer(offer(50_000, data.sha256, { name: 'a.bin' }));
    await r.decide(id, 'accept');
    assert.equal(r.state(id), 'failed');
    assert.equal(r.snapshots()[0]!.canRetry, true);
    assert.equal(await r.cancel(id), true);
    assert.equal(r.state(id), 'cancelled');
    assert.equal(r.snapshots()[0]!.canRetry, false);
    assert.ok(link.types().includes('share.cancel'));
    assert.deepEqual(readdirSync(d), []);
  } finally {
    await bad.close();
  }
});

// ---- a different file at the saved name (S2) ------------------------------------------------------

test('unexpected-file: a file swapped in just before publication ends the offer — not Saved, no Retry, phone told write-failed, the file untouched', { timeout: 10_000 }, async () => {
  const data = synthetic(100_000);
  const phone = await startFakePhone({ bytes: data.bytes });
  const second = await startFakePhone({ bytes: data.bytes });
  const link = new FakeLink(2, 100_000, data.sha256);
  const d = folder();
  assert.ok(d.startsWith(tmpdir()), 'confined to the OS temp folder');
  const foreign = randomBytes(100_000);
  const name = 'sidekick-offer-probe-100000.bin';
  let partPath = '';
  try {
    const r = receiver(link, d, [phone, second], {
      switches: { acceptProbeDigests: allow(link) },
      // The swap lands after the pull's last look and before the link: the one window it cannot close.
      publish: async (part, f, n) => {
        partPath = part;
        renameSync(part, join(f, 'moved-aside.bin'));
        writeFileSync(part, foreign, { flag: 'wx' });
        return publishExclusive(part, f, n);
      },
    });
    await r.onOffer(offer(100_000, data.sha256));
    assert.equal(lstatSync(join(d, 'moved-aside.bin')).size, 100_000, 'control: the swap happened');

    assert.equal(r.state(id), 'unexpected-file');
    assert.deepEqual(link.types(), ['respond:accept', 'fs.transfer.begin', 'saved:false']);
    assert.deepEqual(link.sent[2]!.payload, { offerId: id, ok: false, reason: 'write-failed' }, 'the existing reason, no savedAs');
    const snap = r.snapshots().find((x) => x.offerId === id)!;
    assert.equal(snap.canRetry, false);
    assert.equal(snap.unexpectedName, name);
    assert.equal(snap.savedAs, null);
    assert.equal((await r.publishedFile(id)).ok, false, 'Open and Show in Finder refuse it');

    await r.retry(id);
    assert.equal(second.seen.length, 0, 'Retry started no second pull');
    r.onCancel({ offerId: id, reason: 'expired' });
    r.onSessionEnded('token-A');
    assert.equal(r.state(id), 'unexpected-file', 'a later phone cancel or session end does not rewrite it');
    assert.deepEqual(link.types(), ['respond:accept', 'fs.transfer.begin', 'saved:false'], 'nothing else was sent');

    assert.deepEqual(readFileSync(join(d, name)), foreign, 'the different file at the saved name is untouched');
    assert.deepEqual(readFileSync(partPath), foreign, 'and keeps its own name');
    const status = shareReceiveStatus({ state: snap.state, wantedName: snap.name, savedAs: snap.savedAs, reason: snap.reason, priorCopy: null, unexpectedName: snap.unexpectedName, folder: snap.folder });
    assert.equal(status.savedOnMac, false);
  } finally {
    await phone.close();
    await second.close();
  }
});
