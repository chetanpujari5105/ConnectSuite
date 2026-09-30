/*
 * Defect 157, the Mac's half of the wiring: the real `LinkClient` says which session ended.
 *
 * A bulk pull claims its socket with the session token, and nothing on the Mac stopped it when that
 * session ended — so after a user Disconnect the pull ran on until the file was whole and then waited
 * 30 s for a verdict the dead control channel could never carry (L1/L2 T3, 2026-09-30).
 * `FilesClient.pull` listens for `SESSION_ENDED_EVENT`; this proves the real `teardown` emits it, with
 * the ending session's token, exactly once per session. Electron and electron-store are stubbed as in
 * `pairingArm.test.ts`; the connected state is set by hand (a real one needs a TLS handshake).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SESSION_ENDED_EVENT, type SessionEnded } from '../shared/session';

const userData = mkdtempSync(join(tmpdir(), 'link-session-ended-'));
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

interface Internals {
  running: boolean;
  phase: string;
  socket: unknown;
  session: { sessionToken: string | null };
  attempt: () => Promise<void>;
  teardown: (reason: string) => void;
}

function connected(token: string | null) {
  storeData.set('paired', { deviceId: 'phone-1', deviceName: 'Galaxy', fingerprint: 'AA:BB', pairedAt: 1 });
  const client = new LinkClient({ certPem: 'CERT', keyPem: 'KEY', fingerprint: '11:22:33', deviceName: 'Mac' });
  const inner = client as unknown as Internals;
  inner.running = true;
  inner.phase = token ? 'connected' : 'idle';
  inner.session.sessionToken = token;
  inner.socket = { destroy: () => undefined, end: () => undefined, write: () => true, removeAllListeners: () => undefined, on: () => undefined, once: () => undefined };
  inner.attempt = async () => undefined; // no reconnect attempt in a unit test
  const ended: SessionEnded[] = [];
  client.on(SESSION_ENDED_EVENT, (e: SessionEnded) => ended.push(e));
  return { client, inner, ended };
}

test('157: a user Disconnect ends the session and names its token, once', () => {
  const { client, ended } = connected('tok-A');
  client.stop('user disconnected');
  assert.deepEqual(ended, [{ token: 'tok-A', reason: 'user disconnected' }]);
  client.stop('user disconnected');
  assert.equal(ended.length, 1, 'a second stop has no session left to end');
});

test('157: the phone closing the connection ends the session the same way', () => {
  const { inner, ended } = connected('tok-B');
  inner.teardown('phone closed the connection');
  assert.deepEqual(ended, [{ token: 'tok-B', reason: 'phone closed the connection' }]);
});

test('157: with no session up, nothing is said to have ended', () => {
  const { client, ended } = connected(null);
  client.stop('user disconnected');
  assert.deepEqual(ended, []);
});
