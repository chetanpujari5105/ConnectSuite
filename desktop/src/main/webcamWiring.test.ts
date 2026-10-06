import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planWebcam, wireWebcam, WEBCAM_IPC, WEBCAM_POWER_EVENTS, type WebcamPlan, type WebcamWiring } from './webcamWiring';
import type { WebcamStatus } from './webcam';
import { SESSION, SESSION_2, SESSION_3, StandInSocket, TOKEN, deferred, goldenAU, makeAU } from './webcam.testkit';
import { webcamClaim } from '../shared/webcamWire';

/**
 * Camera v2's Mac wiring, end to end through **the production factory** `wireWebcam` — the function
 * `main.ts` calls — with these boundaries:
 *
 * - **REAL:** the controller, `BridgeProcess`, the record codecs, and `sidekick-camera-bridge` as built by
 *   `swift build` (copied into a temporary app directory so `planWebcam` resolves it at its one dev path).
 *   On this Mac the real bridge finds no Sidekick Camera and carries no Team ID, and the phone is asked
 *   nothing — the first tests hold the wiring to that.
 * - **STAND-IN (labelled):** the phone (`LinkClient`'s events and acks), the 42502 socket, `ipcMain`,
 *   `powerMonitor`. And an **INJECTED bridge** — a `node` child speaking the real record framing that
 *   reports Sidekick Camera installed, a producer identity configured, and a consumer count the test moves
 *   with signals (SIGUSR1 = an app starts Sidekick Camera, SIGUSR2 = the last one stops, SIGHUP = the
 *   bridge rejects the live session's stream). This Mac has none of those; the child is evidence about
 *   the wiring's handling of a bridge that reports them, never about CoreMediaIO.
 *
 * Every child spawned is tracked; the last test proves each one is gone.
 */

const T = { timeout: 20_000 };
const BUILT = join(__dirname, '../../native/SidekickCamera/.build/debug/sidekick-camera-bridge');
const scratch = mkdtempSync(join(tmpdir(), 'webcam-wiring-test-'));
const pids = new Set<number>();
const wirings: WebcamWiring[] = [];
after(async () => {
  for (const w of wirings) await w.dispose().catch(() => undefined);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone, as it should be */
    }
  }
  rmSync(scratch, { recursive: true, force: true });
});

async function waitFor(what: string, predicate: () => boolean, ms = 6_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A temporary unpackaged app directory with the REAL built bridge at the dev path `planWebcam` resolves. */
function appWithRealBridge(): string {
  assert.ok(existsSync(BUILT), `the bridge is not built: run \`swift build\` in desktop/native/SidekickCamera (${BUILT})`);
  const app = mkdtempSync(join(scratch, 'app-'));
  const dir = join(app, 'native', 'SidekickCamera', '.build', 'release');
  mkdirSync(dir, { recursive: true });
  copyFileSync(BUILT, join(dir, 'sidekick-camera-bridge'));
  chmodSync(join(dir, 'sidekick-camera-bridge'), 0o755);
  return app;
}

/** INJECTED bridge: the real framing, a device and identity this Mac does not have, signal-driven consumers. */
function injectedBridge(): string[] {
  const path = join(scratch, 'injected-bridge.js');
  writeFileSync(
    path,
    `const out = (o) => { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(5); h.writeUInt32BE(b.length + 1); h[4] = 0x81; process.stdout.write(Buffer.concat([h, b])); };
     const note = (s) => process.stderr.write(s + '\\n');
     let live = null;
     setInterval(() => {}, 1000);
     process.on('SIGUSR1', () => out({ op: 'consumers', count: 1 }));
     process.on('SIGUSR2', () => { out({ op: 'consumers', count: 0 }); if (live) { out({ op: 'session-ended', sessionId: live, reason: 'no-consumers' }); live = null; } });
     process.on('SIGHUP', () => { if (live) { out({ op: 'stream-rejected', sessionId: live, generation: 1, violation: 'generation-without-keyframe' }); note('rejected ' + live.slice(0, 8)); live = null; } });
     out({ op: 'ready', device: 'installed', producerIdentity: 'configured' });
     out({ op: 'consumers', count: 0 });
     let buf = Buffer.alloc(0);
     process.stdin.on('data', (c) => {
       buf = Buffer.concat([buf, c]);
       while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
         const len = buf.readUInt32BE(0); const type = buf[4]; const body = buf.subarray(5, 4 + len); buf = buf.subarray(4 + len);
         if (type === 0x01) {
           const m = JSON.parse(body.toString());
           if (m.op === 'session-live') { live = m.sessionId; note('session-live ' + m.sessionId.slice(0, 8) + ' g' + m.generation); }
           if (m.op === 'session-ended') { if (live === m.sessionId) live = null; note('session-ended ' + m.sessionId.slice(0, 8) + ' ' + m.reason); }
           if (m.op === 'shutdown') { note('shutdown'); process.exit(0); }
         } else if (type === 0x02) note('au ' + body.subarray(0, 16).toString('hex').slice(0, 8) + ' ' + (body.length - 16));
       }
     });
     process.stdin.on('end', () => { note('stdin closed'); process.exit(0); });`,
  );
  return [path];
}

/** STAND-IN for the phone as `LinkClient` presents it. */
class StandInLink extends EventEmitter {
  connected = true;
  tokenValue: string | null = TOKEN;
  capabilities: string[] = ['camera', 'webcam'];
  unavailable: Array<{ name: string; reason: string }> = [];
  negotiatedExt: Record<string, number> = { webcam: 1 };
  sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  sessionIds = [SESSION, SESSION_2, SESSION_3];
  /** Replace to hold or refuse an ack. */
  answer: (type: string, payload: Record<string, unknown>) => Promise<{ payload?: unknown }> = async (type) => {
    if (type === 'webcam.request') return { payload: { state: 'awaiting-approval', sessionId: this.sessionIds.shift(), facing: 'front', expiresInMs: 30_000 } };
    return { payload: { stopped: true } };
  };
  isConnected() {
    return this.connected;
  }
  token() {
    return this.connected ? this.tokenValue : null;
  }
  status() {
    return { address: '10.0.0.2', capabilities: this.capabilities, unavailable: this.unavailable };
  }
  negotiated() {
    return this.negotiatedExt;
  }
  request(type: string, payload: Record<string, unknown>) {
    this.sent.push({ type, payload });
    return this.answer(type, payload);
  }
  phone(state: Record<string, unknown>) {
    this.emit('message', { type: 'webcam.state', payload: state });
  }
  requests(type: string) {
    return this.sent.filter((s) => s.type === type);
  }
}

interface Rig {
  wiring: WebcamWiring;
  link: StandInLink;
  power: EventEmitter;
  ipc: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  states: WebcamStatus[];
  sockets: StandInSocket[];
  events: string[];
  bridgeLog: string[];
  pid(): number;
  signal(sig: NodeJS.Signals): void;
}

function rig(plan: WebcamPlan, opts: { injected?: boolean } = {}): Rig {
  const link = new StandInLink();
  const power = new EventEmitter();
  const ipc = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const states: WebcamStatus[] = [];
  const sockets: StandInSocket[] = [];
  const events: string[] = [];
  const bridgeLog: string[] = [];
  const wiring = wireWebcam({
    plan: opts.injected ? { ...plan, executable: process.execPath } : plan,
    link,
    sessionEndedEvent: 'session-ended',
    openSocket: (_host, claim) => {
      const s = new StandInSocket(events, claim);
      sockets.push(s);
      return s;
    },
    handle: (channel, listener) => ipc.set(channel, listener),
    send: (channel, payload) => channel === WEBCAM_IPC.STATE && states.push(payload as WebcamStatus),
    power,
    bridgeOptions: {
      ...(opts.injected ? { args: injectedBridge() } : {}),
      readyTimeoutMs: 5_000,
      gracefulMs: 1_000,
      termMs: 500,
      log: { info: (m) => bridgeLog.push(m), warn: (m) => bridgeLog.push(m) },
    },
    log: { info: () => undefined, warn: () => undefined },
  });
  wirings.push(wiring);
  const pid = wiring.bridgePid();
  if (pid !== null) pids.add(pid);
  return {
    wiring, link, power, ipc, states, sockets, events, bridgeLog,
    invoke: async (channel, ...args) => ipc.get(channel)!({}, ...args),
    pid: () => {
      const p = wiring.bridgePid();
      assert.ok(p !== null, 'a bridge is running');
      return p;
    },
    signal: (sig) => process.kill(rig_pid(wiring), sig),
  };
}

function rig_pid(w: WebcamWiring): number {
  const p = w.bridgePid();
  assert.ok(p !== null, 'a bridge is running');
  return p;
}

const injectedPlan: WebcamPlan = { ext: { webcam: 1 }, gateOpen: true, executable: 'replaced-by-rig', absentReason: null };

/** An app starts Sidekick Camera, the phone acks, its owner taps, the phone runs. */
async function toRunning(r: Rig, sessionId = SESSION): Promise<StandInSocket> {
  r.signal('SIGUSR1');
  await waitFor('the automatic request', () => r.wiring.controller.current().session?.phase === 'awaiting-approval');
  r.link.phone({ sessionId, state: 'starting' });
  const socket = r.sockets.at(-1)!;
  r.link.phone({ sessionId, state: 'running', generation: 1, facing: 'front', width: 1280, height: 720, targetWidth: 1920, targetHeight: 1080, frameRate: 30, codec: 'h264' });
  await waitFor('the bridge told the session is live', () => r.bridgeLog.some((l) => l.includes(`session-live ${sessionId.slice(0, 8)}`)));
  return socket;
}

const injectedReady = async (r: Rig) =>
  waitFor('the injected bridge ready', () => r.wiring.controller.current().bridge === 'running' && r.wiring.controller.current().device === 'installed');

// ---- the gates ------------------------------------------------------------------------------------------

test('the plan: packaged, the switch off, the bridge missing — no ext and nothing to spawn; the release flag is off', T, () => {
  const realApp = appWithRealBridge();
  const exec = '/Applications/Sidekick.app/Contents/MacOS/Sidekick';
  const packaged = planWebcam({ packaged: true, devSwitch: true, appPath: realApp, execPath: exec });
  assert.deepEqual(packaged.ext, {});
  assert.equal(packaged.gateOpen, false, 'a packaged build ignores the development switch');
  assert.match(packaged.absentReason ?? '', /not in this build/);
  const off = planWebcam({ packaged: false, devSwitch: false, appPath: realApp, execPath: exec });
  assert.deepEqual(off.ext, {});
  assert.match(off.absentReason ?? '', /webcamDev/);
  const missing = planWebcam({ packaged: false, devSwitch: true, appPath: mkdtempSync(join(scratch, 'empty-')), execPath: exec });
  assert.deepEqual(missing.ext, {});
  assert.equal(missing.executable, null);
  assert.match(missing.absentReason ?? '', /not built/);
  // Control: the switch on and the bridge at its one path.
  const on = planWebcam({ packaged: false, devSwitch: true, appPath: realApp, execPath: exec });
  assert.deepEqual(on.ext, { webcam: 2 });
  assert.equal(on.executable, join(realApp, 'native/SidekickCamera/.build/release/sidekick-camera-bridge'));
});

test('the gate closed: no bridge spawned, Ask refused with the reason, and the phone is asked nothing', T, async () => {
  const r = rig(planWebcam({ packaged: false, devSwitch: false, appPath: scratch, execPath: '/x' }));
  assert.equal(r.wiring.bridgePid(), null);
  const result = await r.invoke(WEBCAM_IPC.ASK, 'front');
  assert.equal(result.ok, false);
  assert.match(result.reason, /webcamDev/);
  r.power.emit('lock-screen');
  r.link.emit('status');
  assert.equal(r.link.sent.length, 0);
  assert.equal((await r.invoke(WEBCAM_IPC.CURRENT)).bridge, 'absent');
});

test('REAL bridge through the planned path: Sidekick Camera not installed and no identity — nothing asked; quit reaps it', T, async () => {
  const r = rig(planWebcam({ packaged: false, devSwitch: true, appPath: appWithRealBridge(), execPath: '/x' }));
  const pid = r.pid();
  await waitFor('ready', () => r.wiring.controller.current().device !== 'unknown');
  const s = r.wiring.controller.current();
  assert.equal(s.device, 'not-installed', 'this Mac has no activated Sidekick Camera');
  assert.equal(s.producer, 'unconfigured', 'the Team ID is unset');
  const result = await r.invoke(WEBCAM_IPC.ASK, 'front');
  assert.equal(result.ok, false);
  assert.match(result.reason, /not installed/);
  assert.equal(r.link.requests('webcam.request').length, 0, 'no request reached the phone');
  assert.ok(r.states.length > 0, 'the renderer was sent the state');
  await r.wiring.dispose();
  assert.equal(alive(pid), false, 'the real bridge is gone after quit');
});

test('an older phone (no capability, no ext): a consumer arriving asks nothing', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  r.link.capabilities = ['camera'];
  r.link.negotiatedExt = {};
  await injectedReady(r);
  r.signal('SIGUSR1');
  await waitFor('the consumer heard', () => r.wiring.controller.current().consumers === 1);
  assert.equal(r.link.requests('webcam.request').length, 0);
  assert.equal(r.wiring.controller.current().phone.kind, 'older-phone');
});

// ---- the episode, the stream, the endings ----------------------------------------------------------------

test('consumer episode → one request → the tap → the claimed socket → running → AUs reach the bridge; the last consumer stops at once', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  const socket = await toRunning(r);
  assert.deepEqual(r.link.requests('webcam.request').map((s) => s.payload), [{ facing: 'front', trigger: 'consumer' }]);
  assert.equal(socket.claim, webcamClaim(TOKEN, SESSION));
  socket.feed(goldenAU());
  socket.feed(makeAU({ generation: 7, sequence: 2, keyframe: false }));
  await waitFor('two AUs at the bridge', () => r.bridgeLog.filter((l) => l.includes(`au ${SESSION.slice(0, 8)}`)).length === 2);
  const live = r.states.at(-1)!;
  assert.equal(live.session?.phase, 'running');
  assert.deepEqual(live.session?.size, { width: 1280, height: 720, targetWidth: 1920, targetHeight: 1080 });
  // The last app stops using Sidekick Camera.
  r.signal('SIGUSR2');
  await waitFor('the stop', () => r.link.requests('webcam.stop').length === 1);
  assert.deepEqual(r.link.requests('webcam.stop')[0]!.payload, { sessionId: SESSION, cause: 'no-consumers' });
  assert.equal(socket.destroyed, true);
  assert.equal(r.wiring.controller.current().session, null);
});

test('explicit Stop from the pane: stop first, then the socket, then the bridge', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  const socket = await toRunning(r);
  await r.invoke(WEBCAM_IPC.STOP);
  assert.deepEqual(r.link.requests('webcam.stop').at(-1)!.payload, { sessionId: SESSION, cause: 'person' });
  assert.equal(socket.destroyed, true);
  await waitFor('the bridge told', () => r.bridgeLog.some((l) => l.includes(`session-ended ${SESSION.slice(0, 8)} stopped-by-mac`)));
});

test('disconnect ends the session without a wire stop; reconnecting asks nothing (consent not reused)', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  await toRunning(r);
  r.link.connected = false;
  r.link.emit('session-ended', { token: TOKEN, byThisMac: false });
  assert.equal(r.wiring.controller.current().lastEnded?.reason, 'disconnected');
  assert.equal(r.link.requests('webcam.stop').length, 0);
  r.link.connected = true;
  r.link.emit('status');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(r.link.requests('webcam.request').length, 1, 'the spent episode does not ask again on reconnect');
});

// The contract's list, written here rather than read from WEBCAM_POWER_EVENTS: a test that iterates the
// production table loses a test when an entry is deleted and gains a passing one when a wrong one is added
// (mutations MW2 and MW3 survived exactly that way).
const SHUTDOWN_EVENTS: ReadonlyArray<[string, string]> = [
  ['suspend', 'suspend'],
  ['lock-screen', 'lock-screen'],
  ['user-did-resign-active', 'user-switch'],
];
for (const [event, lifecycle] of SHUTDOWN_EVENTS) {
  test(`${event} (${lifecycle}) stops the session at once with cause shutdown; the bridge keeps running`, T, async () => {
    const r = rig(injectedPlan, { injected: true });
    await injectedReady(r);
    const socket = await toRunning(r);
    r.power.emit(event);
    await waitFor('the stop', () => r.link.requests('webcam.stop').length === 1);
    assert.deepEqual(r.link.requests('webcam.stop')[0]!.payload, { sessionId: SESSION, cause: 'shutdown' });
    assert.equal(socket.destroyed, true);
    assert.equal(r.wiring.controller.current().bridge, 'running');
  });
}

test('resume and unlock are not bound: coming back never resumes a camera', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  assert.equal(r.power.listenerCount('resume'), 0);
  assert.equal(r.power.listenerCount('unlock-screen'), 0);
  assert.deepEqual(r.power.eventNames().map(String).sort(), SHUTDOWN_EVENTS.map(([e]) => e).sort());
  assert.deepEqual({ ...WEBCAM_POWER_EVENTS }, Object.fromEntries(SHUTDOWN_EVENTS));
});

test('a malformed AU on the current stream ends it as a Mac failure', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  const socket = await toRunning(r);
  const bad = makeAU({ sequence: 2 });
  bad.writeUInt8(2, 13); // webcam version 2
  socket.feed(bad);
  assert.deepEqual(r.link.requests('webcam.stop').at(-1)!.payload, { sessionId: SESSION, cause: 'failure', detail: 'stream-malformed' });
  assert.equal(r.wiring.controller.current().lastEnded?.reason, 'malformed-stream');
});

test("the bridge rejecting the current session's stream ends exactly that session as a Mac failure", T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  await toRunning(r);
  r.signal('SIGHUP');
  await waitFor('the failure stop', () => r.link.requests('webcam.stop').length === 1);
  assert.deepEqual(r.link.requests('webcam.stop')[0]!.payload, { sessionId: SESSION, cause: 'failure', detail: 'stream-malformed' });
});

test('the bridge dying mid-session stops the phone as a Mac failure and is reported, not restarted', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  await toRunning(r);
  const pid = r.pid();
  process.kill(pid, 'SIGKILL');
  await waitFor('the failure stop', () => r.link.requests('webcam.stop').length === 1);
  assert.deepEqual(r.link.requests('webcam.stop')[0]!.payload, { sessionId: SESSION, cause: 'failure', detail: 'bridge-failed' });
  assert.equal(r.wiring.controller.current().bridge, 'failed');
  assert.equal(r.wiring.bridgePid(), null, 'nothing restarted it');
  await waitFor('reaped', () => !alive(pid));
});

test('a delayed ack: the consumer leaves first, so the late ack is withdrawn with no-consumers and nothing opens', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  const ack = deferred<{ payload?: unknown }>();
  r.link.answer = async (type) => (type === 'webcam.request' ? ack.promise : { payload: { stopped: true } });
  r.signal('SIGUSR1');
  await waitFor('the request sent', () => r.link.requests('webcam.request').length === 1);
  r.signal('SIGUSR2');
  await waitFor('the episode over', () => r.wiring.controller.current().consumers === 0);
  ack.resolve({ payload: { state: 'awaiting-approval', sessionId: SESSION, expiresInMs: 30_000 } });
  await waitFor('the withdrawal', () => r.link.requests('webcam.stop').length === 1);
  assert.deepEqual(r.link.requests('webcam.stop')[0]!.payload, { sessionId: SESSION, cause: 'no-consumers' });
  assert.equal(r.sockets.length, 0);
});

test('rapid consumer changes during a held ack never put two requests on the phone', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  const ack = deferred<{ payload?: unknown }>();
  r.link.answer = async (type) => (type === 'webcam.request' ? ack.promise : { payload: { stopped: true } });
  for (let i = 0; i < 6; i++) {
    r.signal(i % 2 === 0 ? 'SIGUSR1' : 'SIGUSR2');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  r.signal('SIGUSR1');
  await waitFor('a request in flight', () => r.link.requests('webcam.request').length >= 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(r.link.requests('webcam.request').length, 1, 'one request in flight, the others waited');
  ack.resolve({ payload: { state: 'awaiting-approval', sessionId: SESSION, expiresInMs: 30_000 } });
});

test('a replaced session and a stale generation: only the current session and generation count', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  await toRunning(r, SESSION);
  r.signal('SIGUSR2');
  await waitFor('session 1 ended', () => r.wiring.controller.current().session === null);
  await toRunning(r, SESSION_2);
  // Late news about session 1, and an older generation of session 2.
  r.link.phone({ sessionId: SESSION, state: 'stopped', reason: 'stopped-on-phone', framesSent: 1, framesDropped: 0 });
  r.link.phone({ sessionId: SESSION, state: 'running', generation: 9 });
  r.link.phone({ sessionId: SESSION_2, state: 'running', generation: 3, facing: 'back' });
  r.link.phone({ sessionId: SESSION_2, state: 'running', generation: 2, facing: 'front' });
  const s = r.wiring.controller.current().session!;
  assert.equal(s.sessionId, SESSION_2);
  assert.equal(s.generation, 3);
  assert.equal(s.facing, 'back');
});

test('the phone refusing (Camera v1 or the mirror holds it: CAMERA_BUSY) spends the episode — no retry', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  r.link.answer = async (type) => {
    if (type === 'webcam.request') throw Object.assign(new Error('busy'), { code: 'CAMERA_BUSY', phoneMessage: 'The phone is mirroring its screen, so the webcam is not offered.' });
    return { payload: {} };
  };
  r.signal('SIGUSR1');
  await waitFor('refused', () => r.wiring.controller.current().lastEnded?.reason === 'refused');
  assert.equal(r.wiring.controller.current().lastEnded?.code, 'CAMERA_BUSY');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(r.link.requests('webcam.request').length, 1);
  // The person may still ask; it goes to the webcam namespace, with the chosen camera.
  r.link.answer = async () => ({ payload: { state: 'awaiting-approval', sessionId: SESSION_2, expiresInMs: 30_000 } });
  assert.equal((await r.invoke(WEBCAM_IPC.ASK, 'back')).ok, true);
  assert.deepEqual(r.link.requests('webcam.request').at(-1)!.payload, { facing: 'back', trigger: 'person' });
  assert.equal(r.link.sent.some((s) => s.type.startsWith('camera.')), false, 'nothing reached Camera v1');
});

test('Switch from the pane reaches webcam.switch for the exact session', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  await toRunning(r);
  assert.equal((await r.invoke(WEBCAM_IPC.SWITCH, 'back')).ok, true);
  assert.deepEqual(r.link.requests('webcam.switch').at(-1)!.payload, { sessionId: SESSION, facing: 'back' });
});

test('quit: the stop is written first, then the bridge is shut down and reaped', T, async () => {
  const r = rig(injectedPlan, { injected: true });
  await injectedReady(r);
  await toRunning(r);
  const pid = r.pid();
  await r.wiring.dispose();
  assert.deepEqual(r.link.requests('webcam.stop').at(-1)!.payload, { sessionId: SESSION, cause: 'shutdown' });
  assert.ok(r.bridgeLog.some((l) => l.includes('shutdown')), 'the bridge was asked to shut down');
  assert.equal(alive(pid), false);
  assert.equal(r.wiring.bridgePid(), null);
  // A second dispose (Electron's second before-quit) does nothing more.
  await r.wiring.dispose();
});

// ---- main.ts calls this factory, with the real objects -------------------------------------------------

test('main.ts wires the production factory with the real link, ipcMain, powerMonitor and pinned socket', T, () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const call = main.slice(main.indexOf('webcam = wireWebcam({'), main.indexOf('});', main.indexOf('webcam = wireWebcam({')));
  assert.ok(call.includes('plan: webcamPlan'));
  assert.ok(call.includes('sessionEndedEvent: SESSION_ENDED_EVENT'));
  assert.ok(call.includes('openCameraSocket(identity, host, claim, cameraLink.peerFingerprint())'));
  assert.ok(call.includes('ipc.handle(channel, listener)'), 'through the S4 IPC guard');
  assert.ok(call.includes('power: powerMonitor'));
  assert.ok(main.includes('devSwitch: !app.isPackaged && debugSwitches().webcamDev'), 'the switch is forced off when packaged');
  assert.ok(main.includes('...filesAdvert, ...webcamPlan.ext }'), 'the advertisement is the plan’s');
  assert.ok(main.includes("app.prependListener('before-quit'"), 'quit waits for the bridge, ahead of the link closing');
  // The preload's channels are the factory's.
  const preload = readFileSync(join(__dirname, '../preload.ts'), 'utf8');
  for (const channel of Object.values(WEBCAM_IPC)) assert.ok(preload.includes(`'${channel}'`), `preload lacks ${channel}`);
});

test('no orphan: every bridge child these tests spawned is gone', T, async () => {
  for (const w of wirings) await w.dispose();
  assert.ok(pids.size >= 10, `control: the tests spawned children (${pids.size})`);
  await waitFor('every child gone', () => [...pids].every((p) => !alive(p)), 8_000);
});
