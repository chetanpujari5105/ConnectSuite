// The real wiring for one Camera retry session: CDP for the Mac pane, the pinned adb wrapper for the
// phone. Every decision is in driver-core.mjs, which the local tests run. Usage:
//   node retry-driver.mjs <report.json> [dry]
// `dry` routes, installs the instrument and reads both ends, then exits without any request.
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { createRecorder, runSession, INSTALL_INSTRUMENT, DEFAULT_LIMITS } from './driver-core.mjs';

const [OUT, MODE] = process.argv.slice(2);
const REPO = '/Users/chetan/Desktop/ConnectSuite';
const PKG = 'com.chetan.connectsuite.debug';
const recorder = createRecorder();
const { note } = recorder;

function adb(args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(`${REPO}/scripts/adb-pinned.sh`, ['samsung', ...args], { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      err && !stdout ? reject(err) : resolve(stdout));
  });
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

async function resumedActivity() {
  const out = await adb(['shell', 'dumpsys activity activities | grep topResumedActivity']);
  return (out.match(/u0 (\S+)/) || [null, out.trim()])[1];
}

async function phoneScreen() {
  const xml = await adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], 15000);
  return [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]).filter((t) => t.trim()).slice(0, 20);
}

// ---- before anything is sent ---------------------------------------------------------------------
const routed = await probe.act({ what: 'route to Camera', run: `document.querySelector('[data-nav="camera"]').click()`, expect: `!${S}.hidden`, within: 5000 });
note('route to the Camera pane', { landed: routed.landed });
const instrument = await read(INSTALL_INSTRUMENT);
note('page instrument', { result: instrument });
const top = await resumedActivity();
note('phone resumed activity', { top });
const exit = (code, report) => {
  try { writeFileSync(OUT, JSON.stringify(report ?? { aborted: true, events: recorder.events }, null, 1)); } catch {}
  try { probe.close(); } catch {}
  process.exit(code);
};
if (!routed.landed || !/^installed once/.test(instrument)) { note('ABORT: the Mac instrument is not ready — no request sent'); exit(4); }
if (!top || !top.startsWith(`${PKG}/`)) { note('ABORT: Sidekick is not the resumed activity on the phone — no request sent'); exit(5); }
if (MODE === 'dry') {
  note('DRY: both ends read; no request', { pane: await read(PANE), screen: await phoneScreen() });
  exit(0);
}

// ---- the session ----------------------------------------------------------------------------------
const report = await runSession({
  now: Date.now, setTimeout, clearTimeout,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  recorder,
  readPane: () => read(PANE),
  pressRequest: async () => {
    const a = await probe.act({
      what: 'press the request once',
      run: `(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-request'), function(x){ return /^(Ask phone for camera|Ask again)$/.test(x.textContent.trim()) && !x.disabled; }); if (b.length !== 1) return 'refused'; b[0].click(); return 'clicked'; })()`,
      expect: `${S}.querySelectorAll('button.camera-request').length === 0`,
      within: 5000,
    });
    return a.landed;
  },
  pressSwitch: async () => {
    const a = await probe.act({
      what: 'press Switch to front camera once',
      run: `(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-switch'), function(x){ return x.textContent.trim() === 'Switch to front camera' && !x.disabled; }); if (b.length !== 1) return 'refused'; b[0].click(); return 'clicked'; })()`,
      expect: `(function(){ var b = ${S}.querySelector('button.camera-switch'); return !!b && b.textContent.trim() === 'Switch to back camera'; })()`,
      within: 4000,
    });
    return { landed: a.landed };
  },
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
    const landed = after.stop === 0 && after.cancel === 0;
    return { landed, atMs: clicked.at ?? Date.now(), clicked, trigger, text: after.text.slice(0, 300), canvasCss: after.canvasCss };
  },
  emergencyStop: async () => adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']),
  phoneLines: async () => (await adb(['shell', 'run-as', PKG, 'tail', '-n', '40', 'files/logs/link.log'])).split('\n').filter((l) => l.includes('[camera]')),
  sampleAfter: async () => {
    const cam = await adb(['shell', `dumpsys media.camera | sed -n '/Active Camera Clients/,+1p' | tr -s ' \\n' ' '; echo; dumpsys media.camera | grep -c 'package ${PKG}'`]);
    const p = await read(PANE);
    const i = await read(`(function(){ var i = window.__camInstr; return i ? { paints: i.paints.length, draws: i.draws.length } : null; })()`);
    return { clients: (cam.match(/Active Camera Clients: (\[[^\]]*\])/) || [null, 'UNREAD'])[1], ours: Number(cam.split('\n')[1]), stop: p.stop, cancel: p.cancel, canvasCss: p.canvasCss, instr: i };
  },
  phoneScreen,
  readInstr: () => read(`(function(){ var i = window.__camInstr; if (!i) return null; var s = i.stopAt; return {
    stopAt: s, paints: i.paints.length, draws: i.draws.length,
    paintsAfterStop: s === null ? null : i.paints.filter(function(t){ return t > s; }).length,
    drawsAfterStop: s === null ? null : i.draws.filter(function(t){ return t > s; }).length,
    lastDrawBeforeStopMs: s === null || !i.draws.length ? null : s - Math.max.apply(null, i.draws.filter(function(t){ return t <= s; }).concat([0]))
  }; })()`),
  writeReport: async (r) => writeFileSync(OUT, JSON.stringify(r, null, 1)),
}, DEFAULT_LIMITS);
note('session finished', { outcome: report.outcome, capture: report.capture, stopLanded: report.stopLanded && report.stopLanded.trigger });
exit(report.outcome === 'stopped' && report.capture.withinLimit ? 0 : 6, report);
