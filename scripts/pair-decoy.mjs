#!/usr/bin/env node
/**
 * H7's impostor stand-in (docs/pairing-v2-hardware-test-proposal.md): a TLS listener on THIS Mac that
 * answers the Mac's pairing `hello` with a `hello.ack` and **no proof** — the downgrade an attacker who
 * answers first would try. Run it, then start pairing in a Sidekick development build launched with
 * `CONNECTSUITE_DEBUG_SWITCHES=pairDecoyFirst`, which tries 127.0.0.1:42611 before every real candidate
 * while pairing is armed (`desktop/src/main/pairDecoy.ts`).
 *
 * Pass, read on the Mac: `a device at … was not trusted: it answered without proving the pairing code`;
 * read here: `pair.confirm received: 0` (the Mac sent the impostor no proof) and `hellos with pair: 1`
 * (control: the Mac really did reach the decoy while pairing). Then the real phone pairs.
 *
 * Bounds, all printed in the summary: loopback only and a fixed port (not options — this must never be
 * pointed at another machine); stops after `--seconds` (default 300, at most 900); a throwaway RSA
 * certificate made in memory for this run. It prints counts, message types and key names — never a
 * payload value — because a pairing hello carries a nonce and the session carries the Mac's identity.
 *
 * `--inject` first sends a synthetic notification and a synthetic clipboard push (fixed marker text, no
 * real content), then the ack — the pre-authentication injection case. Pass: neither reaches the Mac's
 * Notifications or Clipboard pane, and the Mac log shows the decoy refused.
 *
 *   node scripts/pair-decoy.mjs [--seconds N] [--inject]
 */
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
/** Read from the Mac's own constant, so the two cannot drift. */
const PORT = Number(/PAIR_DECOY_PORT = (\d+)/.exec(readFileSync(join(HERE, '../desktop/src/main/pairDecoy.ts'), 'utf8'))?.[1]);
const MAX_SECONDS = 900;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const seconds = Math.min(Number(arg('--seconds', '300')), MAX_SECONDS);
const inject = process.argv.includes('--inject');
/** Synthetic and fixed, so a sighting anywhere on the Mac is unambiguous. */
export const INJECT_MARKER = 'SIDEKICK-DECOY-INJECT-7f3a';
if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(PORT)) {
  console.error(`pair-decoy: refused — seconds=${seconds} port=${PORT}`);
  process.exit(2);
}

const forge = createRequire(join(HERE, '../desktop/package.json'))('node-forge');
function throwawayCert() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: 'commonName', value: 'sidekick-pair-decoy' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  const fingerprint = createHash('sha256').update(der).digest('hex').match(/../g).join(':').toUpperCase();
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert), fingerprint };
}

const id = throwawayCert();
const tally = { injected: 0, connections: 0, hellos: 0, hellosWithPair: 0, helloKeys: [], pairConfirms: 0, otherTypes: {}, bytes: 0, acksSent: 0 };

function frame(socket, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([head, body]));
}

const server = createServer({ key: id.key, cert: id.cert, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' }, (socket) => {
  tally.connections += 1;
  socket.on('error', () => undefined);
  let buf = Buffer.alloc(0);
  socket.on('data', (d) => {
    tally.bytes += d.length;
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
      const len = buf.readUInt32BE(0);
      let env;
      try { env = JSON.parse(buf.subarray(4, 4 + len).toString('utf8')); } catch { env = { type: '(unparseable)' }; }
      buf = buf.subarray(4 + len);
      if (env.type === 'hello') {
        tally.hellos += 1;
        if (env.payload && typeof env.payload === 'object' && 'pair' in env.payload) tally.hellosWithPair += 1;
        tally.helloKeys = Object.keys(env.payload ?? {}).sort();
        if (inject) {
          frame(socket, { v: 1, ts: Date.now(), id: `n-${randomBytes(4).toString('hex')}`, type: 'notif.posted', payload: { key: 'decoy', app: 'Decoy', title: INJECT_MARKER, text: INJECT_MARKER } });
          frame(socket, { v: 1, ts: Date.now(), id: `c-${randomBytes(4).toString('hex')}`, type: 'clip.push', payload: { kind: 'text', text: INJECT_MARKER, origin: 'clipboard' } });
          tally.injected += 2;
        }
        // The downgrade: an ack, as if paired, with no `pair.proof` before it.
        frame(socket, { v: 1, ts: Date.now(), id: env.id, type: 'hello.ack', payload: { protocolVersion: 1, deviceName: 'Decoy', deviceId: 'decoy', fingerprint: id.fingerprint, sessionToken: randomBytes(32).toString('hex'), capabilities: [] } });
        tally.acksSent += 1;
      } else if (env.type === 'pair.confirm') {
        tally.pairConfirms += 1;
      } else {
        tally.otherTypes[env.type] = (tally.otherTypes[env.type] ?? 0) + 1;
      }
    }
  });
});

const started = Date.now();
function finish(why) {
  server.close();
  const summary = {
    stopped: why,
    bounds: { host: HOST, port: PORT, seconds, inject, listenedSeconds: Math.round((Date.now() - started) / 1000) },
    decoyFingerprintPrefix: id.fingerprint.slice(0, 11),
    connections: tally.connections,
    hellos: tally.hellos,
    hellosWithPair: tally.hellosWithPair,
    helloPayloadKeys: tally.helloKeys,
    acksSent: tally.acksSent,
    injectedBeforeAck: tally.injected,
    injectMarker: inject ? INJECT_MARKER : null,
    'pair.confirm received': tally.pairConfirms,
    otherTypes: tally.otherTypes,
    bytesReceived: tally.bytes,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
server.on('error', (e) => { console.error(`pair-decoy: cannot listen on ${HOST}:${PORT} — ${e.code ?? e.message}`); process.exit(3); });
server.listen(PORT, HOST, () => console.log(`pair-decoy: listening on ${HOST}:${PORT} for at most ${seconds}s (decoy ${id.fingerprint.slice(0, 11)}…)`));
setTimeout(() => finish('time bound'), seconds * 1000).unref();
process.on('SIGINT', () => finish('SIGINT'));
process.on('SIGTERM', () => finish('SIGTERM'));
