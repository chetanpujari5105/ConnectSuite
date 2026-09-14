/**
 * Where a frame's latency is actually spent, with every median beside its denominator.
 *
 * ### Why this could not be run before today
 *
 * `mirror.stats` carries `ptsUs` (stamped at capture, by the display pipeline) and `monoUs`
 * (`System.nanoTime()` at `dequeueOutputBuffer`, **after** encoding). The Mac anchored *capture*
 * time to `monoUs`, so every total it published was short by the anchor frame's encode duration —
 * constantly, and with nothing on screen saying so. Figures of 9, 11, 99 and 134 ms were all quoted
 * against that origin.
 *
 * The two timestamps were always both on the wire. They were being read as one anchor pair instead
 * of as two stage boundaries, so the repair needed **no protocol change** — see
 * `renderer/latencyStages.ts`.
 *
 * ### The one thing that has to be measured, not assumed
 *
 * All of the above holds only if PTS shares a timebase with `System.nanoTime()`. `monoUs - ptsUs` is
 * an encode duration if it does and roughly the phone's uptime if it does not — six orders of
 * magnitude apart. This prints the verdict first, and every number below it is conditional on it.
 *
 * Usage: node scripts/latency-stages-read.mjs [seconds]      default 30
 */
import { openProbe, format } from './probe.mjs';

const SECONDS = Number(process.argv[2] ?? 30);
const probe = await openProbe({ port: 9222, window: 'index' });

const routed = await probe.act({
  what: 'route the Mac to the Mirror pane',
  run: `document.querySelector('[data-nav="mirror"]').click()`,
  expect: `__probe.one('section[data-screen="mirror"] .mirror-stage').getBoundingClientRect().height > 0`,
  within: 5000,
});
if (!routed.landed) { console.error('NOT A READING: could not reach the Mirror pane.'); probe.close(); process.exit(3); }

/* The verdict, and the raw pair it rests on, so a reader can redo the arithmetic. */
const anchor = await probe.read({
  question: 'Is the phone’s PTS on the same clock as System.nanoTime()?',
  control: `mirror.stats().framesDecoded`,
  read: `(function () {
    var t = mirror.telemetry;
    var p = t && t.phone ? t.phone : null;
    return {
      ptsUs: p ? p.ptsUs : null,
      monoUs: p ? p.monoUs : null,
      clockOffsetMs: t ? t.clockOffsetMs : undefined,
      verdict: p ? timebaseVerdict({ ptsUs: p.ptsUs, monoUs: p.monoUs }) : null
    };
  })()`,
  settle: {
    until: (v) => v && v.ptsUs !== null && v.monoUs !== null && v.clockOffsetMs !== undefined,
    within: 20_000,
    poll: 500,
  },
});
console.log(format(anchor));
if (!anchor.reportable) {
  console.error('\nNOT A READING: no anchor pair and clock offset inside the deadline. Is a session running?');
  probe.close(); process.exit(3);
}
const v = anchor.value.verdict;
console.log(`\ntimebase: ${v.verdict.toUpperCase()} — ${v.why}`);
console.log(`  ptsUs=${anchor.value.ptsUs}  monoUs=${anchor.value.monoUs}  ` +
  `monoUs-ptsUs=${v.lagUs} us  clockOffsetMs=${anchor.value.clockOffsetMs}`);
if (v.verdict !== 'shared') {
  console.log('\n  → capture time is NOT knowable on the phone: nothing in the app observes a frame');
  console.log('    before the encoder hands it back. Every figure below is measured from ENCODER');
  console.log('    OUTPUT and is labelled as such. That is the honest report, not a degraded one.');
}

/* Samples over a window, so a median has a denominator. */
console.log(`\n--- sampling for ${SECONDS}s ---`);
const samples = [];
const started = Date.now();
while (Date.now() - started < SECONDS * 1000) {
  const r = await probe.read({
    question: 'stage medians',
    control: `mirror.stats().framesDecoded`,
    read: `(function () { var s = mirror.stats(); return {
      frames: s.framesDecoded, fps: s.fps,
      total: s.latencyMs, link: s.latencyLinkMs, decode: s.latencyDecodeMs,
      encode: s.latencyEncodeMs, origin: s.latencyOrigin, n: s.latencySamples,
      peak: s.latencyPeakMs }; })()`,
  });
  samples.push(r.value);
  await new Promise((res) => setTimeout(res, 1000));
}

const med = (xs) => {
  const a = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q);
  if (a.length === 0) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const framesAdvanced = samples.length ? samples[samples.length - 1].frames - samples[0].frames : 0;
const origins = [...new Set(samples.map((s) => s.origin).filter(Boolean))];

const rows = [
  ['capture → encoded  (encode)', med(samples.map((s) => s.encode))],
  ['encoded → arrived  (wire)', med(samples.map((s) => s.link))],
  ['arrived → painted  (Mac)', med(samples.map((s) => s.decode))],
  ['capture → painted  (total)', med(samples.map((s) => s.total))],
];

console.log('\nstage medians, with the denominators that give them meaning:');
for (const [name, value] of rows) {
  console.log(`  ${name.padEnd(30)} ${value === null ? 'NOT MEASURED' : `${value.toFixed(1)} ms`}`);
}
console.log(`\n  origin of the total       ${origins.join(', ') || 'none'}`);
console.log(`  latency samples in window ${med(samples.map((s) => s.n)) ?? 0} (rolling window inside the app)`);
console.log(`  probe samples             ${samples.length}`);
console.log(`  frames decoded in window  ${framesAdvanced}`);
console.log(`  median fps                ${med(samples.map((s) => s.fps)) ?? 'not measured'}`);
console.log(`  peak total seen           ${med(samples.map((s) => s.peak))?.toFixed(1) ?? 'n/a'} ms`);

if (framesAdvanced === 0) {
  console.error('\nNOT A READING: no frames decoded in the window — the medians are of retained samples.');
  probe.close(); process.exit(3);
}
probe.close();
process.exit(0);
