/**
 * How many scroll gestures a continuous wheel burst actually produces, and how many are thrown away.
 *
 * ### What it measures and where
 *
 * The stimulus is a burst of `wheel` events on the mirror canvas. The **effect** is read from the
 * Mac's own log at the boundary the stimulus crosses — `input.scroll delivered` and the stale-drop
 * refusals in `InputClient` — never from the dispatch, because a probe that reports what it asked for
 * is how 12 MB that never left the machine was once recorded as delivered.
 *
 * ### What this instrument supplies, said plainly
 *
 * The `deltaY` values come from this script, not from a physical trackpad. Everything downstream of
 * `MirrorView.onWheel` is the shipping path; the OS→Chromium conversion is the one step not
 * exercised. That is acceptable here because the quantity under test is a **rate**, and the rate is
 * set by how often events arrive rather than by where they came from. The cadence — one event every
 * 15 ms — is a continuous two-finger scroll, which is what the Mac's real log shows during the bursts
 * that produced the defect.
 *
 * **The magnitude is deliberately large (120 per event) and that is a safety choice, not a
 * measurement one.** A small delta produces a stroke under the phone's touch slop, which Android
 * reads as a tap — defect 111 — and the phone under test has a home screen full of app icons in
 * front of it. A burst of taps on somebody's home screen is the coordinate-clicking accident this
 * repo has a rule about. The sub-slop question is answered from the user's own historical log
 * instead, where it happened without being provoked.
 *
 * ### The bound this instrument imposes, reported rather than hidden
 *
 * It waits for the log to go quiet rather than for a fixed time, and it prints how long that took. A
 * run that hits the ceiling says so and is `reportable: false`, because a burst that was still
 * draining when the reading was taken has proven nothing about how many gestures it produces.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { openProbe, format, formatAct } from './probe.mjs';

const MAC_LOG = join(homedir(), 'Library', 'Application Support', 'connectsuite-desktop', 'logs', 'connectsuite.log');
const EVENTS = Number(process.argv[2] ?? 40);
const SPACING_MS = 15;
const DELTA = 120;

/** Display pixels per capture pixel on the reference handset, and its measured touch slop. */
const SCALE = 3120 / 2340;
const SLOP = 30;

const lines = () => readFileSync(MAC_LOG, 'utf8').split('\n');
const scrolls = (from) => from.filter((l) => l.includes('input.scroll delivered'));
const drops = (from) => from.filter((l) => /That scroll waited \d+ms behind other input/.test(l));

const probe = await openProbe({ port: 9222, window: 'index' });

const before = lines();
const beforeScrolls = scrolls(before).length;
const beforeDrops = drops(before).length;

const startedAt = Date.now();
const burst = await probe.act({
  what: `${EVENTS} wheel events, deltaY=${DELTA}, one every ${SPACING_MS}ms on the mirror canvas`,
  run: `(async () => {
     const c = __probe.one('#mirror-canvas');
     const r = c.getBoundingClientRect();
     for (let i = 0; i < ${EVENTS}; i += 1) {
       c.dispatchEvent(new WheelEvent('wheel', {
         deltaY: ${DELTA}, deltaX: 0, deltaMode: 0, bubbles: true, cancelable: true,
         clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
       }));
       await new Promise((res) => setTimeout(res, ${SPACING_MS}));
     }
     globalThis.__burstDone = ${EVENTS};
     return ${EVENTS};
   })()`,
  expect: `globalThis.__burstDone === ${EVENTS}`,
  within: 15000,
});
console.log('  ' + formatAct(burst));

// Settle on the log going quiet, not on a duration. Reported either way.
let quietFor = 0;
let last = -1;
let stopped = 'deadline';
const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250));
  const n = scrolls(lines()).length;
  quietFor = n === last ? quietFor + 250 : 0;
  last = n;
  if (quietFor >= 1500 && n > beforeScrolls) {
    stopped = 'settled';
    break;
  }
}
const elapsed = Date.now() - startedAt;

const after = lines();
const sent = scrolls(after).slice(beforeScrolls);
const dropped = drops(after).length - beforeDrops;

const parse = (l) => {
  const t = l.slice(0, 29);
  const dy = Number(l.match(/by (-?\d+),(-?\d+)/)?.[2] ?? NaN);
  return { at: Date.parse(t), dy };
};
const rows = sent.map(parse).filter((r) => Number.isFinite(r.at));
const gaps = rows.slice(1).map((r, i) => r.at - rows[i].at).sort((a, b) => a - b);
const subSlop = rows.filter((r) => Math.abs(r.dy) * SCALE < SLOP).length;

console.log(`\n  stimulus      ${EVENTS} wheel events over ${EVENTS * SPACING_MS}ms`);
console.log(`  gestures sent ${rows.length}`);
console.log(`  stale-dropped ${dropped}   ← InputClient discards anything that waited > 400ms`);
console.log(`  sub-slop      ${subSlop} of ${rows.length}  (a stroke under ${SLOP} display px is a tap)`);
console.log(`  send gaps     median ${gaps.length ? gaps[Math.floor(gaps.length / 2)] : 'n/a'}ms  min ${gaps[0] ?? 'n/a'}  max ${gaps[gaps.length - 1] ?? 'n/a'}`);
console.log(`  wall clock    ${elapsed}ms to quiescence, stopped=${stopped}`);
console.log(`  reportable    ${stopped === 'settled' && burst.landed}` +
  (stopped === 'settled' ? '' : '   ← NOT a reading: the burst was still draining when the instrument gave up'));

probe.close();
