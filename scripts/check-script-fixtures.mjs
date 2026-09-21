#!/usr/bin/env node
/**
 * Run every fixture suite under `scripts/`, and refuse a commit that leaves one red.
 *
 * ### The gap this closes
 *
 * `check-suites-run.mjs` guards two suites — Gradle's XML and `desktop/.test-run.json` — and says
 * `NOT CHECKED` about the half it cannot see, which is the right shape. There is a **third** suite
 * it has never named: the fixture files beside the guards themselves, `scripts/*.test.mjs` and
 * `scripts/*.test.sh`. Nineteen files, about two seconds, run by nothing.
 *
 * So one went red on this branch and stayed red. `check-renderer-scripts.test.mjs` asserts that the
 * page loads `discHue.js` and that the scan sees it; `discHue.ts` was deleted with its last caller
 * — correctly, the Sidekick system has no per-person hue — and the control that named it rotted.
 * The guard it belongs to went on passing, because its scope comes from `index.html` and a file no
 * longer listed there is simply not in scope. **A guard passing is not its fixtures passing**, and
 * this repo already has that sentence one layer up: a suite that is not run is invisible in a green.
 *
 * A second was red for a different reason, which is why this is a suite check and not one fix.
 * `adb-count.test.sh` exports `CONNECTSUITE_ADB` to point at a fake, and `adb-pinned.sh` execed a
 * literal `adb` — so the pin was fakeable and the command was not, and the two "must READ" fixtures
 * could only pass with an SM-S938B on the cable. Its FAIL branch then died under `set -u` before
 * printing the diagnosis, so the first failure it ever reported was a crash.
 *
 * ### What it reports, and what it refuses
 *
 * It prints the number discovered beside the number run, because a count with no denominator is not
 * evidence, and it **refuses outright** when discovery comes back empty or below a floor: "all
 * fixtures pass" against nothing found is a green over an app nobody looked at, which is the
 * failure this whole directory of guards is about.
 *
 * ### Why `--list` exists, and it is not convenience
 *
 * This file's own suite is one of the nineteen, and its last test asserts the floor sits below the
 * real count — which means spawning the guard against the real tree, from inside a suite the guard
 * runs. That recursed until it was killed. The answer is not to exempt this file from discovery:
 * the one suite the guard refuses to run is the one guarding the guard, which is the gap it was
 * written to close, one level in. So discovery is separable from running, the test asks for the
 * count alone, and every suite including this one stays in scope.
 *
 *   node scripts/check-script-fixtures.mjs            # the real tree
 *   node scripts/check-script-fixtures.mjs --list     # discover and count, run nothing
 *   SCRIPT_FIXTURE_ROOT=/tmp/x node ...               # a fixture tree, for its own test
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const ROOT = process.env.SCRIPT_FIXTURE_ROOT ?? HERE;

/**
 * The floor is a control, not a preference. It is below today's count so adding or removing one
 * suite does not wake it, and far enough above zero that a discovery which silently found nothing
 * — a moved directory, a bad glob, a wrong `ROOT` — cannot read as a pass.
 */
const FLOOR = Number(process.env.SCRIPT_FIXTURE_FLOOR ?? 12);

const isSuite = (name) => /\.test\.(mjs|sh)$/.test(name);

function discover(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      found.push(...discover(full));
    } else if (entry.isFile() && isSuite(entry.name)) {
      found.push(full);
    }
  }
  return found.sort();
}

if (!existsSync(ROOT)) {
  console.log(`check-script-fixtures: REFUSED — ${ROOT} does not exist, so nothing was discovered`);
  process.exit(1);
}

const suites = discover(ROOT);

if (suites.length < FLOOR) {
  console.log(
    `check-script-fixtures: REFUSED — found ${suites.length} fixture suites under ${relative(REPO, ROOT) || ROOT}, ` +
      `below the floor of ${FLOOR}.`,
  );
  console.log('  An empty or near-empty discovery is an instrument failure, not a pass: "all');
  console.log('  fixtures green" over nothing found is the reading this directory exists to prevent.');
  process.exit(1);
}

if (process.argv.includes('--list')) {
  console.log(`check-script-fixtures: ${suites.length} fixture suites discovered (floor ${FLOOR}), none run`);
  for (const suite of suites) console.log(`  ${relative(REPO, suite)}`);
  process.exit(0);
}

const failed = [];
for (const suite of suites) {
  const run = suite.endsWith('.mjs')
    ? spawnSync(process.execPath, [suite], { cwd: REPO, encoding: 'utf8' })
    : spawnSync('bash', [suite], { cwd: REPO, encoding: 'utf8' });
  if (run.status !== 0) {
    failed.push({ suite: relative(REPO, suite), status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}` });
  }
}

console.log(
  `check-script-fixtures: ${suites.length - failed.length} of ${suites.length} fixture suites green ` +
    `(floor ${FLOOR})`,
);

for (const f of failed) {
  console.log(`  RED  ${f.suite}  (exit ${f.status})`);
  /*
   * The matched lines, not the count — a guard that says only "1 failed" sends the next person to
   * run it by hand to find out what, which is how a slow guard gets routed around.
   *
   * And it is the *named* lines rather than the tail. A `slice(-12)` of a `node:test` run is the
   * last frames of a stack trace, which says where the assertion library was and nothing about
   * which claim failed. The failing test's own name and its message are what a reader needs.
   */
  const lines = f.out.trim().split('\n');
  const named = lines.filter((l) => /^\s*(✖|FAIL|not ok|AssertionError|Error:|\s+[a-z]+:)/.test(l));
  const shown = named.length ? named : lines;
  for (const line of shown.slice(0, 12)) console.log(`       ${line.trimEnd()}`);
  if (shown.length > 12) console.log(`       … ${shown.length - 12} more; run it directly for the rest`);
}

process.exit(failed.length > 0 ? 1 : 0);
