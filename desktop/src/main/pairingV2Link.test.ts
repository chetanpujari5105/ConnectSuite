/*
 * Pairing v2 through the Mac's REAL handshake path — audit S1, defect 182; docs/protocol.md → Pairing
 * (version 2).
 *
 * The production `LinkClient` connects over real TLS 1.3 on 127.0.0.1 to scripted phones with per-run
 * certificates: a genuine v2 phone, impostors that skip, forge, replay or relay the proof, a phone with
 * the wrong secret, an old phone, an injector, and one that hangs up mid-exchange. Electron and
 * electron-store are stubbed exactly as `linkSessionEnded.test.ts` does; discovery and the clock come
 * through `LinkClientOptions`, the only seams.
 *
 * What this cannot prove: the phone's real `ControlSession` (Kotlin; its decisions are `PhonePairing`,
 * tested in `PairingV2Test` against the same vectors), a real network attacker (the impostor is a second
 * certificate on loopback), or anything about the renderer. The scripted genuine phone computes its
 * proofs with this repo's `pairingV2.ts`; the vectors test is what ties that to the phone's Kotlin.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from 'node:tls';
import forge from 'node-forge';

const userData = mkdtempSync(join(tmpdir(), 'pairing-v2-link-'));
const storeData = new Map<string, unknown>();
const moduleWithLoad = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = moduleWithLoad._load;
moduleWithLoad._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, isPackaged: false, getName: () => 'test' }, safeStorage: {} };
  }
  if (request === 'electron-store') {
    return class {
      constructor(opts?: { defaults?: Record<string, unknown> }) {
        for (const [k, v] of Object.entries(opts?.defaults ?? {})) if (!storeData.has(k)) storeData.set(k, v);
      }
      get(key: string) { return storeData.get(key); }
      set(key: string, value: unknown) { storeData.set(key, value); }
    };
  }
  return realLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LinkClient, PAIR_MAX_FAILURES } = require('./link') as typeof import('./link');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FrameReader, writeFrame } = require('./framing') as typeof import('./framing');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fingerprintOf, fingerprintOfDer } = require('./identity') as typeof import('./identity');
import { newNonceHex, proof as pairingProof, verifyProof } from '../shared/pairingV2';
import { MAX_CONTROL_FRAME, MessageType, PROTOCOL_MAJOR, type PairingQrPayload } from '../shared/protocol';
import type { Identity } from './identity';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cleanups: Array<() => void | Promise<void>> = [];
after(async () => {
  for (const link of active.splice(0)) link.stop('test over');
  for (const fn of cleanups.splice(0)) await fn();
});

function testIdentity(name: string): Identity {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  cert.serialNumber = `00${randomBytes(8).toString('hex')}`;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: 'commonName', value: name }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  return { certPem, keyPem, fingerprint: fingerprintOf(certPem), deviceName: name };
}

const MAC = testIdentity('test-mac');
const PHONE = testIdentity('test-phone');
const IMPOSTOR = testIdentity('test-impostor');

type Mode =
  | 'v2'               // a genuine v2 phone: proves, verifies the Mac, answers hello.ack
  | 'skipProof'        // answers hello.ack straight away — the v1-style downgrade
  | 'badProof'         // a pair.proof of random bytes
  | 'replay'           // a pair.proof captured from an earlier genuine exchange
  | 'relay'            // knows K, but proves over the REAL phone's fingerprint (a relayed proof)
  | 'oldPhone'         // a v1 phone: refuses a hello with no pairToken
  | 'inject'           // sends feature events first, then skips the proof
  | 'hangUpAfterConfirm'; // proves, reads the Mac's proof, then closes without hello.ack

interface Phone {
  port: number;
  hellos: Array<Record<string, unknown>>;
  confirms: Array<Record<string, unknown>>;
  macProofValid: boolean[];
  rawText: string;
  proofsSent: Array<{ nonce: string; proof: string }>;
}

interface PhoneOptions {
  mode: Mode;
  identity?: Identity;
  secret?: () => string | null;
  replay?: { nonce: string; proof: string };
  /** Runs after the hello arrives and before the phone's proof goes out (to move the clock, cancel…). */
  beforeProof?: () => void | Promise<void>;
}

async function phone(o: PhoneOptions): Promise<Phone> {
  const identity = o.identity ?? PHONE;
  const side: Phone = { port: 0, hellos: [], confirms: [], macProofValid: [], rawText: '', proofsSent: [] };
  const sockets: TLSSocket[] = [];
  const server: TlsServer = createTlsServer(
    { key: identity.keyPem, cert: identity.certPem, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' },
    (socket) => {
      sockets.push(socket);
      socket.on('error', () => undefined);
      const macFp = fingerprintOfDer(socket.getPeerX509Certificate()!.raw);
      let exchange: { nonce: string; macNonce: string } | null = null;
      const send = (env: Record<string, unknown>) => writeFrame(socket, Buffer.from(JSON.stringify({ v: PROTOCOL_MAJOR, ts: Date.now(), ...env }), 'utf8'), MAX_CONTROL_FRAME);
      const ack = (id: string) => send({ id, type: MessageType.HELLO_ACK, payload: { protocolVersion: PROTOCOL_MAJOR, deviceName: identity.deviceName, deviceId: 'phone-id', fingerprint: identity.fingerprint, sessionToken: randomBytes(32).toString('hex'), capabilities: ['clipboard'] } });
      const reader = new FrameReader(async (frame) => {
        side.rawText += frame.toString('utf8');
        const env = JSON.parse(frame.toString('utf8')) as { id: string; type: string; payload: Record<string, unknown> };
        if (env.type === MessageType.HELLO) {
          side.hellos.push(env.payload);
          const pair = env.payload.pair as { v: number; nonce: string } | undefined;
          if (!pair) {
            if (o.mode === 'oldPhone') {
              send({ id: env.id, type: MessageType.ERROR, payload: { code: 'UNAUTHORIZED', message: 'no token' } });
              send({ id: env.id, type: MessageType.PAIR_REJECTED, payload: { reason: 'TOKEN_MISSING', fingerprint: macFp, message: 'no token' } });
              socket.end();
              return;
            }
            ack(env.id);                       // a pinned, trusted reconnect
            return;
          }
          if (o.mode === 'oldPhone') {
            send({ id: env.id, type: MessageType.ERROR, payload: { code: 'UNAUTHORIZED', message: 'no token' } });
            send({ id: env.id, type: MessageType.PAIR_REJECTED, payload: { reason: 'TOKEN_MISSING', fingerprint: macFp, message: 'no token' } });
            socket.end();
            return;
          }
          if (o.mode === 'inject') {
            send({ id: randomUUID(), type: 'notif.posted', payload: { key: 'k', title: 'Your bank', text: 'Your code is 123456' } });
            send({ id: randomUUID(), type: 'clip.push', payload: { kind: 'text', text: 'attacker text' } });
            ack(env.id);
            return;
          }
          if (o.mode === 'skipProof') { ack(env.id); return; }
          await o.beforeProof?.();
          const nonce = newNonceHex();
          let p: string;
          if (o.mode === 'badProof') p = randomBytes(32).toString('hex');
          else if (o.mode === 'replay') { p = o.replay!.proof; }
          else {
            const secret = o.secret?.() ?? null;
            if (!secret) { p = randomBytes(32).toString('hex'); }
            else {
              const asSeen = o.mode === 'relay' ? PHONE.fingerprint : identity.fingerprint;
              p = pairingProof(secret, 'phone', { macFingerprint: macFp, phoneFingerprint: asSeen, macNonce: pair.nonce, phoneNonce: nonce });
            }
          }
          const sentNonce = o.mode === 'replay' ? o.replay!.nonce : nonce;
          side.proofsSent.push({ nonce: sentNonce, proof: p });
          exchange = { nonce: sentNonce, macNonce: pair.nonce };
          send({ id: env.id, type: MessageType.PAIR_PROOF, payload: { v: 2, nonce: sentNonce, proof: p } });
          return;
        }
        if (env.type === MessageType.PAIR_CONFIRM) {
          side.confirms.push(env.payload);
          const secret = o.secret?.() ?? '';
          const valid = !!exchange && verifyProof(secret, 'mac', { macFingerprint: macFp, phoneFingerprint: identity.fingerprint, macNonce: exchange.macNonce, phoneNonce: exchange.nonce }, env.payload.proof);
          side.macProofValid.push(valid);
          if (o.mode === 'hangUpAfterConfirm' || !valid) { socket.destroy(); return; }
          ack(env.id);
          return;
        }
        if (env.type === MessageType.PING) send({ id: env.id, type: MessageType.PONG, payload: {} });
      }, () => socket.destroy(), MAX_CONTROL_FRAME);
      socket.on('data', (chunk: Buffer) => reader.push(chunk));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  side.port = (server.address() as AddressInfo).port;
  cleanups.push(() => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }));
  return side;
}

let clock = Date.now();
/** Every link a test made. Stopped before the next test, so none keeps pairing into the shared store. */
const active: Array<{ stop(reason?: string): void }> = [];
function client(ports: number[]) {
  const link = new LinkClient(MAC, () => false, () => ({}), {
    candidates: async function* () { for (const port of ports) yield { host: '127.0.0.1', port, via: 'manual' as const }; },
    now: () => clock,
  });
  const messages: unknown[] = [];
  const rejections: unknown[] = [];
  const proofFailures: Array<{ host: string; retired: boolean }> = [];
  link.on('message', (m) => messages.push(m));
  link.on('pair-rejected', (r) => rejections.push(r));
  link.on('pair-proof-failed', (f) => proofFailures.push(f));
  active.push(link);
  return { link, messages, rejections, proofFailures };
}

async function until(predicate: () => boolean, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate()) return true; await wait(20); }
  return predicate();
}

const paired = () => storeData.get('paired') as { fingerprint: string; pairing?: number } | null;

beforeEach(() => {
  for (const link of active.splice(0)) link.stop('test over');
  storeData.set('paired', null);
  clock = Date.now();
});

// ---- the genuine path -------------------------------------------------------------------------

test('a valid pairing: both proofs verify, the phone is stored as v2, the secret never crosses the wire, and a reconnect is a plain pinned hello', async () => {
  let qr: PairingQrPayload | null = null;
  const real = await phone({ mode: 'v2', secret: () => qr?.secret ?? null });
  const { link } = client([real.port]);
  qr = link.armPairing('127.0.0.1');
  link.start();
  assert.ok(await until(() => link.isConnected()), 'control: the genuine phone pairs');
  assert.equal(paired()?.fingerprint, PHONE.fingerprint);
  assert.equal(paired()?.pairing, 2);
  assert.deepEqual(real.macProofValid, [true], 'the phone verified the Mac proof');
  assert.equal(link.isPairingArmed(), false, 'the secret is retired on success');
  assert.ok(!real.rawText.includes(qr.secret), 'the pairing secret was never sent');
  assert.ok(!JSON.stringify([...storeData.entries()]).includes(qr.secret), 'the pairing secret is not persisted');
  assert.ok(!('pairToken' in real.hellos[0]!), 'no v1 token');
  assert.equal(link.status().pairedLegacy, false);

  link.stop('reconnect');
  link.start();
  assert.ok(await until(() => link.isConnected()), 'a normal reconnect works');
  assert.equal(real.hellos.length, 2);
  assert.equal('pair' in real.hellos[1]!, false, 'a pinned reconnect carries no pairing request');
});

test('an attacker answering FIRST is not trusted, learns nothing, and the real phone still pairs in the same attempt', async () => {
  let qr: PairingQrPayload | null = null;
  const impostor = await phone({ mode: 'skipProof', identity: IMPOSTOR });
  const real = await phone({ mode: 'v2', secret: () => qr?.secret ?? null });
  const { link, proofFailures } = client([impostor.port, real.port]);
  qr = link.armPairing('127.0.0.1');
  link.start();
  assert.ok(await until(() => link.isConnected()));
  assert.equal(paired()?.fingerprint, PHONE.fingerprint, 'stored the real phone, not the first to answer');
  assert.equal(impostor.hellos.length, 1, 'control: the impostor did answer first');
  assert.equal(impostor.confirms.length, 0, 'the impostor never received a Mac proof');
  assert.ok(!impostor.rawText.includes(qr.secret), 'the impostor never saw the secret');
  assert.equal(proofFailures.length, 1);
});

// ---- every way to fail ------------------------------------------------------------------------

for (const [mode, label, identity] of [
  ['skipProof', 'answers hello.ack without a proof (downgrade)', IMPOSTOR],
  ['badProof', 'sends a forged proof', IMPOSTOR],
  ['relay', 'relays a proof made over the real phone’s certificate', IMPOSTOR],
  ['inject', 'injects notifications and clipboard text before acking', IMPOSTOR],
] as const) {
  test(`an impostor that ${label} is not trusted, and nothing it sent reaches a feature`, async () => {
    let qr: PairingQrPayload | null = null;
    const bad = await phone({ mode, identity, secret: () => qr?.secret ?? null });
    const { link, messages, proofFailures } = client([bad.port]);
    qr = link.armPairing('127.0.0.1');
    link.start();
    assert.ok(await until(() => proofFailures.length > 0), 'control: the exchange ran and failed');
    await wait(100);
    assert.equal(link.isConnected(), false);
    assert.equal(paired(), null, 'no trust record');
    assert.equal(messages.length, 0, 'no pre-authentication message reached a feature');
    assert.equal(bad.confirms.length, 0, 'no Mac proof for an unverified peer');
    assert.equal(link.isPairingArmed(), true, 'one failure does not burn the code for the real phone');
  });
}

test('the right certificate with the WRONG secret is refused', async () => {
  const real = await phone({ mode: 'v2', secret: () => randomBytes(32).toString('hex') });
  const { link, proofFailures } = client([real.port]);
  link.armPairing('127.0.0.1');
  link.start();
  assert.ok(await until(() => proofFailures.length > 0));
  assert.equal(paired(), null);
  assert.equal(real.confirms.length, 0);
});

test('a proof replayed from an earlier genuine exchange is refused', async () => {
  let qr: PairingQrPayload | null = null;
  const real = await phone({ mode: 'v2', secret: () => qr?.secret ?? null, beforeProof: () => undefined });
  const first = client([real.port]);
  qr = first.link.armPairing('127.0.0.1');
  first.link.start();
  assert.ok(await until(() => first.link.isConnected()), 'control: a genuine exchange to capture');
  const captured = real.proofsSent[0]!;
  first.link.stop('captured');
  storeData.set('paired', null);

  const replayer = await phone({ mode: 'replay', identity: PHONE, replay: captured });
  const second = client([replayer.port]);
  second.link.armPairing('127.0.0.1', true);
  second.link.start();
  assert.ok(await until(() => second.proofFailures.length > 0));
  assert.equal(paired(), null, 'the replayed proof did not verify: fresh nonce, fresh secret');
});

test('an old phone fails closed: the Mac reports it and stores nothing', async () => {
  const old = await phone({ mode: 'oldPhone' });
  const { link, rejections } = client([old.port]);
  link.armPairing('127.0.0.1');
  link.start();
  assert.ok(await until(() => rejections.length > 0));
  assert.equal((rejections[0] as { reason: string }).reason, 'TOKEN_MISSING');
  assert.equal(paired(), null);
  assert.ok(!('pairToken' in old.hellos[0]!), 'the Mac never offers the v1 token');
});

test('an expired code: the Mac does not even start a pairing, and expiry mid-exchange stores nothing', async () => {
  const real = await phone({ mode: 'v2', secret: () => 'aa'.repeat(32) });
  const { link } = client([real.port]);
  link.armPairing('127.0.0.1');
  clock += 5 * 60 * 1000 + 1;
  link.start();
  await wait(400);
  assert.equal(real.hellos.length, 0, 'not armed, not paired: no hello at all');

  let qr: PairingQrPayload | null = null;
  const slow = await phone({ mode: 'v2', secret: () => qr?.secret ?? null, beforeProof: () => { clock += 5 * 60 * 1000 + 1; } });
  const second = client([slow.port]);
  qr = second.link.armPairing('127.0.0.1');
  second.link.start();
  assert.ok(await until(() => slow.proofsSent.length > 0), 'control: the proof was sent after expiry');
  await wait(200);
  assert.equal(paired(), null);
  assert.equal(slow.confirms.length, 0);
});

test('cancelled mid-exchange: nothing stored, no Mac proof sent', async () => {
  let qr: PairingQrPayload | null = null;
  let link: InstanceType<typeof LinkClient> | null = null;
  const real = await phone({ mode: 'v2', secret: () => qr?.secret ?? null, beforeProof: () => link!.cancelPairing('test') });
  const c = client([real.port]);
  link = c.link;
  qr = link.armPairing('127.0.0.1');
  link.start();
  assert.ok(await until(() => real.hellos.length > 0));
  await wait(300);
  assert.equal(paired(), null);
  assert.equal(real.confirms.length, 0);
  assert.equal(link.isPairingArmed(), false);
});

test('interrupted after the Mac proved itself: nothing stored, the code survives, and a retry with fresh nonces pairs', async () => {
  let qr: PairingQrPayload | null = null;
  const flaky = await phone({ mode: 'hangUpAfterConfirm', secret: () => qr?.secret ?? null });
  const real = await phone({ mode: 'v2', secret: () => qr?.secret ?? null });
  const ports = [flaky.port];
  const { link } = client(ports);
  qr = link.armPairing('127.0.0.1');
  link.start();
  assert.ok(await until(() => flaky.confirms.length > 0), 'control: the Mac proved itself to the flaky phone');
  await wait(200);
  assert.equal(paired(), null, 'no hello.ack, no trust');
  assert.equal(link.isPairingArmed(), true);
  ports.splice(0, 1, real.port);
  link.retryNow('test');
  assert.ok(await until(() => link.isConnected()));
  assert.notEqual((real.hellos[0]!.pair as { nonce: string }).nonce, (flaky.hellos[0]!.pair as { nonce: string }).nonce, 'fresh nonce per attempt');
});

test(`the code is retired after ${PAIR_MAX_FAILURES} failed proofs, and a fresh code is needed`, async () => {
  const bad = await phone({ mode: 'badProof', identity: IMPOSTOR });
  const { link, proofFailures } = client([bad.port]);
  link.armPairing('127.0.0.1');
  link.start();
  for (let i = 0; i < PAIR_MAX_FAILURES; i++) {
    assert.ok(await until(() => proofFailures.length > i), `failure ${i + 1}`);
    if (i < PAIR_MAX_FAILURES - 1) link.retryNow('test');
  }
  assert.equal(proofFailures.at(-1)!.retired, true);
  assert.equal(link.isPairingArmed(), false);
  assert.equal(paired(), null);
});

test('rotating the code under an exchange tears it down: a proof for the old code is never trusted', async () => {
  let qr: PairingQrPayload | null = null;
  let link: InstanceType<typeof LinkClient> | null = null;
  const real = await phone({ mode: 'v2', secret: () => qr?.secret ?? null, beforeProof: () => { link!.armPairing('127.0.0.1', true); } });
  const c = client([real.port]);
  link = c.link;
  qr = link.armPairing('127.0.0.1');
  link.start();
  assert.ok(await until(() => real.proofsSent.length > 0));
  await wait(200);
  assert.equal(paired(), null);
  assert.equal(real.confirms.length, 0);
});

test('a legacy record (stored before v2) keeps working, is reported as legacy, and is never upgraded by reconnecting', async () => {
  storeData.set('paired', { deviceId: 'old', deviceName: 'Old phone', fingerprint: PHONE.fingerprint, pairedAt: 1 });
  const real = await phone({ mode: 'v2', secret: () => null });
  const { link } = client([real.port]);
  link.start();
  assert.ok(await until(() => link.isConnected()), 'a pinned legacy reconnect still works');
  assert.equal(link.status().pairedLegacy, true);
  assert.equal(paired()?.pairing, undefined, 'not upgraded');
  assert.equal('pair' in real.hellos[0]!, false);
});

test('no log call in the pairing paths mentions the secret, and the renderer gets the QR image and public fields, not the raw secret field', async () => {
  const { readFileSync } = await import('node:fs');
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const file of ['link.ts', 'main.ts']) {
    const code = strip(readFileSync(join(__dirname, file), 'utf8'));
    const logCalls = code.match(/log\.(info|warn|error)\([^;]*;/g) ?? [];
    assert.ok(logCalls.length > 10, `control: ${file}'s log calls were found`);
    const leaking = logCalls.filter((c) => /secret/i.test(c));
    assert.deepEqual(leaking, [], `${file} logs the pairing secret`);
  }
  const main = strip(readFileSync(join(__dirname, 'main.ts'), 'utf8'));
  assert.match(main, /const payload = \{ host: armed\.host, name: armed\.name \};/, 'pairing-qr hands over host and name only');
  assert.ok(!/qr = JSON\.stringify\(payload\)/.test(main), 'pair-rejected no longer carries the payload JSON');
});
