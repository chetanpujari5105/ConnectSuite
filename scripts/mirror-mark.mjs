/**
 * "That was bad" — from a terminal, for when the global shortcut is taken by another app.
 *
 * The same summary the mark shortcut produces — ⌃⌥⌘M since 2026-09-16, when it moved off ⌘⇧M,
 * which the handoff prints for "Mirror phone" (defect 123). The stages over the seconds before it,
 * with the worst frame and the longest gap between paints called out separately from the median.
 * A median over a window containing one 300 ms stall hides the stall, which is the entire event.
 *
 * Usage: node scripts/mirror-mark.mjs ["what it looked like"] [windowSeconds]
 */
import { openProbe, format } from './probe.mjs';

const label = process.argv[2] ?? 'unlabelled';
const windowMs = Number(process.argv[3] ?? 5) * 1000;

const probe = await openProbe({ port: 9222, window: 'index' });

/*
 * The control is the sample count the view is holding. A mark taken against an empty buffer would
 * summarise nothing and say "clean" — which is the one answer this must never give by accident.
 */
const r = await probe.read({
  question: `mark: ${label}`,
  control: `mirror.stats().latencySamples`,
  read: `JSON.stringify(mirror.markMoment(${JSON.stringify(label)}, ${windowMs}))`,
});

console.log(format(r));
const s = JSON.parse(r.value);
console.log(`\n  ${s.clean ? 'CLEAN' : 'NOT CLEAN'} — ${s.why}`);
console.log(`  samples ${s.samples} over ${windowMs / 1000}s   fps ${s.fps === null ? 'n/a' : s.fps.toFixed(1)}`);
console.log(`  total   median ${s.medianTotalMs} ms   worst ${s.worstTotalMs} ms`);
console.log(`  gap     longest between paints ${s.longestGapMs} ms`);
console.log(`  stages  encode ${s.medianEncodeMs} ms · wire ${s.medianWireMs} ms · mac ${s.medianMacMs} ms`);
if (s.unreliableSplits > 0) {
  // The total is a measured interval and stays sound; only its division into encode and wire is
  // sampled once every 2 s, and a negative wire is that sample overshooting. Said, never clamped.
  console.log(`  NOTE    ${s.unreliableSplits} of ${s.samples} frames had an untrustworthy encode/wire split.`);
  console.log('          Read the TOTAL for this window, not the two halves.');
}

/* Also written to the Mac's own log, so a session's marks are one grep rather than scrollback. */
await probe.act({
  what: 'record the mark in the Mac log',
  run: `connect.markMoment(${JSON.stringify(s)})`,
  expect: `mirror.stats().latencySamples >= 0`,
  within: 3000,
});

probe.close();
process.exit(0);
