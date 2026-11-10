/*
 * What the Mac says when no address answers (2026-11-10) — against real sockets, because the fact
 * under test is which socket event fires when: a listener that accepts TCP and never speaks TLS, and
 * a port nothing listens on. Electron and electron-store are stubbed as in `linkTrialGate.test.ts`.
 *
 * Not reached from here: a real phone, macOS's Local Network block (EHOSTUNREACH is exercised as a
 * code in `shared/reachDiagnosis.test.ts`, never produced), and a network that isolates clients.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userData = mkdtempSync(join(tmpdir(), 'link-reach-'));
const storeData = new Map<string, unknown>();
const moduleWithLoad = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = moduleWithLoad._load;
moduleWithLoad._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') return { app: { getPath: () => userData, isPackaged: false, getName: () => 'test' }, safeStorage: {} };
  if (request === 'electron-store') {
    return class {
      constructor(opts?: { defaults?: Record<string, unknown> }) {
        for (const [k, v] of Object.entries(opts?.defaults ?? {})) storeData.set(k, v);
      }
      get(key: string) { return storeData.get(key); }
      set(key: string, value: unknown) { storeData.set(key, value); }
    };
  }
  return realLoad.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LinkClient } = require('./link') as typeof import('./link');

// No client certificate: neither server here ever gets as far as asking for one.
const ID = { certPem: '', keyPem: '', fingerprint: '11:22:33', deviceName: 'Mac' };

type Tried = { host: string; port: number; via: 'manual' | 'gateway' | 'last-known' };

async function oneRound(candidates: Tried[]): Promise<{ lastError?: string; lastFailureKind?: string }> {
  const c = new LinkClient(ID as never, () => false, () => ({}), {
    candidates: async function* () { yield* candidates; },
    handshakeTimeoutMs: 200,
  });
  const inner = c as unknown as { running: boolean; attempt: () => Promise<void> };
  inner.running = true;
  await inner.attempt();
  const status = c.status();
  c.stop();
  return status;
}

/** Accepts TCP and never sends a byte: the address is right and the handshake never finishes. */
interface Mute { port: number; accepted: () => number; close: () => Promise<void> }

function muteListener(): Promise<Mute> {
  return new Promise((resolve) => {
    const sockets: Socket[] = [];
    const server: Server = createServer((socket) => { sockets.push(socket); socket.on('error', () => undefined); });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        accepted: () => sockets.length,
        // Connections first: `close` waits for every open one, and these never close themselves.
        close: () => new Promise<void>((done) => { sockets.forEach((socket) => socket.destroy()); server.close(() => done()); }),
      });
    });
  });
}

/** A port that was just free, so nothing is listening on it. */
async function closedPort(): Promise<number> {
  const mute = await muteListener();
  await mute.close();
  return mute.port;
}

test('TCP connects and the handshake never finishes: the Mac says it reached the phone', async () => {
  const mute = await muteListener();
  try {
    const status = await oneRound([{ host: '127.0.0.1', port: mute.port, via: 'manual' }]);
    assert.equal(mute.accepted(), 1, 'control: the listener really accepted this connection');
    assert.equal(status.lastFailureKind, 'unreachable', 'the kind every other surface reads is unchanged');
    assert.match(status.lastError ?? '', /reached the phone at 127\.0\.0\.1/);
    assert.doesNotMatch(status.lastError ?? '', /different networks/);
  } finally {
    await mute.close();
  }
});

test('nothing listening on the port: the Mac says a device answered and Sidekick is not listening', async () => {
  const status = await oneRound([{ host: '127.0.0.1', port: await closedPort(), via: 'gateway' }]);
  assert.equal(status.lastFailureKind, 'unreachable');
  assert.match(status.lastError ?? '', /Sidekick is not listening there/);
});

test('the address as the phone displays it, untreated, is named as a bad address', async () => {
  // What discovery handed over before `parsePhoneAddress`: the port still inside the host.
  const status = await oneRound([{ host: '10.35.99.249:42501', port: 42501, via: 'manual' }]);
  assert.match(status.lastError ?? '', /“10\.35\.99\.249:42501” is not an address/);
});

test('the per-address reason survives the end of the round', async () => {
  // Two addresses, two different failures. The round used to end by overwriting both with one line.
  const mute = await muteListener();
  try {
    const status = await oneRound([
      { host: '127.0.0.1', port: await closedPort(), via: 'last-known' },
      { host: '127.0.0.1', port: mute.port, via: 'gateway' },
    ]);
    assert.match(status.lastError ?? '', /reached the phone/, 'the attempt that got furthest decides');
  } finally {
    await mute.close();
  }
});

test('no address to try at all is said as that', async () => {
  const status = await oneRound([]);
  assert.match(status.lastError ?? '', /no address to try/);
});
