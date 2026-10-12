// The timed actions the maintained driver's `plain` case does not have, run BESIDE it (never instead of
// it). The driver owns: the one request, this attempt's stream id, the fresh phone-log cursor, the
// independent 20 s cap, and the 60 s watch from the end. This actor owns only:
//   smoke:      Switch to front at live+5 s, the real Mac Stop at live+15 s, then post-stop draw counts.
//   disconnect: the tray's Disconnect at live+5 s (Camera pane still selected), release confirmed,
//               the tray's Connect once, and 60 s of observation from the CONFIRMED reconnect.
// It never presses the request and never retries. Every action is gated, at the moment of acting, on
// the Mac's own state for the SAME stream id; a failed gate is logged and the action is not taken.
// No images or frame payloads are saved: the canvas is only counted (non-transparent sampled pixels).
import { execFile } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';

const MODE = process.argv[2];
const OUT = process.argv[3];
const ELECTRON_PID = Number(process.argv[4]);
if (!['smoke', 'disconnect'].includes(MODE) || !OUT || !ELECTRON_PID) {
  console.error('usage: actor.mjs <smoke|disconnect> <report.json> <electron-pid>');
  process.exit(2);
}
const REPO = '/Users/chetan/Desktop/ConnectSuite';
const PKG = 'com.chetan.connectsuite.debug';
const MACLOG = `${process.env.HOME}/Library/Application Support/sidekick-desktop/logs/sidekick.log`;
const NAV = `document.querySelectorAll('[data-nav]').length`;
const S = `document.querySelector('section[data-screen="camera"]')`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const events = [];
function note(what, data) {
  const at = Date.now();
  events.push({ atMs: at, iso: new Date(at).toISOString(), t: (at - t0) / 1000, what, data: data ?? null });
  console.log(`[actor] ${new Date(at).toISOString().slice(11, 23)} +${((at - t0) / 1000).toFixed(3)}s ${what}${data === undefined ? '' : ' ' + JSON.stringify(data)}`);
}
const save = (extra = {}) => writeFileSync(OUT, JSON.stringify({ mode: MODE, t0, events, ...extra }, null, 1));

function run(file, args, timeout = 8000) {
  return new Promise((ok) => execFile(file, args, { timeout, maxBuffer: 16 << 20 }, (err, out, errOut) => ok({ err: err ? String(err.message).slice(0, 200) : null, out: String(out ?? ''), errOut: String(errOut ?? '') })));
}
const adb = (args, timeout) => run(`${REPO}/scripts/adb-pinned.sh`, ['samsung', ...args], timeout);
async function ourCamera() {
  const r = await adb(['shell', `dumpsys media.camera | sed -n '/Active Camera Clients/,+1p' | tr -s ' \\n' ' '; echo`]);
  const m = r.out.match(/Active Camera Clients: (\[[^\]]*\])/);
  return { read: !!m, clients: m ? m[1] : null, ours: m ? m[1].includes(PKG) : null };
}
const macLogSize = () => statSync(MACLOG).size;
const macLogFrom = (from) => { const b = readFileSync(MACLOG); return b.subarray(Math.min(from, b.length)).toString('utf8'); };
async function phoneLogTail(n = 200) {
  const r = await adb(['exec-out', 'run-as', PKG, 'tail', '-n', String(n), 'files/logs/link.log']);
  return r.err ? null : r.out;
}

// The tray, by name. Every click re-checks the item's title and enabled flag in the same script.
async function tray(label, wantTitle) {
  const script = `tell application "System Events" to tell (first process whose unix id is ${ELECTRON_PID})
  set mi to menu bar item 1 of menu bar 2
  set ttl to title of mi
  if ttl is not "${wantTitle}" then return "REFUSED title=" & ttl
  click mi
  delay 0.4
  set its to (every menu item of menu 1 of mi whose name is "${label}")
  if (count of its) is not 1 then
    key code 53
    return "REFUSED no single item ${label}"
  end if
  set it to item 1 of its
  if not (enabled of it) then
    key code 53
    return "REFUSED ${label} disabled"
  end if
  click it
  return "clicked ${label}"
end tell`;
  const at = Date.now();
  const r = await run('/usr/bin/osascript', ['-e', script], 10000);
  return { at, result: (r.out || r.errOut).trim(), err: r.err };
}
async function trayTitle() {
  const r = await run('/usr/bin/osascript', ['-e', `tell application "System Events" to tell (first process whose unix id is ${ELECTRON_PID}) to get title of menu bar item 1 of menu bar 2`]);
  return r.out.trim();
}

const isTransfer = (l) => (/\[(bulk|share)\]/.test(l) || (/\[files\]/.test(l) && !/fs\.list|fs\.thumb|resume records/.test(l)));
const PORT = Number(process.env.ACTOR_PORT || 9222); // 9222 = the real app; another port only for the local fake-pane tests
const probe = await openProbe({ port: PORT });
const read = async (question, expr) => (await probe.read({ question, control: NAV, read: expr })).value;
const STATE = `(function(){ var cs = camera.state || {}; var s = ${S}; var st = s.querySelector('.camera-stage, [data-camera-stage]');
  var c = s.querySelector('canvas');
  return { kind: cs.kind || null, streamId: cs.streamId || null, facing: cs.facing || null, reason: cs.reason || null, framesReceived: cs.framesReceived ?? null, stalled: cs.stalled ?? null,
    paneVisible: !s.hidden, canvasParentHidden: c.closest('[hidden]') !== null, canvasPx: [c.width, c.height],
    switchButtons: Array.prototype.filter.call(s.querySelectorAll('button.camera-switch'), function(b){ return !b.disabled; }).map(function(b){ return b.textContent.trim(); }),
    stopButtons: Array.prototype.filter.call(s.querySelectorAll('button.camera-stop'), function(b){ return !b.disabled; }).length,
    statusText: (s.querySelector('.camera-status, [data-camera-status]') || {}).textContent || null,
    instr: window.__camInstr ? { paints: window.__camInstr.paints.length, draws: window.__camInstr.draws.length, lastDraw: window.__camInstr.draws[window.__camInstr.draws.length - 1] || null } : null };
})()`;
const LIT = `(function(){ var c = ${S}.querySelector('canvas'); try { if (!c.width || !c.height) return 0; var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; var n = 0, k = 0; for (var i = 3; i < d.length; i += 4 * 97) { k++; if (d[i] !== 0) n++; } return { litSampled: n, sampled: k }; } catch (e) { return 'unreadable: ' + e.message; } })()`;
const DRAWS_AFTER = (t) => `(function(){ var i = window.__camInstr; if (!i) return null; return { draws: i.draws.length, paints: i.paints.length, drawsAfter: i.draws.filter(function(x){ return x > ${t}; }).length, paintsAfter: i.paints.filter(function(x){ return x > ${t}; }).length, lastDraw: i.draws[i.draws.length-1] || null }; })()`;

let exitCode = 0;
try {
  // ---- wait for THIS stream to be live: the first 32-hex id the Mac shows after we start ------------
  const before = await read('state before', STATE);
  note('state at start', before);
  if (before.kind !== 'idle' && before.kind !== 'ended') { note('REFUSED: the pane is not idle at the start'); exitCode = 3; throw new Error('not idle'); }
  let streamId = null, liveAt = null, last = '';
  const waitUntil = Date.now() + 60_000;
  while (Date.now() < waitUntil) {
    const s = await read('state', STATE);
    const key = `${s.kind}|${s.streamId}`;
    if (key !== last) { note('state', { kind: s.kind, streamId: s.streamId, facing: s.facing, reason: s.reason }); last = key; }
    if (!streamId && /^[0-9a-f]{32}$/.test(s.streamId || '') && s.kind === 'requesting') streamId = s.streamId;
    if (streamId && s.streamId === streamId && s.kind === 'live') { liveAt = Date.now(); note('LIVE seen', { streamId }); break; }
    if (streamId && s.kind === 'ended') { note('ended before live — actor does nothing', s); break; }
    await sleep(100);
  }
  if (!liveAt) { note('NO ACTION: this stream never went live within 60 s'); exitCode = 4; throw new Error('never live'); }

  if (MODE === 'smoke') {
    // ---- live+5 s: Switch to front, gated on the same stream, back facing, one switch button ------------
    await sleep(Math.max(0, liveAt + 5000 - Date.now()));
    const g1 = await read('gate before switch', STATE);
    note('gate before switch', g1);
    if (g1.kind === 'live' && g1.streamId === streamId && g1.facing === 'back' && g1.switchButtons.length === 1 && g1.switchButtons[0] === 'Switch to front camera') {
      const r = await probe.act({
        what: 'Switch to front camera (once)',
        run: `(function(){ var b = Array.prototype.filter.call(${S}.querySelectorAll('button.camera-switch'), function(x){ return x.textContent.trim() === 'Switch to front camera' && !x.disabled; }); if (b.length !== 1 || camera.state.streamId !== '${streamId}') return 'refused'; b[0].click(); return 'clicked'; })()`,
        expect: `camera.state.kind === 'live' && camera.state.streamId === '${streamId}' && camera.state.facing === 'front'`,
        within: 6000,
      });
      note('SWITCH', { landed: r.landed, waitedMs: r.waitedMs, sentAtApprox: Date.now() - r.waitedMs });
    } else note('SWITCH NOT SENT: gate failed');

    // ---- live+15 s: the real Mac Stop ---------------------------------------------------------------
    await sleep(Math.max(0, liveAt + 15000 - Date.now()));
    const g2 = await read('gate before stop', STATE);
    note('gate before stop (picture control)', { ...g2, lit: await read('lit', LIT) });
    if (g2.kind === 'live' && g2.streamId === streamId && g2.stopButtons === 1) {
      const clicked = await read('press Stop', `(function(){ var s = ${S}; var b = Array.prototype.filter.call(s.querySelectorAll('button.camera-stop'), function(x){ return x.textContent.trim() === 'Stop camera' && !x.disabled; });
        if (b.length !== 1 || camera.state.streamId !== '${streamId}') return { clicked: false };
        var at = Date.now(); if (window.__camInstr) window.__camInstr.stopAt = at; b[0].click(); return { clicked: true, at: at }; })()`);
      note('STOP pressed', clicked);
      const stopAt = clicked.at;
      if (stopAt) {
        await sleep(300);
        note('+0.3 s after Stop', { ...(await read('after stop', STATE)), lit: await read('lit', LIT), drawsAfter: await read('draws after', DRAWS_AFTER(stopAt)) });
        for (const ms of [1000, 3000, 10000]) {
          await sleep(Math.max(0, stopAt + ms - Date.now()));
          const c = await ourCamera();
          note(`+${ms / 1000} s after Stop`, { drawsAfter: await read('draws after', DRAWS_AFTER(stopAt)), camera: c, kind: (await read('k', STATE)).kind });
        }
      }
    } else note('STOP NOT PRESSED by the actor: gate failed (the driver’s 20 s cap stays armed)');
    save({ streamId, liveAt });
  }

  if (MODE === 'disconnect') {
    await sleep(Math.max(0, liveAt + 5000 - Date.now()));
    const g1 = await read('gate before Disconnect', STATE);
    const route = await read('route', `(function(){ var v = Array.prototype.filter.call(document.querySelectorAll('section[data-screen]'), function(x){ return !x.hidden; }).map(function(x){ return x.getAttribute('data-screen'); }); return v; })()`);
    note('gate before Disconnect', { ...g1, visibleSections: route, lit: await read('lit', LIT) });
    if (!(g1.kind === 'live' && g1.streamId === streamId && g1.paneVisible && route.length === 1 && route[0] === 'camera')) {
      note('DISCONNECT NOT SENT: gate failed (the driver’s 20 s cap stays armed)'); exitCode = 5; throw new Error('gate');
    }
    const macFrom = macLogSize();
    const d = await tray('Disconnect', '● CS');
    note('TRAY Disconnect', d);
    if (!/^clicked/.test(d.result)) { note('Disconnect did not land — stopping; the driver’s cap stays armed'); exitCode = 6; throw new Error('tray'); }
    // The Mac's own ending for THIS stream.
    let ended = null;
    for (let i = 0; i < 50 && !ended; i++) { const s = await read('after disconnect', STATE); if (s.kind !== 'live') ended = { ...s, afterMs: Date.now() - d.at }; else await sleep(100); }
    note('Mac after Disconnect', { ...ended, lit: await read('lit', LIT) });
    // Release on the phone: the client list, every second, up to 15 s.
    let release = null;
    for (let i = 0; i < 15 && !release; i++) { const c = await ourCamera(); if (c.read && !c.ours) release = { ...c, afterMs: Date.now() - d.at }; else await sleep(1000); }
    note('phone camera release', release);
    const plog = await phoneLogTail(120);
    const pref = streamId.slice(0, 8);
    const phoneLines = (plog || '').split('\n').filter((l) => l.includes('[camera]') && (l.includes(pref) || /Camera released|Camera stream closed/.test(l))).slice(-8);
    note('phone [camera] lines for this stream (tail)', phoneLines);
    const releasedLine = phoneLines.some((l) => l.includes(`Camera released`) && l.includes(pref));
    if (!release || !releasedLine) { note('RELEASE NOT CONFIRMED — Connect is NOT pressed; stopping', { release, releasedLine }); exitCode = 7; throw new Error('release'); }
    note('Mac log since Disconnect', macLogFrom(macFrom).split('\n').filter((l) => /\[(link|camera)\]/.test(l)).slice(0, 12));

    // ---- the tray's Connect, once -------------------------------------------------------------------
    await sleep(1000);
    const macFrom2 = macLogSize();
    const c = await tray('Connect', '○ CS');
    note('TRAY Connect', c);
    if (!/^clicked/.test(c.result)) { note('Connect did not land — not retried'); exitCode = 8; throw new Error('connect'); }
    let reconnectedAt = null;
    for (let i = 0; i < 60 && !reconnectedAt; i++) {
      const lines = macLogFrom(macFrom2);
      const m = lines.split('\n').find((l) => l.includes('[link] Connected to'));
      if (m) { reconnectedAt = Date.now(); note('RECONNECT confirmed (Mac log)', { line: m.slice(0, 160), trayTitle: await trayTitle() }); }
      else await sleep(500);
    }
    if (!reconnectedAt) { note('RECONNECT NOT CONFIRMED within 30 s — not retried'); exitCode = 9; throw new Error('reconnect'); }

    // ---- 60 s from the confirmed reconnect ----------------------------------------------------------
    const samples = [];
    const pmark = (await phoneLogTail(1)) || '';
    while (Date.now() - reconnectedAt < 60_000) {
      const cam = await ourCamera();
      const s = await read('watch', STATE);
      const mac = macLogFrom(macFrom2).split('\n');
      samples.push({ t: (Date.now() - reconnectedAt) / 1000, ours: cam.ours, clients: cam.clients, kind: s.kind, streamId: s.streamId,
        macCameraRequests: mac.filter((l) => l.includes('camera.request')).length,
        macCameraLines: mac.filter((l) => l.includes('[camera]')).length,
        macTransferLines: mac.filter(isTransfer).length });
      await sleep(2000);
    }
    const ptail = (await phoneLogTail(400)) || '';
    const idx = ptail.lastIndexOf(pmark.trim());
    const after = (idx >= 0 ? ptail.slice(idx + pmark.trim().length) : ptail).split('\n');
    const reconnectIso = new Date(reconnectedAt).toISOString();
    const mac = macLogFrom(macFrom2).split('\n');
    note('watch summary (60 s from confirmed reconnect)', {
      samples: samples.length, everOurs: samples.some((x) => x.ours), everUnread: samples.some((x) => x.ours === null),
      kinds: [...new Set(samples.map((x) => x.kind))], macCameraRequests: Math.max(...samples.map((x) => x.macCameraRequests)),
      macCameraLinesSinceConnect: mac.filter((l) => l.includes('[camera]')).map((l) => l.slice(0, 180)),
      macTransferLinesSinceConnect: mac.filter(isTransfer).map((l) => l.slice(0, 180)),
      phoneCameraOrTransferLinesInWatch: after.filter((l) => /\[(camera|bulk|share|transfer)\]/.test(l)).map((l) => l.slice(0, 180)),
      phoneWatchAnchorFound: idx >= 0, reconnectIso,
    });
    save({ streamId, liveAt, reconnectedAt, samples });
  }
} catch (e) {
  note('actor stopped', { error: String(e.message) });
  save({ error: String(e.message) });
} finally {
  try { probe.close(); } catch {}
}
process.exit(exitCode);
