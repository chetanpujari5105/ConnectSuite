// Local verification of actor.mjs `disconnect` mode with an INJECTED tray (window.__fakeTray), a fake
// pane on :9334, a fake adb and a fake Mac log. This proves the actor's timing and gates; it does NOT
// exercise the macOS menu integration (osascript → System Events → the real status item), which only the
// live session can. No device, no real app, no real tray.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { runSession, createRecorder, DEFAULT_LIMITS } from '/Users/chetan/Desktop/ConnectSuite/scripts/camera-driver-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH = join(HERE, '..');
const ELECTRON = '/Users/chetan/Desktop/ConnectSuite/desktop/node_modules/.bin/electron';
const PORT = 9334;
const ADBLOG = join(HERE, 'fake-adb.log');
const CAM = join(HERE, 'fake-cam.txt');
const PLOG = join(HERE, 'fake-phone.log');
const MLOG = join(HERE, 'fake-mac.log');
const PKG = 'com.chetan.connectsuite.debug';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV = `document.querySelectorAll('[data-nav]').length`;
const S = `document.querySelector('section[data-screen="camera"]')`;
const Y = 'aaaaaaaa111111112222222233333333';
const results = [];
const only = process.argv.slice(2);
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + JSON.stringify(detail) : ''}`); };
const iso = () => new Date().toISOString().replace('Z', '+00:00');

async function startPage(scenario) {
  const p = spawn(ELECTRON, [join(HERE, 'main.js'), `--remote-debugging-port=${PORT}`, `--scenario=${scenario}`], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const t = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (t.some((x) => x.type === 'page' && x.url.includes('/renderer/index.html'))) break; } catch {}
    await sleep(250);
  }
  await sleep(300);
  return p;
}
const stopPage = (p) => new Promise((r) => { p.once('exit', r); p.kill('SIGTERM'); setTimeout(r, 3000); });
function startActor(tag) {
  const report = join(HERE, `actor-${tag}.json`);
  if (existsSync(report)) rmSync(report);
  const a = spawn('node', [join(SCRATCH, 'actor.mjs'), 'disconnect', report, '1'], {
    env: { ...process.env, ACTOR_PORT: String(PORT), ACTOR_FAKE_TRAY: '1', ACTOR_MACLOG: MLOG, CONNECTSUITE_ADB: join(HERE, 'fake-adb-d.sh'), FAKE_ADB_LOG: ADBLOG, FAKE_CAM_FILE: CAM, FAKE_PHONE_LOG: PLOG },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  a.stdout.on('data', (d) => { out += d; });
  a.stderr.on('data', (d) => { out += d; });
  return { a, done: new Promise((r) => a.once('exit', (c) => r(c))), out: () => out, report };
}
const pageRead = (probe, expr) => probe.read({ question: 'fake pane', control: NAV, read: expr }).then((r) => r.value);

/** Plays the phone and the Mac log from the fake page's state, as the real ones would answer. */
function startWorld(probe, scenario) {
  writeFileSync(CAM, '[]');
  writeFileSync(PLOG, `${iso()} I [camera] Camera released (closed): bbbbbbbb… back epoch 0 — 1 released of 1 bound\n${iso()} I [vitals] idle\n`);
  writeFileSync(MLOG, `${iso()} I [link] Connected to Samsung SM-S938B at 10.0.0.1 via last-known\n`); // an OLD line: must not count
  const t = { released: null, releasedLine: null, connected: null };
  let stop = false, disconnectSeen = null, connectSeen = null;
  const loop = (async () => {
    while (!stop) {
      let v;
      try { v = await pageRead(probe, `({ kind: camera.state.kind, log: window.__log.filter(function(e){ return /^TRAY (Disconnect|Connect)$/.test(e.what); }) })`); } catch { await sleep(100); continue; }
      const dis = v.log.find((e) => e.what === 'TRAY Disconnect');
      const con = v.log.find((e) => e.what === 'TRAY Connect');
      if (dis && !disconnectSeen) disconnectSeen = Date.now();
      if (con && !connectSeen) connectSeen = Date.now();
      const holding = v.kind === 'connecting' || v.kind === 'live';
      if (!disconnectSeen) writeFileSync(CAM, holding ? `[Client{package=${PKG}}]` : '[]');
      else if (Date.now() - disconnectSeen > 300) {
        if (scenario !== 'dReleaseNeverConfirmed') { writeFileSync(CAM, '[]'); if (!t.released) t.released = Date.now(); }
        if (scenario !== 'dReleasedLineMissing' && !t.releasedLine) {
          appendFileSync(PLOG, `${iso()} I [camera] Camera stream aaaaaaaa… stopped: MAC_DISCONNECTED — 50 sent / 0 dropped\n${iso()} I [camera] Camera released (closed): aaaaaaaa… back epoch 0 — 1 released of 1 bound\n`);
          t.releasedLine = Date.now();
        }
      }
      if (connectSeen && !t.connected && Date.now() - connectSeen > 500 && scenario !== 'dReconnectNeverConfirmed') {
        appendFileSync(MLOG, `${iso()} I [link] Connected to Samsung SM-S938B at 10.0.0.1 via last-known\n`);
        t.connected = Date.now();
      }
      await sleep(100);
    }
  })();
  return { t, end: async () => { stop = true; await loop; } };
}

function verdicts(scenario, log, actor, code, world) {
  const live = log.find((e) => e.what === 'state:live' && e.streamId === Y);
  const dis = log.filter((e) => e.what === 'TRAY Disconnect');
  const con = log.filter((e) => e.what === 'TRAY Connect');
  const refused = log.filter((e) => e.what === 'TRAY REFUSED');
  const nav = log.filter((e) => e.what.startsWith('CLICK nav'));
  const other = log.filter((e) => /^CLICK (request|cancel|stop|switch)/.test(e.what));
  const rep = existsSync(actor.report) ? JSON.parse(readFileSync(actor.report, 'utf8')) : null;
  const want = {
    dNormal: [1, 1, 0], dStale: [1, 1, 0], dEndedEarly: [0, 0, 5], dReplaced: [0, 0, 5], dExpired: [0, 0, 4], dPendingForever: [0, 0, 4],
    dStartLive: [0, 0, 3], dRouteChanged: [0, 0, 5], dReleaseNeverConfirmed: [1, 0, 7], dReleasedLineMissing: [1, 0, 7],
    dTrayTitleWrong: [0, 0, 6], dReconnectNeverConfirmed: [1, 1, 9],
  }[scenario];
  if (want) {
    check(`${scenario}: Disconnect actions = ${want[0]}`, dis.length === want[0], { got: dis.length });
    check(`${scenario}: Connect actions = ${want[1]}`, con.length === want[1], { got: con.length });
    check(`${scenario}: actor exit ${want[2]}`, code === want[2], { got: code });
  }
  check(`${scenario}: no request/cancel/stop/switch click, no nav click`, other.length === 0 && nav.length === 0, { other: other.map((e) => e.what), nav: nav.map((e) => e.what) });
  if (dis.length) {
    check(`${scenario}: Disconnect only on stream Y while live, Camera the only route, at live+5 s ±1 s`,
      dis.every((e) => e.streamId === Y && e.kind === 'live' && e.route.length === 1 && e.route[0] === 'camera') && Math.abs(dis[0].at - live.at - 5000) <= 1000, { dtMs: dis[0].at - live.at, route: dis[0].route });
    const after = log.filter((e) => e.at > dis[0].at);
    check(`${scenario}: route unchanged after Disconnect`, after.every((e) => e.route.length === 1 && e.route[0] === 'camera'));
  }
  if (con.length) {
    check(`${scenario}: Connect once, only after the Mac ended the stream AND release AND the released line`,
      con.length === 1 && world.t.released && world.t.releasedLine && con[0].at > world.t.released && con[0].at > world.t.releasedLine && con[0].kind === 'ended',
      { connectMinusRelease: world.t.released && con[0].at - world.t.released, connectMinusLine: world.t.releasedLine && con[0].at - world.t.releasedLine, kindAtConnect: con[0].kind });
  }
  if (rep && rep.streamId) check(`${scenario}: actor bound to this attempt's id`, rep.streamId === Y, { bound: rep.streamId });
  if (scenario === 'dNormal' || scenario === 'dStale') {
    const reconnected = rep && rep.reconnectedAt;
    const span = rep && rep.samples && rep.samples.length ? rep.samples[rep.samples.length - 1].t : null;
    check(`${scenario}: reconnect confirmed from a NEW log line (the old one ignored) and a 60 s watch from it`, reconnected && reconnected >= world.t.connected && span >= 57, { watchedS: span, samples: rep && rep.samples && rep.samples.length });
  }
  if (refused.length) console.log(`      tray refusals: ${JSON.stringify(refused.map((e) => e.label + '@' + e.title))}`);
  console.log(`      actor exit ${code}; ${actor.out().trim().split('\n').slice(-1)[0].slice(0, 220)}`);
}

const ALL = ['dNormal', 'dStale', 'dEndedEarly', 'dReplaced', 'dExpired', 'dStartLive', 'dRouteChanged', 'dReleaseNeverConfirmed', 'dReleasedLineMissing', 'dTrayTitleWrong', 'dReconnectNeverConfirmed', 'dPendingForever'];
for (const scenario of ALL) {
  if (only.length && !only.includes(scenario)) continue;
  const page = await startPage(scenario);
  const probe = await openProbe({ port: PORT });
  const world = startWorld(probe, scenario);
  const actor = startActor(scenario);
  await sleep(1500);
  await pageRead(probe, `window.__go()`);
  const code = await Promise.race([actor.done, sleep(150_000).then(() => 'timeout')]);
  await world.end();
  const log = await pageRead(probe, `window.__log`);
  probe.close();
  await stopPage(page);
  verdicts(scenario, log, actor, code, world);
}

// ---- beside the real driver core: the cap does not depend on the actor --------------------------
const PANE_SRC = (() => {
  const src = readFileSync('/Users/chetan/Desktop/ConnectSuite/scripts/camera-driver.mjs', 'utf8');
  const i = src.indexOf('const PANE = `'); const j = src.indexOf('`;', i);
  return src.slice(i + 'const PANE = `'.length, j).replaceAll('${S}', S).replaceAll('\\\\s', '\\s');
})();
for (const scenario of ['capDNormal', 'capDFrozen']) {
  if (only.length && !only.includes(scenario)) continue;
  const page = await startPage(scenario);
  const probe = await openProbe({ port: PORT });
  const world = startWorld(probe, scenario);
  const actor = startActor(scenario);
  await sleep(1500);
  let frozen = false;
  if (scenario === 'capDFrozen') (async () => { for (;;) { if (/LIVE seen/.test(actor.out())) { actor.a.kill('SIGSTOP'); frozen = true; return; } await sleep(20); } })();
  const read = (e) => pageRead(probe, e);
  const report = await runSession({
    now: Date.now, setTimeout, clearTimeout, sleep, recorder: createRecorder({ print: () => {} }),
    readPane: () => read(PANE_SRC),
    pressRequest: async () => (await probe.act({ what: 'request', run: `(function(){ var b = ${S}.querySelectorAll('button.camera-request'); if (b.length !== 1) return 'refused'; b[0].click(); return 'clicked'; })()`, expect: `${S}.querySelectorAll('button.camera-request').length === 0`, within: 5000 })).landed,
    pressStop: async (trigger) => {
      const c = await read(`(function(){ var s = ${S}; var b = s.querySelectorAll('button.camera-stop'); var c = s.querySelectorAll('button.camera-cancel'); var x = b.length === 1 ? b[0] : c.length === 1 ? c[0] : null; if (!x) return { at: null }; var at = Date.now(); x.click(); return { at: at }; })()`);
      const after = await read(PANE_SRC);
      return { landed: after.stop === 0 && after.cancel === 0, atMs: c.at ?? Date.now(), trigger };
    },
    emergencyStop: async () => 'EMERGENCY (fake)',
    phoneLogMark: async () => ({ inode: 1, size: 0 }),
    phoneLogRead: async () => ({ inode: 1, size: 0, bytes: Buffer.alloc(0) }),
    sampleAfter: async () => ({ kind: (await read(PANE_SRC)).kind }),
    readInstr: async () => null,
    writeReport: async (r) => writeFileSync(join(HERE, `driver-${scenario}.json`), JSON.stringify(r, null, 1)),
  }, { ...DEFAULT_LIMITS, OBSERVE_MS: 3000 });
  if (frozen) actor.a.kill('SIGCONT');
  const code = await Promise.race([actor.done, sleep(150_000).then(() => 'timeout')]);
  await world.end();
  const log = await read(`window.__log`);
  probe.close();
  await stopPage(page);
  const stops = log.filter((e) => e.what === 'CLICK stop');
  const dis = log.filter((e) => e.what === 'TRAY Disconnect');
  const con = log.filter((e) => e.what === 'TRAY Connect');
  if (scenario === 'capDNormal') {
    check('capDNormal: driver outcome ended-by-stimulus (reason disconnected-here), no fallback stop', report.outcome === 'ended-by-stimulus' && report.productEnding?.reason === 'disconnected-here' && report.actions.fallbackStops.length === 0, { outcome: report.outcome, reason: report.productEnding?.reason });
    check('capDNormal: one request by the driver; one Disconnect and one Connect by the actor; no Stop click', log.filter((e) => e.what === 'CLICK request').length === 1 && dis.length === 1 && con.length === 1 && stops.length === 0, { dis: dis.length, con: con.length, stops: stops.length });
  } else {
    check('capDFrozen: actor frozen after LIVE', frozen);
    check('capDFrozen: the driver deadline stopped capture by itself, inside 20 s', report.outcome === 'no-reading:deadline' && report.actions.fallbackStops[0]?.trigger === 'deadline' && stops.length === 1 && stops[0].at - report.anchor <= 20000, { outcome: report.outcome, anchorToStop: stops[0] && stops[0].at - report.anchor });
    check('capDFrozen: resumed actor took no tray action on the ended stream', dis.length === 0 && con.length === 0 && /DISCONNECT NOT SENT/.test(actor.out()), { tail: actor.out().trim().split('\n').slice(-1)[0].slice(0, 160) });
  }
  console.log(`      actor exit ${code}`);
}

const adb = existsSync(ADBLOG) ? readFileSync(ADBLOG, 'utf8').trim().split('\n') : [];
const writes = adb.filter((l) => /\b(install|input|am |pm |settings|keyevent|push|rm )/.test(l));
check('fake adb: reads only', writes.length === 0, { calls: adb.length, writes });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
