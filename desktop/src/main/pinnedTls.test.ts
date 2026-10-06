import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from 'node:tls';
import forge from 'node-forge';
import { BulkClient } from './bulk';
import { VideoClient } from './video';
import { fingerprintOf, type Identity } from './identity';
import { NO_SESSION_PEER, pinVerdict } from './pinnedTls';
import { sharePartPath, newPartNonce } from './shareDestination';

/**
 * Audit S2 (`docs/release-audit-2026-10-06.md`): every Mac → phone side-channel socket is pinned to
 * the control session's phone **before a byte of application payload is written**.
 *
 * The phone here is a Node TLS server on 127.0.0.1 with a per-run certificate. It counts every byte of
 * application data it receives on each connection. The assertion that matters for a wrong peer is
 * **zero bytes** — not that the Mac eventually reported an error, which it also did before the fix,
 * after having written the token.
 *
 * Reached: the production `BulkClient.push`, `.pull`, `.pullShare` and `VideoClient.open`, through
 * `pinnedTlsConnect`. Not reached: the phone's `LinkServer` (Kotlin; it demands a trusted client
 * certificate on every port and is unchanged), and a real network attacker — the impostor is simply a
 * second certificate on loopback. A server with **no** certificate cannot be produced in TLS 1.3, so the
 * missing-certificate case is covered by `pinVerdict` alone.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cleanups: Array<() => void | Promise<void>> = [];
after(async () => {
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
const TOKEN = 'a1'.repeat(32);

interface FakePhone {
  port: number;
  /** TCP connections accepted — proof the Mac reached this server at all. */
  connections: number;
  /** TLS handshakes the server completed. A refused peer may never complete one: the Mac hangs up first. */
  handshakes: number;
  /** Application bytes received, summed over every connection. */
  bytes: number;
  /** The first application frame of the first connection that sent one, decoded. */
  firstFrame: string | null;
}

/** A phone's side-channel port presenting [identity]. Closes each connection once it has read the token. */
async function fakePhone(identity: Identity): Promise<FakePhone> {
  const side: FakePhone = { port: 0, connections: 0, handshakes: 0, bytes: 0, firstFrame: null };
  const sockets: TLSSocket[] = [];
  const server: TlsServer = createTlsServer(
    { key: identity.keyPem, cert: identity.certPem, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' },
    (socket) => {
      sockets.push(socket);
      side.handshakes += 1;
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        side.bytes += chunk.length;
        buffer = Buffer.concat([buffer, chunk]);
        if (side.firstFrame === null && buffer.length >= 4) {
          const length = buffer.readUInt32BE(0);
          if (buffer.length >= 4 + length) {
            side.firstFrame = buffer.subarray(4, 4 + length).toString('utf8');
            socket.end();
          }
        }
      });
      socket.on('error', () => undefined);
    },
  );
  server.on('connection', () => { side.connections += 1; });
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  side.port = (server.address() as AddressInfo).port;
  cleanups.push(() => new Promise<void>((resolve) => {
    for (const s of sockets) s.destroy();
    server.close(() => resolve());
  }));
  return side;
}

/** Each production entry point, opened against [phone] with [expected] as the session's peer. */
type Path = (phone: FakePhone, expected: () => string | null, signal?: AbortSignal) => Promise<{ ok: boolean; reason: string }>;

const folder = () => mkdtempSync(join(tmpdir(), 'pinned-tls-'));

const PATHS: Record<string, Path> = {
  'video.open': async (phone, expected) => {
    const video = new VideoClient(MAC, expected, phone.port);
    cleanups.push(() => video.close('test over'));
    return video.open('127.0.0.1', TOKEN).then(
      () => ({ ok: true, reason: '' }),
      (error: Error) => ({ ok: false, reason: error.message }),
    );
  },
  'bulk.push': async (phone, expected) => {
    const source = join(folder(), 'push.bin');
    writeFileSync(source, randomBytes(4096));
    const result = await new BulkClient(MAC, expected, phone.port).push({
      host: '127.0.0.1', token: TOKEN, transferId: 'push-1', source, offset: 0, totalBytes: 4096, chunkMax: 1024,
    });
    return { ok: result.ok, reason: result.reason ?? '' };
  },
  'bulk.pull': async (phone, expected, signal) => {
    const result = await new BulkClient(MAC, expected, phone.port).pull({
      host: '127.0.0.1', token: TOKEN, transferId: 'pull-1', destination: join(folder(), 'pulled.bin'), expectedBytes: 4096,
      ...(signal ? { signal } : {}),
    });
    return { ok: result.ok, reason: result.reason ?? '' };
  },
  'bulk.pullShare': async (phone, expected, signal) => {
    const d = folder();
    const result = await new BulkClient(MAC, expected, phone.port).pullShare({
      host: '127.0.0.1', token: TOKEN, transferId: 'share-1', part: sharePartPath(d, 's-Q3v9aP0kT7mR2xW8yB4nZc', newPartNonce()),
      expectedBytes: 4096, expectedSha256: createHash('sha256').update('x').digest('hex'), idleTimeoutMs: 2000,
      publish: async () => { throw new Error('nothing may be published in this test'); },
      ...(signal ? { signal } : {}),
    });
    return { ok: result.ok, reason: result.ok ? '' : `${result.reason}: ${result.detail}` };
  },
};

// ---- the pure decision ---------------------------------------------------------------------------

test('pinVerdict: the session phone\'s certificate passes, in any fingerprint spelling', () => {
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(PHONE.certPem))).getBytes(), 'binary');
  assert.deepEqual(pinVerdict(der, PHONE.fingerprint, PHONE.fingerprint), { ok: true });
  const lower = PHONE.fingerprint.toLowerCase();
  assert.deepEqual(pinVerdict(der, lower, PHONE.fingerprint), { ok: true });
});

test('pinVerdict: fails closed on a wrong certificate, a missing one, no session, and a session that changed', () => {
  const der = (id: Identity) => Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(id.certPem))).getBytes(), 'binary');
  const cases: Array<[string, ReturnType<typeof pinVerdict>]> = [
    ['wrong certificate', pinVerdict(der(IMPOSTOR), PHONE.fingerprint, PHONE.fingerprint)],
    ['no certificate (undefined)', pinVerdict(undefined, PHONE.fingerprint, PHONE.fingerprint)],
    ['no certificate (empty DER)', pinVerdict(Buffer.alloc(0), PHONE.fingerprint, PHONE.fingerprint)],
    ['no session at connect', pinVerdict(der(PHONE), null, PHONE.fingerprint)],
    ['session ended during the handshake', pinVerdict(der(PHONE), PHONE.fingerprint, null)],
    ['session re-paired during the handshake', pinVerdict(der(PHONE), PHONE.fingerprint, IMPOSTOR.fingerprint)],
  ];
  for (const [name, verdict] of cases) assert.equal(verdict.ok, false, name);
  assert.equal(cases[3]![1].ok === false && cases[3]![1].reason, NO_SESSION_PEER);
});

// ---- over real TLS, every path ---------------------------------------------------------------------

for (const [name, open] of Object.entries(PATHS)) {
  test(`${name}: the session's phone receives the token as the first frame (control)`, async () => {
    const phone = await fakePhone(PHONE);
    await open(phone, () => PHONE.fingerprint);
    await wait(100);
    assert.equal(phone.handshakes, 1);
    assert.equal(phone.firstFrame, TOKEN, 'the right peer must still get the session token');
  });

  test(`${name}: a wrong certificate receives ZERO application bytes, and the Mac says why`, async () => {
    const impostor = await fakePhone(IMPOSTOR);
    const result = await open(impostor, () => PHONE.fingerprint);
    await wait(150);
    assert.equal(impostor.connections, 1, 'the Mac must have reached the impostor, or zero bytes proves nothing');
    assert.equal(impostor.bytes, 0, `the impostor received ${impostor.bytes} application bytes`);
    assert.equal(impostor.firstFrame, null);
    assert.equal(result.ok, false);
    assert.match(result.reason, /different certificate/);
  });

  test(`${name}: no control session → nothing is written, and the reason names it`, async () => {
    const phone = await fakePhone(PHONE);
    const result = await open(phone, () => null);
    await wait(150);
    assert.equal(phone.bytes, 0);
    assert.equal(result.ok, false);
    assert.match(result.reason, /no paired phone session/);
  });

  test(`${name}: the session ends during the handshake → ZERO application bytes`, async () => {
    const phone = await fakePhone(PHONE);
    let reads = 0;
    // Present when the connection starts, gone by the time the handshake finishes: a disconnect.
    const result = await open(phone, () => (reads++ === 0 ? PHONE.fingerprint : null));
    await wait(150);
    assert.ok(reads >= 2, 'the peer must be re-read at the handshake, or this test proves nothing');
    assert.equal(phone.connections, 1, 'the Mac must have reached the phone, or zero bytes proves nothing');
    assert.equal(phone.bytes, 0);
    assert.equal(result.ok, false);
    assert.match(result.reason, /ended or changed/);
  });
}

for (const name of ['bulk.pull', 'bulk.pullShare'] as const) {
  test(`${name}: cancelled before the handshake completes → ZERO application bytes, even to the right phone`, async () => {
    const phone = await fakePhone(PHONE);
    const controller = new AbortController();
    const running = PATHS[name]!(phone, () => PHONE.fingerprint, controller.signal);
    controller.abort('cancelled by the person');
    const result = await running;
    await wait(150);
    assert.equal(phone.bytes, 0);
    assert.equal(result.ok, false);
  });
}

test('bulk.pull: a refused peer leaves no file at the destination', async () => {
  const impostor = await fakePhone(IMPOSTOR);
  const d = folder();
  const destination = join(d, 'never.bin');
  const result = await new BulkClient(MAC, () => PHONE.fingerprint, impostor.port).pull({
    host: '127.0.0.1', token: TOKEN, transferId: 'pull-2', destination, expectedBytes: 10,
  });
  assert.equal(result.ok, false);
  assert.equal(existsSync(destination), false);
});
