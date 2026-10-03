// Case A retry (phone Home) on the repaired core. Usage: node caseA-driver.mjs <report.json> [dry]
// The owner taps Start camera, presses Home ~5 s after the picture is live, then reopens Sidekick.
// The driver presses nothing during capture unless the 20 s deadline or a safe shutdown needs the real Stop.
import { execFile } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { createRecorder, runSession, INSTALL_INSTRUMENT, DEFAULT_LIMITS } from './driver-core.mjs';

const [OUT, MODE] = process.argv.slice(2);
const REPO = '/Users/chetan/Desktop/ConnectSuite';
const PKG = 'com.chetan.connectsuite.debug';
const LOG = 'files/logs/link.log';
const MACLOG = '/Users/chetan/Library/Application Support/sidekick-desktop/logs/sidekick.log';
const macLogStart = statSync(MACLOG).size;
const recorder = createRecorder();
const { note } = recorder;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adb(args, { timeout = 8000, buffer = false } = {}) {
  return new Promise((resolve, reject) => execFile(`${REPO}/scripts/adb-pinned.sh`, ['samsung', ...args],
    { timeout, maxBuffer: 16 << 20, encoding: buffer ? 'buffer' : 'utf8' }, (err, out) => (err && (!out || !out.length) ? reject(err) : resolve(out))));
}
const macLogSince = () => { const b = readFileSync(MACLOG); return (b.length >= macLogStart ? b.subarray(macLogStart) : b).toString('utf8'); };

async function logStat() {
  const out = await adb(['shell', 'run-as', PKG, 'stat', '-c', 'ino=%i_size=%s', LOG]);
  const m = out.match(/ino=(\d+)_size=(\d+)/);
  if (!m) throw new Error(`no stat for ${LOG}: ${out.trim().slice(0, 80)}`);
  return { inode: Number(m[1]), size: Number(m[2]) };
}
/** Bytes from `from` up to the size `stat` saw first, cut at the last whole line. */
async function logRead(from) {
  const st = await logStat();
  if (st.size < from) return { inode: st.inode, size: st.size, text: '', consumedTo: from };
  const raw = await adb(['exec-out', 'run-as', PKG, 'tail', '-c', `+${from + 1}`, LOG], { buffer: true });
  const bounded = raw.subarray(0, st.size - from);
  const lastNl = bounded.lastIndexOf(0x0a);
  const whole = lastNl < 0 ? Buffer.alloc(0) : bounded.subarray(0, lastNl + 1);
  return { inode: st.inode, size: st.size, text: whole.toString('utf8'), consumedTo: from + whole.length };
}
async function phoneState() {
  const out = await adb(['shell', 'dumpsys activity activities | grep topResumedActivity; dumpsys window | grep -E "isKeyguardShowing="; dumpsys power | grep -E "mWakefulness="']);
  return { top: (out.match(/u0 (\S+)/) || [null, null])[1], keyguard: /isKeyguardShowing=true/.test(out), awake: /mWakefulness=Awake/.test(out) };
}
async function ourCamera() {
  const out = await adb(['shell', `dumpsys media.camera | sed -n '/Active Camera Clients/,+1p' | tr -s ' \\n' ' '; echo; dumpsys media.camera | grep -c 'package ${PKG}'`]);
  const clients = (out.match(/Active Camera Clients: (\[[^\]]*\])/) || [null, 'UNREAD'])[1];
  return { clients, ours: Number(out.split('\n')[1]), oursActive: clients.includes(PKG) };
}
async function phoneScreen() {
  const xml = await adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 15000 });
  return [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]).filter((t) => t.trim()).slice(0, 12);
}

const probe = await openProbe({ port: 9222 });
const NAV = `document.querySelectorAll('[data-nav]').length`;
const S = `document.querySelector('section[data-screen="camera"]')`;
const read = async (expr) => (await probe.read({ question: 'camera pane', control: NAV, read: expr })).value;
const PANE = `(function(){
  var s = ${S}; var r = s.querySelector('canvas').getBoundingClientRect(); var cs = camera.state || {};
  return {
    kind: cs.kind || null, streamId: typeof cs.streamId === 'string' ? cs.streamId : null, reason: cs.reason || null,
    stop: s.querySelectorAll('button.camera-stop').length,
    cancel: s.querySelectorAll('button.camera-cancel').length,
    request: Array.prototype.filter.call(s.querySelectorAll('button.camera-request'), function(b){ return !b.disabled; }).map(function(b){ return b.textContent.trim(); }),
    text: s.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
    canvasCss: [Math.round(r.width), Math.round(r.height)]
  };
})()`;
const exit = (code, report) => {
  try { writeFileSync(OUT, JSON.stringify(report ?? { aborted: true, events: recorder.events }, null, 1)); } catch {}
  try { probe.close(); } catch {}
  process.exit(code);
};

// ---- gates ------------------------------------------------------------------------------------------
const routed = await probe.act({ what: 'route to Camera', run: `document.querySelector('[data-nav="camera"]').click()`, expect: `!${S}.hidden`, within: 5000 });
const instrument = await read(INSTALL_INSTRUMENT);
const ps = await phoneState();
const cam = await ourCamera();
const pane0 = await read(PANE);
const log0 = await logStat().catch((e) => ({ error: e.message }));
note('gates', { routed: routed.landed, instrument, phone: ps, camera: cam, pane: { kind: pane0.kind, request: pane0.request, stop: pane0.stop, cancel: pane0.cancel }, phoneLog: log0 });
const fail = [];
if (!routed.landed) fail.push('Camera pane did not open');
if (!/^installed once/.test(instrument)) fail.push('instrument not installed');
if (!ps.top || !ps.top.startsWith(`${PKG}/`)) fail.push(`Sidekick is not the resumed activity (${ps.top})`);
if (ps.keyguard || !ps.awake) fail.push('the phone is locked or asleep');
if (cam.oursActive) fail.push('our package already holds a camera');
if (/not connected/i.test(pane0.text)) fail.push('the Mac is not connected');
if (typeof log0.inode !== 'number') fail.push('the phone log cannot be stat-ed');
if (fail.length) { note('ABORT before any request', { fail }); exit(5); }
if (MODE === 'dry') {
  const probeRead = await logRead(Math.max(0, log0.size - 400));
  note('DRY: gates passed; a 400-byte read from near the end, as a control of the reader', { consumedTo: probeRead.consumedTo, lines: probeRead.text.split('\n').filter(Boolean).length, inode: probeRead.inode });
  exit(0);
}

// ---- the session ---------------------------------------------------------------------------------------
async function afterEnd() {
  let release = null;
  for (let i = 0; i < 10; i++) {
    const c = await ourCamera();
    if (!c.oursActive) { release = { released: true, withinS: i, camera: c }; break; }
    await sleep(1000);
  }
  if (!release) {
    note('FAIL: our package still holds a camera 10 s after the end — emergency stop from the phone');
    await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    return { done: false, release: { released: false, emergency: true, camera: await ourCamera() } };
  }
  const paneAtEnd = await read(PANE);
  note('at the end', { release, pane: { kind: paneAtEnd.kind, reason: paneAtEnd.reason, text: paneAtEnd.text.slice(0, 220), canvasCss: paneAtEnd.canvasCss } });
  note('waiting for the owner to reopen Sidekick');
  const until = Date.now() + 230_000;
  while (Date.now() < until) {
    const s = await phoneState().catch(() => ({}));
    if (s.top && s.top.startsWith(`${PKG}/`) && !s.keyguard && s.awake) {
      const screen = await phoneScreen().catch((e) => `unread: ${e.message}`);
      return { done: true, release, paneAtEnd: { kind: paneAtEnd.kind, reason: paneAtEnd.reason, text: paneAtEnd.text.slice(0, 300), canvasCss: paneAtEnd.canvasCss }, returned: s, screen, returnedAt: Date.now() };
    }
    await sleep(1000);
  }
  return { done: false, release, note: 'the owner did not reopen Sidekick within 230 s' };
}

const report = await runSession({
  now: Date.now, setTimeout, clearTimeout, sleep, recorder,
  readPane: () => read(PANE),
  pressRequest: async () => (await probe.act({
    what: 'press the request once',
    run: `(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-request'), function(x){ return /^(Ask phone for camera|Ask again)$/.test(x.textContent.trim()) && !x.disabled; }); if (b.length !== 1) return 'refused'; b[0].click(); return 'clicked'; })()`,
    expect: `${S}.querySelectorAll('button.camera-request').length === 0`,
    within: 5000,
  })).landed,
  pressStop: async (trigger) => {
    const clicked = await read(`(function(){
      var s = ${S};
      var stop = Array.prototype.filter.call(s.querySelectorAll('button.camera-stop'), function(x){ return x.textContent.trim() === 'Stop camera' && !x.disabled; });
      var cancel = Array.prototype.filter.call(s.querySelectorAll('button.camera-cancel'), function(x){ return !x.disabled; });
      var b = stop.length === 1 ? stop[0] : cancel.length === 1 ? cancel[0] : null;
      if (!b) return { clicked: null, stopButtons: stop.length, cancelButtons: cancel.length };
      var at = Date.now(); if (window.__camInstr) window.__camInstr.stopAt = at; b.click();
      return { clicked: b.textContent.trim(), at: at };
    })()`);
    const after = await read(PANE);
    const c = await ourCamera();
    return { landed: after.stop === 0 && after.cancel === 0 && !c.oursActive, atMs: clicked.at ?? Date.now(), clicked, trigger, text: after.text.slice(0, 300), canvasCss: after.canvasCss, camera: c };
  },
  emergencyStop: async () => adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']),
  phoneLogMark: logStat,
  phoneLogRead: logRead,
  afterEnd,
  sampleAfter: async () => {
    const c = await ourCamera();
    const s = await phoneState();
    const p = await read(PANE);
    const mac = macLogSince();
    const i = await read(`(function(){ var i = window.__camInstr; return i ? { paints: i.paints.length, draws: i.draws.length } : null; })()`);
    return {
      clients: c.clients, ours: c.ours, top: s.top, keyguard: s.keyguard,
      kind: p.kind, reason: p.reason, stop: p.stop, live: p.kind === 'live', canvasCss: p.canvasCss, instr: i,
      macCameraRequests: (mac.match(/camera\.request sent/g) || []).length,
      macTransferLines: (mac.match(/\[(bulk|share)\]/g) || []).length,
    };
  },
  readInstr: () => read(`(function(){ var i = window.__camInstr; return i ? { stopAt: i.stopAt, paints: i.paints.slice(), draws: i.draws.slice() } : null; })()`),
  writeReport: async (r) => writeFileSync(OUT, JSON.stringify({ macLog: macLogSince().split('\n').filter((l) => l.includes('[camera]') || l.includes('[link]')), ...r }, null, 1)),
}, DEFAULT_LIMITS);
note('case A finished', { outcome: report.outcome, capture: report.capture, afterEnd: report.afterEnd && report.afterEnd.done });
exit(0, { macLog: macLogSince().split('\n').filter((l) => l.includes('[camera]') || l.includes('[link]')), ...report });
