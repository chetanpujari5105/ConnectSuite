/**
 * What does watching the Mac's clipboard actually cost?
 *
 * ### Why polling at all
 *
 * `NSPasteboard` has **no change notification**. There is no callback, no KVO, no notification
 * centre event — every clipboard manager on macOS polls, and Electron exposes no `changeCount`
 * either, so the poll has to read. That makes "what does a read cost" the whole design question
 * rather than a footnote, and the answer decides the interval.
 *
 * ### The two costs, measured separately because they behave differently
 *
 * A read is O(size), so the interval is safe or unsafe depending on what somebody has copied. A
 * person who copies a paragraph and a person who copies a 20 MB log file are the same feature and
 * very different loads, and an average over "typical" clipboards would hide the case that matters.
 *
 * ### The side effect that would disqualify polling outright
 *
 * If reading the pasteboard bumped `changeCount`, a watcher would be its own stimulus — every poll
 * would look like a copy, and the feature would send in a loop with nothing wrong with the
 * interlock. Measured here through Swift, which is the only thing that can see `changeCount`.
 *
 * Run: cd desktop && npx electron ../scripts/clip-poll-cost-probe.mjs
 */
import { app, clipboard } from 'electron';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNTER = join(HERE, 'support', 'change-count.swift');

const changeCount = () => Number(execFileSync('swift', [COUNTER], { encoding: 'utf8' }).trim());

/** Median of n runs, because a first call pays for warm-up the steady state never pays again. */
function timeRead(runs) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const t = process.hrtime.bigint();
    clipboard.readText();
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[runs >> 1], worst: samples[runs - 1], first: samples[0] };
}

app.whenReady().then(() => {
  const theirs = clipboard.readText();
  console.log('\nCost of one clipboard.readText(), by clipboard size (200 reads each)\n');
  console.log('  size        median      worst     → per second at 500ms      at 250ms');

  for (const chars of [0, 100, 10_000, 65_536, 1_000_000, 20_000_000]) {
    clipboard.writeText('x'.repeat(chars));
    const { median, worst } = timeRead(200);
    const per500 = (median * 2).toFixed(3);
    const per250 = (median * 4).toFixed(3);
    console.log(
      `  ${String(chars).padStart(10)}  ${median.toFixed(4).padStart(9)}ms ${worst.toFixed(4).padStart(9)}ms` +
        ` → ${per500.padStart(8)}ms/s        ${per250.padStart(8)}ms/s`,
    );
  }

  console.log('\nDoes reading bump changeCount? (a watcher that is its own stimulus is not viable)');
  clipboard.writeText('a stable clip');
  const before = changeCount();
  for (let i = 0; i < 500; i += 1) clipboard.readText();
  const after = changeCount();
  console.log(`  changeCount before 500 reads: ${before}`);
  console.log(`  changeCount after  500 reads: ${after}   → ${after === before ? 'unchanged — reads are not writes' : 'CHANGED — polling is self-triggering'}`);

  // The control: a real write must move it, or the counter proves nothing about the reads.
  clipboard.writeText('a different clip');
  const moved = changeCount();
  console.log(`  changeCount after one write:  ${moved}   → ${moved > after ? 'moved, so the counter was live throughout' : 'DID NOT MOVE — the counter is not measuring anything'}`);

  clipboard.writeText(theirs);
  console.log(`\nClipboard restored: ${clipboard.readText() === theirs ? 'yes' : 'NO — RESTORE FAILED'}\n`);
  app.exit(0);
});
