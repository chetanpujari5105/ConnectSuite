// Local regression tests for the repaired Camera driver. No phone, no Mac app, no request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { runSession, createRecorder, parsePhoneLine, INSTALL_INSTRUMENT, DEFAULT_LIMITS } from './driver-core.mjs';

const SCALED = {
  LIMIT_MS: 400, DEADLINE_MARGIN_MS: 50, ANCHOR_MARGIN_MS: 20, APPROVAL_MS: 1200, ACK_MS: 100, UNCERTAIN_MS: 80,
  PHONE_FAILS_MAX: 3, OBSERVE_MS: 150, AFTER_END_MS: 300, REQUEST_GRACE_MS: 30, PANE_POLL_MS: 5, PHONE_POLL_MS: 20,
  SAMPLE_MS: 40, CALL_TIMEOUT_MS: 60, STOP_ATTEMPT_MS: 60, STOP_ATTEMPTS: 3,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => undefined);
const STREAM = '7d1e2f3a4b5c6d7e8f90a1b2c3d4e5f6';
const OLD_ATTACHED = '2026-10-02T22:10:56.487+05:30 I [camera] Camera stream 7c0a8542… attached for Chetans-MacBook-Pro';

/** The phone's clock is deliberately not the Mac's: lines are stamped two hours off. */
const phoneStamp = () => new Date(Date.now() - 2 * 3600_000).toISOString().replace('Z', '+05:30');

function sim({ approveAfter = 40, homeAfter = 100, expireAfter = null, macLag = 5, liveLag = 20, ackDelay = 10, streamId = STREAM, oldLog = true, homeWorks = true, print = () => {} } = {}) {
  const prefix = streamId.slice(0, 8);
  const phone = { inode: 848963, buf: Buffer.from('') };
  const add = (body) => { phone.buf = Buffer.concat([phone.buf, Buffer.from(`${phoneStamp()} I [camera] ${body}\n`)]); };
  if (oldLog) {
    // The last 40 lines before the request hold the 22:10 session's attached line (the 22:38 fault).
    // 14 older lines, the 22:10 attached line, then 25 newer ones: like the real log, it stays inside the last
    // 40 lines even after the request's own lines are written.
    const filler = (n, o) => Array.from({ length: n }, (_, i) => `2026-10-02T22:3${(i + o) % 10}:00.000+05:30 I [vitals] battery.state ${i + o}\n`).join('');
    phone.buf = Buffer.from(filler(14, 0) + `${OLD_ATTACHED}\n` + filler(25, 14));
  }
  const calls = { stops: [], requests: 0, emergency: 0, reports: 0, afterEnd: 0, actions: [], ctx: null };
  const t = { request: null, approved: null, ended: null, endReason: null, stoppedByMac: null };
  const recorder = createRecorder({ print });
  let idOverride = null;
  const pane = () => {
    const idle = { kind: 'idle', streamId: null, reason: null, stop: 0, cancel: 0, request: ['Ask phone for camera'], text: 'idle', canvasCss: [0, 0] };
    if (t.request === null) return idle;
    const since = Date.now() - t.request;
    const id = idOverride ?? (since >= ackDelay ? streamId : null);
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
      add('camera.request from Chetans-MacBook-Pro: Ack, ShowRequest, ArmTimer');
      if (approveAfter !== null) timers.push(setTimeout(() => {
        if (t.ended !== null) return;
        t.approved = Date.now();
        add(`Start camera tapped for ${prefix}…: CancelTimers, ClearRequest, SendState, OpenCamera, ArmTimer`);
        add('Camera bound: back, epoch 0');
        add(`Camera stream ${prefix}… attached for Chetans-MacBook-Pro`);
        if (homeAfter !== null) timers.push(setTimeout(() => {
          if (t.ended !== null) return;
          t.ended = Date.now(); t.endReason = 'left-screen';
          add('Camera stream closed: 30 sent / 0 dropped (0 evicted, 0 oversize, 0 unencoded)');
          add(`Camera stream ${prefix}… stopped: LEFT_SCREEN — 30 sent / 0 dropped`);
        }, homeAfter));
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
      if (t.ended === null) { t.ended = Date.now(); t.endReason = 'stopped-by-mac'; t.stoppedByMac = Date.now(); add(`Camera stream ${prefix}… stopped: STOPPED_BY_MAC — 0 sent / 0 dropped`); }
      return { landed: true, atMs: Date.now() };
    },
    emergencyStop: async () => { calls.emergency += 1; },
    phoneLogMark: async () => ({ inode: phone.inode, size: phone.buf.length }),
    phoneLogRead: async (from) => ({ inode: phone.inode, size: phone.buf.length, text: phone.buf.subarray(from).toString('utf8'), consumedTo: phone.buf.length }),
    afterEnd: async (ctx) => { calls.afterEnd += 1; calls.ctx = ctx; await sleep(30); return { done: true, returnedAt: Date.now() }; },
    pressAction: async () => {
      calls.actions.push({ at: Date.now(), paneKind: pane().kind });
      if (homeWorks && t.ended === null) {
        t.ended = Date.now(); t.endReason = 'left-screen';
        add('Camera stream closed: 30 sent / 0 dropped (0 evicted, 0 oversize, 0 unencoded)');
        add(`Camera stream ${prefix}… stopped: LEFT_SCREEN — 30 sent / 0 dropped`);
      }
      return { landed: true };
    },
    sampleAfter: async () => ({ clients: '[]' }),
    readInstr: async () => ({ draws: [] }),
    writeReport: async () => { calls.reports += 1; },
  };
  return { deps, calls, t, phone, add, recorder, setId: (id) => { idOverride = id; }, cleanup: () => timers.forEach(clearTimeout) };
}
const armed = (r) => r.events.filter((e) => e.what === 'capture deadline armed');

// ---- the 22:38 fault ------------------------------------------------------------------------------

test('STALE: the 22:10 attached line still in the last 40 lines never arms the capture timer and never cancels at 19.5 s', async () => {
  const s = sim({ approveAfter: null, expireAfter: 700 }); // well past the scaled 400 ms cap
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(armed(r).length, 0, 'the capture timer was armed with no capture');
  assert.equal(r.anchor, null);
  assert.deepEqual(s.calls.stops, [], `a Stop/Cancel was pressed: ${JSON.stringify(s.calls.stops)}`);
  assert.equal(r.outcome, 'no-reading:expired-without-capture');
  assert.ok(r.ended.atMs - r.requestAt >= 700, 'the request ended before the phone expired it');
  assert.ok(!r.freshPhoneLines.some((l) => l.line.includes('7c0a8542')), 'the stale line was read as fresh');
  // Control: the stale line really is within the last 40 lines of the log the driver started from.
  const before = s.phone.buf.subarray(0, r.phoneLogStart.size).toString('utf8').trimEnd().split('\n');
  assert.ok(before.slice(-40).includes(OLD_ATTACHED), 'control: the stale line is in the last 40 at the mark');
  const after = s.phone.buf.toString('utf8').trimEnd().split('\n');
  assert.ok(after.slice(-40).includes(OLD_ATTACHED), 'control: and still in the last 40 after the request was written');
});

test('a fresh attachment for an unrelated stream never arms; it stops the attempt safely as NO READING', async () => {
  const s = sim({ approveAfter: null, expireAfter: 2000 });
  setTimeout(() => s.add('Camera stream deadbeef… attached for Other-Mac'), 60);
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(armed(r).length, 0);
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /another stream/);
  assert.equal(s.calls.stops.length, 1);
  assert.ok(s.calls.stops[0].sinceRequest < 250, `the shutdown waited ${s.calls.stops[0].sinceRequest} ms`);
});

test('delayed approval: the cap starts at this stream’s start on the Mac, not at the request — approval and cap are separate', async () => {
  const s = sim({ approveAfter: 600, homeAfter: 100 }); // approval later than the whole scaled cap
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(r.outcome, 'ended-by-stimulus');
  assert.equal(armed(r).length, 1);
  assert.match(r.anchorSource, /Mac state (connecting|live) for this stream id/);
  const anchorAfterApproval = r.anchor - s.t.approved;
  assert.ok(anchorAfterApproval >= -SCALED.ANCHOR_MARGIN_MS - 5 && anchorAfterApproval < 60, `anchor ${anchorAfterApproval} ms from approval`);
  assert.deepEqual(s.calls.stops, []);
  assert.equal(s.calls.afterEnd, 1);
  assert.ok(r.capture.withinLimit);
});

test('duplicate and out-of-order events: this stream’s attach seen before the Mac’s start, twice — armed once, no shutdown', async () => {
  const s = sim({ approveAfter: 40, macLag: 60, homeAfter: 150 }); // the phone lines precede the Mac's connecting
  setTimeout(() => s.add(`Camera stream ${STREAM.slice(0, 8)}… attached for Chetans-MacBook-Pro`), 45);
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(armed(r).length, 1);
  assert.equal(r.shutdown, null);
  assert.equal(r.outcome, 'ended-by-stimulus');
  assert.ok(r.freshPhoneLines.filter((l) => l.kind === 'attached').length >= 2, 'control: the duplicate was there');
});

test('phone shows capture but the Mac never shows this stream starting: safe shutdown within the uncertainty bound', async () => {
  const s = sim({ approveAfter: 40, macLag: 100_000, homeAfter: null });
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /never showed this stream starting/);
  assert.equal(armed(r).length, 0);
  const waited = s.calls.stops[0].at - s.t.approved;
  assert.ok(waited < SCALED.UNCERTAIN_MS + 3 * SCALED.PHONE_POLL_MS + 40, `shutdown ${waited} ms after the phone started`);
});

test('log rotation and truncation stop the attempt; there is no fallback to last-N lines', async () => {
  for (const kind of ['rotation', 'truncation']) {
    const s = sim({ approveAfter: null, expireAfter: 2000 });
    setTimeout(() => {
      if (kind === 'rotation') { s.phone.inode = 999; s.phone.buf = Buffer.from(`${OLD_ATTACHED}\n`); }
      else s.phone.buf = s.phone.buf.subarray(0, 100);
    }, 50);
    const r = await runSession(s.deps, SCALED);
    s.cleanup();
    assert.equal(r.outcome, 'no-reading:safe-shutdown', kind);
    assert.match(r.shutdown.reason, /rotated or was truncated/, kind);
    assert.equal(armed(r).length, 0, kind);
    assert.ok(!r.freshPhoneLines.some((l) => l.line.includes('7c0a8542')), `${kind}: the stale line was read after the rotation`);
  }
});

test('expiry with no capture completes its watch and report, with no Stop', async () => {
  const s = sim({ approveAfter: null, expireAfter: 200, oldLog: false });
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(r.outcome, 'no-reading:expired-without-capture');
  assert.deepEqual(s.calls.stops, []);
  assert.ok(r.samples.length >= 2);
  assert.equal(s.calls.reports, 1);
  assert.doesNotThrow(() => JSON.stringify(r));
});

test('recorder, pane and phone-log failures during real capture: the deadline still presses Stop inside the cap', async () => {
  const s = sim({ approveAfter: 40, homeAfter: null, print: () => { throw new Error('stdout gone'); } });
  const readPane = s.deps.readPane;
  let anchored = false;
  s.deps.readPane = async () => { const p = await readPane(); if (p.kind === 'live') { if (anchored) return never(); anchored = true; } return p; };
  const readLog = s.deps.phoneLogRead;
  s.deps.phoneLogRead = async (from) => { if (anchored) throw new Error('adb gone'); return readLog(from); };
  s.deps.writeReport = async () => { throw new Error('disk full'); };
  const r = await runSession(s.deps, { ...SCALED, PHONE_FAILS_MAX: 1000 });
  s.cleanup();
  assert.equal(r.outcome, 'no-reading:deadline');
  assert.equal(r.stopLanded.trigger, 'deadline');
  assert.equal(r.capture.withinLimit, true, JSON.stringify(r.capture));
  assert.ok(s.recorder.failures() > 0 && r.reportWriteFailed, 'control: the failures were real');
});

test('the Mac’s stream id changing under the attempt stops it safely', async () => {
  const s = sim({ approveAfter: 40, homeAfter: null });
  setTimeout(() => s.setId('ffffffffffffffffffffffffffffffff'), 100);
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /stream id changed/);
});

test('no stream id from the ack stops the attempt safely, and nothing is armed', async () => {
  const s = sim({ approveAfter: null, ackDelay: 100_000, expireAfter: 2000 });
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
  assert.match(r.shutdown.reason, /no stream id/);
  assert.equal(armed(r).length, 0);
});

test('a normal case A: this stream live, Home ends it, the return, the watch — phone lines matched by prefix-8 and said so', async () => {
  const s = sim();
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(r.outcome, 'ended-by-stimulus');
  assert.equal(r.ended.reason, 'left-screen');
  assert.equal(r.streamId, STREAM);
  assert.equal(r.prefix, STREAM.slice(0, 8));
  const matched = r.events.filter((e) => e.what === 'phone (fresh)' && e.data.prefix);
  assert.ok(matched.length >= 2 && matched.every((e) => e.data.match === 'prefix-8'), JSON.stringify(matched.map((e) => e.data)));
  assert.deepEqual(s.calls.stops, []);
  assert.ok(r.afterEnd && r.afterEnd.done);
});

test('parsePhoneLine returns only the 8 characters the phone prints, never a full id', () => {
  const p = parsePhoneLine(OLD_ATTACHED);
  assert.equal(p.kind, 'attached');
  assert.equal(p.prefix, '7c0a8542');
  assert.equal(p.peer, 'Chetans-MacBook-Pro');
  assert.equal(parsePhoneLine('2026-10-02T22:11:02.002+05:30 I [camera] Camera bound: front, epoch 1').prefix, null);
});

test('the page instrument wraps the painter exactly once', () => {
  class Painter { constructor() { this.n = 0; } paint() { this.n += 1; } draw() {} }
  const p = new Painter();
  const legacy = p.paint.bind(p); p.paint = function (f) { return legacy(f); };
  const ctx = vm.createContext({ camera: { painter: p }, window: {}, Date, Object });
  vm.runInContext(INSTALL_INSTRUMENT, ctx); vm.runInContext(INSTALL_INSTRUMENT, ctx);
  p.paint({});
  assert.equal(ctx.window.__camInstr.paints.length, 1);
  assert.equal(p.n, 1);
});

test('the recorder keeps its own timestamp whatever the caller passes', () => {
  const r = createRecorder({ print: () => {} });
  r.note('ended', { at: 1, atMs: 2, iso: 3, what: 4 });
  assert.equal(typeof r.events[0].iso, 'string');
  assert.equal(r.events[0].data.at, 1);
});

test('the real limits: the 20 s cap holds with pane reads stuck and the recorder failing', { timeout: 40_000 }, async () => {
  assert.equal(DEFAULT_LIMITS.LIMIT_MS, 20_000);
  const s = sim({ approveAfter: 40, homeAfter: null, print: () => { throw new Error('stdout gone'); } });
  const readPane = s.deps.readPane;
  let anchored = false;
  s.deps.readPane = async () => { const p = await readPane(); if (p.kind === 'live') { if (anchored) return never(); anchored = true; } return p; };
  const r = await runSession(s.deps, { ...DEFAULT_LIMITS, PANE_POLL_MS: 5, PHONE_POLL_MS: 50, OBSERVE_MS: 100, SAMPLE_MS: 50 });
  s.cleanup();
  assert.equal(r.stopLanded.trigger, 'deadline');
  const fromApproval = r.stopLanded.atMs - s.t.approved;
  assert.ok(fromApproval <= 20_000 && fromApproval >= 18_500, `Stop ${fromApproval} ms after the camera opened`);
  assert.equal(r.capture.withinLimit, true);
});

test('a pane that is not idle aborts before any request, and the report still completes', async () => {
  const s = sim();
  s.deps.readPane = async () => ({ kind: 'live', streamId: STREAM, stop: 1, cancel: 0, request: [], text: 'Live', canvasCss: [1, 1] });
  const r = await runSession(s.deps, SCALED);
  s.cleanup();
  assert.equal(r.outcome, 'aborted-before-request');
  assert.equal(s.calls.requests, 0);
  assert.equal(r.phoneLogStart, null);
});

// ---- the timed Home action ----------------------------------------------------------------------------

const ACT = { ...SCALED, ACTION_MS: 100 };

test('HOME: fires once, ACTION_MS after THIS stream is live on the Mac, and its end gets the return and the watch', async () => {
  const s = sim({ homeAfter: null, liveLag: 150 }); // a long connecting → live gap separates the two anchors
  const r = await runSession(s.deps, ACT);
  s.cleanup();
  assert.equal(s.calls.actions.length, 1);
  assert.equal(s.calls.actions[0].paneKind, 'live', 'the action was sent while the stream was not live');
  const afterLive = r.actionAt - r.liveAt;
  assert.ok(afterLive >= ACT.ACTION_MS - 2 && afterLive < ACT.ACTION_MS + 40, `action ${afterLive} ms after live`);
  assert.equal(r.outcome, 'ended-by-stimulus');
  assert.equal(r.ended.reason, 'left-screen');
  assert.deepEqual(s.calls.stops, []);
  assert.equal(s.calls.afterEnd, 1);
  assert.equal(s.calls.ctx.prefix, STREAM.slice(0, 8));
  assert.equal(s.calls.ctx.streamId, STREAM);
});

test('HOME: never fires on a pending request (no approval, the request expires)', async () => {
  const s = sim({ approveAfter: null, expireAfter: 500, oldLog: false });
  const r = await runSession(s.deps, ACT);
  s.cleanup();
  assert.deepEqual(s.calls.actions, []);
  assert.equal(r.outcome, 'no-reading:expired-without-capture');
});

test('HOME: never fires on a stale event (the 22:10 attached line in the log, no approval)', async () => {
  const s = sim({ approveAfter: null, expireAfter: 500 });
  const r = await runSession(s.deps, ACT);
  s.cleanup();
  assert.deepEqual(s.calls.actions, []);
  assert.equal(r.events.filter((e) => e.what === 'capture deadline armed').length, 0);
});

test('HOME: never fires when the phone captures but the Mac never shows this stream live', async () => {
  const s = sim({ macLag: 100_000, homeAfter: null });
  const r = await runSession(s.deps, ACT);
  s.cleanup();
  assert.deepEqual(s.calls.actions, []);
  assert.equal(r.outcome, 'no-reading:safe-shutdown');
});

test('HOME that does not end capture: the deadline presses the real Stop, the case is FAIL, and there is no return', async () => {
  const s = sim({ homeAfter: null, homeWorks: false });
  const r = await runSession(s.deps, ACT);
  s.cleanup();
  assert.equal(s.calls.actions.length, 1);
  assert.equal(r.outcome, 'fail:action-did-not-end-capture');
  assert.equal(r.stopLanded.trigger, 'deadline');
  assert.equal(r.capture.withinLimit, true);
  assert.equal(s.calls.afterEnd, 0, 'Sidekick was reopened after a failed shutdown');
});
