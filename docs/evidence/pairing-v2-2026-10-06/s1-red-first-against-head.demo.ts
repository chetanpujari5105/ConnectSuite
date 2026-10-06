// S1 red-first against HEAD's UNMODIFIED LinkClient (isolated copy; never committed).
// An impostor TLS server on 127.0.0.1:42501 answers hello with hello.ack. HEAD pins it as "the phone".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer } from 'node:tls';
import forge from 'node-forge';
const userData = mkdtempSync(join(tmpdir(), 's1-red-'));
const storeData = new Map<string, unknown>();
const m = Module as unknown as { _load: (r: string, ...rest: unknown[]) => unknown };
const real = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'electron') return { app: { getPath: () => userData, isPackaged: false, getName: () => 't' }, safeStorage: {} };
  if (r === 'electron-store') return class { constructor(o?: { defaults?: Record<string, unknown> }) { for (const [k, v] of Object.entries(o?.defaults ?? {})) if (!storeData.has(k)) storeData.set(k, v); } get(k: string) { return storeData.get(k); } set(k: string, v: unknown) { storeData.set(k, v); } };
  return real.call(this, r, ...rest);
};
const { LinkClient } = require('./link') as typeof import('./link');
const { FrameReader, writeFrame } = require('./framing') as typeof import('./framing');
const { fingerprintOf } = require('./identity') as typeof import('./identity');
function ident(name: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const c = forge.pki.createCertificate(); c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  c.serialNumber = '01' + randomBytes(4).toString('hex'); c.validity.notBefore = new Date(Date.now() - 6e4); c.validity.notAfter = new Date(Date.now() + 864e5);
  c.setSubject([{ name: 'commonName', value: name }]); c.setIssuer([{ name: 'commonName', value: name }]); c.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(c); return { certPem, keyPem, fingerprint: fingerprintOf(certPem), deviceName: name };
}
test('HEAD: an impostor answering first is pinned as the phone, and receives the pairing token', async () => {
  const mac = ident('mac'); const impostor = ident('impostor');
  let received = '';
  const server = createTlsServer({ key: impostor.keyPem, cert: impostor.certPem, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' }, (s) => {
    s.on('error', () => undefined);
    const r = new FrameReader((f) => { received += f.toString(); const e = JSON.parse(f.toString()); if (e.type === 'hello') writeFrame(s, Buffer.from(JSON.stringify({ v: 1, id: e.id, type: 'hello.ack', ts: Date.now(), payload: { protocolVersion: 1, deviceName: 'impostor', deviceId: 'x', sessionToken: 'aa'.repeat(32), capabilities: [] } }))); }, () => s.destroy());
    s.on('data', (d: Buffer) => r.push(d));
  });
  await new Promise<void>((res) => server.listen(42501, '127.0.0.1', res));
  storeData.set('paired', null); storeData.set('lastAddress', '127.0.0.1');
  const link = new LinkClient(mac);
  const qr = link.armPairing('127.0.0.1') as unknown as { token: string };
  link.start();
  for (let i = 0; i < 100 && !link.isConnected(); i++) await new Promise((r) => setTimeout(r, 30));
  link.stop('done'); server.close();
  const pinned = (storeData.get('paired') as { fingerprint?: string } | null)?.fingerprint;
  console.log(`HEAD RESULT: connected=${link.status().paired} pinned=${pinned === impostor.fingerprint ? 'IMPOSTOR' : pinned} tokenSentToImpostor=${received.includes(qr.token)}`);
  // The v2 rule: an unproven peer must not be stored. HEAD violates it — this is the red.
  assert.notEqual(pinned, impostor.fingerprint, 'HEAD stored the impostor as the paired phone');
});
