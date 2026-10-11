/*
 * The link's beta-trial gate (2026-10-12): a refusing gate stops the client before a single candidate
 * is tried, an allowing gate lets discovery run, and a running session is never asked. Electron and
 * electron-store are stubbed as in `linkSessionEnded.test.ts`; discovery is a counting stand-in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userData = mkdtempSync(join(tmpdir(), 'link-trial-gate-'));
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

const ID = { certPem: 'CERT', keyPem: 'KEY', fingerprint: '11:22:33', deviceName: 'Mac' };

function client(allowed: boolean) {
  let tried = 0;
  let asked = 0;
  const c = new LinkClient(ID, () => false, () => ({}), {
    candidates: async function* () { tried += 1; },
    gate: () => { asked += 1; return { allowed, reason: allowed ? 'ok' : 'Beta access ended on 29 Nov 2026.' }; },
  });
  return { c, tried: () => tried, asked: () => asked };
}

const settle = () => new Promise((r) => setImmediate(r));

test('a refusing gate: no candidate is tried, the client stops, and the phase is idle', async () => {
  const k = client(false);
  k.c.start();
  await settle();
  assert.equal(k.asked(), 1);
  assert.equal(k.tried(), 0, 'nothing was searched for');
  assert.equal(k.c.status().phase, 'idle');
  assert.equal((k.c as unknown as { running: boolean }).running, false, 'stopped, not retrying on a timer');
  k.c.stop();
});

test('control: an allowing gate lets discovery run', async () => {
  const k = client(true);
  k.c.start();
  await settle();
  assert.equal(k.asked(), 1);
  assert.equal(k.tried(), 1);
  k.c.stop();
});

test('a connected session is never asked — expiry waits for the next connect', async () => {
  const k = client(false);
  const inner = k.c as unknown as { running: boolean; phase: string; attempt: () => Promise<void> };
  inner.running = true;
  inner.phase = 'connected';
  await inner.attempt();
  assert.equal(k.asked(), 0);
  assert.equal(k.c.status().phase, 'connected');
});
