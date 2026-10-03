// Camera lifecycle driver, repaired after the 22:38 case A NO READING.
//
// That run's fault: the phone-log poller read the last 40 lines, found the 22:10 session's `attached`
// line, took it for this request's, and armed the 20 s capture timer at the request press — so the
// capture cap became an approval window and cancelled the request at 19.5 s.
//
// The rules now:
//  - Freshness: the phone log is read from a byte offset taken, with the file's inode, BEFORE the
//    request. Nothing written before it is ever parsed. A changed inode or a shorter file is a
//    rotation or truncation, and the run stops safely as NO READING — never falls back to last-N lines.
//  - Identity: this attempt's stream id is the FULL 32-hex id the Mac's own state carries after the ack.
//    The phone logs only 8 characters; those lines are matched as `prefix-8`, and recorded as such.
//  - The capture timer arms ONLY on the Mac's own state showing THIS stream id starting (`connecting`)
//    or live, minus a margin. Never on the request, never on a phone line.
//  - Phone evidence of capture (this stream's tap or attach, or any fresh `Camera bound`) with no Mac
//    anchor within UNCERTAIN_MS is uncertainty: the run shuts down safely as NO READING.
//  - Approval has its own window (APPROVAL_MS from the request); the 20 s cap starts at the anchor.
//  - Phone and Mac timestamps are never compared: phone lines are ordered on the phone's clock, and the
//    driver times everything on the Mac's.
//  - The deadline is a timer that does not run through the recorder, the pane loop or the report.

export const DEFAULT_LIMITS = Object.freeze({
  LIMIT_MS: 20_000, // hard capture cap from the anchor
  DEADLINE_MARGIN_MS: 500, // the deadline fires this much early so its Stop lands inside the cap
  ANCHOR_MARGIN_MS: 500, // the anchor is set this much before the Mac saw the stream start
  APPROVAL_MS: 40_000, // from the request: the phone's 30 s expiry + slack; then cancel, NO READING
  ACK_MS: 5_000, // this attempt's stream id must be readable by then
  UNCERTAIN_MS: 2_000, // phone capture evidence with no Mac anchor for this long → safe shutdown
  PHONE_FAILS_MAX: 3, // consecutive phone-log read failures while active → safe shutdown
  OBSERVE_MS: 60_000,
  AFTER_END_MS: 240_000,
  REQUEST_GRACE_MS: 1_000,
  PANE_POLL_MS: 100,
  PHONE_POLL_MS: 1_000,
  SAMPLE_MS: 2_000,
  CALL_TIMEOUT_MS: 3_000,
  STOP_ATTEMPT_MS: 3_000,
  STOP_ATTEMPTS: 3,
  PEER: 'Chetans-MacBook-Pro',
});

export function createRecorder({ now = Date.now, print = console.log, t0 = now() } = {}) {
  const events = [];
  let failures = 0;
  function note(what, data) {
    try {
      const at = now();
      const event = { atMs: at, iso: new Date(at).toISOString(), t: (at - t0) / 1000, what: String(what), data: data ?? null };
      events.push(event);
      let shown = '';
      try { shown = data === undefined ? '' : ' ' + JSON.stringify(data); } catch { shown = ' [data not serialisable]'; failures += 1; }
      try { print(`${event.iso.slice(11, 23)} +${event.t.toFixed(3)}s ${event.what}${shown}`); } catch { failures += 1; }
    } catch { failures += 1; }
  }
  return { note, events, t0, failures: () => failures };
}

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
 * One phone `[camera]` line, classified. `prefix` is the 8 hex characters the phone prints — never a
 * full id. Lines without a stream id (`Camera bound`, `Camera stream closed`) carry `prefix: null`.
 */
export function parsePhoneLine(line) {
  const at = line.slice(0, 29);
  let m;
  if ((m = line.match(/Start camera tapped for ([0-9a-f]{8})…/))) return { kind: 'tapped', prefix: m[1], at, line };
  if ((m = line.match(/Camera stream ([0-9a-f]{8})… attached for (.+)$/))) return { kind: 'attached', prefix: m[1], peer: m[2].trim(), at, line };
  if ((m = line.match(/Camera stream ([0-9a-f]{8})… stopped: ([A-Z_]+) — (\d+) sent \/ (\d+) dropped/))) return { kind: 'stopped', prefix: m[1], reason: m[2], sent: +m[3], dropped: +m[4], at, line };
  if ((m = line.match(/Camera stream ([0-9a-f]{8})… had already ended as (\w+) when the Mac's stop arrived; recorded as (\w+)/))) return { kind: 'reattributed', prefix: m[1], from: m[2], to: m[3], at, line };
  if ((m = line.match(/Camera bound: (back|front), epoch (\d+)/))) return { kind: 'bound', prefix: null, facing: m[1], epoch: +m[2], at, line };
  if ((m = line.match(/Camera stream closed: (\d+) sent \/ (\d+) dropped/))) return { kind: 'closed', prefix: null, sent: +m[1], dropped: +m[2], at, line };
  if (line.includes('camera.request from ')) return { kind: 'request', prefix: null, at, line };
  return { kind: 'other', prefix: null, at, line };
}

function withTimeout(promise, ms, setT, clearT, label) {
  let h;
  const timeout = new Promise((_, reject) => { h = setT(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); });
  return Promise.race([Promise.resolve().then(() => promise), timeout]).finally(() => clearT(h));
}

/**
 * d: now, setTimeout, clearTimeout, sleep, recorder, readPane() → {kind, streamId, reason, stop, cancel,
 * request[], text, canvasCss}, pressRequest(), pressStop(trigger), emergencyStop(), phoneLogMark() →
 * {inode, size}, phoneLogRead(fromByte) → {inode, size, text, consumedTo}, afterEnd(), sampleAfter(), readInstr(),
 * writeReport(report).
 */
export async function runSession(d, limits = DEFAULT_LIMITS) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const { note } = d.recorder;
  const call = async (label, fn, ms = L.CALL_TIMEOUT_MS) => {
    try { return await withTimeout(fn(), ms, d.setTimeout, d.clearTimeout, label); }
    catch (e) { note(`${label} failed`, { error: String(e && e.message ? e.message : e).slice(0, 200) }); return undefined; }
  };
  const st = {
    requestAt: null, streamId: null, prefix: null, anchor: null, anchorSource: null, liveAt: null,
    phoneEvidenceAt: null, uncertainH: null, deadlineH: null, approvalH: null, ackH: null,
    stopTriggers: [], stopLanded: null, emergency: false, ended: null, shutdown: null,
    afterEnd: null, finished: false, phoneFails: 0, anomalies: [],
  };
  const fresh = [];
  let stopChain = null;
  let cursor = null;
  let logStart = null;
  let partial = '';

  // ---- stopping ---------------------------------------------------------------------------------
  async function attemptStop(trigger) {
    for (let attempt = 1; attempt <= L.STOP_ATTEMPTS && !st.stopLanded; attempt++) {
      const result = await call(`stop attempt ${attempt} (${trigger})`, () => d.pressStop(trigger), L.STOP_ATTEMPT_MS);
      note('stop attempt', { trigger, attempt, result: result ?? null });
      if (result && result.landed && !st.stopLanded) { st.stopLanded = { trigger, attempt, atMs: result.atMs ?? d.now(), result }; return; }
    }
    if (!st.stopLanded && !st.emergency) {
      st.emergency = true;
      note('EMERGENCY: the Mac control did not land; ending capture from the phone');
      await call('emergency stop', () => d.emergencyStop(), 10_000);
    }
  }
  function stop(trigger) {
    if (st.stopLanded || st.ended) return stopChain;
    st.stopTriggers.push({ trigger, atMs: d.now() });
    note(`STOP requested (${trigger})`);
    if (stopChain && trigger !== 'deadline') return stopChain;
    const chain = attemptStop(trigger);
    stopChain = stopChain ? Promise.allSettled([stopChain, chain]) : chain;
    return stopChain;
  }
  /** Uncertainty or an anomaly: end whatever is open through the real control, and call it NO READING. */
  function safeShutdown(reason, data) {
    if (st.shutdown || st.ended || st.stopLanded) return;
    st.shutdown = { reason, atMs: d.now(), data: data ?? null };
    note('SAFE SHUTDOWN — this attempt is NO READING', { reason, data: data ?? null });
    stop(`safe shutdown: ${reason}`);
  }

  function arm(t, source) {
    if (st.anchor !== null && st.anchor <= t) return; // the anchor only moves earlier
    st.anchor = t;
    st.anchorSource = source;
    if (st.uncertainH !== null) { d.clearTimeout(st.uncertainH); st.uncertainH = null; }
    if (st.deadlineH !== null) d.clearTimeout(st.deadlineH);
    st.deadlineH = d.setTimeout(() => stop('deadline'), Math.max(0, t + L.LIMIT_MS - L.DEADLINE_MARGIN_MS - d.now()));
    note('capture deadline armed', { source, deadlineInMs: t + L.LIMIT_MS - L.DEADLINE_MARGIN_MS - d.now(), limitMs: L.LIMIT_MS });
  }

  // ---- the phone's log, from the offset taken before the request -------------------------------------
  function onPhoneLine(line) {
    const ev = parsePhoneLine(line);
    fresh.push({ ...ev, seenAtMs: d.now() });
    if (ev.kind === 'other' || ev.kind === 'request') return;
    const ours = ev.prefix !== null && st.prefix !== null && ev.prefix === st.prefix;
    if (ev.prefix !== null && st.prefix === null) {
      // A stream-bearing line before this attempt's id is known: it cannot be shown to be ours.
      st.anomalies.push({ why: 'stream line before this attempt’s id was known', line });
      note('phone line before the ack id was known', { kind: ev.kind, prefix: ev.prefix });
      if (ev.kind === 'tapped' || ev.kind === 'attached') safeShutdown('capture evidence that cannot be attributed', { line: line.slice(0, 160) });
      return;
    }
    if (ev.prefix !== null && !ours) {
      st.anomalies.push({ why: 'fresh line for another stream', line });
      note('fresh phone line for ANOTHER stream — never arms', { kind: ev.kind, prefix: ev.prefix, ours: st.prefix });
      if (ev.kind === 'tapped' || ev.kind === 'attached') safeShutdown('another stream is starting on the phone', { line: line.slice(0, 160) });
      return;
    }
    if (ev.kind === 'attached' && ev.peer !== L.PEER) {
      st.anomalies.push({ why: 'attached for another peer', line });
      safeShutdown('this stream attached for another peer', { peer: ev.peer });
      return;
    }
    note('phone (fresh)', { kind: ev.kind, match: ev.prefix ? 'prefix-8' : 'no id in line', prefix: ev.prefix, at: ev.at });
    const captureEvidence = ev.kind === 'tapped' || ev.kind === 'attached' || ev.kind === 'bound';
    if (captureEvidence && st.anchor === null && st.phoneEvidenceAt === null && !st.ended) {
      st.phoneEvidenceAt = d.now();
      st.uncertainH = d.setTimeout(() => {
        if (st.anchor === null) safeShutdown('the phone shows capture but the Mac never showed this stream starting', { withinMs: L.UNCERTAIN_MS });
      }, L.UNCERTAIN_MS);
    }
  }
  async function readPhone() {
    const r = await call('read phone log', () => d.phoneLogRead(cursor.size));
    if (!r) {
      st.phoneFails += 1;
      if (st.phoneFails >= L.PHONE_FAILS_MAX && !st.finished) safeShutdown('the phone log could not be read', { fails: st.phoneFails });
      return;
    }
    st.phoneFails = 0;
    if (r.inode !== cursor.inode || r.size < cursor.size) {
      note('phone log rotated or truncated', { was: cursor, now: { inode: r.inode, size: r.size } });
      safeShutdown('the phone log rotated or was truncated — no stale fallback', { was: cursor, now: { inode: r.inode, size: r.size } });
      return;
    }
    // `size` is the file's real size (for the rotation check); `consumedTo` is how far whole lines were read.
    cursor = { inode: r.inode, size: typeof r.consumedTo === 'number' ? r.consumedTo : r.size };
    const lines = (partial + r.text).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) if (line.includes('[camera]')) onPhoneLine(line);
  }

  // ---- before the request -----------------------------------------------------------------------------
  const before = await call('read pane', () => d.readPane());
  if (!before || before.request.length !== 1 || before.stop !== 0 || before.cancel !== 0) {
    note('ABORT: the pane is not idle with exactly one request button', { before: before ?? null });
    return finish('aborted-before-request');
  }
  cursor = (await call('mark phone log', () => d.phoneLogMark())) ?? null;
  if (!cursor || typeof cursor.inode !== 'number' || typeof cursor.size !== 'number') {
    note('ABORT: the phone log position could not be recorded — no request sent');
    return finish('aborted-before-request');
  }
  logStart = { ...cursor };
  note('phone log marked', logStart);
  st.requestAt = d.now();
  const requested = await call('press request', () => d.pressRequest());
  note('REQUEST pressed once', { landed: !!requested });
  if (!requested) return finish('request-did-not-land');
  st.approvalH = d.setTimeout(() => { if (st.anchor === null && !st.ended) safeShutdown('the approval window passed with nothing ended', { approvalMs: L.APPROVAL_MS }); }, L.APPROVAL_MS);
  st.ackH = d.setTimeout(() => { if (st.streamId === null && !st.ended) safeShutdown('no stream id from the ack', { ackMs: L.ACK_MS }); }, L.ACK_MS);

  const phoneLoop = (async () => {
    while (!st.finished) {
      if (!st.ended || !st.stopLanded) await readPhone();
      await d.sleep(L.PHONE_POLL_MS);
    }
  })();

  // ---- the Mac's own state ---------------------------------------------------------------------------
  let last = '';
  while (!st.stopTriggers.length && !st.ended) {
    const p = await call('read pane', () => d.readPane());
    if (p) {
      const key = JSON.stringify([p.kind, p.streamId, p.stop, p.cancel, (p.text || '').slice(0, 50)]);
      if (key !== last) { note('pane', { kind: p.kind, streamId: p.streamId, reason: p.reason ?? null, stop: p.stop, text: (p.text || '').slice(0, 120), canvasCss: p.canvasCss }); last = key; }
      if (typeof p.streamId === 'string' && /^[0-9a-f]{32}$/.test(p.streamId)) {
        if (st.streamId === null && p.kind === 'requesting') {
          st.streamId = p.streamId; st.prefix = p.streamId.slice(0, 8);
          note('this attempt’s stream id, from the Mac’s own state after the ack', { streamId: st.streamId, phoneMatchesOn: 'first 8 characters only' });
        } else if (st.streamId !== null && p.streamId !== st.streamId) {
          safeShutdown('the Mac’s stream id changed under this attempt', { was: st.streamId, now: p.streamId });
        }
      }
      const thisStream = st.streamId !== null && p.streamId === st.streamId;
      if (thisStream && (p.kind === 'connecting' || p.kind === 'live') && st.anchor === null) {
        arm(d.now() - L.ANCHOR_MARGIN_MS, `Mac state ${p.kind} for this stream id`);
      }
      if (thisStream && p.kind === 'live' && st.liveAt === null && p.canvasCss && p.canvasCss[0] > 0) {
        st.liveAt = d.now(); note('this stream is live on the Mac');
      }
      if (p.kind === 'ended' && (thisStream || st.streamId === null) && d.now() - st.requestAt > L.REQUEST_GRACE_MS) {
        st.ended = { atMs: d.now(), reason: p.reason ?? null, text: (p.text || '').slice(0, 240), captured: st.anchor !== null };
        note('ENDED', st.ended);
      }
    }
    await d.sleep(L.PANE_POLL_MS);
  }
  for (let chain = stopChain; chain; chain = chain === stopChain ? null : stopChain) await chain;
  while (st.stopTriggers.length && !st.stopLanded && !st.emergency && d.now() - st.requestAt < L.APPROVAL_MS + L.LIMIT_MS + L.STOP_ATTEMPTS * L.STOP_ATTEMPT_MS) {
    await d.sleep(L.PANE_POLL_MS);
    for (let chain = stopChain; chain; chain = chain === stopChain ? null : stopChain) await chain;
  }
  for (const h of [st.deadlineH, st.approvalH, st.ackH, st.uncertainH]) if (h !== null) d.clearTimeout(h);
  await readPhone();

  // ---- a real end by the case's stimulus: the return, then the watch ------------------------------------
  const endedByStimulus = st.ended && st.ended.captured && !st.stopTriggers.length;
  if (endedByStimulus && d.afterEnd) {
    note('afterEnd: starting');
    st.afterEnd = (await call('afterEnd', () => d.afterEnd(), L.AFTER_END_MS)) ?? { done: false, timedOut: true };
    note('afterEnd: finished', { result: st.afterEnd });
  }
  const endAt = st.stopLanded ? st.stopLanded.atMs : st.ended ? st.ended.atMs : d.now();
  const observeFrom = st.afterEnd ? d.now() : endAt;
  note('observing', { forMs: L.OBSERVE_MS });
  const samples = [];
  while (d.now() - observeFrom < L.OBSERVE_MS) {
    const s = await call('sample', () => d.sampleAfter(), 10_000);
    await readPhone();
    samples.push({ t: (d.now() - d.recorder.t0) / 1000, phoneFreshLines: fresh.length, ...(s ?? { unread: true }) });
    await d.sleep(L.SAMPLE_MS);
  }
  const instr = (await call('read instrument', () => d.readInstr())) ?? null;
  const outcome = st.shutdown ? 'no-reading:safe-shutdown'
    : st.stopLanded && st.stopTriggers.some((t) => t.trigger === 'deadline') ? 'no-reading:deadline'
    : st.ended && !st.ended.captured ? (st.ended.reason === 'expired' ? 'no-reading:expired-without-capture' : 'no-reading:ended-before-capture')
    : endedByStimulus ? 'ended-by-stimulus'
    : 'unresolved';
  return finish(outcome, { samples, instr });

  async function finish(outcome, extra = {}) {
    st.finished = true;
    for (const h of [st.deadlineH, st.approvalH, st.ackH, st.uncertainH]) if (h !== null) d.clearTimeout(h);
    const endMs = st.stopLanded ? st.stopLanded.atMs : st.ended ? st.ended.atMs : null;
    const captureMs = st.anchor !== null && endMs !== null ? endMs - st.anchor : null;
    const report = {
      outcome, limits: L,
      requestAt: st.requestAt, streamId: st.streamId, prefix: st.prefix, anchor: st.anchor, anchorSource: st.anchorSource, liveAt: st.liveAt,
      stopTriggers: st.stopTriggers, stopLanded: st.stopLanded, emergency: st.emergency, ended: st.ended, shutdown: st.shutdown,
      afterEnd: st.afterEnd, anomalies: st.anomalies,
      capture: { anchorToEndMs: captureMs, withinLimit: captureMs === null ? null : captureMs <= L.LIMIT_MS },
      phoneLogStart: logStart, phoneLogEnd: cursor, freshPhoneLines: fresh,
      recorderFailures: d.recorder.failures(), events: d.recorder.events, ...extra,
    };
    try { await d.writeReport(report); } catch (e) { note('report write failed', { error: String(e).slice(0, 200) }); report.reportWriteFailed = true; }
    return report;
  }
}
