import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:tls';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SCRIPT = new URL('./pair-decoy.mjs', import.meta.url);

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

test('the decoy answers a pairing hello with hello.ack and no proof, counts what the Mac sends, prints no payload value', { timeout: 30_000 }, async () => {
  const child = spawn(process.execPath, [SCRIPT.pathname, '--seconds', '20'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 200 && !/listening on 127\.0\.0\.1:(\d+)/.test(out); i += 1) await new Promise((r) => setTimeout(r, 50));
  const port = Number(/listening on 127\.0\.0\.1:(\d+)/.exec(out)?.[1]);
  assert.ok(port > 0, `control: the decoy started: ${out}`);

  const nonce = randomBytes(16).toString('hex');
  const socket = connect({ host: '127.0.0.1', port, rejectUnauthorized: false, minVersion: 'TLSv1.3' });
  await new Promise((r, j) => { socket.once('secureConnect', r); socket.once('error', j); });
  const replies = [];
  let buf = Buffer.alloc(0);
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) { replies.push(JSON.parse(buf.subarray(4, 4 + buf.readUInt32BE(0)))); buf = buf.subarray(4 + buf.readUInt32BE(0)); }
  });
  socket.write(frame({ v: 1, ts: 1, id: 'h1', type: 'hello', payload: { deviceName: 'Mac', pair: { v: 2, nonce } } }));
  for (let i = 0; i < 100 && replies.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(replies.map((r) => r.type), ['hello.ack'], 'the downgrade: an ack with no pair.proof before it');
  socket.write(frame({ v: 1, ts: 2, id: 'c1', type: 'pair.confirm', payload: { proof: 'x' } }));
  await new Promise((r) => setTimeout(r, 200));
  socket.destroy();

  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  const summary = JSON.parse(out.slice(out.indexOf('{')));
  assert.equal(summary.hellosWithPair, 1);
  assert.equal(summary.acksSent, 1);
  assert.equal(summary['pair.confirm received'], 1, 'control: a confirm reaching the decoy is counted, so a 0 on hardware means something');
  assert.deepEqual(summary.helloPayloadKeys, ['deviceName', 'pair']);
  assert.equal(summary.bounds.host, '127.0.0.1');
  assert.ok(!out.includes(nonce), 'no payload value is printed');
});

test('the decoy cannot be pointed anywhere but this Mac, and its port is the Mac’s own constant', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /const HOST = '127\.0\.0\.1';/);
  assert.doesNotMatch(src, /--host|--port|process\.env\.[A-Z_]*HOST/);
  assert.match(src, /PAIR_DECOY_PORT = \(\\d\+\)/, 'the port is read from desktop/src/main/pairDecoy.ts');
});

test('--inject sends a synthetic notification and clipboard push before its ack, and says so', { timeout: 30_000 }, async () => {
  const child = spawn(process.execPath, [SCRIPT.pathname, '--seconds', '20', '--inject'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 200 && !/listening on 127\.0\.0\.1:(\d+)/.test(out); i += 1) await new Promise((r) => setTimeout(r, 50));
  const port = Number(/listening on 127\.0\.0\.1:(\d+)/.exec(out)?.[1]);
  const socket = connect({ host: '127.0.0.1', port, rejectUnauthorized: false, minVersion: 'TLSv1.3' });
  await new Promise((r, j) => { socket.once('secureConnect', r); socket.once('error', j); });
  const types = [];
  let buf = Buffer.alloc(0);
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) { types.push(JSON.parse(buf.subarray(4, 4 + buf.readUInt32BE(0))).type); buf = buf.subarray(4 + buf.readUInt32BE(0)); }
  });
  socket.write(frame({ v: 1, ts: 1, id: 'h1', type: 'hello', payload: { pair: { v: 2, nonce: 'n' } } }));
  for (let i = 0; i < 100 && types.length < 3; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(types, ['notif.posted', 'clip.push', 'hello.ack']);
  socket.destroy();
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  const summary = JSON.parse(out.slice(out.indexOf('{')));
  assert.equal(summary.injectedBeforeAck, 2);
  assert.equal(summary.injectMarker, 'SIDEKICK-DECOY-INJECT-7f3a');
});
