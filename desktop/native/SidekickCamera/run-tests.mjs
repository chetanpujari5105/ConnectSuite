#!/usr/bin/env node
/**
 * Runs the Swift suite and records the run — pass **or** fail — in `.test-run.json`, the artifact
 * `scripts/check-suites-run.mjs` reads for its Swift leg. Same shape and same reason as
 * `desktop/scripts/run-tests.mjs`: a wrapper that records only successes leaves a green memory
 * behind a red run.
 *
 * Why a wrapper at all: under the Command Line Tools (no Xcode) SwiftPM does not put Swift
 * Testing's framework on the search path, and a bare `swift test` fails with "no such module
 * 'Testing'". The two paths below are where the CLT ships it; they are passed explicitly, and a run
 * where they are missing is recorded as red with that reason rather than as a green with no tests.
 *
 * Usage: node run-tests.mjs [extra swift test args…]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLT = '/Library/Developer/CommandLineTools/Library/Developer';
const frameworks = join(CLT, 'Frameworks');
const libs = join(CLT, 'usr/lib');

const startedAtMs = Date.now();
const args = [
  'test',
  '-Xswiftc', '-F', '-Xswiftc', frameworks,
  '-Xlinker', '-F', '-Xlinker', frameworks,
  '-Xlinker', '-rpath', '-Xlinker', frameworks,
  '-Xlinker', '-rpath', '-Xlinker', libs,
  ...process.argv.slice(2),
];

let output = '';
let status = 1;
let reason = null;
if (!existsSync(join(frameworks, 'Testing.framework'))) {
  reason = `Testing.framework not found under ${frameworks}`;
} else {
  const r = spawnSync('swift', args, { cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  status = r.status ?? 1;
  if (r.error) reason = String(r.error);
}
process.stdout.write(output);

// Swift Testing's summary line: "✔ Test run with N tests in M suites passed after …" or
// "✘ Test run with N tests in M suites failed after … with K issues."
const summary = output.match(/Test run with (\d+) tests? in (\d+) suites? (passed|failed)[^\n]*/);
const issues = output.match(/with (\d+) issues?\./);
const failedTests = (output.match(/^✘ Test .* failed after/gm) ?? []).length;
const record = {
  note:
    'Written by desktop/native/SidekickCamera/run-tests.mjs on every run, pass or fail. A record with ' +
    'green: true and an old ranAtMs says the suite was green then, not now.',
  ranAtMs: Date.now(),
  startedAtMs,
  exitCode: status,
  // A subset is not the suite: scripts/check-suites-run.mjs reads a filtered record as unrun.
  filtered: process.argv.slice(2).some((a) => a.startsWith('--filter') || a.startsWith('--skip')),
  green: status === 0 && !!summary && summary[3] === 'passed',
  counts: summary
    ? { tests: Number(summary[1]), suites: Number(summary[2]), fail: failedTests, issues: issues ? Number(issues[1]) : 0 }
    : null,
  reason: reason ?? (summary ? null : 'no Swift Testing summary line in the output (build failure?)'),
};
writeFileSync(join(here, '.test-run.json'), `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(join(here, '.test-run.log'), output);
console.log(
  `\nrun-tests: ${record.green ? 'GREEN' : 'RED'} — exit ${status}, ` +
    (record.counts ? `${record.counts.tests} tests, ${record.counts.fail} failing` : 'no count') +
    (record.reason ? ` (${record.reason})` : ''),
);
process.exit(record.green ? 0 : 1);
