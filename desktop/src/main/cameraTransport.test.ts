import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import { createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from 'node:tls';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import forge from 'node-forge';
import { CameraController, openCameraSocket, type CameraFrameMessage, type CameraPaneState } from './camera';
import { FrameReader } from './framing';
import { fingerprintOf, fingerprintOfDer, type Identity } from './identity';
import { cameraClaim } from '../shared/cameraFrame';

/**
 * The Mac's camera socket over **real TLS 1.3 on loopback**, with certificates generated per run — the
 * production `openCameraSocket`, its pin, its claim write and its close handling, and then the production
 * `CameraController` and `CameraFrameReader` on top of it.
 *
 * What plays the phone here is a Node TLS server, not the phone's `LinkServer`: it presents a
 * certificate, demands the Mac's, reads the claim with the production `FrameReader`, and writes frames.
 * It does **not** run the phone's claim parser or its authorisation — those are Kotlin
 * (`SideChannelClaimTest`, `CameraSessionMachineTest`). This file proves the Mac half of the handshake;
 * the two halves have only ever met on hardware.
 *
 * No external network: every socket is 127.0.0.1. No certificate, token or frame is logged.
 */

const TOKEN = 'c'.repeat(64);
const STREAM = '0123456789abcdef0123456789abcdef';
const CLAIM_GRAMMAR = /^[0-9a-f]{64} camera [0-9a-f]{32}$/;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything a test opened, closed after the file whether its assertions passed or not. */
const cleanups: Array<() => void | Promise<void>> = [];
after(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

/** A self-signed identity, as `identity.ts` mints them: RSA-2048, SHA-256, its fingerprint over the DER. */
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

interface PhoneSide {
  server: TlsServer;
  port: number;
  connections: number;
  claims: string[];
  /** Bytes received after the claim — the Mac must never write here. */
  extraBytes: number;
  macFingerprints: string[];
  protocols: string[];
  sockets: TLSSocket[];
  /** The TCP sockets under them, for a reset. */
  raw: Socket[];
  closed: number;
  close(): Promise<void>;
}

/** A phone's video port: presents [identity], requires a client certificate, reads one framed claim. */
async function phone(identity: Identity = PHONE): Promise<PhoneSide> {
  const side = { connections: 0, claims: [], extraBytes: 0, macFingerprints: [], protocols: [], sockets: [], raw: [], closed: 0 } as unknown as PhoneSide;
  const server = createTlsServer({ key: identity.keyPem, cert: identity.certPem, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' }, (socket) => {
    side.sockets.push(socket);
    const raw = socket.getPeerX509Certificate?.()?.raw;
    if (raw) side.macFingerprints.push(fingerprintOfDer(raw));
    side.protocols.push(String(socket.getProtocol()));
    let claimed = false;
    const reader = new FrameReader(
      (frame) => {
        if (!claimed) {
          claimed = true;
          side.claims.push(frame.toString('utf8'));
        } else side.extraBytes += frame.length;
      },
      () => socket.destroy(),
      128,
    );
    socket.on('data', (chunk: Buffer) => (claimed ? (side.extraBytes += chunk.length) : reader.push(chunk)));
    socket.on('error', () => undefined);
    socket.on('close', () => (side.closed += 1));
  });
  server.on('connection', (raw: Socket) => {
    side.connections += 1;
    side.raw.push(raw);
  });
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  side.server = server;
  side.port = (server.address() as AddressInfo).port;
  let closed = false;
  side.close = () =>
    new Promise<void>((resolve) => {
      for (const s of side.sockets) s.destroy();
      if (closed) return resolve();
      closed = true;
      server.close(() => resolve());
    });
  cleanups.push(() => side.close());
  return side;
}

async function until(predicate: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met within ' + ms + ' ms');
    await wait(5);
  }
}

function open(side: PhoneSide, expected: string | null, timeoutMs?: number) {
  const closes: string[] = [];
  const data: Buffer[] = [];
  const lines: string[] = [];
  const socket = openCameraSocket(MAC, '127.0.0.1', cameraClaim(TOKEN, STREAM), expected, {
    port: side.port,
    ...(timeoutMs ? { timeoutMs } : {}),
    log: { info: (m) => lines.push(`I ${m}`), warn: (m) => lines.push(`W ${m}`) },
  });
  socket.onClose((reason) => closes.push(reason));
  socket.onData((chunk) => data.push(chunk));
  cleanups.push(() => socket.destroy());
  return { socket, closes, data, lines };
}

test('the pinned phone gets exactly one claim, in the contract’s grammar, over mutual TLS 1.3', async () => {
  const side = await phone();
  const s = open(side, PHONE.fingerprint);
  await until(() => side.claims.length === 1);
  assert.deepEqual(side.claims, [cameraClaim(TOKEN, STREAM)]);
  assert.match(side.claims[0]!, CLAIM_GRAMMAR);
  assert.equal(Buffer.byteLength(side.claims[0]!), 104, 'the contract’s 104-byte claim');
  assert.deepEqual(side.protocols, ['TLSv1.3']);
  assert.deepEqual(side.macFingerprints, [MAC.fingerprint], 'the phone sees this Mac’s own certificate');
  assert.deepEqual(s.closes, []);
  s.socket.destroy();
  await until(() => side.closed === 1);
  assert.equal(side.extraBytes, 0, 'the Mac wrote nothing after its claim');
  assert.deepEqual(s.closes, [], 'a local destroy is not reported as the phone closing');
  await side.close();
});

test('a phone presenting another certificate gets no claim, and the socket closes as a mismatch', async () => {
  const side = await phone(IMPOSTOR);
  const s = open(side, PHONE.fingerprint);
  await until(() => s.closes.length === 1);
  // The Mac hangs up mid-handshake, so the phone side never completes one: there is no server-side
  // socket to wait for. Give any claim time to arrive instead.
  await wait(200);
  assert.deepEqual(s.closes, ['certificate mismatch']);
  assert.equal(side.connections, 1, 'control: the connection did reach the impostor');
  assert.deepEqual(side.claims, [], 'the claim (with the session token) was never sent to it');
  assert.ok(s.lines.some((l) => l.startsWith('W ') && l.includes('different certificate')));
  assert.ok(!s.lines.some((l) => l.includes(PHONE.fingerprint) || l.includes(IMPOSTOR.fingerprint) || l.includes(TOKEN)), 'no fingerprint or token in the log');
  await side.close();
});

/** Defect 173: with no expected identity there is nothing to pin, so there must be no connection at all. */
test('with no expected phone identity the Mac does not connect, present its certificate, or send the claim', async () => {
  const side = await phone();
  const s = open(side, null);
  await until(() => s.closes.length === 1);
  await wait(150);
  assert.equal(side.connections, 0, 'a TLS handshake was made to an unpinned peer');
  assert.deepEqual(side.claims, []);
  assert.equal(s.closes.length, 1);
  assert.match(s.closes[0]!, /no phone identity/);
  // Control: the same server, asked properly, is reachable.
  const ok = open(side, PHONE.fingerprint);
  await until(() => side.claims.length === 1);
  ok.socket.destroy();
  await side.close();
});

test('the phone closing the stream is reported once; a reset is reported once and throws nothing', async () => {
  const side = await phone();
  const s = open(side, PHONE.fingerprint);
  await until(() => side.claims.length === 1);
  side.sockets[0]!.end();
  await until(() => s.closes.length >= 1);
  await wait(50);
  assert.equal(s.closes.length, 1);

  const r = open(side, PHONE.fingerprint);
  await until(() => side.claims.length === 2);
  side.raw[1]!.resetAndDestroy();
  await until(() => r.closes.length >= 1);
  await wait(50);
  assert.equal(r.closes.length, 1, `reset reported ${r.closes.length} times`);
  await side.close();
});

test('a port that accepts and never handshakes is closed at the timeout, with nothing sent', async () => {
  let bytes = 0;
  const held: Socket[] = [];
  const silent: TcpServer = createTcpServer((socket) => {
    held.push(socket);
    socket.on('data', (c) => (bytes += c.length));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const port = (silent.address() as AddressInfo).port;
  cleanups.push(() => {
    for (const s of held) s.destroy();
    silent.close();
  });
  const closes: string[] = [];
  const started = Date.now();
  const socket = openCameraSocket(MAC, '127.0.0.1', cameraClaim(TOKEN, STREAM), PHONE.fingerprint, { port, timeoutMs: 300, log: { info() {}, warn() {} } });
  socket.onClose((reason) => closes.push(reason));
  cleanups.push(() => socket.destroy());
  await until(() => closes.length === 1, 3000);
  const took = Date.now() - started;
  assert.ok(took >= 250 && took < 2500, `closed after ${took} ms against a 300 ms bound`);
  assert.match(closes[0]!, /did not answer/);
  assert.ok(bytes > 0, 'control: the ClientHello did go out');
});

test('destroyed before the handshake finishes: no claim, no close report, no stray error', async () => {
  const side = await phone();
  const errors: unknown[] = [];
  const onUncaught = (e: unknown) => errors.push(e);
  process.on('uncaughtException', onUncaught);
  const s = open(side, PHONE.fingerprint);
  s.socket.destroy();
  await wait(200);
  process.off('uncaughtException', onUncaught);
  assert.deepEqual(side.claims, []);
  assert.deepEqual(s.closes, []);
  assert.deepEqual(errors, []);
  await side.close();
});

// ---- the production controller and reader, over the real socket -------------------------------------

function goldenFrame(sequence: number): Buffer {
  const text = readFileSync(join(__dirname, '../../../docs/fixtures/camera-frame-v1.hex'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('')
    .replace(/\s+/g, '');
  const bytes = Buffer.from(text, 'hex');
  bytes.writeUInt32BE(sequence, 13 + 10);
  return bytes;
}

function controllerOver(side: PhoneSide) {
  const states: CameraPaneState[] = [];
  const frames: CameraFrameMessage[] = [];
  const sent: string[] = [];
  const controller = new CameraController({
    link: {
      isConnected: () => true,
      token: () => TOKEN,
      address: () => '127.0.0.1',
      request: async (type) => {
        sent.push(type);
        return type === 'camera.request' ? { payload: { state: 'awaiting-approval', streamId: STREAM, expiresInMs: 30_000 } } : { payload: { stopped: true } };
      },
    },
    openSocket: (host, claim) => openCameraSocket(MAC, host, claim, PHONE.fingerprint, { port: side.port, log: { info() {}, warn() {} } }),
    emitState: (state) => states.push(state),
    emitFrame: (frame) => {
      frames.push(frame);
      // An instant page: drawn and acked before the next frame is read. A slow page, which costs frames
      // by design, is `camera.test.ts`'s business.
      controller.frameAck(frame.streamId, 'drawn');
    },
    log: { info() {}, warn() {} },
  });
  return { controller, states, frames, sent };
}

test('end to end: no socket before approval; fragmented frames arrive whole; nothing is drawn after Stop', async () => {
  const side = await phone();
  const c = controllerOver(side);
  await c.controller.request('back');
  await wait(100);
  assert.equal(side.connections, 0, 'a socket opened before the phone said starting');

  c.controller.onState({ state: 'starting', streamId: STREAM, facing: 'back' });
  await until(() => side.claims.length === 1);
  assert.deepEqual(side.claims, [cameraClaim(TOKEN, STREAM)]);

  // Three frames, written one byte at a time and then coalesced into one write.
  const phoneSocket = side.sockets[0]!;
  const bytes = Buffer.concat([goldenFrame(1), goldenFrame(2), goldenFrame(3)]);
  for (let i = 0; i < 40; i++) phoneSocket.write(bytes.subarray(i, i + 1));
  phoneSocket.write(bytes.subarray(40));
  await until(() => c.frames.length === 3).catch((e) => { throw new Error(`${e.message}: frames ${c.frames.length}, states ${c.states.map((x) => x.kind).join(",")}`); });
  assert.deepEqual(c.frames.map((f) => f.sequence), [1, 2, 3]);

  await c.controller.stop();
  phoneSocket.write(goldenFrame(4));
  await until(() => side.closed === 1);
  await wait(50);
  assert.deepEqual(c.frames.map((f) => f.sequence), [1, 2, 3], 'a frame was emitted after Stop');
  assert.equal(c.controller.current().kind, 'ended');
  assert.deepEqual(c.sent, ['camera.request', 'camera.stop']);
  await side.close();
});

test('end to end: a malformed frame from the real socket closes it and is never drawn', async () => {
  const side = await phone();
  const c = controllerOver(side);
  await c.controller.request('back');
  c.controller.onState({ state: 'starting', streamId: STREAM, facing: 'back' });
  await until(() => side.claims.length === 1);
  const bad = goldenFrame(1);
  bad[13 + 15] = 1; // a reserved byte
  side.sockets[0]!.write(bad);
  await until(() => side.closed === 1);
  assert.equal(c.frames.length, 0);
  assert.equal(c.controller.current().kind, 'error');
  await side.close();
});
