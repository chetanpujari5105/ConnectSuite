#!/usr/bin/env node
// Evidence handling for a saved encoder-spike report (docs/camera-v2-encoder-spike.md §8). Reads files;
// touches no device, no camera and no running app. Never overwrites an output: evidence is never replaced.
//
//   node scripts/webcam-spike-evidence.mjs sanitize --in <original> --out <derived copy>
//       A DERIVED copy fit for the repository: the peer's name replaced by every shape the phone writes it
//       in and by every name this Mac is known by, with a residual check that refuses rather than writes.
//       The copy names the original's SHA-256 and says that it is derived.
//
//   node scripts/webcam-spike-evidence.mjs rescore --in <original> --sanitized <derived copy> --out <file>
//       --original-scorer <commit>
//       Replays the SAME saved report through the current scorer and writes a SEPARATE re-score record.
//       It is not a hardware run and says so. Refuses unless: the original scorer, loaded from
//       <commit>, reproduces the report's recorded verdict exactly; the current scorer is committed (its
//       commit is recorded); every bound is unchanged; the only criteria that moved are the accounting
//       line; and the sanitized copy scores identically to the original.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as core from './webcam-spike-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = 'scripts/webcam-spike-core.mjs';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
const scutil = (key) => { try { return execFileSync('/usr/sbin/scutil', ['--get', key], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const flag = (argv, name) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const refuse = (why) => { console.error(`REFUSED — nothing written: ${why}`); process.exit(2); };

/** Every string replaced by a placeholder: what is left must be identical between original and copy. */
const shape = (v) => (typeof v === 'string' ? '§' : Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : v);

function sanitize(argv) {
  const input = flag(argv, '--in');
  const out = flag(argv, '--out');
  if (!input || !out) refuse('sanitize needs --in and --out');
  const bytes = readFileSync(input);
  const original = JSON.parse(bytes.toString('utf8'));
  const names = core.knownMacNames({ hostname: hostname(), username: userInfo().username, computerName: scutil('ComputerName'), localHostName: scutil('LocalHostName') });
  if (!names.length) refuse('no name for this Mac could be read, so nothing could be checked');
  const { report, replaced } = core.sanitizeReport(original, names);
  if (!isDeepStrictEqual(shape(report), shape(original))) refuse('sanitizing changed something other than a string');
  const derived = {
    derived: {
      kind: 'sanitized copy',
      notice: 'DERIVED from the original report, which is held privately outside version control. Only the peer’s device name was replaced (with <peer>); every number, key and other string is the original’s. The verdict inside is the ORIGINAL verdict, as the run produced it.',
      from: { sha256: sha256(bytes), bytes: bytes.length },
      by: { tool: 'scripts/webcam-spike-evidence.mjs sanitize', commit: git('rev-parse', 'HEAD') },
      redactions: replaced,
      namesChecked: names.length,
    },
    ...report,
  };
  writeFileSync(out, JSON.stringify(derived, null, 1) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ wrote: out, from: derived.derived.from, redactions: replaced, namesChecked: names.length }));
}

async function rescore(argv) {
  const input = flag(argv, '--in');
  const sanitizedPath = flag(argv, '--sanitized');
  const out = flag(argv, '--out');
  const originalScorer = flag(argv, '--original-scorer');
  if (!input || !sanitizedPath || !out || !originalScorer) refuse('rescore needs --in, --sanitized, --out and --original-scorer');

  const bytes = readFileSync(input);
  const original = JSON.parse(bytes.toString('utf8'));
  const sanitizedBytes = readFileSync(sanitizedPath);
  const sanitized = JSON.parse(sanitizedBytes.toString('utf8'));
  if (sanitized.derived?.from?.sha256 !== sha256(bytes)) refuse('the sanitized copy does not name this original as its source');

  // The scorer must be committed, so the re-score can name the exact code that produced it.
  try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', CORE], { cwd: REPO }); } catch { refuse(`${CORE} has uncommitted changes — commit the scorer first`); }
  const scorerCommit = git('rev-parse', 'HEAD');
  const scorerBlob = git('rev-parse', `HEAD:${CORE}`);

  // Reproduce the original verdict with the original scorer, from git, before trusting any comparison.
  const v1Src = git('show', `${originalScorer}:${CORE}`);
  const dir = mkdtempSync(join(tmpdir(), 'spike-scorer-v1-'));
  let v1;
  try {
    writeFileSync(join(dir, 'core-v1.mjs'), v1Src);
    v1 = await import(pathToFileURL(join(dir, 'core-v1.mjs')).href);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const reproduced = v1.verdict(original.spike, original.phone);
  if (!isDeepStrictEqual(reproduced, original.verdict)) refuse(`the scorer at ${originalScorer} does not reproduce the recorded verdict — this is not the scorer that judged the run`);
  if (!isDeepStrictEqual(v1.BOUNDS, core.BOUNDS) || !isDeepStrictEqual(v1.DRIVER_LIMITS, core.DRIVER_LIMITS)) refuse('a bound or a driver limit differs from the original scorer’s');

  const corrected = core.verdict(original.spike, original.phone);
  const changes = core.criteriaChanges(original.verdict, corrected);
  const other = [...changes.removed, ...changes.added].filter((l) => !/^(FAIL|PASS): accounting /.test(l));
  if (other.length) refuse(`criteria other than accounting changed: ${other.join(' | ')}`);
  const fromSanitized = core.verdict(sanitized.spike, sanitized.phone);
  if (!isDeepStrictEqual(fromSanitized, corrected)) refuse('the sanitized copy does not score identically to the original');

  const acct = core.accounting(original.spike.probe.counts);
  const record = {
    kind: 'webcam-spike re-score',
    notice: 'A RE-SCORE of a saved report. NOT a new hardware run: no phone, camera, Mac pipeline or app was touched to produce it. The run itself happened once, on the date in `run.startedAt`.',
    run: { startedAt: original.startedAt, session: original.spike?.session ?? null, runbook: original.runbook },
    input: {
      original: { sha256: sha256(bytes), bytes: bytes.length, held: 'privately, outside version control' },
      sanitizedCopy: { path: relative(REPO, resolve(sanitizedPath)), sha256: sha256(sanitizedBytes) },
    },
    original: {
      verdict: original.verdict.verdict,
      reasons: original.verdict.reasons,
      scorer: { version: 1, commit: git('rev-parse', originalScorer), file: CORE },
      reproducedByThatScorer: true,
      standing: 'This is the run’s verdict and it stays FAIL. It is not replaced, amended or superseded by this record.',
    },
    corrected: {
      verdict: corrected.verdict,
      reasons: corrected.reasons,
      scorer: { version: core.SCORER_VERSION, commit: scorerCommit, file: CORE, blob: scorerBlob },
      qualification: 'POST-HOC. The version-2 accounting rule was written after this reading existed, to correct a defect in the version-1 rule. It is not pre-registered, so this verdict is the run re-read through a corrected instrument, not a pre-registered PASS of the run.',
    },
    changed: {
      criteria: changes,
      onlyTheAccountingCriterion: true,
      boundsUnchanged: true,
      accounting: acct,
    },
    explanation: [
      'Version 1 summed probe.decoded + droppedDecodeQueue + decodeErrors + composeErrors + discardedEnded and compared it with accepted.',
      'probe.decoded is not where an AU ends. BridgeCore.decodeAndFeed checks the session again after a successful decode and counts discardedEnded there, so a frame that was decoding when the planned Stop landed is in probe.decoded AND discardedEnded.',
      `This run: probe.decoded ${original.spike.probe.counts['probe.decoded']}, sinkEnqueued ${original.spike.probe.counts.sinkEnqueued}, discardedEnded ${original.spike.probe.counts.discardedEnded} — one frame decoded and then discarded at the door, counted twice by version 1 (368 against 367 accepted).`,
      'Version 2 sums BridgeCore’s own disjoint terminal dispositions — the set BridgeCore.invariantHolds uses, checked against the Swift by test — and treats a missing counter as a failure, not a zero.',
      'Corroboration from outside the report: the decode probe printed “exiting 0; invariant holds” at exit (Electron main’s log, 2026-10-04T19:57:34.195+05:30), i.e. BridgeCore’s own invariant held for this run.',
    ],
  };
  writeFileSync(out, JSON.stringify(record, null, 1) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ wrote: out, original: record.original.verdict, corrected: record.corrected.verdict, changes }));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'sanitize') sanitize(rest);
else if (cmd === 'rescore') await rescore(rest);
else { console.log('usage: webcam-spike-evidence.mjs sanitize --in <original> --out <copy> | rescore --in <original> --sanitized <copy> --out <file> --original-scorer <commit>'); process.exit(cmd ? 2 : 0); }
