/*
 * Opening the pairing screen while a phone is already connected must not disturb it.
 *
 * Runs the real `LinkClient` through the real `armPairingCode` — the sequence the `pairing-qr`
 * handler calls — with only Electron and `electron-store` replaced, because neither can load under
 * `node --test`. **What this does not reach**, said rather than implied: the connected state is set
 * by hand (a real one needs a TLS handshake with a phone), and the renderer's route hook in
 * `renderer.ts` — which only asks for a code when none is drawn — is reached by no test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userData = mkdtempSync(join(tmpdir(), 'pairing-arm-'));
const storeWrites: Array<[string, unknown]> = [];
const storeData = new Map<string, unknown>();

// Electron and electron-store are stubbed before link.ts is loaded, which is why it is `require`d
// below rather than imported: an import would be hoisted above this hook.
const moduleWithLoad = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = moduleWithLoad._load;
moduleWithLoad._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, isPackaged: false, getName: () => 'test' }, safeStorage: {} };
  }
  if (request === 'electron-store') {
    return class {
      constructor(opts?: { defaults?: Record<string, unknown> }) {
        for (const [k, v] of Object.entries(opts?.defaults ?? {})) storeData.set(k, v);
      }
      get(key: string) { return storeData.get(key); }
      set(key: string, value: unknown) { storeWrites.push([key, value]); storeData.set(key, value); }
    };
  }
  return realLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LinkClient } = require('./link') as typeof import('./link');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { armPairingCode } = require('./pairingArm') as typeof import('./pairingArm');

const PAIRED = { deviceId: 'phone-1', deviceName: 'Galaxy', fingerprint: 'AA:BB', pairedAt: 1 };
const IDENTITY = { certPem: 'CERT', keyPem: 'KEY', fingerprint: '11:22:33', deviceName: 'Mac' };

interface Internals {
  running: boolean;
  phase: string;
  socket: unknown;
  attempt: () => Promise<void>;
  teardown: (reason: string) => void;
  stop: (reason?: string) => void;
}

/** A client in the state a live session leaves it in, with every way out of that state counted. */
function connectedClient() {
  storeData.set('paired', PAIRED);
  storeWrites.length = 0;
  const identity = { ...IDENTITY };
  const client = new LinkClient(identity);
  const inner = client as unknown as Internals;
  const calls = { attempt: 0, teardown: 0, stop: 0, destroy: 0, end: 0 };
  inner.running = true;
  inner.phase = 'connected';
  inner.socket = { destroy: () => { calls.destroy++; }, end: () => { calls.end++; }, write: () => true,
    removeAllListeners: () => undefined, on: () => undefined, once: () => undefined };
  inner.attempt = async () => { calls.attempt++; };
  const realTeardown = inner.teardown.bind(client);
  inner.teardown = (reason) => { calls.teardown++; realTeardown(reason); };
  const realStop = inner.stop.bind(client);
  inner.stop = (reason) => { calls.stop++; realStop(reason); };
  return { client, inner, calls, identity };
}

test('opening the pairing screen while connected leaves the session up', () => {
  const { client, inner, calls } = connectedClient();
  armPairingCode(client, '192.168.1.5', false);
  assert.equal(client.isConnected(), true);
  assert.equal(inner.running, true);
  assert.notEqual(inner.socket, null);
  assert.deepEqual(calls, { attempt: 0, teardown: 0, stop: 0, destroy: 0, end: 0 });
});

test('opening the pairing screen while connected keeps the pairing', () => {
  const { client } = connectedClient();
  armPairingCode(client, '192.168.1.5', false);
  assert.deepEqual(storeData.get('paired'), PAIRED);
  assert.deepEqual(storeWrites, [], 'the pairing screen wrote to the settings store');
  assert.equal(client.status().paired, true);
});

test('re-opening the pairing screen keeps the code already on screen', () => {
  const { client } = connectedClient();
  const first = armPairingCode(client, '192.168.1.5', false);
  const second = armPairingCode(client, '192.168.1.5', false);
  assert.equal(second.secret, first.secret);
  assert.equal(client.isPairingArmed(), true);
});

test('only an explicit new code rotates the token', () => {
  // The control for the test above: the token *can* change, so "unchanged" is a reading.
  const { client } = connectedClient();
  const first = armPairingCode(client, '192.168.1.5', false);
  const rotated = armPairingCode(client, '192.168.1.5', true);
  assert.notEqual(rotated.secret, first.secret);
  assert.equal(client.isConnected(), true, 'a rotation must not end the session either');
});

test('the code carries the same TLS identity, and arming does not change it', () => {
  const { client, identity } = connectedClient();
  const payload = armPairingCode(client, '192.168.1.5', false);
  armPairingCode(client, '192.168.1.5', true);
  assert.equal(payload.fp, IDENTITY.fingerprint);
  assert.equal(payload.name, IDENTITY.deviceName);
  assert.deepEqual(identity, IDENTITY);
});

test('control: a stopped client is started, so the checks above can see a start', () => {
  const { client, inner, calls } = connectedClient();
  inner.running = false;
  inner.phase = 'idle';
  armPairingCode(client, '192.168.1.5', false);
  assert.ok(calls.attempt >= 1, `no dial attempt from a stopped client (${calls.attempt})`);
});
