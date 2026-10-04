#!/usr/bin/env node
// The Camera v2 encoder spike's driver: ONE supervised webcam request on the pinned phone, run by the
// development Mac's spike runner (desktop/src/main/webcamSpike.ts), observed from both ends, judged by
// the pre-registered criteria in webcam-spike-core.mjs. docs/camera-v2-encoder-spike.md is the runbook.
//
//   node scripts/webcam-spike-driver.mjs                 help only — touches nothing
//   node scripts/webcam-spike-driver.mjs --plan          the steps, bounds and criteria — touches nothing
//   node scripts/webcam-spike-driver.mjs --dry-run       READ-ONLY gates: pins the phone, stats its log,
//                                                        reads the Mac's spike status. No request.
//   node scripts/webcam-spike-driver.mjs --execute --report <new file> --owner-present
//                                                        ONE request. Every flag is required.
//
// Rules this file keeps:
//  - Every device command goes through `scripts/adb-pinned.sh samsung …`. Device WRITES: none in the
//    ordinary run. The one exception is the emergency stop — one KEYCODE_HOME if our package still holds a
//    camera 25 s after the tap, which the Mac's planned Stop (15 s) and hard cap (20 s) should make
//    impossible. Pressing it is recorded and fails the run.
//  - The request is the Mac's (`window.connect.webcamSpikeRun()`, back camera, trigger "person"); the
//    approval is the owner's tap. This never taps, grants or dismisses anything on the phone.
//  - It calls the run at most once, and the Mac refuses a second run per launch anyway.
//  - Nothing of the picture is read, kept or written: the report holds the Mac's integers, the phone's
//    `[webcam]` lines for this session (peer name removed), and camera-client samples.
//  - The phone log is read from a byte offset and inode taken BEFORE the request, cut at the newline byte
//    (camera-driver-core's `takeWholeLines`); a rotation or truncation is NO READING, never a fallback.
//  - It refuses to write over an existing report: a report is evidence.
import { execFile } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { takeWholeLines } from './camera-driver-core.mjs';
import { BOUNDS, DRIVER_LIMITS, USAGE, parseArgs, parseWebcamLine, verdict } from './webcam-spike-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'com.chetan.connectsuite.debug';
const LOG = 'files/logs/link.log';

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
async function logBytes(from) {
  const st = await logStat();
  if (st.size <= from) return { ...st, bytes: Buffer.alloc(0) };
  return { ...st, bytes: await adb(['exec-out', 'run-as', PKG, 'tail', '-c', `+${from + 1}`, LOG], { buffer: true }) };
}
async function phoneState() {
  const out = await adb(['shell', 'dumpsys activity activities | grep topResumedActivity; dumpsys window | grep -E "isKeyguardShowing="; dumpsys power | grep -E "mWakefulness="; dumpsys telephony.registry | grep -E "mCallState="; dumpsys thermalservice | grep -E "Thermal Status:"']);
  return {
    top: (out.match(/u0 (\S+)/) || [null, null])[1], keyguard: /isKeyguardShowing=true/.test(out), awake: /mWakefulness=Awake/.test(out),
    callActive: /mCallState=[12]/.test(out), thermal: Number((out.match(/Thermal Status: (\d)/) || [null, 'NaN'])[1]),
  };
}
async function ourCamera() {
  const out = await adb(['shell', `dumpsys media.camera | sed -n '/Active Camera Clients/,+1p' | tr -s ' \\n' ' '; echo`]);
  const clients = (out.match(/Active Camera Clients: (\[[^\]]*\])/) || [null, 'UNREAD'])[1];
  return { clients, oursActive: clients.includes(PKG), read: clients !== 'UNREAD' };
}

/** Read-only: the interface macOS routes the phone's address through, and that interface's kind. */
function macRoute(address) {
  if (!/^[0-9.]+$/.test(address)) return Promise.resolve({ address, error: 'not an IPv4 literal' });
  return new Promise((ok) => execFile('/sbin/route', ['-n', 'get', address], { timeout: 5000 }, (err, out) => {
    const iface = (String(out ?? '').match(/interface: (\S+)/) || [null, null])[1];
    if (!iface) return ok({ address, interface: null, error: err ? err.message : 'no interface line' });
    execFile('/usr/sbin/networksetup', ['-listallhardwareports'], { timeout: 5000 }, (_e, ports) => {
      const block = String(ports ?? '').split('\n\n').find((b) => b.includes(`Device: ${iface}`)) ?? '';
      ok({ address, interface: iface, hardwarePort: (block.match(/Hardware Port: (.+)/) || [null, null])[1] });
    });
  }));
}

const NAV = `document.querySelectorAll('[data-nav]').length`;

async function main(argv) {
  const args = parseArgs(argv);
  if (args.mode === 'help') { console.log(USAGE); return 0; }
  if (args.mode === 'refused') { console.error(`REFUSED — nothing was run:\n  ${args.errors.join('\n  ')}\n\n${USAGE}`); return 2; }
  if (args.mode === 'plan') { console.log(JSON.stringify({ limits: DRIVER_LIMITS, bounds: BOUNDS, runbook: 'docs/camera-v2-encoder-spike.md' }, null, 1)); return 0; }
  if (args.mode === 'execute' && existsSync(args.report)) {
    console.error(`REFUSED — ${args.report} exists; a report is evidence and is never overwritten. Nothing was run.`);
    return 2;
  }

  const t0 = Date.now();
  const note = (what, data) => console.log(`+${((Date.now() - t0) / 1000).toFixed(3)}s ${what}${data === undefined ? '' : ' ' + JSON.stringify(data)}`);
  const { openProbe } = await import('./probe.mjs');
  const probe = await openProbe({ port: 9222 });
  const read = async (question, expr) => (await probe.read({ question, control: NAV, read: expr })).value;
  try {
    // ---- gates, read-only --------------------------------------------------------------------------
    const status = await read('the spike status', `window.connect && window.connect.webcamSpikeCurrent ? window.connect.webcamSpikeCurrent().then(function(s){ return s; }, function(e){ return { armed: false, reason: String(e && e.message || e) }; }) : { armed: false, reason: 'the preload has no webcamSpikeCurrent' }`);
    const ps = await phoneState();
    const cam = await ourCamera();
    const log0 = await logStat().catch((e) => ({ error: e.message }));
    note('gates (read-only)', { spike: { armed: status?.armed, phase: status?.phase, spent: status?.spent, reason: status?.reason }, phone: ps, camera: cam, phoneLog: log0 });
    const fail = [];
    if (!status?.armed) fail.push(`the Mac's encoder spike is not armed: ${status?.reason ?? 'no status'}`);
    else if (status.spent || status.phase !== 'idle') fail.push(`the spike has already run in this launch (phase ${status.phase})`);
    if (!ps.top || !ps.top.startsWith(`${PKG}/`)) fail.push(`Sidekick is not the resumed activity (${ps.top})`);
    if (ps.keyguard || !ps.awake) fail.push('the phone is locked or asleep');
    if (ps.callActive) fail.push('a call is active');
    if (Number.isFinite(ps.thermal) && ps.thermal >= 2) fail.push(`the phone's thermal status is ${ps.thermal} (moderate or worse)`);
    if (!cam.read) fail.push('the camera client list could not be read');
    if (cam.oursActive) fail.push('our package already holds a camera');
    if (typeof log0.inode !== 'number') fail.push('the phone log cannot be stat-ed');
    if (fail.length) { note('ABORT before any request — NO READING', { fail }); return 5; }
    if (args.mode === 'dry-run') { note('DRY RUN: every gate passed; no request, no key, no launch'); return 0; }

    // ---- the one run ---------------------------------------------------------------------------------
    const mark = log0;
    let carry = Buffer.alloc(0);
    let offset = mark.size;
    const lines = [];
    let rotated = false;
    const pull = async () => {
      const r = await logBytes(offset).catch(() => null);
      if (!r) return;
      if (r.inode !== mark.inode || r.size < offset) { rotated = true; return; }
      offset += r.bytes.length;
      const cut = takeWholeLines(carry, r.bytes);
      carry = cut.rest;
      for (const l of cut.lines) if (l.includes('[webcam]')) lines.push({ ...parseWebcamLine(l), seenAtMs: Date.now() - t0 });
    };

    const ran = await probe.act({
      what: 'call the spike run once',
      run: `(function(){ if (window.__spikeRunCalled) return 'refused: already called'; window.__spikeRunCalled = true; window.__spikeRun = null; window.connect.webcamSpikeRun().then(function(r){ window.__spikeRun = r; }, function(e){ window.__spikeRun = { ok: false, reason: String(e) }; }); return 'called'; })()`,
      expect: `window.__spikeRun !== null && window.__spikeRun !== undefined`,
      within: 10_000,
    });
    const runResult = await read('the run answer', 'window.__spikeRun');
    note('run called', { landed: ran.landed, result: runResult });

    let spike = null;
    let startingAtMs = null;
    let stopAtMs = null;
    let releasedWithinMs = null;
    let emergencyHome = false;
    let observationSamples = 0;
    let heldDuringObservation = 0;
    let lastPoll = 0;
    for (;;) {
      const now = Date.now() - t0;
      const s = await read('the spike status', 'window.connect.webcamSpikeCurrent()');
      await pull();
      if (s.phase === 'capturing' && startingAtMs === null) startingAtMs = now;
      if ((s.phase === 'stopping' || s.phase === 'observing' || s.phase === 'done') && stopAtMs === null && startingAtMs !== null) stopAtMs = now;
      if (now - lastPoll >= DRIVER_LIMITS.CAMERA_POLL_MS) {
        lastPoll = now;
        const c = await ourCamera().catch(() => ({ read: false }));
        if (stopAtMs !== null && releasedWithinMs === null && c.read && !c.oursActive) releasedWithinMs = now - stopAtMs;
        if (s.phase === 'observing' && c.read) { observationSamples += 1; if (c.oursActive) heldDuringObservation += 1; }
        // The driver's own, independent emergency: never relies on the Mac's timers.
        if (startingAtMs !== null && c.read && c.oursActive && now - startingAtMs >= DRIVER_LIMITS.EMERGENCY_MS && !emergencyHome) {
          emergencyHome = true;
          note('EMERGENCY: our package still holds a camera 25 s after the tap — one KEYCODE_HOME through the pin');
          await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']).catch((e) => note('emergency Home failed', { error: e.message }));
        }
      }
      if (s.phase === 'done') { spike = s.report; break; }
      if (now > DRIVER_LIMITS.OVERALL_MS) { note('the overall deadline passed before the spike finished — NO READING'); break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    await pull();
    // The route, read rather than assumed: which Mac interface reaches the phone's address. A USB cable
    // carrying adb is not this route; the stream's TLS socket goes wherever this says.
    const route = spike?.route?.address ? await macRoute(spike.route.address) : null;
    note('route', route);
    const prefix = spike?.session ?? null;
    const mine = lines.filter((l) => l.prefix === null || l.prefix === prefix);
    const capturesAfterStop = stopAtMs === null ? 0 : mine.filter((l) => l.kind === 'capture' && l.seenAtMs > stopAtMs + 2_000).length;
    const phone = { lines: mine, releasedWithinMs, heldDuringObservation, observationSamples, capturesAfterStop, emergencyHome, rotated, otherSessions: lines.filter((l) => l.prefix && l.prefix !== prefix).length };
    const judged = rotated ? { verdict: 'NO READING', reasons: ['the phone log rotated or shrank during the run'], passed: [], info: {} } : verdict(spike, phone);
    writeFileSync(args.report, JSON.stringify({ runbook: 'docs/camera-v2-encoder-spike.md', verdict: judged, spike, route, phone, startedAt: new Date(t0).toISOString() }, null, 1), { flag: 'wx' });
    note('finished', { verdict: judged.verdict, reasons: judged.reasons, report: args.report });
    return 0;
  } finally {
    try { probe.close(); } catch { /* the page may already be gone */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`webcam-spike-driver: ${e && e.stack ? e.stack : e}`); process.exit(1); });
}
