#!/usr/bin/env node
/**
 * How long the Files pane takes to show a folder, split where the split can be honestly taken.
 *
 *   node scripts/files-load-profile.mjs [--runs=3] [--root=<rootId>] [--path=<path>]
 *
 * Written for the 2026-10-10 batch (section 1a). Three scenarios, each run `--runs` times:
 *
 *   return   — route away to Overview and back to Files: what a person sees on every visit.
 *   root     — click a different root in the rail.
 *   folder   — open `--path` inside `--root` (default DCIM/Camera, the phone's biggest folder).
 *   deep     — (`--deep`) open that folder, wait 35 s so the phone's 30 s snapshot has expired,
 *              route away and back: what a person sees returning to a big folder later. Reports
 *              whether the folder on screen after the return is still the one they left.
 *
 * For each it reports, from the moment of the action, in renderer time (`performance.now()`):
 *
 *   firstRow   — the first row or tile is in the DOM;
 *   pageDrawn  — the pane's own `loading` flag is false and the rows on screen equal its entries
 *                (the first page — 200 — or the whole folder if smaller);
 *   thumbsSeen — every tile *on screen* (in the scroller's visible rect) that may have a picture has
 *                a decoded <img>, or the deadline passed (said as `thumbs: deadline`);
 *   renders    — how many times the table was emptied and rebuilt (`replaceChildren` on
 *                #files-table, counted by a MutationObserver: a removal of every child);
 *
 * and, from the main process's own log, the phone + wire round trip of each `fs.list` it issued
 * (the log line carries `NN ms`, measured in main around the request). Mac rendering time is the
 * renderer's `pageDrawn` minus that round trip — **a difference of two clocks on one machine**, so
 * it is reported as an estimate, never as a measurement.
 *
 * Bounds, in the output: the poll is one rAF (~16 ms at 60 Hz), the thumbnail deadline is 8 s, the
 * page deadline 20 s. A scenario that hits a deadline prints `deadline`, not a number.
 */
import { openProbe } from './probe.mjs';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

const arg = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const runs = Number(arg('runs', '3'));
const bigRoot = arg('root', 'saf:primary%3ADCIM');
const bigPath = arg('path', 'Camera');
const LOG = join(homedir(), 'Library/Application Support/sidekick-desktop-dev/logs/sidekick.log');

const probe = await openProbe({ port: 9222 });
const ev = (src) => probe.rawEvaluate(src);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Installs the in-page recorder and returns once it is armed. The action is run by the caller. */
const ARM = `(() => {
  const table = document.getElementById('files-table');
  const s = { t0: performance.now(), firstRow: null, pageDrawn: null, thumbsSeen: null, renders: 0, done: false };
  if (window.__fpObs) window.__fpObs.disconnect();
  window.__fpObs = new MutationObserver((records) => {
    for (const r of records) if (r.target === table && r.removedNodes.length > 0 && table.childElementCount <= r.addedNodes.length) s.renders += 1;
  });
  window.__fpObs.observe(table, { childList: true });
  const visibleTiles = () => {
    const box = table.getBoundingClientRect();
    return [...table.querySelectorAll('.files-tile, .files-row')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > box.top && r.top < box.bottom;
    });
  };
  const tick = () => {
    const t = performance.now() - s.t0;
    const rows = table.querySelectorAll('.files-tile, .files-row').length;
    if (rows > 0 && s.firstRow === null) s.firstRow = t;
    if (s.firstRow !== null && s.pageDrawn === null && !files.loading && rows === files.entries.length && files.entries.length > 0) s.pageDrawn = t;
    if (s.pageDrawn !== null && s.thumbsSeen === null) {
      // Visible tiles whose entry may have a picture (image/video), matched by the tile's title.
      const byName = new Map(files.entries.map((e) => [e.name, e]));
      const want = visibleTiles().filter((el) => { const e = byName.get(el.title); return e && !e.dir && (e.mime.startsWith('image/') || e.mime.startsWith('video/')); });
      const decoded = want.filter((el) => { const i = el.querySelector('img'); return i && i.complete && i.naturalWidth > 0; }).length;
      s.visible = want.length; s.visibleDecoded = decoded;
      if (decoded === want.length) s.thumbsSeen = t;
    }
    if (t > 20000 || (s.pageDrawn !== null && s.thumbsSeen !== null)) { s.done = true; }
    else if (s.pageDrawn !== null && t - s.pageDrawn > 8000) { s.thumbsSeen = 'deadline'; s.done = true; }
    if (s.done) { clearInterval(s.timer); s.obs.disconnect(); }
  };
  window.__fp = s;
  // Mutation-driven, not rAF: rAF stops while the window is occluded, and the first run of this
  // instrument recorded nothing at all for that reason. A table change runs the tick at once;
  // the 20 ms interval covers image decodes, which are not mutations (throttled when hidden —
  // the visibility state is reported beside the numbers).
  s.obs = new MutationObserver(tick);
  s.obs.observe(table, { childList: true, subtree: true });
  s.timer = setInterval(tick, 20);
  s.visibility = document.visibilityState;
  return true;
})()`;

const logSize = () => readFileSync(LOG, 'utf8').length;
const roundTrips = (from) =>
  readFileSync(LOG, 'utf8').slice(from).split('\n')
    .map((l) => l.match(/fs\.list (\S+) → (\d+) entries, hasMore=(\w+), (\d+) ms/))
    .filter(Boolean).map((m) => ({ where: m[1], entries: Number(m[2]), ms: Number(m[4]) }));

async function scenario(name, prepare, act) {
  const out = [];
  for (let i = 0; i < runs; i++) {
    await prepare();
    await sleep(600);
    const mark = logSize();
    await ev(ARM);
    await ev(act);
    let s;
    for (let w = 0; w < 120; w++) {
      await sleep(250);
      s = await ev('(() => { const { timer, obs, ...p } = window.__fp; return p; })()');
      if (s.done) break;
    }
    await sleep(150);
    const rt = roundTrips(mark);
    const { timer, obs, ...plain } = s;
    const where = await ev(`(() => ({ root: files.selectedRoot, path: files.path }))()`);
    out.push({ ...plain, fsList: rt, where });
  }
  return { name, runs: out };
}

const control = await ev(`typeof files === 'object' && files !== null && Array.isArray(files.entries) && !!document.getElementById('files-table')`);
if (!control) {
  console.error('files-load-profile REFUSED: the Files view is not reachable as `files` in the page — no reading.');
  exit(1);
}
const before = await ev(`({ screen: shell.screen, root: files.selectedRoot, path: files.path, mode: files.viewMode })`);

const results = [];
try {
  results.push(await scenario('return',
    () => ev(`(() => { shell.route('files'); return true; })()`).then(() => sleep(1500)).then(() => ev(`(() => { shell.route('overview'); return true; })()`)),
    `(() => { shell.route('files'); return true; })()`));
  results.push(await scenario('root',
    () => ev(`(() => { shell.route('files'); files.selectedRoot = 'downloads:connectsuite'; void files.openPath(''); return true; })()`).then(() => sleep(2500)),
    `(() => { files.selectedRoot = ${JSON.stringify(bigRoot)}; void files.openPath(''); return true; })()`));
  results.push(await scenario('folder',
    () => ev(`(() => { files.selectedRoot = ${JSON.stringify(bigRoot)}; void files.openPath(''); return true; })()`).then(() => sleep(2500)),
    `(() => { void files.openPath(${JSON.stringify(bigPath)}); return true; })()`));
  if (argv.includes('--deep')) {
    results.push(await scenario('deep',
      () => ev(`(() => { shell.route('files'); files.selectedRoot = ${JSON.stringify(bigRoot)}; void files.openPath(${JSON.stringify(bigPath)}); return true; })()`)
        .then(() => sleep(35_000)).then(() => ev(`(() => { shell.route('overview'); return true; })()`)),
      `(() => { shell.route('files'); return true; })()`));
  }
} finally {
  if (before.screen !== 'files') await ev(`(() => { shell.route(${JSON.stringify(before.screen)}); return true; })()`);
}

const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? `${Math.round(v)} ms` : v);
for (const r of results) {
  console.log(`\n${r.name}`);
  for (const s of r.runs) {
    const listMs = s.fsList.reduce((a, b) => a + b.ms, 0);
    const est = typeof s.pageDrawn === 'number' ? Math.round(s.pageDrawn - listMs) : null;
    console.log(`  [${s.visibility}] firstRow=${fmt(s.firstRow)} pageDrawn=${fmt(s.pageDrawn)} thumbsSeen=${fmt(s.thumbsSeen)} renders=${s.renders} ` +
      `thumbs=${s.visibleDecoded ?? '—'}/${s.visible ?? '—'} visible | fs.list: ${s.fsList.map((x) => `${x.entries}e ${x.ms}ms`).join(', ') || 'none'} ` +
      `| Mac side ≈ ${est === null ? '—' : est + ' ms'} (estimate) | after: ${s.where.root}/${s.where.path}`);
  }
}
console.log(`\nbounds: rAF poll, page deadline 20 s, thumbnail deadline 8 s after the page; restored screen=${before.screen}`);
exit(0);
