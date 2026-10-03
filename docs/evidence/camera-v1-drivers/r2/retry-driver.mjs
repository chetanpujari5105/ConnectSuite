// Camera retry for defects 167/168 — one session, a hard capture deadline, the real Mac controls only.
//
// Timers (Mac clock, this process):
//   anchor   = the earliest observed of: the Mac pane's Stop button appearing (on `starting`, before the
//              phone attaches) or the phone's `attached` log line being seen. If live is observed with
//              no anchor, the anchor is the request press — the earliest it could have been.
//   switch   = first live frame + 5 s, once, rear -> front.
//   planned  = anchor + 15 s: the real Stop.
//   deadline = anchor + 20 s: the real Stop, if still running. Never extended.
//   ceiling  = request + 55 s (30 s approval + 5 s slack + 20 s): Stop if anything is still open.
// No timer waits on a person. Nothing here saves an image: the page instrument records draw *times*.
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';

const OUT = process.argv[2];
const LIMIT_MS = 20_000, PLANNED_MS = 15_000, SWITCH_MS = 5_000, CEILING_MS = 55_000, OBSERVE_MS = 60_000;
const REPO = '/Users/chetan/Desktop/ConnectSuite';
const PKG = 'com.chetan.connectsuite.debug';
const events = [];
const t0 = Date.now();
const rel = (t) => (t === null ? null : ((t - t0) / 1000).toFixed(3));
function note(what, extra = {}) {
  const e = { at: new Date().toISOString(), t: rel(Date.now()), what, ...extra };
  events.push(e);
  console.log(`${e.at.slice(11, 23)} +${e.t}s ${what}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}`);
}

function adb(args) {
  return new Promise((resolve) => {
    execFile(`${REPO}/scripts/adb-pinned.sh`, ['samsung', ...args], { timeout: 8000 }, (err, stdout) =>
      resolve(err && !stdout ? null : stdout));
  });
}

let probe = await openProbe({ port: 9222 });
const NAV = `document.querySelectorAll('[data-nav]').length`;
const S = `document.querySelector('section[data-screen="camera"]')`;
async function read(expr) {
  return (await probe.read({ question: 'camera pane', control: NAV, read: expr })).value;
}
const PANE = `(function(){
  var s = ${S}; var c = s.querySelector('canvas'); var r = c.getBoundingClientRect();
  var st = s.querySelector('.camera-status, [class*="status"]');
  return {
    hidden: s.hidden,
    stop: s.querySelectorAll('button.camera-stop').length,
    request: Array.prototype.filter.call(s.querySelectorAll('button.camera-request'), function(b){ return !b.disabled; }).map(function(b){ return b.textContent.trim(); }),
    cancel: s.querySelectorAll('button.camera-cancel').length,
    switchLabel: (s.querySelector('button.camera-switch') || {}).textContent || null,
    text: s.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
    canvasCss: [Math.round(r.width), Math.round(r.height)],
    instr: window.__camInstr ? { paints: window.__camInstr.paints.length, draws: window.__camInstr.draws.length } : null
  };
})()`;

// ---- route, gate, instrument -----------------------------------------------------------------
const routed = await probe.act({ what: 'route to Camera', run: `document.querySelector('[data-nav="camera"]').click()`, expect: `!${S}.hidden`, within: 5000 });
if (!routed.landed) { note('ABORT: Camera pane did not open'); finish(3); }
const start = await read(PANE);
note('pane before request', { request: start.request, stop: start.stop, cancel: start.cancel });
if (start.request.length !== 1 || start.stop !== 0 || start.cancel !== 0) { note('ABORT: pane not idle with exactly one request button'); finish(4); }

const instrumented = await read(`(function(){
  if (typeof camera === 'undefined' || !camera.painter || typeof camera.painter.draw !== 'function') return 'no painter';
  if (window.__camInstr) { window.__camInstr.paints = []; window.__camInstr.draws = []; window.__camInstr.stopAt = null; return 'installed'; }
  var p = camera.painter; window.__camInstr = { paints: [], draws: [], stopAt: null };
  var paint = p.paint.bind(p), draw = p.draw.bind(p);
  p.paint = function(f){ window.__camInstr.paints.push(Date.now()); return paint(f); };
  p.draw = function(b, f){ window.__camInstr.draws.push(Date.now()); return draw(b, f); };
  return 'installed';
})()`);
note('page instrument (draw/paint times only)', { instrumented });
if (instrumented !== 'installed') { note('ABORT: could not instrument the painter'); finish(4); }

// ---- the phone's log, polled --------------------------------------------------------------------
const phoneLines = new Map();
let phoneAttachSeenAt = null;
let phoneStoppedSeen = false;
let polling = true;
(async function pollPhone() {
  while (polling) {
    const out = await adb(['shell', 'run-as', PKG, 'tail', '-n', '40', 'files/logs/link.log']);
    if (out) for (const line of out.split('\n')) {
      if (!line.includes('[camera]') || phoneLines.has(line)) continue;
      phoneLines.set(line, Date.now());
      if (line.includes(' attached for ') && phoneAttachSeenAt === null) { phoneAttachSeenAt = Date.now(); note('phone log: attached seen', { line: line.slice(11, 200) }); if (anchor === null) anchorAt(requestAt ?? phoneAttachSeenAt, 'fallback-request-press (attach seen only in the phone log, which is polled late)'); }
      if (/ stopped: /.test(line)) phoneStoppedSeen = true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
})();

// ---- the session --------------------------------------------------------------------------------
let requestAt = null, anchor = null, anchorSource = null, liveAt = null, stopped = null, switched = null, ended = null;
const timers = [];
const later = (ms, fn) => { const h = setTimeout(fn, Math.max(0, ms)); timers.push(h); return h; };

function anchorAt(t, source) {
  if (anchor !== null && anchor <= t) return;
  anchor = t; anchorSource = source;
  note('capture deadline armed', { anchorSource: source, deadlineInS: ((anchor + LIMIT_MS - Date.now()) / 1000).toFixed(3) });
  for (const h of timers.splice(0)) clearTimeout(h);
  later(anchor + PLANNED_MS - Date.now(), () => stopNow('planned'));
  later(anchor + LIMIT_MS - Date.now(), () => stopNow('deadline'));
  if (liveAt !== null && !switched) later(liveAt + SWITCH_MS - Date.now(), switchOnce);
}

let stopPromise = null;
function stopNow(trigger) {
  if (stopped) return stopPromise;
  stopPromise = doStop(trigger);
  return stopPromise;
}
async function doStop(trigger) {
  stopped = { trigger, at: Date.now() };
  note(`STOP (${trigger})`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const a = await probe.act({
        what: `press Stop camera (${trigger})`,
        run: `(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-stop'), function(x){ return x.textContent.trim() === 'Stop camera' && !x.disabled; }); if (b.length !== 1) return 'no single stop button: ' + b.length; window.__camInstr.stopAt = Date.now(); b[0].click(); return 'clicked'; })()`,
        expect: `${S}.querySelectorAll('button.camera-stop').length === 0`,
        within: 3000,
      });
      const p = await read(PANE);
      stopped.clickedAtPage = await read(`window.__camInstr.stopAt`);
      note('stop result', { landed: a.landed, attempt, text: p.text.slice(0, 260), canvasCss: p.canvasCss, stopButtons: p.stop });
      if (a.landed) return;
    } catch (e) {
      note('stop attempt failed', { attempt, error: String(e).slice(0, 160) });
      try { probe.close(); } catch {}
      try { probe = await openProbe({ port: 9222 }); } catch {}
    }
  }
  // The Mac's control could not be pressed. Last resort so capture is not left running: the phone's
  // Home key ends a live stream as left-screen. Emergency only, and reported as such.
  note('EMERGENCY: Mac Stop could not be pressed; sending KEYCODE_HOME to end capture as left-screen');
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
}

async function switchOnce() {
  if (switched || stopped) return;
  switched = { at: Date.now() };
  const a = await probe.act({
    what: 'press Switch to front camera once',
    run: `(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-switch'), function(x){ return x.textContent.trim() === 'Switch to front camera' && !x.disabled; }); if (b.length !== 1 || ${S}.querySelectorAll('button.camera-stop').length !== 1) return 'refused'; b[0].click(); return 'clicked'; })()`,
    expect: `(function(){ var b = ${S}.querySelector('button.camera-switch'); return !!b && b.textContent.trim() === 'Switch to back camera'; })()`,
    within: 4000,
  });
  note('switch result', { landed: a.landed });
}

if (process.argv[3] === 'dry') { await new Promise((r) => setTimeout(r, 2500)); note('DRY: stopping before any request', { phoneCameraLinesSeen: phoneLines.size, pane: await read(PANE) }); finish(0); }
const gate = await read(`(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-request'), function(x){ return /^(Ask phone for camera|Ask again)$/.test(x.textContent.trim()) && !x.disabled; }); return b.length; })()`);
if (gate !== 1) { note('ABORT: request gate failed', { gate }); finish(4); }
requestAt = Date.now();
await probe.act({ what: 'press the request once', run: `Array.prototype.filter.call(${S}.querySelectorAll('button.camera-request'), function(x){ return !x.disabled; })[0].click()`, expect: `${S}.querySelectorAll('button.camera-request').length === 0`, within: 5000 });
note('REQUEST pressed once');
const ceiling = setTimeout(async () => { const p = await read(PANE).catch(() => null); if (!stopped && (!p || p.stop > 0)) stopNow('ceiling'); }, CEILING_MS);

let last = '';
while (!stopped && !ended) {
  let p;
  try { p = await read(PANE); } catch (e) { note('pane read failed', { error: String(e).slice(0, 120) }); await new Promise((r) => setTimeout(r, 200)); continue; }
  const summary = JSON.stringify([p.stop, p.switchLabel, p.text.slice(0, 60)]);
  if (summary !== last) { note('pane', { stop: p.stop, switchLabel: p.switchLabel, text: p.text.slice(0, 160), canvasCss: p.canvasCss, instr: p.instr }); last = summary; }
  if (p.stop === 1 && anchor === null) anchorAt(Date.now(), 'mac-stop-button');
  if (liveAt === null && /^Live · /.test(p.text) && p.canvasCss[0] > 0) {
    liveAt = Date.now();
    if (anchor === null) anchorAt(requestAt, 'fallback-request-press');
    note('first live picture on the Mac');
    later(liveAt + SWITCH_MS - Date.now(), switchOnce);
  }
  if (p.stop === 0 && p.cancel === 0 && requestAt !== null && Date.now() - requestAt > 1000 && !/^Live/.test(p.text)) {
    ended = { at: Date.now(), text: p.text.slice(0, 200) };
    note('ENDED without a Mac Stop (no retry)', ended);
  }
  await new Promise((r) => setTimeout(r, 100));
}
clearTimeout(ceiling);
for (const h of timers.splice(0)) clearTimeout(h);
if (stopPromise) await stopPromise;

// ---- 60 s observation after the end ----------------------------------------------------------------
const endAt = stopped ? stopped.at : ended.at;
note('observing for 60 s');
const samples = [];
while (Date.now() - endAt < OBSERVE_MS) {
  const cam = await adb(['shell', `dumpsys media.camera | sed -n '/Active Camera Clients/,+1p' | tr -s ' \\n' ' '; echo; dumpsys media.camera | grep -c 'package ${PKG}'`]);
  const p = await read(PANE).catch(() => null);
  const clients = cam ? (cam.match(/Active Camera Clients: (\[[^\]]*\])/) || [null, 'UNREAD'])[1] : 'UNREAD';
  samples.push({ t: rel(Date.now()), clients, ours: cam ? Number(cam.split('\n')[1]) : null, stopButtons: p ? p.stop : null, canvasCss: p ? p.canvasCss : null });
  await new Promise((r) => setTimeout(r, 2000));
}
const instr = await read(`(function(){ var i = window.__camInstr; return { stopAt: i.stopAt, paints: i.paints.length, draws: i.draws.length, drawsAfterStop: i.stopAt === null ? null : i.draws.filter(function(t){ return t > i.stopAt; }).length, paintsAfterStop: i.stopAt === null ? null : i.paints.filter(function(t){ return t > i.stopAt; }).length, lastDrawBeforeStopMs: i.stopAt === null || !i.draws.length ? null : i.stopAt - Math.max.apply(null, i.draws.filter(function(t){ return t <= i.stopAt; })) }; })()`);
const finalPane = await read(PANE);
polling = false;
note('done', { instr, finalPane: { text: finalPane.text.slice(0, 300), canvasCss: finalPane.canvasCss, stop: finalPane.stop } });
finish(0, { samples, instr, finalPane, requestAt, anchor, anchorSource, liveAt, switched, stopped, ended });

function finish(code, extra = {}) {
  polling = false;
  const phone = [...phoneLines.entries()].map(([line, seenAt]) => ({ line: line.slice(11, 260), seenAtT: rel(seenAt) }));
  const limits = { LIMIT_MS, PLANNED_MS, SWITCH_MS, CEILING_MS, OBSERVE_MS, phonePollMs: 1000, panePollMs: 100 };
  const capture = extra.anchor && extra.stopped ? { anchorToStopS: ((extra.stopped.at - extra.anchor) / 1000).toFixed(3), withinLimit: extra.stopped.at - extra.anchor <= LIMIT_MS } : null;
  if (OUT) writeFileSync(OUT, JSON.stringify({ code, t0: new Date(t0).toISOString(), limits, capture, events, phone, ...extra }, null, 1));
  console.log(`EXIT ${code}; capture ${JSON.stringify(capture)}`);
  try { probe.close(); } catch {}
  process.exit(code);
}
