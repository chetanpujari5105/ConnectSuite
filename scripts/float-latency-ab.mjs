/**
 * Does opening the float window degrade the **main** pane's latency?
 *
 * `docs/mirror-diagnosis-2026-09-09.md` lists four mirror symptoms. §1 is the float hanging on
 * start and §4 is latency drift. Whether they are one bug or two decides the shape of the fix, and
 * the reading that decides it can only be taken **before** the start contract is written — once the
 * float's start path changes, the state it is in today is gone.
 *
 * ### The two states, and what each means
 *
 * - **State A — unchanged.** The float is an independent consumer; its start problem is its own, and
 *   §4 is a separate bug in the main pipeline. Two fixes.
 * - **State B — degrades.** The two windows contend for one stream, and §1 and §4 are one bug: the
 *   float's arrival is what moves the main pane's numbers. One fix, and it is in the sharing.
 *
 * ### Pre-registered decision rule, written before the run
 *
 * | reading | verdict |
 * |---|---|
 * | B's median total latency **≥ 1.5×** A's, **or** fps down **≥ 30%** | **state B** — degrades |
 * | both within **±15%** of A | **state A** — unchanged |
 * | anything between | **inconclusive** — a longer run, not a nudged threshold |
 *
 * The middle row exists so the result cannot be rounded into whichever answer is convenient. A
 * threshold chosen after seeing the numbers is not a threshold.
 *
 * ### The control, and why a low frame rate is the danger here
 *
 * Latency is measured per decoded frame. A static phone screen encodes at 1-2 fps, so a window can
 * pass with a handful of samples and a median that is one outlier. Both phases therefore report
 * **how many non-null latency samples they hold** and **how far `framesDecoded` advanced**, and the
 * run refuses rather than reporting a verdict when either phase is too thin. A median over three
 * samples is not a measurement of latency, it is a measurement of three frames.
 *
 * Usage: node scripts/float-latency-ab.mjs [secondsPerPhase]      default 25
 */
import { openProbe, format } from './probe.mjs';

const SECONDS = Number(process.argv[2] ?? 25);
const MIN_LATENCY_SAMPLES = 8;

const probe = await openProbe({ port: 9222 });
const STAGE = `section[data-screen="mirror"] .mirror-stage`;

const routed = await probe.act({
  what: 'route the Mac to the Mirror pane',
  run: `document.querySelector('[data-nav="mirror"]').click()`,
  expect: `__probe.one('${STAGE}').getBoundingClientRect().height > 0`,
  within: 5000,
});
if (!routed.landed) { console.error('NOT A READING: could not reach the Mirror pane.'); probe.close(); process.exit(3); }

const SAMPLE = `(function () {
  var s = mirror.stats();
  return {
    frames: s.framesDecoded, fps: s.fps,
    total: s.latencyMs, link: s.latencyLinkMs, decode: s.latencyDecodeMs, peak: s.latencyPeakMs
  };
})()`;

const FLOAT_OPEN = `(function () {
  var l = document.getElementById('mirror-float-label');
  var d = document.getElementById('mirror-float-dot');
  return { label: l ? l.textContent.trim() : null, dotHidden: d ? d.classList.contains('hidden') : null };
})()`;

async function phase(name, seconds) {
  const samples = [];
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    const r = await probe.read({ question: `${name} sample`, control: `mirror.stats().framesDecoded`, read: SAMPLE });
    samples.push(r.value);
    await new Promise((res) => setTimeout(res, 1000));
  }
  const withLatency = samples.filter((s) => typeof s.total === 'number');
  const med = (xs) => {
    if (xs.length === 0) return null;
    const a = [...xs].sort((p, q) => p - q);
    return a.length % 2 ? a[(a.length - 1) / 2] : Math.round((a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  };
  const fpsSamples = samples.map((s) => s.fps).filter((f) => typeof f === 'number');
  return {
    name,
    samples: samples.length,
    latencySamples: withLatency.length,
    framesAdvancedBy: samples.length ? samples[samples.length - 1].frames - samples[0].frames : 0,
    medianTotalMs: med(withLatency.map((s) => s.total)),
    medianLinkMs: med(withLatency.map((s) => s.link)),
    medianDecodeMs: med(withLatency.map((s) => s.decode)),
    medianFps: med(fpsSamples),
    peakMs: withLatency.length ? Math.max(...withLatency.map((s) => s.peak ?? 0)) : null,
  };
}

const floatBefore = await probe.read({ question: 'is the float open before phase A?', control: `mirror.stats().framesDecoded`, read: FLOAT_OPEN });
console.log(format(floatBefore));
if (floatBefore.value.label !== 'Floating window') {
  console.error(`\nNOT A READING: the float appears to be open already (label ${JSON.stringify(floatBefore.value.label)}). Phase A must be taken with it closed.`);
  probe.close(); process.exit(3);
}

console.log(`\n--- phase A: float CLOSED, ${SECONDS}s ---`);
const A = await phase('A (float closed)', SECONDS);
console.log(JSON.stringify(A, null, 2));

const opened = await probe.act({
  what: 'open the floating window',
  run: `document.getElementById('mirror-float').click()`,
  // The effect is a second BrowserWindow, which this page cannot see — but the button's own two
  // states are driven from `main/float.ts:openFloat`, so the label flipping IS the confirmation
  // that the main process opened it, not merely that a click happened.
  expect: `document.getElementById('mirror-float-label').textContent.trim() === 'Show floating window'`,
  within: 8000,
});
console.log(`\nfloat open: ${opened.landed ? 'confirmed by the label flip' : 'NOT CONFIRMED'} (${opened.waitedMs} ms)`);
if (!opened.landed) {
  console.error('NOT A READING: the float did not open, so phase B would measure the same state as phase A.');
  probe.close(); process.exit(3);
}

console.log(`\n--- phase B: float OPEN, ${SECONDS}s ---`);
const B = await phase('B (float open)', SECONDS);
console.log(JSON.stringify(B, null, 2));

// --- the verdict, against the rule written above ------------------------------------------------
const thin = A.latencySamples < MIN_LATENCY_SAMPLES || B.latencySamples < MIN_LATENCY_SAMPLES;
const stalled = A.framesAdvancedBy === 0 || B.framesAdvancedBy === 0;

/*
 * **The comparability guard, and the run that produced it.**
 *
 * A first run came back `STATE B — degrades`: median latency 5 ms → 8 ms, a ratio of 1.6 against a
 * pre-registered threshold of 1.5. It was not a reading. Phase A decoded **102** frames at 2 fps and
 * phase B decoded **532** at 18 fps — five times the work — and a latency that rises with throughput
 * is what more frames in flight looks like **with or without contention**. The comparison could not
 * separate the hypothesis from the load.
 *
 * This is the units rule one level up: that rule says two numbers must be *of the same thing* before
 * a ratio means anything; this says the two *conditions* must be alike in every way but the one
 * under test. A/B is a claim that only one variable moved, and nothing in an A/B checks it.
 *
 * So the phases must have carried comparable work. ±40% is loose on purpose — the motion source is a
 * human-scale scroll and will never be exact — and anything outside it is reported as a confounded
 * run rather than as a verdict.
 */
const loadRatio = A.framesAdvancedBy === 0 ? Infinity : B.framesAdvancedBy / A.framesAdvancedBy;
const confounded = !stalled && (loadRatio > 1.4 || loadRatio < 1 / 1.4);

let verdict;
if (stalled) verdict = 'NO READING — frames did not advance in one of the phases';
else if (confounded) {
  verdict =
    `NO READING — the phases were not comparable: B decoded ${B.framesAdvancedBy} frames against ` +
    `A's ${A.framesAdvancedBy} (${loadRatio.toFixed(2)}x). Latency that moves with throughput says ` +
    'nothing about contention. Steady the motion source and re-run.';
}
else if (thin) verdict = `NO READING — fewer than ${MIN_LATENCY_SAMPLES} latency samples in a phase (A ${A.latencySamples}, B ${B.latencySamples})`;
else {
  const latRatio = B.medianTotalMs / A.medianTotalMs;
  // `fps` is null whenever no frame has painted inside the rolling window, which on a static phone
  // screen is most samples. A null is **not a zero** and must not enter the ratio: NaN comparisons
  // are all false, so a missing fps would silently push every run into INCONCLUSIVE and look like a
  // real between-bands result. When fps is unavailable the verdict rests on latency alone and says so.
  const fpsUsable = typeof A.medianFps === 'number' && typeof B.medianFps === 'number' && A.medianFps > 0;
  const fpsRatio = fpsUsable ? B.medianFps / A.medianFps : null;
  const note = fpsUsable ? '' : ' (fps unavailable on a static screen — verdict on latency alone)';
  if (latRatio >= 1.5 || (fpsUsable && fpsRatio <= 0.7)) verdict = 'STATE B — degrades. Symptoms 1 and 4 are one bug.' + note;
  else if (latRatio <= 1.15 && (!fpsUsable || fpsRatio >= 0.85)) verdict = 'STATE A — unchanged. The float is an independent consumer; §1 and §4 are separate.' + note;
  else verdict = 'INCONCLUSIVE — between the pre-registered bands. Re-run longer; do not move the threshold.' + note;
}

console.log('\n======================================================================');
console.log(verdict);
console.log(`  median total latency   A ${A.medianTotalMs} ms  →  B ${B.medianTotalMs} ms`);
console.log(`  median fps             A ${A.medianFps}       →  B ${B.medianFps}`);
console.log(`  latency samples        A ${A.latencySamples}/${A.samples}  B ${B.latencySamples}/${B.samples}`);
console.log(`  frames advanced        A ${A.framesAdvancedBy}       B ${B.framesAdvancedBy}   (load ratio ${loadRatio.toFixed(2)}x — must be within 1.4x either way)`);

/*
 * Leave the app as it was found — and **the button does not do this**.
 *
 * Its two states are "Floating window" and "Show floating window": the second *focuses* the window,
 * it does not toggle it shut. Clicking it as cleanup left the float open across two runs, and the
 * second run then refused its own phase A for a float that was already open — which is the guard
 * working, over a mess this script made. Closing the float's own CDP target is what actually closes
 * it, and the main window's label flipping back is the confirmation.
 */
const floatTarget = (await (await fetch('http://localhost:9222/json')).json())
  .find((t) => t.type === 'page' && (t.url ?? '').includes('/renderer/float.'));
if (floatTarget) {
  await fetch(`http://localhost:9222/json/close/${floatTarget.id}`);
  await new Promise((r) => setTimeout(r, 1500));
}
const closedLabel = await probe.read({
  question: 'is the float closed again?',
  control: `mirror.stats().framesDecoded`,
  read: `document.getElementById('mirror-float-label').textContent.trim()`,
});
console.log(`cleanup: float label is now ${JSON.stringify(closedLabel.value)}` +
  (closedLabel.value === 'Floating window' ? '' : ' — STILL OPEN, close it by hand before the next run'));

console.log('\n' + JSON.stringify({ A, B, verdict, secondsPerPhase: SECONDS }, null, 2));
probe.close();
process.exit(0);
