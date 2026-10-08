// Typechecks every test file (tsconfig.alltests.json) and gates on API-shape errors only, against a
// baseline that may only go down. See the config's header for why the rest is reported, not gated.
import { spawnSync } from 'node:child_process';

/** API-shape: the call or object does not match the code under test. */
const GATED = new Set(['TS2554', 'TS2339', 'TS2353', 'TS2551', 'TS2305', 'TS2724', 'TS2559']);
/** Measured 2026-10-09: 14 in 6 files (bulkBlockPull, bulkPrehashPull, filesResume, filesView, remoteView,
 *  streamStart, clipboardView). Lower it when one is fixed; the script says so. Never raise it. */
const BASELINE = 14;

const started = Date.now();
const run = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.alltests.json'], { encoding: 'utf8' });
const lines = `${run.stdout}${run.stderr}`.split('\n').filter((l) => / error TS\d+/.test(l));
const code = (l) => l.match(/error (TS\d+)/)[1];
const gated = lines.filter((l) => GATED.has(code(l)));
const byCode = {};
for (const l of lines) byCode[code(l)] = (byCode[code(l)] ?? 0) + 1;
console.log(`typecheck-tests: tsc exit ${run.status}, ${lines.length} error(s) over every test file in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
  `API-shape (gated) ${gated.length} / baseline ${BASELINE}; by code ${JSON.stringify(byCode)}`);
if (run.status === null || (run.status !== 0 && lines.length === 0)) {
  console.error('typecheck-tests: tsc did not produce a reading'); process.exit(2);
}
if (gated.length > BASELINE) {
  console.error('typecheck-tests: NEW API-shape errors in tests (a test calling code with the wrong shape):');
  for (const l of gated) console.error(`  ${l.slice(0, 220)}`);
  process.exit(1);
}
if (gated.length < BASELINE) console.log(`typecheck-tests: below baseline — lower BASELINE to ${gated.length} in scripts/typecheck-tests.mjs`);
