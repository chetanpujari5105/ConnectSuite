import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BridgeProcess, type BridgeHooks } from './webcamBridge';
import { DECODE_PROBE_NAME, EncoderSpike, SPIKE_IPC, resolveDecodeProbe, wireWebcamSpike, type SpikeBounds, type SpikeReport, type SpikeStatus } from './webcamSpike';
import { SESSION, SESSION_2, StandInSocket, TOKEN, makeAU } from './webcam.testkit';
import { webcamClaim } from '../shared/webcamWire';

/**
 * The encoder spike's Electron-main runner, with these boundaries:
 *
 * - **REAL:** `EncoderSpike`, `BridgeProcess`, the record codecs, and `sidekick-camera-decode-probe` as built
 *   by `swift build` — the bridge's own pipeline decoding with VideoToolbox. The access units are
 *   `docs/fixtures/webcam-phone-stream-v1.hex`: real H.264 (a Mac encoder standing in for the phone's)
 *   wrapped by the phone's production writer.
 * - **STAND-IN (labelled):** the phone (`LinkClient`'s acks and `webcam.state`), the 42502 socket, the
 *   timers' scale (bounds are shortened; their *order* is the runbook's).
 *
 * Nothing here is evidence about the Samsung's encoder. That is the spike's job, on hardware, approved
 * separately.
 */

const T = { timeout: 30_000 };
const PROBE = join(__dirname, '../../native/SidekickCamera/.build/debug', DECODE_PROBE_NAME);
const scratch = mkdtempSync(join(tmpdir(), 'webcam-spike-test-'));
const pids = new Set<number>();
after(() => {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone, as it should be */
    }
  }
  rmSync(scratch, { recursive: true, force: true });
});
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The phone writer's fixture, generation 1 only: front, 320×180, IDR, 3 P, IDR, P. */
function fixtureGeneration1(): Buffer[] {
  return readFileSync(join(__dirname, '../../../docs/fixtures/webcam-phone-stream-v1.hex'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => Buffer.from(l.trim(), 'hex'))
    .slice(0, 6);
}

const FAST: Partial<SpikeBounds> = { plannedStopMs: 600, hardCapMs: 1_200, observeMs: 250, stoppedWithinMs: 400, expirySlackMs: 100, probeLifetimeS: 20 };

/** STAND-IN for the phone on the control channel. */
class StandInPhone extends EventEmitter {
  connected = true;
  caps = ['webcam'];
  capabilities = () => this.caps.slice();
  ext: Record<string, number> = { webcam: 1 };
  calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  ackRequest: Record<string, unknown> | Error = { state: 'awaiting-approval', sessionId: SESSION, expiresInMs: 30_000 };
  constructor(private readonly events: string[]) {
    super();
  }
  isConnected = () => this.connected;
  token = () => (this.connected ? TOKEN : null);
  address = () => '192.0.2.10';
  negotiated = () => this.ext;
  unavailableReason = () => null;
  async request(type: string, payload: Record<string, unknown>): Promise<{ payload?: unknown }> {
    this.calls.push({ type, payload });
    this.events.push(`link.${type}${payload.cause ? `:${String(payload.cause)}` : ''}`);
    if (type === 'webcam.request') {
      if (this.ackRequest instanceof Error) throw this.ackRequest;
      return { payload: this.ackRequest };
    }
    if (type === 'webcam.keyframe') return { payload: { result: 'accepted', generation: payload.generation } };
    return { payload: { stopped: true } };
  }
  state(payload: Record<string, unknown>): void {
    this.emit('message', { type: 'webcam.state', payload: { sessionId: SESSION, ...payload } });
  }
}

interface Rig {
  spike: EncoderSpike;
  phone: StandInPhone;
  events: string[];
  sockets: StandInSocket[];
  statuses: SpikeStatus[];
  logs: string[];
  probePids: number[];
  /** The real probe's hooks, so a test can add a labelled INJECTED status beside what the probe reports. */
  probeHooks: BridgeHooks[];
}

function rig(opts: { bounds?: Partial<SpikeBounds>; busy?: boolean; probe?: 'real' | 'none' } = {}): Rig {
  const events: string[] = [];
  const phone = new StandInPhone(events);
  const sockets: StandInSocket[] = [];
  const statuses: SpikeStatus[] = [];
  const logs: string[] = [];
  const probePids: number[] = [];
  const probeHooks: BridgeHooks[] = [];
  const spike = new EncoderSpike({
    link: phone,
    openSocket: (host, claim) => {
      events.push(`socket.open ${host}`);
      const s = new StandInSocket(events, claim);
      sockets.push(s);
      return s;
    },
    startProbe: (hooks: BridgeHooks) => {
      if (opts.probe === 'none') throw new Error('no probe here');
      probeHooks.push(hooks);
      const p = new BridgeProcess({ executable: PROBE, args: ['--max-seconds', '20'], ...hooks, readyTimeoutMs: 5_000, gracefulMs: 1_000, termMs: 500, log: { info: () => undefined, warn: () => undefined } });
      if (p.pid) {
        pids.add(p.pid);
        probePids.push(p.pid);
      }
      return p;
    },
    webcamBusy: () => opts.busy === true,
    emit: (s) => statuses.push(s),
    bounds: { ...FAST, ...(opts.bounds ?? {}) },
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
  });
  phone.on('message', (e: { type: string; payload: unknown }) => spike.onState(e.payload));
  return { spike, phone, events, sockets, statuses, logs, probePids, probeHooks };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what: string, predicate: () => boolean, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await sleep(10);
  }
}

/** Tap → starting → running → the fixture's AUs at ~30 fps. */
async function approveAndStream(r: Rig, aus: Buffer[] = fixtureGeneration1()): Promise<void> {
  r.phone.state({ state: 'starting' });
  await waitFor('the socket', () => r.sockets.length === 1);
  r.phone.state({ state: 'running', facing: 'back', width: 320, height: 180, targetWidth: 1920, targetHeight: 1080, frameRate: 30, codec: 'h264', generation: 1 });
  for (const au of aus) {
    r.sockets[0]!.feed(au);
    await sleep(33);
  }
}

test('the spike: one request, the exact claim, real H.264 decoded by the built probe, the planned Stop, then nothing', T, async () => {
  assert.ok(existsSync(PROBE), `build the Swift package first (${PROBE})`);
  const r = rig();
  const ran = await r.spike.run('back');
  assert.deepEqual(ran, { ok: true });
  assert.deepEqual(r.phone.calls[0], { type: 'webcam.request', payload: { facing: 'back', trigger: 'person' } });

  await approveAndStream(r);
  // The claim is the contract's frame for exactly the acked session, on the control session's token.
  assert.equal(r.sockets[0]!.claim, webcamClaim(TOKEN, SESSION));

  // A stopped answer as soon as the stop is written, as the phone sends it.
  await waitFor('the planned stop', () => r.events.includes('link.webcam.stop:person'));
  r.phone.state({ state: 'stopped', reason: 'stopped-by-mac', framesSent: 6, framesDropped: 0 });
  const report = (await r.spike.done()) as SpikeReport;

  assert.equal(report.outcome, 'completed');
  assert.equal(report.stop.trigger, 'planned');
  assert.deepEqual(report.stop.wire, { cause: 'person' });
  // Written first, then the socket — the same tick, no waiting for the ack.
  assert.ok(r.events.indexOf('link.webcam.stop:person') < r.events.indexOf('socket.destroy'), r.events.join(' → '));
  assert.ok(report.timeline.stopFromStartingMs! >= FAST.plannedStopMs! && report.timeline.stopFromStartingMs! < FAST.hardCapMs!);
  assert.equal(report.phoneStopped?.reason, 'stopped-by-mac');
  assert.deepEqual(report.route, { address: '192.0.2.10' });

  assert.equal(report.mac.framed, 6);
  assert.equal(report.mac.keyframes, 2);
  assert.equal(report.mac.forwarded, 6);
  const c = report.probe.counts!;
  assert.equal(c['received'], 6);
  assert.equal(c['probe.decoded'], 6, JSON.stringify(c));
  assert.equal(c['probe.decoded.idr'], 2);
  assert.equal(c['probe.decoded.nonIdr'], 4);
  assert.equal(c['probe.nal.sps'], 2);
  assert.equal(c['probe.header.width'], 320);
  assert.equal(c['probe.sps.width'], 320);
  assert.equal(c['probe.decoded.width'], 320);
  assert.equal(c['probe.decoded.height'], 180);
  assert.equal(c['probe.mismatch.headerVsSps'], undefined);
  assert.equal(c['probe.mismatch.spsVsDecoded'], undefined);
  assert.equal(c['probe.firstArrivedIsIdrWithConfig'], 1);
  assert.equal(report.probe.exit?.code, 0);
  assert.equal(report.probe.ready?.deviceInstalled, false, 'the probe takes the same honest reading as the bridge');

  // The observation: nothing sent after the stop, and the probe is gone.
  assert.equal(r.phone.calls.length, 2);
  assert.equal(report.observation.statesAfterStopped, 0);
  assert.equal(report.observation.ausAfterStop, 0);
  assert.ok(report.observation.ms >= FAST.observeMs!);
  for (const pid of r.probePids) assert.equal(alive(pid), false, `probe pid ${pid} outlived the spike`);

  // The pre-registered verdict (scripts/webcam-spike-core.mjs) reads THIS report's real shape: every
  // bitstream, dimension and accounting criterion passes on it. Only the ones the fixture cannot meet —
  // six AUs, shortened bounds, no phone — fail, so a renamed field here goes red there.
  const core = await import(pathToFileURL(join(__dirname, '../../../scripts/webcam-spike-core.mjs')).href);
  const phoneLines = [
    { kind: 'attached', prefix: report.session },
    { kind: 'capture', prefix: report.session, width: 320, height: 180 },
    { kind: 'stopped', prefix: report.session, reason: 'STOPPED_BY_MAC' },
  ];
  const v = core.verdict(report, { lines: phoneLines, releasedWithinMs: 100, heldDuringObservation: 0, observationSamples: 30, capturesAfterStop: 0, emergencyHome: false });
  for (const wanted of [/one session id acked/, /attached the claim/, /one generation/, /running \d+ ms after starting reached the Mac/, /first AU \d+ ms/, /IDR carrying SPS and PPS/, /SPS ×2, PPS ×2/, /SPS read: profile 66/,
    /2 IDR decoded/, /no decode failure/, /no malformed AU/, /header = running = SPS = decoded = 320×180/, /no per-AU dimension mismatch/, /one size throughout/,
    /selected 320×180 and the stream carried it/, /accounting holds: 6 received/, /the planned Stop ended it/, /stopped-by-mac in \d+ ms/, /probe exited 0/, /no state and no AU after the stop/]) {
    assert.ok(v.passed.some((p: string) => wanted.test(p)), `verdict criterion not met on the real report: ${wanted} — passed: ${v.passed.join(' | ')} — failed: ${v.reasons.join(' | ')}`);
  }
  assert.deepEqual(
    v.reasons.map((r: string) => r.split(' ')[0]).sort(),
    ['Stop', 'fewer', 'fewer', 'the'].sort(),
    `only the fixture's own limits fail: ${v.reasons.join(' | ')}`,
  );

  // No token and no whole session id in the report or the log.
  const text = JSON.stringify(report) + r.logs.join('\n');
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes(SESSION), false);
  assert.equal(report.session, SESSION.slice(0, 8));
});

test('it runs once per launch: a second run is refused and sends nothing', T, async () => {
  const r = rig({ busy: true });
  await r.spike.run('back');
  const again = await r.spike.run('back');
  assert.equal(again.ok, false);
  assert.match(again.reason ?? '', /already run/);
  assert.equal(r.phone.calls.length, 0);
});

test('preconditions are named no-readings, read before anything is spawned or sent', T, async () => {
  const cases: Array<[string, (r: Rig) => void, string, boolean?]> = [
    ['not connected', (r) => (r.phone.connected = false), 'not-connected'],
    ['no webcam capability', (r) => (r.phone.caps = []), 'phone-has-no-webcam'],
    ['ext.webcam not negotiated', (r) => (r.phone.ext = {}), 'webcam-not-negotiated'],
    ['the Use as webcam section is busy', () => undefined, 'webcam-busy-on-this-mac', true],
  ];
  for (const [what, set, kind, busy] of cases) {
    const r = rig({ busy, probe: 'none' });
    set(r);
    const ran = await r.spike.run('back');
    assert.equal(ran.ok, false, what);
    const report = (await r.spike.done())!;
    assert.equal(report.outcome, 'no-reading', what);
    assert.equal(report.noReading, kind, what);
    assert.equal(r.phone.calls.length, 0, `${what}: nothing sent`);
  }
});

test('no request is sent unless the probe is ready to decode', T, async () => {
  const r = rig({ probe: 'none' });
  const ran = await r.spike.run('back');
  assert.equal(ran.ok, false);
  assert.equal((await r.spike.done())!.noReading, 'probe-unavailable');
  assert.equal(r.phone.calls.length, 0);
});

test('the hard cap is independent: with the planned Stop out of reach, the cap ends it', T, async () => {
  const r = rig({ bounds: { plannedStopMs: 60_000, hardCapMs: 500 } });
  await r.spike.run('back');
  await approveAndStream(r, fixtureGeneration1().slice(0, 2));
  const report = (await r.spike.done())!;
  assert.equal(report.stop.trigger, 'hard-cap');
  assert.deepEqual(report.stop.wire, { cause: 'person' });
  assert.ok(report.timeline.stopFromStartingMs! >= 500 && report.timeline.stopFromStartingMs! < 2_000);
  assert.ok(r.logs.some((l) => /hard cap/.test(l)));
});

test('a decline or an expiry before the tap is a no-reading, with no socket opened', T, async () => {
  const declined = rig();
  await declined.spike.run('back');
  declined.phone.state({ state: 'stopped', reason: 'declined', framesSent: 0, framesDropped: 0 });
  const d = (await declined.spike.done())!;
  assert.equal(d.noReading, 'ended-before-capture');
  assert.equal(d.detail, 'declined');
  assert.equal(declined.sockets.length, 0);

  const expired = rig();
  expired.phone.ackRequest = { state: 'awaiting-approval', sessionId: SESSION, expiresInMs: 150 };
  await expired.spike.run('back');
  const e = (await expired.spike.done())!;
  assert.equal(e.noReading, 'not-approved');
  assert.deepEqual(expired.phone.calls[1], { type: 'webcam.stop', payload: { sessionId: SESSION, cause: 'failure', detail: 'no-answer' } });
  assert.equal(expired.sockets.length, 0);
  for (const pid of [...declined.probePids, ...expired.probePids]) await waitFor(`probe ${pid} reaped`, () => !alive(pid));
});

test('a refusal from the phone is a no-reading carrying its code', T, async () => {
  const r = rig();
  r.phone.ackRequest = Object.assign(new Error('busy'), { code: 'CAMERA_BUSY', phoneMessage: 'The mirror is running.' });
  const ran = await r.spike.run('back');
  assert.equal(ran.ok, false);
  const report = (await r.spike.done())!;
  assert.equal(report.noReading, 'refused-by-phone');
  assert.equal(report.detail, 'CAMERA_BUSY');
});

test("a stream main cannot frame ends it with failure stream-malformed, written before the socket closes", T, async () => {
  const r = rig();
  await r.spike.run('back');
  r.phone.state({ state: 'starting' });
  await waitFor('the socket', () => r.sockets.length === 1);
  const bad = makeAU();
  bad.writeUInt8(9, 13); // version 9
  r.sockets[0]!.feed(bad);
  const report = (await r.spike.done())!;
  assert.equal(report.stop.trigger, 'stream-malformed');
  assert.deepEqual(report.stop.wire, { cause: 'failure', detail: 'stream-malformed' });
  assert.match(report.mac.malformed ?? '', /version 9/);
  assert.ok(r.events.indexOf('link.webcam.stop:failure') < r.events.indexOf('socket.destroy'));
});

test('the phone ending it first (Home) is recorded as the phone’s, with no stop written', T, async () => {
  const r = rig();
  await r.spike.run('back');
  await approveAndStream(r, fixtureGeneration1().slice(0, 3));
  r.phone.state({ state: 'stopped', reason: 'left-screen', framesSent: 3, framesDropped: 0 });
  const report = (await r.spike.done())!;
  assert.equal(report.stop.trigger, 'phone');
  assert.equal(report.stop.wire, null);
  assert.equal(report.phoneStopped?.reason, 'left-screen');
  assert.equal(r.phone.calls.filter((c) => c.type === 'webcam.stop').length, 0);
});

test('states after the stop and states for other sessions are counted, and change nothing', T, async () => {
  const r = rig({ bounds: { observeMs: 600 } });
  await r.spike.run('back');
  await approveAndStream(r, fixtureGeneration1().slice(0, 2));
  await waitFor('the planned stop', () => r.events.includes('link.webcam.stop:person'));
  r.phone.state({ state: 'stopped', reason: 'stopped-by-mac' });
  await waitFor('observing', () => r.statuses.at(-1)?.phase === 'observing');
  r.phone.state({ state: 'running', generation: 2 });
  r.phone.emit('message', { type: 'webcam.state', payload: { sessionId: SESSION_2, state: 'starting' } });
  const report = (await r.spike.done())!;
  assert.equal(report.observation.statesAfterStopped, 1);
  assert.equal(report.observation.foreignStates, 1);
  assert.equal(r.sockets.length, 1, 'nothing reopened');
  assert.equal(r.phone.calls.filter((c) => c.type === 'webcam.request').length, 1);
});

test('the control session ending mid-capture ends it with nothing written; the phone stops by itself', T, async () => {
  const r = rig();
  await r.spike.run('back');
  await approveAndStream(r, fixtureGeneration1().slice(0, 2));
  r.spike.onSessionEnded(TOKEN);
  const report = (await r.spike.done())!;
  assert.equal(report.stop.trigger, 'link');
  assert.equal(report.stop.wire, null);
  assert.equal(report.observation.linkEnded, true);
});

// ---- wiring and the probe's path -----------------------------------------------------------------

function appWithProbe(kind: 'file' | 'symlink' | 'missing'): string {
  const app = mkdtempSync(join(scratch, 'app-'));
  const dir = join(app, 'native', 'SidekickCamera', '.build', 'release');
  mkdirSync(dir, { recursive: true });
  if (kind === 'file') {
    copyFileSync(PROBE, join(dir, DECODE_PROBE_NAME));
    chmodSync(join(dir, DECODE_PROBE_NAME), 0o755);
  } else if (kind === 'symlink') {
    symlinkSync(PROBE, join(dir, DECODE_PROBE_NAME));
  }
  return app;
}

test('the probe resolves at its one path only: never packaged, never a symlink, never missing', T, () => {
  assert.equal(resolveDecodeProbe({ packaged: true, appPath: appWithProbe('file') }).path, null);
  assert.match((resolveDecodeProbe({ packaged: false, appPath: appWithProbe('symlink') }) as { reason: string }).reason, /symbolic link/);
  assert.match((resolveDecodeProbe({ packaged: false, appPath: appWithProbe('missing') }) as { reason: string }).reason, /not built/);
  assert.ok(resolveDecodeProbe({ packaged: false, appPath: appWithProbe('file') }).path);
});

test('wiring: no IPC channel exists unless every gate is open, and the run is back-camera only', T, async () => {
  const wire = (over: Partial<Parameters<typeof wireWebcamSpike>[0]>) => {
    const handled: string[] = [];
    const link = new StandInPhone([]);
    const w = wireWebcamSpike({
      packaged: false,
      devSwitch: true,
      spikeSwitch: true,
      webcamAdvertised: true,
      appPath: appWithProbe('file'),
      link: link as never,
      sessionEndedEvent: 'session-ended',
      openSocket: () => new StandInSocket([], ''),
      webcamBusy: () => false,
      handle: (channel, listener) => {
        handled.push(channel);
        (link as unknown as Record<string, unknown>)[`ipc:${channel}`] = listener;
      },
      send: () => undefined,
      power: { on: () => undefined },
      ...over,
    });
    return { w, handled, link };
  };
  // Each gate is asserted by its own reason: the packaged case is refused twice (here, and again by the
  // probe resolver), and an outcome-only check passed with the first guard deleted (mutation MS7).
  for (const [what, over, reason] of [
    ['packaged', { packaged: true }, /packaged build never runs/],
    ['switch off', { spikeSwitch: false }, /switch is off/],
    ['webcamDev off', { devSwitch: false }, /needs webcamDev/],
    ['ext.webcam not advertised', { webcamAdvertised: false }, /not advertised/],
    ['probe not built', { appPath: appWithProbe('missing') }, /not built/],
  ] as const) {
    const { w, handled } = wire(over);
    assert.equal(w.spike, null, what);
    assert.match(w.reason ?? '', reason, what);
    assert.deepEqual(handled, [], `${what}: no channel registered`);
  }
  const { w, handled, link } = wire({});
  assert.ok(w.spike);
  assert.deepEqual(handled.sort(), [SPIKE_IPC.CURRENT, SPIKE_IPC.RUN].sort());
  // The renderer cannot choose the camera: whatever it passes, the request is for the back camera.
  const runViaIpc = (link as unknown as Record<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>)[`ipc:${SPIKE_IPC.RUN}`]!;
  await runViaIpc({}, 'front');
  assert.deepEqual(link.calls[0], { type: 'webcam.request', payload: { facing: 'back', trigger: 'person' } });
  await w.dispose();
});

for (const version of [2, 1]) {
  test(`version ${version}: a broken chain during the spike ${version === 2 ? 'asks once, and the report carries the counts' : 'asks nothing'}`, T, async () => {
    const r = rig();
    r.phone.ext = { webcam: version };
    await r.spike.run('back');
    await approveAndStream(r);
    // INJECTED: a chain-broken beside the real probe's own records — the probe's real one needs a real
    // decoder fault, which the Swift ChainSignalTests hold. This holds the runner's wiring.
    r.probeHooks[0]!.onStatus({ op: 'chain-broken', sessionId: SESSION, generation: 1, cause: 'queue-full' });
    r.probeHooks[0]!.onStatus({ op: 'chain-broken', sessionId: '0'.repeat(32), generation: 1, cause: 'queue-full' });
    await waitFor('the planned stop', () => r.events.includes('link.webcam.stop:person'));
    r.phone.state({ state: 'stopped', reason: 'stopped-by-mac', framesSent: 6, framesDropped: 0 });
    const report = (await r.spike.done()) as SpikeReport;
    const asked = r.phone.calls.filter((c) => c.type === 'webcam.keyframe');
    assert.equal(asked.length, version === 2 ? 1 : 0);
    if (version === 2) assert.deepEqual(asked[0]!.payload, { sessionId: SESSION, generation: 1 });
    const c = report.recovery!;
    assert.ok(c, 'the report carries the recovery counters');
    // The other session's report never reaches the policy: the runner drops it at its own gate (stale 0).
    assert.deepEqual([c.breaks, c.requested, c.unsupported, c.stale], version === 2 ? [1, 1, 0, 0] : [1, 0, 1, 0]);
    assert.equal(r.phone.calls.filter((x) => x.type === 'webcam.request').length, 1, 'one request per launch, as before');
  });
}
