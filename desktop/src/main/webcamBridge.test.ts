import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeProcess, BRIDGE_AU_BOUND, resolveBridgeExecutable, type BridgeExit } from './webcamBridge';
import { WebcamController, type WebcamStatus } from './webcam';
import { StatusRecordReader, accessUnitRecord, controlRecord, type BridgeStatus } from '../shared/webcamBridgeRecords';
import { SESSION, TOKEN, goldenAU, makeAU } from './webcam.testkit';

/**
 * Electron main ↔ the bridge, with real child processes.
 *
 * - **REAL:** `sidekick-camera-bridge` as built by `swift build` in `desktop/native/SidekickCamera`. On
 *   this Mac it finds no Sidekick Camera (nothing is activated) and carries no Team ID, and these tests
 *   hold main to that. Its absence is a **failure**, not a skip: a skipped integration test is a green
 *   that measured nothing.
 * - **STAND-IN:** small `node` scripts written to a temporary directory, for what the real bridge
 *   cannot be made to do on demand — print garbage, crash, never say ready, ignore SIGTERM, or report a
 *   device and a producer identity this Mac does not have (**INJECTED**). None of them is evidence about
 *   the bridge; they are evidence about main's handling of a child that behaves that way.
 *
 * Every test has a hard timeout, and the last one checks every child spawned here is gone.
 */

const BRIDGE = join(__dirname, '../../native/SidekickCamera/.build/debug/sidekick-camera-bridge');
const T = { timeout: 15_000 };
const pids: number[] = [];
/** Every child, so a regression that fails to reap one cannot leave it running after the suite. */
const live: Array<{ kill(): void }> = [];
const scratch = mkdtempSync(join(tmpdir(), 'webcam-bridge-test-'));
after(() => {
  // Only children whose exit has not been seen: an unreaped pid cannot have been reused, so this can
  // only ever signal a process these tests started. The 'no orphan' test still reports the failure.
  for (const c of live) c.kill();
  rmSync(scratch, { recursive: true, force: true });
});

function track(child: ChildProcess): ChildProcess {
  live.push({ kill: () => (child.exitCode === null && child.signalCode === null ? void child.kill('SIGKILL') : undefined) });
  if (child.pid !== undefined) pids.push(child.pid);
  return child;
}

function trackBridge(b: BridgeProcess): BridgeProcess {
  live.push({ kill: () => (!b.exited && b.pid !== null ? void process.kill(b.pid, 'SIGKILL') : undefined) });
  if (b.pid !== null) pids.push(b.pid);
  return b;
}

function requireBridge(): void {
  assert.ok(existsSync(BRIDGE), `the bridge is not built: run \`swift build\` in desktop/native/SidekickCamera (${BRIDGE})`);
}

async function waitFor(what: string, predicate: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Run {
  bridge: BridgeProcess;
  statuses: BridgeStatus[];
  logs: string[];
  exit: BridgeExit | null;
}

function run(executable: string, args: string[] = [], extra: Partial<ConstructorParameters<typeof BridgeProcess>[0]> = {}): Run {
  const r: Run = { bridge: null as unknown as BridgeProcess, statuses: [], logs: [], exit: null };
  r.bridge = new BridgeProcess({
    executable,
    args,
    onStatus: (s) => r.statuses.push(s),
    onExit: (e) => (r.exit = e),
    log: { info: (m) => r.logs.push(`I ${m}`), warn: (m) => r.logs.push(`W ${m}`) },
    ...extra,
  });
  trackBridge(r.bridge);
  return r;
}

/** A STAND-IN child: a node script whose behaviour is named by [mode]. */
function standIn(mode: string): string[] {
  const path = join(scratch, `stand-in-${mode}.js`);
  writeFileSync(
    path,
    `const out = (o) => { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(5); h.writeUInt32BE(b.length + 1); h[4] = 0x81; process.stdout.write(Buffer.concat([h, b])); };
     const mode = ${JSON.stringify(mode)};
     const keep = setInterval(() => {}, 1000);
     if (mode === 'garbage') { out({ op: 'ready', device: 'not-installed', producerIdentity: 'unconfigured' }); process.stdout.write('Hello from a stray print\\n'); }
     if (mode === 'crash') { out({ op: 'ready', device: 'not-installed', producerIdentity: 'unconfigured' }); setTimeout(() => process.exit(134), 50); }
     if (mode === 'silent') { }
     if (mode === 'ignore-term') { process.on('SIGTERM', () => {}); out({ op: 'ready', device: 'not-installed', producerIdentity: 'unconfigured' }); }
     if (mode === 'injected-device') {
       // INJECTED: a device and a producer identity this Mac does not have, and one consumer.
       out({ op: 'ready', device: 'installed', producerIdentity: 'configured' });
       out({ op: 'consumers', count: 1 });
       let buf = Buffer.alloc(0);
       process.stdin.on('data', (c) => {
         buf = Buffer.concat([buf, c]);
         while (buf.length >= 5 && buf.length >= 4 + buf.readUInt32BE(0)) {
           const type = buf[4]; buf = buf.subarray(4 + buf.readUInt32BE(0));
           if (type === 0x02) process.stdout.write('\\u0000\\u0000\\u0000\\u0002\\u0099!'); // malformed: type 0x99
         }
       });
     }`,
  );
  return [path];
}

// ---- the real bridge ------------------------------------------------------------------------------

test('REAL bridge: ready is the first record — no device on this Mac, no producer identity — then the count; Stop reaps it', T, async () => {
  requireBridge();
  const r = run(BRIDGE);
  await waitFor('two status records', () => r.statuses.length >= 2);
  assert.deepEqual(r.statuses[0], { op: 'ready', deviceInstalled: false, producerIdentityConfigured: false });
  assert.deepEqual(r.statuses[1], { op: 'consumers', count: 0 });
  const exit = await r.bridge.stop();
  assert.deepEqual({ code: exit.code, signal: exit.signal, requested: exit.requested, cause: exit.cause }, { code: 0, signal: null, requested: true, cause: 'stopped' });
  assert.equal(r.statuses.at(-1)?.op, 'counts', 'the final counts record on the way out');
  assert.ok(r.logs.some((l) => l.includes('camera bridge says: [camera-bridge] started; Sidekick Camera device not installed')), 'stderr reached the log as diagnostics');
  assert.equal(r.logs.some((l) => l.includes('SIGTERM') || l.includes('SIGKILL')), false, 'it left when asked');
});

test('REAL bridge: records split into single bytes, then coalesced into one write, framed by main', T, async () => {
  requireBridge();
  const child = track(spawn(BRIDGE, [], { stdio: ['pipe', 'pipe', 'pipe'] }));
  const reader = new StatusRecordReader();
  const statuses: BridgeStatus[] = [];
  child.stdout.on('data', (c: Buffer) => statuses.push(...reader.push(c)));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  await waitFor('ready', () => statuses.length >= 2);

  // One byte at a time, each in its own write.
  const live = controlRecord({ op: 'session-live', sessionId: SESSION, generation: 7 });
  for (const b of live) {
    child.stdin.write(Buffer.from([b]));
    await new Promise((r) => setImmediate(r));
  }
  await waitFor('the bridge ending the session for no consumers', () => statuses.some((s) => s.op === 'session-ended'));
  assert.deepEqual(statuses.find((s) => s.op === 'session-ended'), { op: 'session-ended', sessionId: SESSION, reason: 'no-consumers' });

  // Three records in one write: the golden AU, a session-ended, a shutdown.
  child.stdin.write(Buffer.concat([
    accessUnitRecord(SESSION, goldenAU()),
    controlRecord({ op: 'session-ended', sessionId: SESSION, reason: 'stopped-by-mac' }),
    controlRecord({ op: 'shutdown' }),
  ]));
  assert.equal(await exited, 0);
  const counts = (statuses.filter((s) => s.op === 'counts').at(-1) as { counts: Record<string, number> } | undefined)?.counts;
  assert.equal(counts?.received, 1, 'the AU arrived whole');
  assert.equal(counts?.['gate.endedSession'], 1, 'and was refused as an ended session');
  assert.equal(counts?.sinkEnqueued, 0);
});

test('REAL bridge: malformed input is reported and the bridge exits 2', T, async () => {
  requireBridge();
  const cases: Array<[string, Buffer]> = [
    ['a length over the cap', Buffer.from([0x7f, 0xff, 0xff, 0xff, 0x02])],
    ['an unknown record type', Buffer.from([0, 0, 0, 1, 0x09])],
    ['a status record sent to it', Buffer.from([0, 0, 0, 3, 0x81, 0x7b, 0x7d])],
    ['a control record that is not JSON', Buffer.from([0, 0, 0, 3, 0x01, 0x68, 0x69])],
  ];
  for (const [name, bytes] of cases) {
    const child = track(spawn(BRIDGE, [], { stdio: ['pipe', 'pipe', 'pipe'] }));
    const reader = new StatusRecordReader();
    const statuses: BridgeStatus[] = [];
    child.stdout.on('data', (c: Buffer) => statuses.push(...reader.push(c)));
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    child.stdin.write(bytes);
    assert.equal(await exited, 2, name);
    assert.ok(statuses.some((s) => s.op === 'error' && s.error.startsWith('malformed-record')), name);
  }
});

test('REAL bridge: its stdin closing — Electron main gone — ends it with no orphan', T, async () => {
  requireBridge();
  const child = track(spawn(BRIDGE, [], { stdio: ['pipe', 'pipe', 'ignore'] }));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  child.stdout.resume();
  child.stdin.end();
  assert.equal(await exited, 0);
});

test('REAL bridge, hung (SIGSTOP): AUs stay bounded at 4 with the keyframe rule, and Stop escalates past the ignored shutdown and reaps it', T, async () => {
  requireBridge();
  const r = run(BRIDGE, [], { gracefulMs: 300, termMs: 300 });
  await waitFor('ready', () => r.statuses.length >= 1);
  process.kill(r.bridge.pid!, 'SIGSTOP');
  const sent = 30;
  for (let i = 1; i <= sent; i++) r.bridge.sendAccessUnit(SESSION, makeAU({ sequence: i, keyframe: i === 1, size: 128 * 1024 }), i === 1);
  const c = r.bridge.counts();
  assert.ok(c.maxPending <= BRIDGE_AU_BOUND, `at most ${BRIDGE_AU_BOUND} pending, saw ${c.maxPending}`);
  assert.equal(c.maxPending, BRIDGE_AU_BOUND, 'the bound was reached — the pipe really was full');
  assert.equal(c.forwarded + c.droppedBridge + (BRIDGE_AU_BOUND - 1), sent, 'every AU accounted for: written, dropped, or still queued');
  const exit = await r.bridge.stop();
  // Reading, 2026-10-04: on Darwin a SIGSTOPped process takes SIGTERM's default action (it dies) rather
  // than holding it pending, so this run ends at the first escalation. The SIGKILL step is held to its
  // job by the ignore-term stand-in below.
  assert.equal(exit.signal, 'SIGTERM');
  assert.equal(exit.requested, true);
  assert.ok(r.logs.some((l) => l.includes('still running 300 ms after shutdown; SIGTERM')), 'the escalation is logged with its bound');
});

test('REAL bridge under the controller: no device, no identity — nothing asked of the phone, and quit reaps it', T, async () => {
  requireBridge();
  const sent: string[] = [];
  const states: WebcamStatus[] = [];
  const controller = new WebcamController({
    link: {
      isConnected: () => true,
      token: () => TOKEN,
      address: () => '10.0.0.2',
      capabilities: () => ['webcam'],
      unavailableReason: () => null,
      negotiated: () => ({ webcam: 1 }),
      request: async (type) => {
        sent.push(type);
        return { payload: {} };
      },
    },
    openSocket: () => {
      throw new Error('no socket may open');
    },
    startBridge: (hooks) => {
      const b = trackBridge(new BridgeProcess({ executable: BRIDGE, ...hooks, log: { info: () => undefined, warn: () => undefined } }));
      return b;
    },
    emitState: (s) => states.push(s),
    log: { info: () => undefined, warn: () => undefined },
  });
  controller.start();
  await waitFor('the bridge ready', () => controller.current().device !== 'unknown');
  const now = controller.current();
  assert.equal(now.bridge, 'running');
  assert.equal(now.device, 'not-installed');
  assert.equal(now.producer, 'unconfigured');
  assert.equal(now.consumers, 0);
  assert.match(now.blocker ?? '', /not installed on this Mac/);
  const asked = await controller.askPhone('front');
  assert.equal(asked.ok, false);
  assert.deepEqual(sent, [], 'a bridge process existing is not a reason to ask the phone anything');
  await controller.lifecycle('quit');
  assert.equal(controller.current().bridge, 'stopped');
});

// ---- stand-ins ------------------------------------------------------------------------------------

test('STAND-IN: malformed bridge output fails the bridge and it is killed', T, async () => {
  const r = run(process.execPath, standIn('garbage'));
  await waitFor('exit', () => r.exit !== null);
  assert.equal(r.exit!.cause, 'malformed-output');
  assert.equal(r.exit!.requested, false);
  assert.ok(r.statuses.length <= 1, 'nothing after the garbage is delivered');
});

test('STAND-IN: a bridge crash is reported as an unrequested exit with its code', T, async () => {
  const r = run(process.execPath, standIn('crash'));
  await waitFor('exit', () => r.exit !== null);
  assert.deepEqual({ code: r.exit!.code, requested: r.exit!.requested, cause: r.exit!.cause }, { code: 134, requested: false, cause: 'exited' });
});

test('STAND-IN: a bridge that never says ready is stopped as failed', T, async () => {
  const r = run(process.execPath, standIn('silent'), { readyTimeoutMs: 200 });
  await waitFor('exit', () => r.exit !== null);
  assert.equal(r.exit!.cause, 'no-ready');
});

test('STAND-IN: a bridge ignoring SIGTERM is SIGKILLed and reaped', T, async () => {
  const r = run(process.execPath, standIn('ignore-term'), { gracefulMs: 200, termMs: 200 });
  await waitFor('ready', () => r.statuses.length >= 1);
  const exit = await r.bridge.stop();
  assert.equal(exit.signal, 'SIGKILL');
  assert.ok(r.logs.some((l) => l.includes('ignored SIGTERM for 200 ms; SIGKILL')));
});

test('a bridge that cannot be spawned fails cleanly, and Stop still resolves', T, async () => {
  const r = run(join(scratch, 'no-such-bridge'));
  await waitFor('exit', () => r.exit !== null);
  assert.match(r.exit!.cause, /^spawn-failed: ENOENT/);
  const again = await r.bridge.stop();
  assert.equal(again, r.exit);
  assert.equal(r.bridge.sendAccessUnit(SESSION, goldenAU(), true), false);
});

test('STAND-IN under the controller (INJECTED device and identity): malformed output mid-session stops the phone', T, async () => {
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const sockets: Array<{ feed?: (b: Buffer) => void; destroyed: boolean }> = [];
  const controller = new WebcamController({
    link: {
      isConnected: () => true,
      token: () => TOKEN,
      address: () => '10.0.0.2',
      capabilities: () => ['webcam'],
      unavailableReason: () => null,
      negotiated: () => ({ webcam: 1 }),
      request: async (type, payload) => {
        sent.push({ type, payload });
        return type === 'webcam.request' ? { payload: { sessionId: SESSION, expiresInMs: 30_000 } } : { payload: { stopped: true } };
      },
    },
    openSocket: () => {
      const s: { feed?: (b: Buffer) => void; destroyed: boolean } = { destroyed: false };
      sockets.push(s);
      return { onData: (l) => (s.feed = l), onClose: () => undefined, destroy: () => (s.destroyed = true) };
    },
    startBridge: (hooks) => {
      return trackBridge(new BridgeProcess({ executable: process.execPath, args: standIn('injected-device'), ...hooks, log: { info: () => undefined, warn: () => undefined } }));
    },
    emitState: () => undefined,
    log: { info: () => undefined, warn: () => undefined },
  });
  controller.start();
  await waitFor('the automatic request', () => sent.some((s) => s.type === 'webcam.request'));
  await waitFor('awaiting approval', () => controller.current().session?.phase === 'awaiting-approval');
  controller.onState({ sessionId: SESSION, state: 'starting' });
  controller.onState({ sessionId: SESSION, state: 'running', generation: 7 });
  sockets[0]!.feed!(goldenAU());
  await waitFor('the session ended', () => controller.current().session === null);
  assert.equal(controller.current().lastEnded?.reason, 'bridge-failed');
  assert.equal(controller.current().bridge, 'failed');
  assert.deepEqual(sent.at(-1), { type: 'webcam.stop', payload: { sessionId: SESSION, cause: 'failure', detail: 'bridge-failed' } });
  assert.equal(sockets[0]!.destroyed, true);
});

// ---- the path ------------------------------------------------------------------------------------

test('the bridge path: one location per build kind, a real executable file, no symlink, no fallback', T, () => {
  const app = join(scratch, 'app');
  const release = join(app, 'native', 'SidekickCamera', '.build', 'release');
  const debug = join(app, 'native', 'SidekickCamera', '.build', 'debug');
  mkdirSync(debug, { recursive: true });
  writeFileSync(join(debug, 'sidekick-camera-bridge'), '#!/bin/sh\n');
  chmodSync(join(debug, 'sidekick-camera-bridge'), 0o755);
  const unpackaged = { packaged: false, appPath: app, execPath: '/irrelevant' };
  assert.equal(resolveBridgeExecutable(unpackaged).path, null, 'a debug build is not a fallback');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'sidekick-camera-bridge'), '#!/bin/sh\n');
  chmodSync(join(release, 'sidekick-camera-bridge'), 0o644);
  assert.match((resolveBridgeExecutable(unpackaged) as { reason: string }).reason, /not executable/);
  chmodSync(join(release, 'sidekick-camera-bridge'), 0o755);
  assert.equal(resolveBridgeExecutable(unpackaged).path, join(release, 'sidekick-camera-bridge'));

  const macos = join(scratch, 'Sidekick.app', 'Contents', 'MacOS');
  mkdirSync(macos, { recursive: true });
  const packaged = { packaged: true, appPath: '/irrelevant', execPath: join(macos, 'Sidekick') };
  assert.equal(resolveBridgeExecutable(packaged).path, null);
  symlinkSync('/bin/sleep', join(macos, 'sidekick-camera-bridge'));
  assert.match((resolveBridgeExecutable(packaged) as { reason: string }).reason, /symbolic link/);
  rmSync(join(macos, 'sidekick-camera-bridge'));
  writeFileSync(join(macos, 'sidekick-camera-bridge'), '#!/bin/sh\n');
  chmodSync(join(macos, 'sidekick-camera-bridge'), 0o755);
  assert.equal(resolveBridgeExecutable(packaged).path, join(macos, 'sidekick-camera-bridge'));
});

// ---- last -----------------------------------------------------------------------------------------

test('no orphan: every child these tests spawned is gone', T, async () => {
  assert.ok(pids.length >= 10, `positive control: children were spawned (${pids.length})`);
  for (const pid of pids) {
    await waitFor(`pid ${pid} gone`, () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH';
      }
    }, 3_000);
  }
});
