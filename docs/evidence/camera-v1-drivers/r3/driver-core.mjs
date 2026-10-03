// The Camera retry driver's decisions, with every effect injected so a local test can run them.
//
// The capture deadline is the property that matters most, so it is built to survive everything else:
//   - it is a timer armed at the earliest attachment observation, and the anchor only ever moves EARLIER
//     (a later observation never re-arms it), so it cannot be extended;
//   - it does not run through the recorder, the pane loop or the report — none of those can delay it;
//   - a Stop attempt that hangs or fails does not block it: the deadline (and the ceiling) start a fresh
//     attempt even while an earlier one is still in flight;
//   - every dependency call the session loop makes is bounded by a timeout.
// Nothing here saves an image; the page instrument records draw/paint *times* only.

export const DEFAULT_LIMITS = Object.freeze({
  LIMIT_MS: 20_000, // hard capture deadline, from the earliest attachment observation
  DEADLINE_MARGIN_MS: 500, // the deadline fires this much early, so its Stop lands inside the limit
  PLANNED_MS: 15_000, // the planned real Stop
  SWITCH_MS: 5_000, // rear -> front, after the first live picture
  CEILING_MS: 55_000, // from the request: 30 s approval + 5 s slack + 20 s
  OBSERVE_MS: 60_000, // after the end
  REQUEST_GRACE_MS: 1_000,
  PANE_POLL_MS: 100,
  PHONE_POLL_MS: 1_000,
  SAMPLE_MS: 2_000,
  SCREEN_AFTER_MS: 3_000,
  CALL_TIMEOUT_MS: 3_000, // any one dependency call
  STOP_ATTEMPT_MS: 3_000,
  STOP_ATTEMPTS: 3,
});

/**
 * The recorder. Each event's own fields are `atMs`, `iso`, `t` and `what`; whatever the caller passes
 * lives under `data`, so nothing a caller passes can overwrite a timestamp (the 21:33 crash: an
 * `ended` object's numeric `at` replaced the event's ISO `at`, and `.slice` threw). It never throws.
 */
export function createRecorder({ now = Date.now, print = console.log, t0 = now() } = {}) {
  const events = [];
  let failures = 0;
  function note(what, data) {
    let at;
    try {
      at = now();
      const event = { atMs: at, iso: new Date(at).toISOString(), t: (at - t0) / 1000, what: String(what), data: data ?? null };
      events.push(event);
      let shown = '';
      try { shown = data === undefined ? '' : ' ' + JSON.stringify(data); } catch { shown = ' [data not serialisable]'; failures += 1; }
      try { print(`${event.iso.slice(11, 23)} +${event.t.toFixed(3)}s ${event.what}${shown}`); } catch { failures += 1; }
    } catch {
      failures += 1;
    }
  }
  return { note, events, t0, failures: () => failures };
}

function withTimeout(promise, ms, setTimeoutFn, clearTimeoutFn, label) {
  let handle;
  const timeout = new Promise((_, reject) => { handle = setTimeoutFn(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); });
  return Promise.race([Promise.resolve().then(() => promise), timeout]).finally(() => clearTimeoutFn(handle));
}

/**
 * The page instrument, installed once per page. Earlier wrappers are own properties on the painter
 * instance; deleting them restores the prototype's methods, which are then wrapped exactly once.
 */
export const INSTALL_INSTRUMENT = `(function(){
  if (typeof camera === 'undefined' || !camera || !camera.painter) return 'no painter';
  var p = camera.painter, proto = Object.getPrototypeOf(p);
  if (typeof proto.paint !== 'function' || typeof proto.draw !== 'function') return 'no prototype methods';
  var removed = 0;
  if (Object.prototype.hasOwnProperty.call(p, 'paint')) { delete p.paint; removed++; }
  if (Object.prototype.hasOwnProperty.call(p, 'draw')) { delete p.draw; removed++; }
  if (p.paint !== proto.paint || p.draw !== proto.draw) return 'could not restore the originals';
  var instr = { paints: [], draws: [], stopAt: null };
  window.__camInstr = instr;
  var paint = proto.paint, draw = proto.draw;
  p.paint = function (f) { instr.paints.push(Date.now()); return paint.call(p, f); };
  p.draw = function (b, f) { instr.draws.push(Date.now()); return draw.call(p, b, f); };
  p.paint.__camWrapper = true; p.draw.__camWrapper = true;
  return 'installed once (removed ' + removed + ' earlier wrapper(s))';
})()`;

/**
 * One session. `d` supplies: now, setTimeout, clearTimeout, sleep, recorder, readPane, pressRequest,
 * pressSwitch, pressStop(trigger), emergencyStop, phoneLines, sampleAfter, phoneScreen, readInstr,
 * writeReport. Resolves with the report; never rejects.
 */
export async function runSession(d, limits = DEFAULT_LIMITS) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const { note } = d.recorder;
  const call = async (label, fn, ms = L.CALL_TIMEOUT_MS) => {
    try { return await withTimeout(fn(), ms, d.setTimeout, d.clearTimeout, label); }
    catch (e) { note(`${label} failed`, { error: String(e && e.message ? e.message : e).slice(0, 200) }); return undefined; }
  };
  const st = {
    requestAt: null, anchor: null, anchorSource: null, liveAt: null, switchAt: null, switchResult: null,
    stopTriggers: [], stopLanded: null, emergency: false, ended: null, finished: false,
    plannedH: null, deadlineH: null, ceilingH: null, switchH: null,
  };
  let stopChain = null;
  const phone = new Map();

  function arm(t, source) {
    if (st.anchor !== null && st.anchor <= t) return; // the anchor only moves earlier
    st.anchor = t;
    st.anchorSource = source;
    if (st.plannedH !== null) d.clearTimeout(st.plannedH);
    if (st.deadlineH !== null) d.clearTimeout(st.deadlineH);
    if (L.PLANNED_MS !== null) st.plannedH = d.setTimeout(() => { stop('planned'); }, Math.max(0, t + L.PLANNED_MS - d.now()));
    st.deadlineH = d.setTimeout(() => { stop('deadline'); }, Math.max(0, t + L.LIMIT_MS - L.DEADLINE_MARGIN_MS - d.now()));
    note('capture deadline armed', { source, deadlineInMs: t + L.LIMIT_MS - d.now(), limitMs: L.LIMIT_MS });
  }

  async function attemptStop(trigger) {
    for (let attempt = 1; attempt <= L.STOP_ATTEMPTS && !st.stopLanded; attempt++) {
      const result = await call(`stop attempt ${attempt} (${trigger})`, () => d.pressStop(trigger), L.STOP_ATTEMPT_MS);
      note('stop attempt', { trigger, attempt, result: result ?? null });
      if (result && result.landed && !st.stopLanded) {
        st.stopLanded = { trigger, attempt, atMs: result.atMs ?? d.now(), result };
        return;
      }
    }
    if (!st.stopLanded && !st.emergency) {
      st.emergency = true;
      note('EMERGENCY: the Mac Stop did not land; ending capture from the phone instead');
      await call('emergency stop', () => d.emergencyStop(), 10_000);
    }
  }

  /** Planned, deadline and ceiling all come here. Only the deadline and ceiling may start a second chain. */
  function stop(trigger) {
    if (st.stopLanded) return stopChain;
    st.stopTriggers.push({ trigger, atMs: d.now() });
    note(`STOP requested (${trigger})`);
    if (stopChain && trigger === 'planned') return stopChain;
    const chain = attemptStop(trigger);
    stopChain = stopChain ? Promise.allSettled([stopChain, chain]) : chain;
    return stopChain;
  }

  function scheduleSwitch() {
    if (st.switchH !== null || L.SWITCH_MS === null) return;
    st.switchH = d.setTimeout(async () => {
      if (st.stopTriggers.length || st.ended) return;
      st.switchAt = d.now();
      st.switchResult = (await call('switch', () => d.pressSwitch())) ?? null;
      note('switch result', { result: st.switchResult });
    }, Math.max(0, st.liveAt + L.SWITCH_MS - d.now()));
  }

  // ---- the request -----------------------------------------------------------------------------
  const before = await call('read pane', () => d.readPane());
  if (!before || before.request.length !== 1 || before.stop !== 0 || before.cancel !== 0) {
    note('ABORT: the pane is not idle with exactly one request button', { before: before ?? null });
    return finish('aborted-before-request');
  }
  st.requestAt = d.now();
  const requested = await call('press request', () => d.pressRequest());
  note('REQUEST pressed once', { landed: !!requested });
  if (!requested) return finish('request-did-not-land');
  st.ceilingH = d.setTimeout(() => { if (!st.ended && !st.stopLanded) stop('ceiling'); }, L.CEILING_MS);

  // ---- the phone's log, polled alongside -----------------------------------------------------------
  const phoneLoop = (async () => {
    while (!st.finished) {
      const lines = (await call('read phone log', () => d.phoneLines())) ?? [];
      for (const line of lines) {
        if (phone.has(line)) continue;
        phone.set(line, d.now());
        if (line.includes(' attached for ') && st.anchor === null) {
          note('phone log: attached seen before the Mac showed it');
          arm(st.requestAt, 'request press (attachment seen only in the phone log, which is polled late)');
        }
      }
      await d.sleep(L.PHONE_POLL_MS);
    }
  })();

  // ---- the Mac pane --------------------------------------------------------------------------------
  let last = '';
  while (!st.stopTriggers.length && !st.ended) {
    const p = await call('read pane', () => d.readPane());
    if (p) {
      const key = JSON.stringify([p.stop, p.cancel, p.switchLabel, (p.text || '').slice(0, 60)]);
      if (key !== last) { note('pane', { stop: p.stop, cancel: p.cancel, switchLabel: p.switchLabel, text: (p.text || '').slice(0, 160), canvasCss: p.canvasCss }); last = key; }
      if (p.stop === 1 && st.anchor === null) arm(d.now(), 'Mac Stop button (shown on starting, before the phone attaches)');
      if (st.liveAt === null && /^Live · /.test(p.text || '') && p.canvasCss && p.canvasCss[0] > 0) {
        st.liveAt = d.now();
        if (st.anchor === null) arm(st.requestAt, 'request press (live seen with no attachment observed)');
        note('first live picture on the Mac');
        scheduleSwitch();
      }
      if (p.stop === 0 && p.cancel === 0 && d.now() - st.requestAt > L.REQUEST_GRACE_MS && !/^Live/.test(p.text || '')) {
        st.ended = { atMs: d.now(), text: (p.text || '').slice(0, 240) };
        note('ENDED without a Mac Stop — no retry', { text: st.ended.text });
      }
    }
    await d.sleep(L.PANE_POLL_MS);
  }
  // The deadline may add a second chain while the first is in flight, so wait until none was added.
  for (let chain = stopChain; chain; chain = chain === stopChain ? null : stopChain) await chain;
  if (st.stopTriggers.length && !st.stopLanded && !st.emergency) {
    // The pane loop left because a stop was requested; wait for the deadline's chain if it is still to come.
    while (!st.stopLanded && !st.emergency && d.now() - st.requestAt < L.CEILING_MS + L.STOP_ATTEMPTS * L.STOP_ATTEMPT_MS) {
      await d.sleep(L.PANE_POLL_MS);
      for (let chain = stopChain; chain; chain = chain === stopChain ? null : stopChain) await chain;
    }
  }
  for (const h of [st.plannedH, st.deadlineH, st.ceilingH, st.switchH]) if (h !== null) d.clearTimeout(h);

  // ---- after the end -------------------------------------------------------------------------------
  const endAt = st.stopLanded ? st.stopLanded.atMs : st.ended ? st.ended.atMs : d.now();
  let screen = null;
  if (st.stopTriggers.length) {
    await d.sleep(Math.max(0, endAt + L.SCREEN_AFTER_MS - d.now()));
    screen = (await call('read phone screen', () => d.phoneScreen(), 10_000)) ?? null;
    note('phone screen after stop', { screen });
  }
  note('observing', { forMs: L.OBSERVE_MS });
  const samples = [];
  while (d.now() - endAt < L.OBSERVE_MS) {
    const s = await call('sample', () => d.sampleAfter(), 10_000);
    samples.push({ t: (d.now() - d.recorder.t0) / 1000, ...(s ?? { unread: true }) });
    await d.sleep(L.SAMPLE_MS);
  }
  const instr = (await call('read instrument', () => d.readInstr())) ?? null;
  return finish(st.stopLanded ? 'stopped' : st.ended ? 'ended-without-stop' : 'unresolved', { samples, instr, screen });

  async function finish(outcome, extra = {}) {
    st.finished = true;
    for (const h of [st.plannedH, st.deadlineH, st.ceilingH, st.switchH]) if (h !== null) d.clearTimeout(h);
    const captureMs = st.anchor !== null && st.stopLanded ? st.stopLanded.atMs - st.anchor : null;
    const report = {
      outcome,
      limits: L,
      requestAt: st.requestAt, anchor: st.anchor, anchorSource: st.anchorSource, liveAt: st.liveAt,
      switchAt: st.switchAt, switchResult: st.switchResult,
      stopTriggers: st.stopTriggers, stopLanded: st.stopLanded, emergency: st.emergency,
      ended: st.ended,
      capture: { anchorToStopMs: captureMs, withinLimit: captureMs === null ? null : captureMs <= L.LIMIT_MS },
      phoneLines: [...phone.entries()].map(([line, seenAt]) => ({ line, seenAt })),
      recorderFailures: d.recorder.failures(),
      events: d.recorder.events,
      ...extra,
    };
    try { await d.writeReport(report); } catch (e) { note('report write failed', { error: String(e).slice(0, 200) }); report.reportWriteFailed = true; }
    return report;
  }
}
