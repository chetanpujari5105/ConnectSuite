#!/usr/bin/env node
// The Camera v1 hardware driver: ONE supervised camera request on the pinned phone, driven through the
// Mac's Camera pane, timed and bounded by `camera-driver-core.mjs`.
//
//   node scripts/camera-driver.mjs                        help only — touches nothing
//   node scripts/camera-driver.mjs --plan --case home     the steps and bounds — touches nothing
//   node scripts/camera-driver.mjs --dry-run --case home  READ-ONLY gates: pins the phone, stats its log,
//                                                         reads the pane. No request, no key, no launch.
//   node scripts/camera-driver.mjs --execute --case home --report <new file> --owner-present
//                                                         ONE request. Every flag is required.
//
// Cases: `plain` — the owner (or the 20 s cap) stops it; `home` — the driver presses Home once, 5 s
// after THIS stream is live on the Mac, then confirms the release and reopens Sidekick normally.
//
// Rules this file keeps, beyond the core's:
//  - Every device command goes through `scripts/adb-pinned.sh samsung …` (CLAUDE.md: writes through the
//    pin). Device WRITES are: one request (via the Mac's button), the Stop/Cancel button, one
//    `KEYCODE_HOME` (case home, and as the emergency stop), and one normal launcher start (case home's
//    return). Nothing else writes.
//  - Approval is the owner's: this never taps Start camera, never grants a permission, never dismisses
//    anything on the phone.
//  - It refuses to write over an existing report: a report is evidence.
//  - It does not loop and never sends a second request, whatever happens.
//  - The page instrument is installed once and disposed at the end, whatever the outcome.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRecorder, runSession, INSTALL_INSTRUMENT, DISPOSE_INSTRUMENT, DEFAULT_LIMITS } from './camera-driver-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'com.chetan.connectsuite.debug';
const LOG = 'files/logs/link.log';
const MACLOG = join(process.env.HOME ?? '', 'Library/Application Support/sidekick-desktop/logs/sidekick.log');
const CASES = Object.freeze({
  plain: { actionMs: null, describe: 'no driver action: the owner stops it on the phone or the Mac, or the 20 s cap does' },
  home: { actionMs: 5_000, describe: 'one KEYCODE_HOME 5 s after THIS stream is live on the Mac; then release + LEFT_SCREEN confirmed, then one normal reopen' },
});

export const USAGE = `camera-driver — one supervised Camera v1 request (see the header of this file)

  --plan --case <plain|home>                          print steps and bounds; touches nothing
  --dry-run --case <plain|home>                       read-only gates; no request, no key, no launch
  --execute --case <plain|home> --report <new file> --owner-present
                                                      ONE request; every flag required

Without --dry-run or --execute this prints and exits. It never sends a request on its own.`;

/** Pure: what the arguments ask for, or why they ask for nothing. */
export function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const value = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const known = new Set(['--plan', '--dry-run', '--execute', '--case', '--report', '--owner-present', '--help']);
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && !known.has(a)) errors.push(`unknown flag ${a}`);
    if ((a === '--case' || a === '--report') && i + 1 < argv.length) i++;
  }
  const modes = ['--plan', '--dry-run', '--execute'].filter(has);
  if (modes.length > 1) errors.push(`choose one of --plan, --dry-run, --execute (got ${modes.join(', ')})`);
  const mode = modes.length === 1 ? modes[0].slice(2) : 'help';
  const kase = value('--case');
  if (mode !== 'help' && !kase) errors.push('--case is required');
  if (kase && !CASES[kase]) errors.push(`unknown case ${kase}`);
  const report = value('--report');
  if (mode === 'execute') {
    if (!report) errors.push('--execute needs --report <new file>');
    if (!has('--owner-present')) errors.push('--execute needs --owner-present: the phone’s owner must be there to answer the request');
  }
  return { mode: errors.length ? 'refused' : mode, kase, report, errors };
}

// ---- the real phone and Mac (only reached by --dry-run and --execute) --------------------------------

function adb(args, { timeout = 8000, buffer = false } = {}) {
  return new Promise((ok, fail) =>
    execFile(join(REPO, 'scripts/adb-pinned.sh'), ['samsung', ...args], { timeout, maxBuffer: 16 << 20, encoding: buffer ? 'buffer' : 'utf8' }, (err, out) =>
      err && (!out || !out.length) ? fail(err) : ok(out)));
}
async function logStat() {
  const out = await adb(['shell', 'run-as', PKG, 'stat', '-c', 'ino=%i_size=%s', LOG]);
  const m = String(out).match(/ino=(\d+)_size=(\d+)/);
  if (!m) throw new Error(`no stat for ${LOG}`);
  return { inode: Number(m[1]), size: Number(m[2]) };
}
/** Raw bytes from [from]; the core cuts lines at the newline byte and checks rotation against the stat. */
async function logRead(from) {
  const st = await logStat();
  if (st.size <= from) return { inode: st.inode, size: st.size, bytes: Buffer.alloc(0) };
  const raw = await adb(['exec-out', 'run-as', PKG, 'tail', '-c', `+${from + 1}`, LOG], { buffer: true });
  return { inode: st.inode, size: st.size, bytes: raw };
}
async function phoneState() {
  const out = await adb(['shell', 'dumpsys activity activities | grep topResumedActivity; dumpsys window | grep -E "isKeyguardShowing="; dumpsys power | grep -E "mWakefulness="; dumpsys telephony.registry | grep -E "mCallState="']);
  return {
    top: (out.match(/u0 (\S+)/) || [null, null])[1], keyguard: /isKeyguardShowing=true/.test(out),
    awake: /mWakefulness=Awake/.test(out), callActive: /mCallState=[12]/.test(out),
  };
}
async function ourCamera() {
  const out = await adb(['shell', `dumpsys media.camera | sed -n '/Active Camera Clients/,+1p' | tr -s ' \\n' ' '; echo`]);
  const clients = (out.match(/Active Camera Clients: (\[[^\]]*\])/) || [null, 'UNREAD'])[1];
  return { clients, oursActive: clients.includes(PKG), read: clients !== 'UNREAD' };
}

const S = `document.querySelector('section[data-screen="camera"]')`;
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

/** Every page read goes through probe.mjs with the same control: the app's nav rows are there. */
const NAV = `document.querySelectorAll('[data-nav]').length`;
const pageReader = (probe) => async (expr) => (await probe.read({ question: 'camera pane', control: NAV, read: expr })).value;

async function gates(probe, note) {
  const read = pageReader(probe);
  const resolved = String(await adb(['shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', PKG])).trim().split('\n').pop().trim();
  const paneVisible = await read(`!${S}.hidden`);
  const ps = await phoneState();
  const cam = await ourCamera();
  const pane = paneVisible ? await read(PANE) : null;
  const log = await logStat().catch((e) => ({ error: e.message }));
  note('gates (read-only)', { resolved, paneVisible, phone: ps, camera: cam, pane: pane && { kind: pane.kind, request: pane.request, stop: pane.stop, cancel: pane.cancel }, phoneLog: log });
  const fail = [];
  if (resolved !== `${PKG}/com.chetan.connectsuite.MainActivity`) fail.push(`unexpected launcher activity: ${resolved}`);
  if (!paneVisible) fail.push('the Camera pane is not the visible pane on the Mac — open it by hand first');
  if (!ps.top || !ps.top.startsWith(`${PKG}/`)) fail.push(`Sidekick is not the resumed activity (${ps.top})`);
  if (ps.keyguard || !ps.awake) fail.push('the phone is locked or asleep');
  if (ps.callActive) fail.push('a call is active');
  if (!cam.read) fail.push('the camera client list could not be read');
  if (cam.oursActive) fail.push('our package already holds a camera');
  if (pane && (pane.request.length !== 1 || pane.stop !== 0 || pane.cancel !== 0)) fail.push('the pane is not idle with one request button');
  if (pane && /not connected/i.test(pane.text)) fail.push('the Mac is not connected');
  if (typeof log.inode !== 'number') fail.push('the phone log cannot be stat-ed');
  return { fail, resolved, read };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.mode === 'help') { console.log(USAGE); return 0; }
  if (args.mode === 'refused') { console.error(`REFUSED — nothing was run:\n  ${args.errors.join('\n  ')}\n\n${USAGE}`); return 2; }
  const kase = CASES[args.kase];
  if (args.mode === 'plan') {
    console.log(JSON.stringify({ case: args.kase, describe: kase.describe, limits: { ...DEFAULT_LIMITS, ACTION_MS: kase.actionMs } }, null, 1));
    return 0;
  }
  if (args.mode === 'execute' && existsSync(args.report)) {
    console.error(`REFUSED — ${args.report} exists; a report is evidence and is never overwritten. Nothing was run.`);
    return 2;
  }

  const recorder = createRecorder();
  const { note } = recorder;
  const { openProbe } = await import('./probe.mjs');
  const probe = await openProbe({ port: 9222 });
  const macLogStart = existsSync(MACLOG) ? statSync(MACLOG).size : 0;
  const macLogSince = () => {
    try { const b = readFileSync(MACLOG); return (b.length >= macLogStart ? b.subarray(macLogStart) : b).toString('utf8'); } catch { return ''; }
  };
  let installed = false;
  try {
    const g = await gates(probe, note);
    if (g.fail.length) { note('ABORT before any request — NO READING', { fail: g.fail }); return 5; }
    if (args.mode === 'dry-run') { note('DRY RUN: every gate passed; no request, no key, no launch'); return 0; }

    const instrument = await g.read(INSTALL_INSTRUMENT);
    installed = /^installed once/.test(String(instrument));
    note('instrument', { instrument });
    if (!installed) { note('ABORT before any request — the page instrument did not install'); return 5; }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const afterEnd = kase.actionMs === null ? null : async (ctx) => {
      let release = null;
      for (let i = 0; i < 10 && !release; i++) {
        const c = await ourCamera();
        if (c.read && !c.oursActive) release = { released: true, withinS: i };
        else await sleep(1000);
      }
      let stopped = null;
      for (let i = 0; i < 10 && !stopped; i++) {
        const r = await logRead(ctx.logStart.size).catch(() => null);
        const m = r && r.bytes.toString('utf8').match(new RegExp(`Camera stream ${ctx.prefix}… stopped: ([A-Z_]+) — (\\d+) sent / (\\d+) dropped`));
        if (m) stopped = { reason: m[1], sent: +m[2], dropped: +m[3], match: 'prefix-8' };
        else await sleep(1000);
      }
      const pane = await g.read(PANE);
      const gate = [];
      if (!release) gate.push('our package still holds a camera 10 s after the end');
      if (!stopped) gate.push('no stopped line for this stream in the phone log');
      else if (stopped.reason !== 'LEFT_SCREEN') gate.push(`the phone ended it as ${stopped.reason}, not LEFT_SCREEN`);
      if (pane.kind !== 'ended' || pane.streamId !== ctx.streamId) gate.push('the Mac does not show this stream ended');
      if (gate.length) {
        if (!release) await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']).catch(() => null);
        return { done: false, fail: gate, release, stopped };
      }
      const launch = String(await adb(['shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-n', g.resolved])).trim();
      for (let i = 0; i < 15; i++) {
        const s = await phoneState().catch(() => ({}));
        if (s.top && s.top.startsWith(`${PKG}/`) && !s.keyguard && s.awake) return { done: true, reopenedAt: Date.now(), release, stopped, launch: launch.split('\n').pop() };
        await sleep(1000);
      }
      return { done: false, fail: ['Sidekick did not come to the front within 15 s of the launch'], release, stopped };
    };

    const report = await runSession({
      now: Date.now, setTimeout, clearTimeout, sleep, recorder,
      readPane: () => g.read(PANE),
      pressRequest: async () => (await probe.act({
        what: 'press the request once',
        run: `(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-request'), function(x){ return /^(Ask phone for camera|Ask again)$/.test(x.textContent.trim()) && !x.disabled; }); if (b.length !== 1) return 'refused'; b[0].click(); return 'clicked'; })()`,
        expect: `${S}.querySelectorAll('button.camera-request').length === 0`,
        within: 5000,
      })).landed,
      pressAction: kase.actionMs === null ? undefined : async () => {
        const sentAt = Date.now();
        await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
        return { landed: true, what: 'one KEYCODE_HOME through the pinned wrapper', sentAt };
      },
      pressStop: async (trigger) => {
        const clicked = await g.read(`(function(){
          var s = ${S};
          var stop = Array.prototype.filter.call(s.querySelectorAll('button.camera-stop'), function(x){ return x.textContent.trim() === 'Stop camera' && !x.disabled; });
          var cancel = Array.prototype.filter.call(s.querySelectorAll('button.camera-cancel'), function(x){ return !x.disabled; });
          var b = stop.length === 1 ? stop[0] : cancel.length === 1 ? cancel[0] : null;
          if (!b) return { clicked: null };
          var at = Date.now(); if (window.__camInstr) window.__camInstr.stopAt = at; b.click();
          return { clicked: b.textContent.trim(), at: at };
        })()`);
        const after = await g.read(PANE);
        const c = await ourCamera();
        return { landed: after.stop === 0 && after.cancel === 0 && c.read && !c.oursActive, atMs: clicked.at ?? Date.now(), clicked, trigger };
      },
      emergencyStop: async () => adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']),
      phoneLogMark: logStat,
      phoneLogRead: logRead,
      afterEnd: afterEnd ?? undefined,
      sampleAfter: async () => {
        const c = await ourCamera();
        const p = await g.read(PANE);
        return { clients: c.clients, kind: p.kind, streamId: p.streamId, live: p.kind === 'live', macCameraRequests: (macLogSince().match(/camera\.request sent/g) || []).length };
      },
      readInstr: () => g.read(`(function(){ var i = window.__camInstr; return i ? { stopAt: i.stopAt, paints: i.paints.length, draws: i.draws.length } : null; })()`),
      writeReport: async (r) => writeFileSync(args.report, JSON.stringify({ case: args.kase, macLog: macLogSince().split('\n').filter((l) => l.includes('[camera]')), ...r }, null, 1), { flag: 'wx' }),
    }, { ...DEFAULT_LIMITS, ACTION_MS: kase.actionMs });
    note('finished', { outcome: report.outcome, capture: report.capture, observation: report.observation });
    return 0;
  } finally {
    if (installed) note('instrument disposed', { result: await pageReader(probe)(DISPOSE_INSTRUMENT).catch((e) => `failed: ${e.message}`) });
    try { probe.close(); } catch { /* the page may already be gone */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`camera-driver: ${e && e.stack ? e.stack : e}`); process.exit(1); });
}
