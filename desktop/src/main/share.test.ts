import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { pullShareWith, type SharePullResult } from './bulk';
import { ShareReceiver, isAcceptableProbe, type ShareDeps, type ShareLink } from './share';
import { checkDestination, publishExclusive, type DestinationVerdict } from './shareDestination';
import { startFakePhone, synthetic, type FakePhone } from './sharePhone.testkit';

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
