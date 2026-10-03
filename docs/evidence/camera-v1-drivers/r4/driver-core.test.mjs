// Local tests for the Camera retry driver — no phone, no Mac app, no camera request.
// Every test runs the production runSession against simulated dependencies with real timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { runSession, createRecorder, INSTALL_INSTRUMENT, DEFAULT_LIMITS } from './driver-core.mjs';

const SCALED = {
  LIMIT_MS: 400, DEADLINE_MARGIN_MS: 50, PLANNED_MS: 300, SWITCH_MS: 100, CEILING_MS: 1500, OBSERVE_MS: 150, REQUEST_GRACE_MS: 30,
  PANE_POLL_MS: 5, PHONE_POLL_MS: 20, SAMPLE_MS: 40, SCREEN_AFTER_MS: 20, CALL_TIMEOUT_MS: 60,
  STOP_ATTEMPT_MS: 60, STOP_ATTEMPTS: 3,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => undefined);

/** A simulated session: the pane follows a script keyed on time since the request. */
function sim({ approveAfter = 30, attachAfter = 40, liveAfter = 60, expireAfter = null, endAfter = null, print = () => {}, overrides = {} } = {}) {
  const calls = { requests: 0, switches: [], stops: [], emergency: 0, reports: 0, screens: 0 };
  let requestedAt = null;
  let stoppedAt = null;
  let switched = false;
  let externalEndAt = null;
  const recorder = createRecorder({ print });
  const pane = () => {
    const idle = { stop: 0, cancel: 0, request: ['Ask phone for camera'], switchLabel: null, text: "See your phone's camera here", canvasCss: [0, 0] };
    if (requestedAt === null) return idle;
    const since = Date.now() - requestedAt;
    if (stoppedAt !== null) return { ...idle, request: ['Ask again'], text: 'Camera off You stopped the camera from this Mac.' };
    if (externalEndAt !== null || (endAfter !== null && since >= endAfter)) return { ...idle, request: ['Ask again'], text: "The camera stopped because Sidekick's camera screen left your phone's display." };
    if (expireAfter !== null && since >= expireAfter) return { ...idle, request: ['Ask again'], text: 'The request expired Nobody allowed the camera on your phone within 30 seconds.' };
    if (since < approveAfter) return { ...idle, request: [], cancel: 1, text: 'Waiting for you to allow it on your phone' };
    if (since < liveAfter) return { ...idle, request: [], stop: 1, text: "Starting your phone's camera…" };
    return { ...idle, request: [], stop: 1, switchLabel: switched ? 'Switch to back camera' : 'Switch to front camera', text: `Live · ${switched ? 'front' : 'back'} camera · 960 × 720`, canvasCss: [1108, 554] };
  };
  const deps = {
    now: Date.now, setTimeout, clearTimeout, sleep, recorder,
    readPane: async () => pane(),
    pressRequest: async () => { calls.requests += 1; requestedAt = Date.now(); return true; },
    pressSwitch: async () => { calls.switches.push(Date.now()); switched = true; return { landed: true }; },
    pressStop: async (trigger) => { calls.stops.push({ trigger, at: Date.now() }); stoppedAt = Date.now(); return { landed: true, atMs: stoppedAt }; },
    emergencyStop: async () => { calls.emergency += 1; },
    phoneLines: async () => (requestedAt !== null && Date.now() - requestedAt >= attachAfter && expireAfter === null ? ['I [camera] Camera stream 0123abcd… attached for Mac'] : []),
    sampleAfter: async () => ({ clients: '[]', ours: 7 }),
    phoneScreen: async () => { calls.screens += 1; return ['Camera off', 'The Mac stopped the camera.']; },
    readInstr: async () => ({ paints: 3, draws: 3, drawsAfterStop: 0 }),
    writeReport: async () => { calls.reports += 1; },
    ...overrides,
  };
  return { deps, calls, recorder, endNow: () => { externalEndAt = Date.now(); }, get requestedAt() { return requestedAt; } };
}

test('a normal session: one request, one switch at ~5 s of live, the planned Stop at ~15 s, a report', async () => {
  const s = sim();
  const report = await runSession(s.deps, SCALED);
  assert.equal(report.outcome, 'stopped');
  assert.equal(s.calls.requests, 1);
  assert.equal(s.calls.switches.length, 1, 'one switch');
  const switchDelay = s.calls.switches[0] - report.liveAt;
  assert.ok(switchDelay >= SCALED.SWITCH_MS && switchDelay < SCALED.SWITCH_MS + 40, `switch at ${switchDelay} ms after live`);
  assert.equal(report.stopLanded.trigger, 'planned');
  assert.ok(report.capture.anchorToStopMs >= SCALED.PLANNED_MS && report.capture.withinLimit, JSON.stringify(report.capture));
  assert.equal(s.calls.stops.length, 1);
  assert.equal(s.calls.emergency, 0);
  assert.equal(s.calls.screens, 1);
  assert.ok(report.samples.length >= 2, 'the observation ran');
  assert.equal(s.calls.reports, 1);
  assert.match(report.anchorSource, /Mac Stop button/);
});

test('the deadline presses Stop although the pane read is stuck, the recorder cannot print and the report cannot be written', async () => {
  let anchorSeen = false;
  const s = sim({
    print: () => { throw new Error('stdout gone'); },
    overrides: {
      writeReport: async () => { throw new Error('disk full'); },
    },
  });
  const realRead = s.deps.readPane;
  // Once the stream is starting, every pane read hangs — the instrument is stuck, or the driver is
  // waiting on something that never answers (a pending user reply looks the same from here).
  s.deps.readPane = async () => { const p = await realRead(); if (p.stop === 1) { if (anchorSeen) return never(); anchorSeen = true; } return p; };
  const report = await runSession(s.deps, { ...SCALED, PLANNED_MS: null });
  assert.equal(report.stopLanded.trigger, 'deadline');
  const ms = report.capture.anchorToStopMs;
  assert.ok(ms >= SCALED.LIMIT_MS - SCALED.DEADLINE_MARGIN_MS && ms <= SCALED.LIMIT_MS, `deadline stop ${ms} ms after the anchor`);
  assert.equal(report.capture.withinLimit, true);
  assert.ok(s.recorder.failures() > 0, 'control: the recorder really was failing');
  assert.equal(report.reportWriteFailed, true, 'control: the report really could not be written');
});

test('a planned Stop that hangs does not hold the deadline: the deadline starts its own attempt and lands', async () => {
  const s = sim();
  s.deps.pressStop = async (trigger) => {
    s.calls.stops.push({ trigger, at: Date.now() });
    if (trigger === 'planned') return never();
    return { landed: true, atMs: Date.now() };
  };
  const report = await runSession(s.deps, { ...SCALED, STOP_ATTEMPT_MS: 2000 }); // a planned attempt outlives the deadline
  assert.equal(report.stopLanded.trigger, 'deadline');
  assert.equal(report.capture.withinLimit, true, JSON.stringify(report.capture));
  assert.deepEqual(s.calls.stops.map((x) => x.trigger), ['planned', 'deadline']);
  assert.equal(s.calls.emergency, 0);
});

test('when no Mac Stop ever lands, the emergency fallback runs once', async () => {
  const s = sim();
  s.deps.pressStop = async (trigger) => { s.calls.stops.push({ trigger }); return { landed: false }; };
  const report = await runSession(s.deps, SCALED);
  assert.equal(report.stopLanded, null);
  assert.equal(report.emergency, true);
  assert.equal(s.calls.emergency, 1);
});

test('an expiry ends the session without a Stop, completes the observation and writes the report', async () => {
  const s = sim({ approveAfter: 1e9, expireAfter: 80 });
  const report = await runSession(s.deps, SCALED);
  assert.equal(report.outcome, 'ended-without-stop');
  assert.equal(s.calls.stops.length, 0, 'a Stop was pressed on an expired request');
  assert.equal(s.calls.switches.length, 0);
  assert.equal(report.anchor, null);
  assert.ok(report.samples.length >= 2, 'the observation did not run');
  assert.equal(s.calls.reports, 1);
  assert.doesNotThrow(() => JSON.stringify(report));
  const ended = report.events.find((e) => e.what.startsWith('ENDED'));
  assert.equal(typeof ended.iso, 'string');
  assert.match(ended.data.text, /request expired/);
});

test('the recorder keeps its own timestamp whatever the caller passes, and never throws', () => {
  let printed = 0;
  const r = createRecorder({ print: () => { printed += 1; } });
  r.note('ended', { at: 12345, atMs: 1, iso: 2, t: 3, what: 4 }); // the 21:33 crash's exact shape, and more
  const e = r.events[0];
  assert.equal(typeof e.iso, 'string');
  assert.equal(e.what, 'ended');
  assert.notEqual(e.atMs, 1);
  assert.equal(e.data.at, 12345);
  const circular = {}; circular.self = circular;
  assert.doesNotThrow(() => r.note('circular', circular));
  const broken = createRecorder({ print: () => { throw new Error('no stdout'); } });
  assert.doesNotThrow(() => broken.note('x', { a: 1 }));
  assert.equal(broken.failures(), 1);
  assert.equal(printed, 2);
});

test('the anchor only moves earlier: a later attachment observation never re-arms the deadline', async () => {
  const s = sim({ attachAfter: 90 }); // the phone line is seen after the Mac's Stop button
  const report = await runSession(s.deps, SCALED);
  assert.match(report.anchorSource, /Mac Stop button/);
  assert.equal(report.events.filter((e) => e.what === 'capture deadline armed').length, 1);
});

test('attachment seen only in the phone log anchors at the request press, the earliest it could be', async () => {
  const s = sim({ attachAfter: 10 });
  const realRead = s.deps.readPane;
  s.deps.readPane = async () => { const p = await realRead(); return p.stop === 1 && !/^Live/.test(p.text) ? { ...p, stop: 0, cancel: 1 } : p; };
  s.deps.phoneLines = async () => (s.requestedAt !== null ? ['I [camera] Camera stream 0123abcd… attached for Mac'] : []);
  const report = await runSession(s.deps, SCALED);
  assert.equal(report.anchor, report.requestAt);
  assert.match(report.anchorSource, /request press/);
});

test('the page instrument wraps the painter exactly once, however many times it is installed', () => {
  class Painter {
    constructor() { this.painted = 0; this.drawn = 0; }
    paint() { this.painted += 1; }
    draw() { this.drawn += 1; }
  }
  const p = new Painter();
  // The wrapper the earlier sittings left behind: own properties bound to the prototype's methods.
  const legacy = p.paint.bind(p); p.paint = function (f) { return legacy(f); };
  const legacyDraw = p.draw.bind(p); p.draw = function (b, f) { return legacyDraw(b, f); };
  const ctx = vm.createContext({ camera: { painter: p }, window: {}, Date, Object });
  const first = vm.runInContext(INSTALL_INSTRUMENT, ctx);
  const second = vm.runInContext(INSTALL_INSTRUMENT, ctx);
  assert.match(first, /installed once \(removed 2 earlier/);
  assert.match(second, /installed once \(removed 2 earlier/);
  p.paint({}); p.draw({}, {});
  assert.equal(ctx.window.__camInstr.paints.length, 1, 'paint was counted more than once');
  assert.equal(ctx.window.__camInstr.draws.length, 1);
  assert.equal(p.painted, 1, 'the real paint ran more than once');
  assert.equal(p.drawn, 1);
  // Control: no painter, no install.
  assert.equal(vm.runInContext(INSTALL_INSTRUMENT, vm.createContext({ window: {}, Object, Date })), 'no painter');
});

test('the real limits: 20 s deadline, 15 s planned, 5 s switch — the deadline fires at 20 s with planned Stop disabled and pane reads stuck', { timeout: 40_000 }, async () => {
  assert.equal(DEFAULT_LIMITS.LIMIT_MS, 20_000);
  let anchorSeen = false;
  const s = sim({ print: () => { throw new Error('stdout gone'); } });
  const realRead = s.deps.readPane;
  s.deps.readPane = async () => { const p = await realRead(); if (p.stop === 1) { if (anchorSeen) return never(); anchorSeen = true; } return p; };
  const report = await runSession(s.deps, { ...DEFAULT_LIMITS, PLANNED_MS: null, OBSERVE_MS: 200, SAMPLE_MS: 50, SCREEN_AFTER_MS: 10 });
  assert.equal(report.stopLanded.trigger, 'deadline');
  const ms = report.capture.anchorToStopMs;
  assert.ok(ms >= 19_500 && ms <= 20_000, `deadline Stop at ${ms} ms after the anchor`);
  assert.equal(report.capture.withinLimit, true);
});

// ---- the lifecycle batch: a case action, a return step, and the watch from the return ------------

const LIFE = { ...SCALED, PLANNED_MS: null, SWITCH_MS: null, ACTION_MS: 100, AFTER_END_MS: 500 };

test('a case action fires once at ~ACTION_MS after the anchor, ends the stream, and the watch starts at the return', async () => {
  const s = sim();
  let actions = 0;
  let returned = null;
  s.deps.pressAction = async () => { actions += 1; s.endNow(); return { landed: true }; };
  s.deps.afterEnd = async () => { await sleep(80); returned = Date.now(); return { done: true }; };
  const report = await runSession(s.deps, LIFE);
  assert.equal(report.outcome, 'ended-without-stop');
  assert.equal(actions, 1);
  const delay = report.actionAt - report.anchor;
  assert.ok(delay >= LIFE.ACTION_MS && delay < LIFE.ACTION_MS + 40, `action ${delay} ms after the anchor`);
  assert.equal(s.calls.stops.length, 0, 'a Stop was pressed although the action ended the stream');
  assert.ok(report.capture.withinLimit && report.capture.anchorToStopMs < LIFE.LIMIT_MS, JSON.stringify(report.capture));
  assert.deepEqual(report.afterEnd, { done: true });
  assert.ok(report.samples.length >= 2);
  const lastSample = report.samples.at(-1).t * 1000 + s.recorder.t0;
  assert.ok(lastSample - returned >= LIFE.OBSERVE_MS - LIFE.SAMPLE_MS, `the watch ran ${lastSample - returned} ms after the return, not the full window`);
});

test('an end the owner causes (no driver action) is recognised, and the return step and watch still run', async () => {
  const s = sim({ endAfter: 160 });
  s.deps.afterEnd = async () => ({ done: true });
  const report = await runSession(s.deps, { ...LIFE, ACTION_MS: null });
  assert.equal(report.outcome, 'ended-without-stop');
  assert.equal(report.actionAt, null);
  assert.equal(s.calls.stops.length, 0);
  assert.deepEqual(report.afterEnd, { done: true });
});

test('an action that does not end the stream leaves the deadline to press the real Stop, and no return step runs', async () => {
  const s = sim();
  let returned = false;
  s.deps.pressAction = async () => ({ landed: true }); // e.g. Home pressed but capture carried on
  s.deps.afterEnd = async () => { returned = true; return { done: true }; };
  const report = await runSession(s.deps, LIFE);
  assert.equal(report.outcome, 'stopped');
  assert.equal(report.stopLanded.trigger, 'deadline');
  assert.equal(report.capture.withinLimit, true);
  assert.equal(returned, false, 'a return step ran after a capture the case did not end');
});

test('a return step that never finishes is bounded, and the watch and the report still complete', async () => {
  const s = sim({ endAfter: 160 });
  s.deps.afterEnd = () => never();
  const report = await runSession(s.deps, { ...LIFE, ACTION_MS: null });
  assert.deepEqual(report.afterEnd, { done: false, timedOut: true });
  assert.ok(report.samples.length >= 2);
  assert.equal(s.calls.reports, 1);
});
