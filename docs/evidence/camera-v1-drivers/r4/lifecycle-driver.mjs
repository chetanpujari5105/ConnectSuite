// One lifecycle case per run. Usage: node lifecycle-driver.mjs <A|B|C|D> <report.json> [dry]
//   A  the owner presses Home on the phone (~5 s); return = the owner reopens Sidekick
//   B  the owner locks the phone (~5 s);        return = the owner unlocks and reopens Sidekick
//   C  the driver clicks Overview in the nav at ~5 s; return = the nav back to Camera (no request)
//   D  the driver presses the tray's Disconnect at ~5 s; return = the tray's Connect, once
// The 20 s deadline (Mac Stop) and every other rule are driver-core.mjs's, which the local tests run.
import { execFile } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { createRecorder, runSession, INSTALL_INSTRUMENT, DEFAULT_LIMITS } from './driver-core.mjs';

const [CASE, OUT, MODE] = process.argv.slice(2);
if (!['A', 'B', 'C', 'D'].includes(CASE)) throw new Error('case must be A, B, C or D');
const REPO = '/Users/chetan/Desktop/ConnectSuite';
const PKG = 'com.chetan.connectsuite.debug';
const MACLOG = '/Users/chetan/Library/Application Support/sidekick-desktop/logs/sidekick.log';
const macLogStart = statSync(MACLOG).size;
const recorder = createRecorder();
const { note } = recorder;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, out) => (err && !out ? reject(err) : resolve(out))));
}
const adb = (args, timeout) => run(`${REPO}/scripts/adb-pinned.sh`, ['samsung', ...args], timeout);

function macLogSince() {
  const buf = readFileSync(MACLOG);
  return buf.length >= macLogStart ? buf.subarray(macLogStart).toString('utf8') : buf.toString('utf8'); // a rotation restarts the file
}

async function phoneState() {
  const out = await adb(['shell', 'dumpsys activity activities | grep topResumedActivity; dumpsys window | grep -E "isKeyguardShowing="; dumpsys power | grep -E "mWakefulness="']);
  return {
    top: (out.match(/u0 (\S+)/) || [null, null])[1],
    keyguard: /isKeyguardShowing=true/.test(out),
    awake: /mWakefulness=Awake/.test(out),
  };
}
async function ourCamera() {
  const out = await adb(['shell', `dumpsys media.camera | sed -n '/Active Camera Clients/,+1p' | tr -s ' \\n' ' '; echo; dumpsys media.camera | grep -c 'package ${PKG}'`]);
  const clients = (out.match(/Active Camera Clients: (\[[^\]]*\])/) || [null, 'UNREAD'])[1];
  return { clients, ours: Number(out.split('\n')[1]), oursActive: clients.includes(PKG) };
}
async function phoneScreen() {
  const xml = await adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], 15000);
  return [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]).filter((t) => t.trim()).slice(0, 12);
}
/** The tray's status menu, by name: open it, read its items, press `item` only if present. */
async function tray(item) {
  const script = `
    tell application "System Events" to tell process "Electron"
      set bar to menu bar item 1 of menu bar 2
      click bar
      delay 0.4
      set names to name of every menu item of menu 1 of bar
      if names contains "${item}" then
        click menu item "${item}" of menu 1 of bar
        return "clicked ${item} | " & (names as text)
      else
        key code 53
        return "REFUSED: no ${item} | " & (names as text)
      end if
    end tell`;
  return (await run('osascript', ['-e', script], 10000)).trim();
}

const probe = await openProbe({ port: 9222 });
const NAV = `document.querySelectorAll('[data-nav]').length`;
const S = `document.querySelector('section[data-screen="camera"]')`;
const read = async (expr) => (await probe.read({ question: 'camera pane', control: NAV, read: expr })).value;
const PANE = `(function(){
  var s = ${S}; var r = s.querySelector('canvas').getBoundingClientRect();
  return {
    hidden: s.hidden,
    stop: s.querySelectorAll('button.camera-stop').length,
    cancel: s.querySelectorAll('button.camera-cancel').length,
    request: Array.prototype.filter.call(s.querySelectorAll('button.camera-request'), function(b){ return !b.disabled; }).map(function(b){ return b.textContent.trim(); }),
    switchLabel: (s.querySelector('button.camera-switch') || {}).textContent || null,
    text: s.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
    canvasCss: [Math.round(r.width), Math.round(r.height)]
  };
})()`;
const routeTo = (screen) => probe.act({ what: `route to ${screen}`, run: `document.querySelector('[data-nav="${screen}"]').click()`, expect: `!document.querySelector('section[data-screen="${screen}"]').hidden`, within: 5000 });

const exit = (code, report) => {
  try { writeFileSync(OUT, JSON.stringify(report ?? { aborted: true, events: recorder.events }, null, 1)); } catch {}
  try { probe.close(); } catch {}
  process.exit(code);
};

// ---- gates before the request ----------------------------------------------------------------------
const routed = await routeTo('camera');
const instrument = await read(INSTALL_INSTRUMENT);
const ps = await phoneState();
const cam = await ourCamera();
const pane0 = await read(PANE);
note('gates', { case: CASE, routed: routed.landed, instrument, phone: ps, camera: cam, pane: { request: pane0.request, stop: pane0.stop, cancel: pane0.cancel, text: pane0.text.slice(0, 80) } });
const fail = [];
if (!routed.landed) fail.push('Camera pane did not open');
if (!/^installed once/.test(instrument)) fail.push('instrument not installed');
if (!ps.top || !ps.top.startsWith(`${PKG}/`)) fail.push(`Sidekick is not the resumed activity (${ps.top})`);
if (ps.keyguard || !ps.awake) fail.push('the phone is locked or asleep');
if (cam.oursActive) fail.push('our package already holds a camera');
if (/not connected/i.test(pane0.text)) fail.push('the Mac is not connected');
if (fail.length) { note('ABORT before any request', { fail }); exit(5); }
if (MODE === 'dry') {
  if (CASE === 'D') note('DRY: tray menu check skipped (opening the menu is an action)');
  note('DRY: gates passed; no request');
  exit(0);
}

// ---- the case ---------------------------------------------------------------------------------------
const pressAction = {
  C: async () => { const a = await routeTo('overview'); return { landed: a.landed, what: 'nav → Overview' }; },
  D: async () => ({ landed: true, what: await tray('Disconnect') }),
}[CASE];

async function waitForRelease() {
  for (let i = 0; i < 10; i++) {
    const c = await ourCamera();
    if (!c.oursActive) return { released: true, afterS: i, camera: c };
    await sleep(1000);
  }
  note('FAIL: our package still holds a camera 10 s after the end — emergency stop from the phone');
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
  return { released: false, emergency: true, camera: await ourCamera() };
}

const afterEnd = async () => {
  const release = await waitForRelease();
  const screenAtEnd = await phoneScreen().catch((e) => `unread: ${e.message}`);
  note('at the end', { release, screenAtEnd });
  if (!release.released) return { done: false, release };
  if (CASE === 'A' || CASE === 'B') {
    note(`waiting for the owner to ${CASE === 'B' ? 'unlock the phone and ' : ''}reopen Sidekick`);
    const until = Date.now() + 230_000;
    while (Date.now() < until) {
      const s = await phoneState().catch(() => ({}));
      if (s.top && s.top.startsWith(`${PKG}/`) && !s.keyguard && s.awake) {
        const screen = await phoneScreen().catch((e) => `unread: ${e.message}`);
        return { done: true, release, screenAtEnd, returned: s, screen };
      }
      await sleep(1000);
    }
    return { done: false, release, screenAtEnd, note: 'the owner did not reopen Sidekick within 230 s' };
  }
  if (CASE === 'C') {
    await sleep(3000);
    const back = await routeTo('camera');
    const pane = await read(PANE);
    return { done: back.landed, release, screenAtEnd, pane: { stop: pane.stop, cancel: pane.cancel, request: pane.request, text: pane.text.slice(0, 200), canvasCss: pane.canvasCss } };
  }
  // D: reconnect once, through the same tray menu
  await sleep(5000);
  const reconnect = await tray('Connect');
  note('reconnect', { reconnect });
  for (let i = 0; i < 60; i++) {
    const pane = await read(PANE);
    if (!/not connected/i.test(pane.text) && pane.request.length === 1) {
      return { done: true, release, screenAtEnd, reconnect, connectedAfterS: i, pane: { request: pane.request, text: pane.text.slice(0, 200), canvasCss: pane.canvasCss } };
    }
    await sleep(1000);
  }
  return { done: false, release, screenAtEnd, reconnect, note: 'not reconnected within 60 s' };
};

const report = await runSession({
  now: Date.now, setTimeout, clearTimeout, sleep, recorder,
  readPane: () => read(PANE),
  pressRequest: async () => (await probe.act({
    what: 'press the request once',
    run: `(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-request'), function(x){ return /^(Ask phone for camera|Ask again)$/.test(x.textContent.trim()) && !x.disabled; }); if (b.length !== 1) return 'refused'; b[0].click(); return 'clicked'; })()`,
    expect: `${S}.querySelectorAll('button.camera-request').length === 0`,
    within: 5000,
  })).landed,
  pressSwitch: async () => ({ landed: false, refused: 'no switch in the lifecycle batch' }),
  pressAction,
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
    // Landed means the Mac's control is gone AND the phone no longer holds the camera.
    return { landed: after.stop === 0 && after.cancel === 0 && !c.oursActive, atMs: clicked.at ?? Date.now(), clicked, trigger, text: after.text.slice(0, 300), canvasCss: after.canvasCss, camera: c };
  },
  emergencyStop: async () => adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']),
  phoneLines: async () => (await adb(['shell', 'run-as', PKG, 'tail', '-n', '40', 'files/logs/link.log'])).split('\n').filter((l) => l.includes('[camera]')),
  afterEnd,
  sampleAfter: async () => {
    const c = await ourCamera();
    const s = await phoneState();
    const p = await read(PANE);
    const mac = macLogSince();
    const i = await read(`(function(){ var i = window.__camInstr; return i ? { paints: i.paints.length, draws: i.draws.length } : null; })()`);
    return {
      clients: c.clients, ours: c.ours, top: s.top, keyguard: s.keyguard,
      stop: p.stop, cancel: p.cancel, live: /^Live/.test(p.text), canvasCss: p.canvasCss, instr: i,
      macCameraRequests: (mac.match(/camera\.request sent/g) || []).length,
      macTransferLines: (mac.match(/\[(bulk|share)\]/g) || []).length,
    };
  },
  phoneScreen,
  readInstr: () => read(`(function(){ var i = window.__camInstr; return i ? { stopAt: i.stopAt, paints: i.paints.slice(), draws: i.draws.slice() } : null; })()`),
  writeReport: async (r) => writeFileSync(OUT, JSON.stringify({ case: CASE, macLog: macLogSince().split('\n').filter((l) => l.includes('[camera]') || l.includes('[link]')), ...r }, null, 1)),
}, { ...DEFAULT_LIMITS, PLANNED_MS: null, SWITCH_MS: null, ACTION_MS: pressAction ? 5_000 : null, AFTER_END_MS: 240_000 });
note('case finished', { case: CASE, outcome: report.outcome, capture: report.capture, afterEnd: report.afterEnd && report.afterEnd.done });
exit(0, { case: CASE, macLog: macLogSince().split('\n').filter((l) => l.includes('[camera]') || l.includes('[link]')), ...report });
