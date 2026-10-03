// Fixtures for the Camera driver's core. No phone, no Mac app, no request: every device and page action
// is a simulation. Each fault the 2026-10-02 sittings lost a reading to has a fixture here, named for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runSession, createRecorder, parsePhoneLine, takeWholeLines, INSTALL_INSTRUMENT, DISPOSE_INSTRUMENT, DEFAULT_LIMITS, PHONE_LINE_CONTRACT,
} from './camera-driver-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Bounds set before any run: scaled limits keep each fixture under ~2 s; one fixture runs the real 20 s cap.
const SCALED = {
  LIMIT_MS: 400, DEADLINE_MARGIN_MS: 50, ANCHOR_MARGIN_MS: 20, APPROVAL_MS: 1200, ACK_MS: 100, UNCERTAIN_MS: 80,
  PHONE_FAILS_MAX: 3, OBSERVE_MS: 150, AFTER_END_MS: 300, REQUEST_GRACE_MS: 30, PANE_POLL_MS: 5, PHONE_POLL_MS: 20,
  SAMPLE_MS: 40, CALL_TIMEOUT_MS: 60, STOP_ATTEMPT_MS: 60, STOP_ATTEMPTS: 3, REPORT_MS: 100,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => undefined);
const STREAM = '7d1e2f3a4b5c6d7e8f90a1b2c3d4e5f6';
const OLD_ATTACHED = '2026-10-02T22:10:56.487+05:30 I [camera] Camera stream 7c0a8542… attached for Chetans-MacBook-Pro';

/** The phone's clock is deliberately not the Mac's: lines are stamped two hours off. */
const phoneStamp = () => new Date(Date.now() - 2 * 3600_000).toISOString().replace('Z', '+05:30');

function sim({ approveAfter = 40, homeAfter = 100, expireAfter = null, macLag = 5, liveLag = 20, ackDelay = 10, streamId = STREAM, oldLog = true, homeWorks = true, print = () => {}, readSplit = null, reopenAfter = 30 } = {}) {
  const prefix = streamId.slice(0, 8);
  const phone = { inode: 848963, buf: Buffer.from('') };
  const add = (body) => { phone.buf = Buffer.concat([phone.buf, Buffer.from(`${phoneStamp()} I [camera] ${body}\n`)]); };
  if (oldLog) {
    // The last 40 lines before the request hold the 22:10 session's attached line (the 22:38 fault).
    const filler = (n, o) => Array.from({ length: n }, (_, i) => `2026-10-02T22:3${(i + o) % 10}:00.000+05:30 I [vitals] battery.state ${i + o}\n`).join('');
    phone.buf = Buffer.from(filler(14, 0) + `${OLD_ATTACHED}\n` + filler(25, 14));
  }
  const calls = { stops: [], requests: 0, emergency: 0, reports: 0, afterEnd: 0, actions: [], ctx: null, reads: 0 };
  const t = { request: null, approved: null, ended: null, endReason: null };
  const recorder = createRecorder({ print });
  let idOverride = null;
  const endLeftScreen = () => {
    t.ended = Date.now(); t.endReason = 'left-screen';
    add('Camera stream closed: 30 sent / 0 dropped (0 evicted, 0 oversize, 0 unencoded)');
    add(`Camera stream ${prefix}… stopped: LEFT_SCREEN — 30 sent / 0 dropped`);
  };
  const pane = () => {
    const idle = { kind: 'idle', streamId: null, reason: null, stop: 0, cancel: 0, request: ['Ask phone for camera'], text: 'idle', canvasCss: [0, 0] };
    if (t.request === null) return idle;
    const id = idOverride ?? (Date.now() - t.request >= ackDelay ? streamId : null);
    if (t.ended !== null) return { ...idle, kind: 'ended', streamId: id, reason: t.endReason, request: ['Ask again'], text: `Camera off ${t.endReason}` };
    if (t.approved !== null && Date.now() - t.approved >= macLag) {
      const live = Date.now() - t.approved >= macLag + liveLag;
      return { ...idle, kind: live ? 'live' : 'connecting', streamId: id, request: [], stop: 1, text: live ? 'Live · back camera' : 'Starting', canvasCss: live ? [1108, 554] : [0, 0] };
    }
    return { ...idle, kind: 'requesting', streamId: id, request: [], cancel: 1, text: 'Waiting' };
  };
  const timers = [];
  const deps = {
    now: Date.now, setTimeout, clearTimeout, sleep, recorder,
    readPane: async () => pane(),
    pressRequest: async () => {
      calls.requests += 1; t.request = Date.now();
      add('camera.request from Chetans-MacBook-Pro: Ack, ShowRequest(screen), ArmTimer');
      if (approveAfter !== null) timers.push(setTimeout(() => {
        if (t.ended !== null) return;
        t.approved = Date.now();
        add(`Start camera tapped for ${prefix}…: CancelTimers, ClearRequest, state starting, OpenCamera(back, epoch 0), ArmTimer`);
        add('Camera bound: back, epoch 0');
        add(`Camera stream ${prefix}… attached for Chetans-MacBook-Pro`);
        add(`Camera stream ${prefix}… running: first frame 960 × 720 from the back camera, epoch 0`);
        if (homeAfter !== null) timers.push(setTimeout(() => { if (t.ended === null) endLeftScreen(); }, homeAfter));
      }, approveAfter));
      if (expireAfter !== null) timers.push(setTimeout(() => {
        if (t.approved !== null || t.ended !== null) return;
        t.ended = Date.now(); t.endReason = 'expired';
        add(`Camera stream ${prefix}… stopped: EXPIRED — 0 sent / 0 dropped`);
      }, expireAfter));
      return true;
    },
    pressStop: async (trigger) => {
      calls.stops.push({ trigger, at: Date.now(), sinceRequest: Date.now() - t.request });
      if (t.ended === null) { t.ended = Date.now(); t.endReason = 'stopped-by-mac'; add(`Camera stream ${prefix}… stopped: STOPPED_BY_MAC — 0 sent / 0 dropped`); }
      return { landed: true, atMs: Date.now() };
    },
    emergencyStop: async () => { calls.emergency += 1; },
    phoneLogMark: async () => ({ inode: phone.inode, size: phone.buf.length }),
    // Bytes from the offset, as `tail -c +N` returns them — optionally cut short at [readSplit] bytes.
    phoneLogRead: async (from) => {
      calls.reads += 1;
      const all = phone.buf.subarray(Math.min(from, phone.buf.length));
      return { inode: phone.inode, size: phone.buf.length, bytes: readSplit === null ? all : all.subarray(0, readSplit(calls.reads, all)) };
    },
    afterEnd: async (ctx) => { calls.afterEnd += 1; calls.ctx = ctx; await sleep(reopenAfter); return { done: true, reopenedAt: Date.now() }; },
    pressAction: async () => {
      calls.actions.push({ at: Date.now(), paneKind: pane().kind });
      if (homeWorks && t.ended === null) endLeftScreen();
      return { landed: true };
    },
    sampleAfter: async () => ({ clients: '[]', at: Date.now() }),
    readInstr: async () => ({ draws: [] }),
    writeReport: async () => { calls.reports += 1; },
  };
  return { deps, calls, t, phone, add, recorder, setId: (id) => { idOverride = id; }, cleanup: () => timers.forEach(clearTimeout) };
}
const armed = (r) => r.events.filter((e) => e.what === 'capture deadline armed');

/** Every run, whatever its fixture: at most one request was ever pressed. */
async function run(s, limits) {
  const r = await runSession(s.deps, limits);
  s.cleanup();
  assert.ok(s.calls.requests <= 1 && r.requestsPressed <= 1, `more than one request: ${s.calls.requests}`);
  return r;
}

// ---- the 22:38 fault: a stale attachment ------------------------------------------------------------

test('STALE: the 22:10 attached line still in the last 40 lines never arms the capture timer and never cancels at 19.5 s', async () => {
  const s = sim({ approveAfter: null, expireAfter: 700 });
  const r = await run(s, SCALED);
  assert.equal(armed(r).length, 0, 'the capture timer was armed with no capture');
  assert.equal(r.anchor, null);
  assert.deepEqual(s.calls.stops, [], `a Stop/Cancel was pressed: ${JSON.stringify(s.calls.stops)}`);
  assert.equal(r.outcome, 'no-reading:expired-without-capture');
  assert.ok(!r.freshPhoneLines.some((l) => l.line.includes('7c0a8542')), 'the stale line was read as fresh');
  const before = s.phone.buf.subarray(0, r.phoneLogStart.size).toString('utf8').trimEnd().split('\n');
  assert.ok(before.slice(-40).includes(OLD_ATTACHED), 'control: the stale line is in the last 40 at the mark');
});

test('WRONG STREAM: a fresh attachment for an unrelated stream never arms; it stops the attempt safely as NO READING', async () => {
  const s = sim({ approveAfter: null, expireAfter: 2000 });
  setTimeout(() => s.add('Camera stream deadbeef… attached for Other-Mac'), 60);
  const r = await run(s, SCALED);
  assert.equal(armed(r).length, 0);
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /another stream/);
  assert.equal(s.calls.stops.length, 1);
  assert.deepEqual(r.actions.fallbackStops.map((x) => x.trigger), ['safe shutdown: another stream is starting on the phone']);
  assert.equal(r.actions.test, null);
});

test('delayed approval: the cap starts at this stream’s start on the Mac, not at the request', async () => {
  const s = sim({ approveAfter: 600, homeAfter: 100 });
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'ended-by-stimulus');
  assert.equal(armed(r).length, 1);
  assert.match(r.anchorSource, /Mac state (connecting|live) for this stream id/);
  const anchorAfterApproval = r.anchor - s.t.approved;
  assert.ok(anchorAfterApproval >= -SCALED.ANCHOR_MARGIN_MS - 5 && anchorAfterApproval < 60, `anchor ${anchorAfterApproval} ms from approval`);
  assert.deepEqual(s.calls.stops, []);
  assert.ok(r.capture.withinLimit);
});

test('duplicate and out-of-order events: this stream’s attach before the Mac’s start, twice — armed once, no shutdown', async () => {
  const s = sim({ approveAfter: 40, macLag: 60, homeAfter: 150 });
  setTimeout(() => s.add(`Camera stream ${STREAM.slice(0, 8)}… attached for Chetans-MacBook-Pro`), 45);
  const r = await run(s, SCALED);
  assert.equal(armed(r).length, 1);
  assert.equal(r.shutdown, null);
  assert.equal(r.outcome, 'ended-by-stimulus');
  assert.ok(r.freshPhoneLines.filter((l) => l.kind === 'attached').length >= 2, 'control: the duplicate was there');
});

test('phone shows capture but the Mac never shows this stream starting: safe shutdown within the uncertainty bound', async () => {
  const s = sim({ approveAfter: 40, macLag: 100_000, homeAfter: null });
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /never showed this stream starting/);
  assert.equal(armed(r).length, 0);
});

// ---- the phone log -------------------------------------------------------------------------------------

test('ROTATION and TRUNCATION stop the attempt; there is no fallback to last-N lines', async () => {
  for (const kind of ['rotation', 'truncation']) {
    const s = sim({ approveAfter: null, expireAfter: 2000 });
    setTimeout(() => {
      if (kind === 'rotation') { s.phone.inode = 999; s.phone.buf = Buffer.from(`${OLD_ATTACHED}\n`); }
      else s.phone.buf = s.phone.buf.subarray(0, 100);
    }, 50);
    const r = await run(s, SCALED);
    assert.equal(r.outcome, 'no-reading:safe-shutdown', kind);
    assert.match(r.shutdown.reason, /rotated or was truncated/, kind);
    assert.equal(armed(r).length, 0, kind);
    assert.ok(!r.freshPhoneLines.some((l) => l.line.includes('7c0a8542')), `${kind}: the stale line was read after the rotation`);
  }
});

test('PARTIAL UTF-8: a read that ends inside the three-byte `…` carries it to the next read, and the line parses whole', async () => {
  // Every read stops one byte into the first `…` it can see (E2 80 A6), whatever else is there.
  const cut = (n, bytes) => {
    const at = bytes.indexOf(Buffer.from('…'));
    return at < 0 ? bytes.length : at + 1;
  };
  const s = sim({ readSplit: cut, oldLog: false });
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'ended-by-stimulus');
  const attached = r.freshPhoneLines.filter((l) => l.kind === 'attached');
  assert.equal(attached.length, 1);
  assert.equal(attached[0].prefix, STREAM.slice(0, 8));
  assert.ok(!r.freshPhoneLines.some((l) => l.line.includes('�')), 'a replacement character reached a parsed line');
  assert.ok(s.calls.reads > 5, 'control: the reads really were cut short');
});

test('takeWholeLines cuts at the newline byte and keeps a partial character for later', () => {
  const ellipsis = Buffer.from('…'); // e2 80 a6
  const one = Buffer.concat([Buffer.from('a\nb'), ellipsis.subarray(0, 2)]);
  const first = takeWholeLines(Buffer.alloc(0), one);
  assert.deepEqual(first.lines, ['a']);
  const second = takeWholeLines(first.rest, Buffer.concat([ellipsis.subarray(2), Buffer.from('c\n')]));
  assert.deepEqual(second.lines, ['b…c']);
  assert.equal(second.rest.length, 0);
  assert.deepEqual(takeWholeLines(Buffer.alloc(0), Buffer.from('no newline')).lines, []);
});

test('HUNG READ: a phone log read that never answers stops the attempt safely, and the report still completes', async () => {
  const s = sim({ approveAfter: null, expireAfter: 5000, oldLog: false });
  s.deps.phoneLogRead = () => never();
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /could not be read/);
  assert.equal(s.calls.reports, 1);
});

// ---- endings with no capture ---------------------------------------------------------------------------

test('EXPIRY without capture completes its watch and report, with no Stop', async () => {
  const s = sim({ approveAfter: null, expireAfter: 200, oldLog: false });
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'no-reading:expired-without-capture');
  assert.deepEqual(s.calls.stops, []);
  assert.ok(r.samples.length >= 2);
  assert.equal(s.calls.reports, 1);
  assert.equal(r.observation.from, 'end');
  assert.doesNotThrow(() => JSON.stringify(r));
});

test('the Mac’s stream id changing under the attempt stops it safely', async () => {
  const s = sim({ approveAfter: 40, homeAfter: null });
  setTimeout(() => s.setId('ffffffffffffffffffffffffffffffff'), 100);
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /stream id changed/);
});

test('no stream id from the ack stops the attempt safely, and nothing is armed', async () => {
  const s = sim({ approveAfter: null, ackDelay: 100_000, expireAfter: 2000 });
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /no stream id/);
  assert.equal(armed(r).length, 0);
});

test('a pane that is not idle aborts before any request, and the report still completes', async () => {
  const s = sim();
  s.deps.readPane = async () => ({ kind: 'live', streamId: STREAM, stop: 1, cancel: 0, request: [], text: 'Live', canvasCss: [1, 1] });
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'aborted-before-request');
  assert.equal(s.calls.requests, 0);
  assert.equal(r.phoneLogStart, null);
});

test('a request press that does not land ends the attempt: nothing is retried', async () => {
  const s = sim();
  s.deps.pressRequest = async () => { s.calls.requests += 1; return false; };
  const r = await run(s, SCALED);
  assert.equal(r.outcome, 'request-did-not-land');
  assert.equal(s.calls.requests, 1);
});

// ---- the cap, under failure and in races ----------------------------------------------------------------

test('recorder, pane, phone-log and report failures during real capture: the deadline still presses Stop inside the cap', async () => {
  const s = sim({ approveAfter: 40, homeAfter: null, print: () => { throw new Error('stdout gone'); } });
  const readPane = s.deps.readPane;
  let anchored = false;
  s.deps.readPane = async () => { const p = await readPane(); if (p.kind === 'live') { if (anchored) return never(); anchored = true; } return p; };
  const readLog = s.deps.phoneLogRead;
  s.deps.phoneLogRead = async (from) => { if (anchored) throw new Error('adb gone'); return readLog(from); };
  s.deps.writeReport = async () => { throw new Error('disk full'); };
  const r = await run(s, { ...SCALED, PHONE_FAILS_MAX: 1000 });
  assert.equal(r.outcome, 'no-reading:deadline');
  assert.equal(r.actions.fallbackStopLanded.trigger, 'deadline');
  assert.equal(r.capture.withinLimit, true, JSON.stringify(r.capture));
  assert.ok(s.recorder.failures() > 0 && r.reportWriteFailed, 'control: the failures were real');
});

test('HUNG REPORT: a report write that never returns cannot hold the run open', async () => {
  const s = sim({ oldLog: false });
  s.deps.writeReport = () => never();
  const started = Date.now();
  const r = await run(s, SCALED);
  assert.equal(r.reportWriteFailed, true);
  assert.equal(r.outcome, 'ended-by-stimulus');
  assert.ok(Date.now() - started < 3000);
});

test('HUNG ACTION: a test action that never returns does not stop the cap; the case is FAIL with the real Stop', async () => {
  const s = sim({ homeAfter: null, oldLog: false });
  s.deps.pressAction = () => { s.calls.actions.push({ at: Date.now() }); return never(); };
  const r = await run(s, { ...SCALED, ACTION_MS: 100 });
  assert.equal(s.calls.actions.length, 1);
  assert.equal(r.outcome, 'fail:action-did-not-end-capture');
  assert.equal(r.actions.fallbackStopLanded.trigger, 'deadline');
  assert.equal(r.capture.withinLimit, true);
});

test('EMERGENCY: when the Mac’s Stop never lands, the phone-side stop runs once and is reported as such', async () => {
  const s = sim({ homeAfter: null, oldLog: false });
  s.deps.pressStop = async (trigger) => { s.calls.stops.push({ trigger }); return { landed: false }; };
  const r = await run(s, SCALED);
  assert.equal(s.calls.stops.length, SCALED.STOP_ATTEMPTS);
  assert.equal(s.calls.emergency, 1);
  assert.equal(r.actions.emergency, true);
  assert.equal(r.actions.test, null);
});

test('DEADLINE RACE: the stimulus ending the stream as the cap fires — one Stop at most, one outcome, inside the cap (20 runs)', async () => {
  const outcomes = new Set();
  for (let i = 0; i < 20; i++) {
    // The deadline lands ~335 ms after approval (Mac lag 5 − anchor margin 20 + cap 400 − margin 50); the
    // phone ends it anywhere from 25 ms before that to 20 ms after.
    const s = sim({ approveAfter: 40, homeAfter: 310 + (i % 10) * 5, oldLog: false });
    const r = await run(s, SCALED);
    assert.ok(s.calls.stops.length <= 1, `run ${i}: ${s.calls.stops.length} Stops`);
    assert.ok(['ended-by-stimulus', 'no-reading:deadline'].includes(r.outcome), `run ${i}: ${r.outcome}`);
    assert.notEqual(r.capture.withinLimit, false, `run ${i}`);
    if (r.outcome === 'no-reading:deadline') assert.equal(s.calls.afterEnd, 0, 'a deadline Stop got the return as though the stimulus ended it');
    outcomes.add(r.outcome);
  }
  // Printed, not asserted: which side wins is the scheduler's. Both orders are wanted in the window.
  console.log(`deadline race: outcomes seen ${[...outcomes].join(', ')}`);
});

test('the real limits: the 20 s cap holds with pane reads stuck and the recorder failing', { timeout: 40_000 }, async () => {
  assert.equal(DEFAULT_LIMITS.LIMIT_MS, 20_000);
  const s = sim({ approveAfter: 40, homeAfter: null, print: () => { throw new Error('stdout gone'); } });
  const readPane = s.deps.readPane;
  let anchored = false;
  s.deps.readPane = async () => { const p = await readPane(); if (p.kind === 'live') { if (anchored) return never(); anchored = true; } return p; };
  const r = await run(s, { ...DEFAULT_LIMITS, PANE_POLL_MS: 5, PHONE_POLL_MS: 50, OBSERVE_MS: 100, SAMPLE_MS: 50 });
  assert.equal(r.actions.fallbackStopLanded.trigger, 'deadline');
  const fromApproval = r.actions.fallbackStopLanded.atMs - s.t.approved;
  assert.ok(fromApproval <= 20_000 && fromApproval >= 18_500, `Stop ${fromApproval} ms after the camera opened`);
  assert.equal(r.capture.withinLimit, true);
});

// ---- the timed TEST action ------------------------------------------------------------------------------

const ACT = { ...SCALED, ACTION_MS: 100 };

test('HOME: fires once, ACTION_MS after THIS stream is live on the Mac; its end gets the return, and the watch starts from the confirmed return', async () => {
  const s = sim({ homeAfter: null, liveLag: 150, reopenAfter: 60 });
  const r = await run(s, ACT);
  assert.equal(s.calls.actions.length, 1);
  assert.equal(s.calls.actions[0].paneKind, 'live');
  const afterLive = r.actions.test.atMs - r.liveAt;
  assert.ok(afterLive >= ACT.ACTION_MS - 2 && afterLive < ACT.ACTION_MS + 40, `action ${afterLive} ms after live`);
  assert.equal(r.outcome, 'ended-by-stimulus');
  assert.equal(r.productEnding.reason, 'left-screen');
  assert.deepEqual(s.calls.stops, []);
  assert.equal(r.observation.from, 'confirmed-return');
  assert.equal(r.observation.atMs, r.afterEnd.reopenedAt);
  assert.ok(r.samples.length >= 1);
  assert.equal(s.calls.ctx.streamId, STREAM);
});

test('LATE HOME: the owner’s own Home before the driver’s — the product ending is kept, the scripted procedure is NO READING', async () => {
  const s = sim({ homeAfter: 40, liveLag: 5 }); // the phone ends it 40 ms after approval; the action is due at live + 100
  const r = await run(s, ACT);
  assert.deepEqual(s.calls.actions, [], 'the driver sent its Home after the stream had already ended');
  assert.equal(r.outcome, 'no-reading:ended-before-action');
  assert.equal(r.actions.test, null);
  assert.equal(r.productEnding.reason, 'left-screen', 'the product’s ending is still recorded');
  assert.equal(s.calls.afterEnd, 1, 'the return and the watch still ran');
});

test('HOME: never fires on a pending request (no approval, the request expires)', async () => {
  const s = sim({ approveAfter: null, expireAfter: 500, oldLog: false });
  const r = await run(s, ACT);
  assert.deepEqual(s.calls.actions, []);
  assert.equal(r.outcome, 'no-reading:expired-without-capture');
});

test('HOME: never fires on a stale event (the 22:10 attached line in the log, no approval)', async () => {
  const s = sim({ approveAfter: null, expireAfter: 500 });
  const r = await run(s, ACT);
  assert.deepEqual(s.calls.actions, []);
  assert.equal(armed(r).length, 0);
});

test('HOME: never fires when the phone captures but the Mac never shows this stream live', async () => {
  const s = sim({ macLag: 100_000, homeAfter: null });
  const r = await run(s, ACT);
  assert.deepEqual(s.calls.actions, []);
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
});

test('HOME that does not end capture: the deadline presses the real Stop, the case is FAIL, and there is no return', async () => {
  const s = sim({ homeAfter: null, homeWorks: false });
  const r = await run(s, ACT);
  assert.equal(s.calls.actions.length, 1);
  assert.equal(r.outcome, 'fail:action-did-not-end-capture');
  assert.equal(r.actions.fallbackStopLanded.trigger, 'deadline');
  assert.equal(s.calls.afterEnd, 0, 'Sidekick was reopened after a failed shutdown');
});

test('a return that is not confirmed is said: the watch runs from the end and says so', async () => {
  const s = sim({ oldLog: false });
  s.deps.afterEnd = async () => ({ done: false, fail: ['Sidekick did not come to the front'] });
  const r = await run(s, SCALED);
  assert.equal(r.observation.from, 'end — the return was NOT confirmed');
});

// ---- parsing, the instrument, the recorder ---------------------------------------------------------------

test('parsePhoneLine returns only the 8 characters the phone prints, and reads the new milestone lines', () => {
  const p = parsePhoneLine(OLD_ATTACHED);
  assert.deepEqual([p.kind, p.prefix, p.peer], ['attached', '7c0a8542', 'Chetans-MacBook-Pro']);
  assert.equal(parsePhoneLine('2026-10-02T22:11:02.002+05:30 I [camera] Camera bound: front, epoch 1').prefix, null);
  const running = parsePhoneLine('x I [camera] Camera stream 7d1e2f3a… running: first frame 960 × 720 from the back camera, epoch 0');
  assert.deepEqual([running.kind, running.prefix, running.width, running.facing], ['running', '7d1e2f3a', 960, 'back']);
  assert.equal(parsePhoneLine('x I [camera] Camera stream 7d1e2f3a… switch confirmed: first frame 960 × 720 from the front camera, epoch 1').kind, 'switch-confirmed');
  const released = parsePhoneLine('x I [camera] Camera released (closed): 7d1e2f3a… back epoch 0 — 1 released of 1 bound');
  assert.deepEqual([released.kind, released.prefix, released.why], ['released', '7d1e2f3a', 'closed']);
});

test('every phone line the parser depends on is still written, word for word, by the phone’s source', () => {
  const dir = join(HERE, '../camera-module/src/main/java/com/chetan/connectsuite/camera');
  const kinds = new Set();
  for (const { kind, file, fragment } of PHONE_LINE_CONTRACT) {
    assert.ok(readFileSync(join(dir, file), 'utf8').includes(fragment), `${file} no longer writes the ${kind} line: ${fragment}`);
    kinds.add(kind);
  }
  // Control: every kind the parser can return, other than 'other', is pinned to a source line.
  for (const kind of ['tapped', 'attached', 'stopped', 'reattributed', 'closed', 'bound', 'released', 'running', 'request']) {
    assert.ok(kinds.has(kind), `${kind} has no source line in the contract`);
  }
});

test('the page instrument wraps the painter exactly once, and disposal leaves the painter’s own methods', () => {
  class Painter { constructor() { this.n = 0; } paint() { this.n += 1; } draw() {} }
  const p = new Painter();
  const legacy = p.paint.bind(p); p.paint = function (f) { return legacy(f); };
  const ctx = vm.createContext({ camera: { painter: p }, window: {}, Date, Object });
  vm.runInContext(INSTALL_INSTRUMENT, ctx); vm.runInContext(INSTALL_INSTRUMENT, ctx);
  p.paint({});
  assert.equal(ctx.window.__camInstr.paints.length, 1);
  assert.equal(p.n, 1);
  assert.match(vm.runInContext(DISPOSE_INSTRUMENT, ctx), /2 wrapper\(s\), counters removed/);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'paint'), false);
  assert.equal(ctx.window.__camInstr, undefined);
  p.paint({});
  assert.equal(p.n, 2, 'the painter still paints after disposal');
  assert.match(vm.runInContext(DISPOSE_INSTRUMENT, ctx), /0 wrapper\(s\), counters absent/);
});

test('the recorder keeps its own timestamp whatever the caller passes (the 21:33 key collision)', () => {
  const r = createRecorder({ print: () => {} });
  r.note('ended', { at: 1, atMs: 2, iso: 3, what: 4 });
  assert.equal(typeof r.events[0].iso, 'string');
  assert.equal(r.events[0].what, 'ended');
  assert.equal(r.events[0].data.at, 1);
});
