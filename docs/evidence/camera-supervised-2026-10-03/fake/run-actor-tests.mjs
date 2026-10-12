// Local verification of actor.mjs (smoke mode) against the fake pane. Touches no device and not the
// running app: a throwaway Electron on :9333 with its own userData, and a recording fake adb.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { runSession, createRecorder, DEFAULT_LIMITS } from '/Users/chetan/Desktop/ConnectSuite/scripts/camera-driver-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH = join(HERE, '..');
const ELECTRON = '/Users/chetan/Desktop/ConnectSuite/desktop/node_modules/.bin/electron';
const PORT = 9333;
const ADBLOG = join(HERE, 'fake-adb.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV = `document.querySelectorAll('[data-nav]').length`;
const S = `document.querySelector('section[data-screen="camera"]')`;
const Y = 'aaaaaaaa111111112222222233333333';
const results = [];
const only = process.argv.slice(2);

async function startPage(scenario) {
  const p = spawn(ELECTRON, [join(HERE, 'main.js'), `--remote-debugging-port=${PORT}`, `--scenario=${scenario}`], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const t = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (t.some((x) => x.type === 'page' && x.url.includes('/renderer/index.html'))) break; } catch {}
    await sleep(250);
  }
  await sleep(300);
  return p;
}
function stopPage(p) { return new Promise((r) => { p.once('exit', r); p.kill('SIGTERM'); setTimeout(r, 3000); }); }
function startActor(tag) {
  const report = join(HERE, `actor-${tag}.json`);
  if (existsSync(report)) rmSync(report);
  const a = spawn('node', [join(SCRATCH, 'actor.mjs'), 'smoke', report, '1'], {
    env: { ...process.env, ACTOR_PORT: String(PORT), CONNECTSUITE_ADB: join(HERE, 'fake-adb.sh'), FAKE_ADB_LOG: ADBLOG },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  a.stdout.on('data', (d) => { out += d; });
  a.stderr.on('data', (d) => { out += d; });
  const done = new Promise((r) => a.once('exit', (code) => r(code)));
  return { a, done, out: () => out, report };
}
const pageRead = (probe, expr) => probe.read({ question: 'fake pane', control: NAV, read: expr }).then((r) => r.value);

function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + JSON.stringify(detail) : ''}`); }

// ---- actor alone, every scenario ------------------------------------------------------------------
const EXPECT = {
  normal: { switch: 1, stop: 1 }, stale: { switch: 1, stop: 1 }, endedEarly: { switch: 0, stop: 0 },
  replaced: { switch: 1, stop: 0 }, pendingExpire: { switch: 0, stop: 0 }, startLive: { switch: 0, stop: 0 },
  startRequesting: { switch: 0, stop: 0 }, pendingForever: { switch: 0, stop: 0 },
};
for (const scenario of Object.keys(EXPECT)) {
  if (only.length && !only.includes(scenario)) continue;
  const page = await startPage(scenario);
  const probe = await openProbe({ port: PORT });
  const actor = startActor(scenario);
  await sleep(1500);
  await pageRead(probe, `window.__go()`);
  const code = await Promise.race([actor.done, sleep(100_000).then(() => 'timeout')]);
  const log = await pageRead(probe, `window.__log`);
  probe.close();
  await stopPage(page);
  const clicks = log.filter((e) => e.what.startsWith('CLICK'));
  const live = log.find((e) => e.what === 'state:live' && e.streamId === Y);
  const sw = clicks.filter((c) => c.what === 'CLICK switch');
  const st = clicks.filter((c) => c.what === 'CLICK stop');
  const other = clicks.filter((c) => !['CLICK switch', 'CLICK stop'].includes(c.what));
  const e = EXPECT[scenario];
  const rep = existsSync(actor.report) ? JSON.parse(readFileSync(actor.report, 'utf8')) : null;
  check(`${scenario}: switch clicks = ${e.switch}`, sw.length === e.switch, { got: sw.length });
  check(`${scenario}: stop clicks = ${e.stop}`, st.length === e.stop, { got: st.length });
  check(`${scenario}: no request/cancel/other click`, other.length === 0, { other: other.map((c) => c.what) });
  if (sw.length) check(`${scenario}: switch on stream Y while live, at live+5 s ±1 s`, sw.every((c) => c.streamId === Y && c.kind === 'live') && Math.abs(sw[0].at - live.at - 5000) <= 1000, { dtMs: sw[0].at - live.at });
  if (st.length) check(`${scenario}: stop on stream Y while live, at live+15 s ±1 s`, st.every((c) => c.streamId === Y && c.kind === 'live') && Math.abs(st[0].at - live.at - 15000) <= 1000, { dtMs: st[0].at - live.at });
  if (rep && rep.streamId) check(`${scenario}: actor bound to this attempt's id`, rep.streamId === Y, { bound: rep.streamId });
  console.log(`      actor exit ${code}; last lines: ${actor.out().trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`);
}

// ---- the actor beside the real driver core: the cap is independent ---------------------------------
const PANE_SRC = (() => {
  const src = readFileSync('/Users/chetan/Desktop/ConnectSuite/scripts/camera-driver.mjs', 'utf8');
  const i = src.indexOf('const PANE = `'); const j = src.indexOf('`;', i);
  return src.slice(i + 'const PANE = `'.length, j).replaceAll('${S}', S).replaceAll('\\\\s', '\\s');
})();
for (const scenario of ['capNormal', 'capActorFrozen']) {
  if (only.length && !only.includes(scenario)) continue;
  const page = await startPage(scenario);
  const probe = await openProbe({ port: PORT });
  const actor = startActor(scenario);
  await sleep(1500);
  let frozen = false;
  if (scenario === 'capActorFrozen') {
    (async () => { for (;;) { if (/LIVE seen/.test(actor.out())) { actor.a.kill('SIGSTOP'); frozen = true; return; } await sleep(20); } })();
  }
  const recorder = createRecorder({ print: () => {} });
  const read = (e) => pageRead(probe, e);
  const report = await runSession({
    now: Date.now, setTimeout, clearTimeout, sleep, recorder,
    readPane: () => read(PANE_SRC),
    pressRequest: async () => (await probe.act({ what: 'request', run: `(function(){ var b = ${S}.querySelectorAll('button.camera-request'); if (b.length !== 1) return 'refused'; b[0].click(); return 'clicked'; })()`, expect: `${S}.querySelectorAll('button.camera-request').length === 0`, within: 5000 })).landed,
    pressStop: async (trigger) => {
      const c = await read(`(function(){ var s = ${S}; var b = s.querySelectorAll('button.camera-stop'); var c = s.querySelectorAll('button.camera-cancel'); var x = b.length === 1 ? b[0] : c.length === 1 ? c[0] : null; if (!x) return { at: null }; var at = Date.now(); x.click(); return { at: at, label: x.textContent }; })()`);
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
  const code = await Promise.race([actor.done, sleep(30_000).then(() => 'timeout')]);
  const log = await read(`window.__log`);
  probe.close();
  await stopPage(page);
  const st = log.filter((c) => c.what === 'CLICK stop');
  const live = log.find((e) => e.what === 'state:live' && e.streamId === Y);
  const anchorToStop = st.length ? st[0].at - report.anchor : null;
  if (scenario === 'capNormal') {
    check('capNormal: driver outcome ended-by-stimulus, no fallback stop', report.outcome === 'ended-by-stimulus' && report.actions.fallbackStops.length === 0, { outcome: report.outcome, fallback: report.actions.fallbackStops });
    check('capNormal: one Stop, by the actor at live+15 s; within the 20 s cap', st.length === 1 && Math.abs(st[0].at - live.at - 15000) <= 1000 && report.capture.withinLimit, { dtFromLive: st[0] && st[0].at - live.at, anchorToStop });
    check('capNormal: one request (pressed by the driver), none by the actor', log.filter((c) => c.what === 'CLICK request').length === 1 && report.requestsPressed === 1);
  } else {
    check('capActorFrozen: actor was frozen after LIVE', frozen);
    check('capActorFrozen: the driver deadline stopped capture by itself', report.outcome === 'no-reading:deadline' && report.actions.fallbackStops[0]?.trigger === 'deadline', { outcome: report.outcome, fallback: report.actions.fallbackStops });
    check('capActorFrozen: one Stop, at ~anchor+19.5 s, inside 20 s', st.length === 1 && anchorToStop >= 19000 && anchorToStop <= 20000, { anchorToStop });
    check('capActorFrozen: the resumed actor took no action on the ended stream', st.length === 1 && log.filter((c) => c.what === 'CLICK switch').length === 0 && /STOP NOT PRESSED/.test(actor.out()), { tail: actor.out().trim().split('\n').slice(-3) });
  }
  console.log(`      actor exit ${code}`);
}

const adb = existsSync(ADBLOG) ? readFileSync(ADBLOG, 'utf8').trim().split('\n') : [];
const writes = adb.filter((l) => /\b(install|input|am |pm |settings|keyevent|push|rm )/.test(l));
check('fake adb: the actor issued reads only', writes.length === 0, { calls: adb.length, distinct: [...new Set(adb.map((l) => l.replace(/^-s \S+ /, '').slice(0, 60)))], writes });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
