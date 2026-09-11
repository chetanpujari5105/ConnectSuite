/**
 * `npm test`, with a record of the run left behind.
 *
 * ### Why this wrapper exists
 *
 * `ProtocolNamespaceTest` was committed **red** and survived because the commit that broke it ran
 * `npm test` in `desktop/` and not the phone's suite. Nothing in the repo could have noticed: the
 * Mac half was green, the phone half was never asked, and a suite nobody runs is invisible in
 * exactly the way `CLAUDE.md`'s defect-65 entry says a module with no tests is invisible in a total.
 *
 * `scripts/check-suites-run.mjs` is what notices now, and it needs both halves to leave evidence.
 * Gradle already writes an XML file per class under each module's build directory; `node --test` writes nothing at all. This
 * is the Mac half's artifact.
 *
 * ### It records failures, which is the entire point
 *
 * The obvious shape — `"test": "node --test … && node record.mjs"` — records only on success, so a
 * red run leaves the **previous green record** in place and the checker reads a memory. That is the
 * stale-XML row in `CLAUDE.md` rebuilt on purpose. So this wrapper runs the suite, writes the record
 * **whatever happens**, and exits with the suite's own code.
 *
 * Counts come from a TAP reporter written to a file rather than from scraping the human output, and
 * the exit code is carried separately: if the two ever disagree, the exit code wins and the record
 * says so.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
/**
 * The globs stay in `package.json`'s `test` script and arrive here as argv, rather than living in
 * this file. `scripts/check-orphan-tests.mjs` reads them out of that script to find test files no
 * runner can discover, and moving them in here made **all 53** of the Mac's test files read as
 * orphans on the first run of this wrapper. The guard was right: the discovery rule has one home,
 * and it is the one the guard reads.
 */
const patterns = process.argv.slice(2);
if (patterns.length === 0) {
  console.error('run-tests: no test patterns given. They live in package.json\'s "test" script.');
  process.exit(2);
}

const tapPath = resolve(desktop, '.test-run.tap');
const recordPath = resolve(desktop, '.test-run.json');

rmSync(tapPath, { force: true });

const child = spawn(
  process.execPath,
  [
    '--import', 'tsx',
    '--test',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=tap', `--test-reporter-destination=${tapPath}`,
    ...patterns,
  ],
  { cwd: desktop, stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  const exitCode = code ?? 1;
  let counts = null;
  try {
    const tap = readFileSync(tapPath, 'utf8');
    const grab = (key) => {
      const m = tap.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
      return m ? Number(m[1]) : null;
    };
    counts = { tests: grab('tests'), pass: grab('pass'), fail: grab('fail') };
  } catch {
    // No TAP file means the runner did not start. Left null, and the record says so rather than
    // reporting a zero — a tally that ran over nothing is not a count of zero.
  }

  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(
    recordPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        ranAtMs: Date.now(),
        exitCode,
        signal: signal ?? null,
        // The authority. `counts` is informational and may be null; this is what "green" means.
        green: exitCode === 0,
        counts,
        note:
          'Written by desktop/scripts/run-tests.mjs on every run, pass or fail. A record with ' +
          'green:false is a real reading; an absent record means the suite was not run.',
      },
      null,
      2,
    ) + '\n',
  );
  process.exit(exitCode);
});
