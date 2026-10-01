/**
 * Which half of this repo's test suite was run against the change being committed — and, when the
 * answer is "one of them", which one was not.
 *
 * ### The failure this exists for
 *
 * `ProtocolNamespaceTest > every feature message names a real capability` was committed **red** and
 * lived on the branch for days. The commit that broke it added `MessageType.STORAGE_STATE` without
 * its system-set exemption, ran `npm test` in `desktop/`, saw 623 green, and committed. The phone's
 * suite was never asked. Nothing in the repo could have noticed, and nothing said anything was
 * missing, because **a green is a statement about the suite that ran**.
 *
 * `CLAUDE.md`'s defect-65 entry is the sibling: *a module contributing zero tests is invisible in a
 * total.* This is the same sentence one level up — **a suite that is not run is invisible in a
 * green** — and it is worse, because the number it hides behind is real and current for what it
 * covers.
 *
 * ### Why this does not run the suites
 *
 * Running both on every `git commit` is ~15 s warm and minutes cold, and a hook that slow is a hook
 * people route around, which is how a guard stops guarding. So this reads what the runners **left
 * behind** and reports the age of each artifact beside its verdict — which is the rule `CLAUDE.md`
 * already carries about the stale results XML: *an artifact older than the run is not a result, it
 * is a memory.* Here the artifact is being asked about deliberately, so its age is the finding
 * rather than a footnote.
 *
 * Gradle writes an XML file per class under each module's build directory on its own.
 * `node --test` writes nothing, so `desktop/scripts/run-tests.mjs` writes `desktop/.test-run.json`
 * — on every run, pass **or fail**, because a wrapper that records only successes leaves a green
 * memory behind a red run.
 *
 * ### What it can and cannot see, stated because it is the whole subject
 *
 * It compares **modification times**: the newest source file in a half against that half's newest
 * result artifact. That is the practical signal and it has a known blind direction — an operation
 * that restores old mtimes (a `git stash pop`, a checkout of an older revision, a `touch -d`) can
 * leave a source looking older than an artifact that never tested it. So this reports the two
 * timestamps it compared rather than only its verdict, and the verdict is never the only thing on
 * screen. It is a check on *whether you ran it*, not a proof that the artifact corresponds to these
 * exact bytes.
 *
 * Usage:  node scripts/check-suites-run.mjs [--staged | --worktree]
 * Exit 0 = nothing to say. Exit 1 = a half is red, unrun or stale. Exit 2 = the checker itself failed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRADLE_MODULES = ['app', 'core', 'sync-module', 'mirror-module', 'input-module', 'camera-module'];

/**
 * Which half a changed path belongs to, or null for a path that neither suite covers.
 *
 * Docs, scripts and evidence are deliberately null: a commit that only edits `docs/testing.md` has
 * no suite to run, and demanding one would train people to ignore this.
 */
export function halfOf(path) {
  if (path.startsWith('desktop/src/') && /\.(ts|js|html|css)$/.test(path)) return 'mac';
  const module = path.split('/')[0];
  if (GRADLE_MODULES.includes(module) && path.endsWith('.kt')) return 'phone';
  return null;
}

/** The halves a set of changed paths touches. */
export function halvesTouched(paths) {
  const halves = new Set();
  for (const p of paths) {
    const h = halfOf(p);
    if (h) halves.add(h);
  }
  return halves;
}

/**
 * The phone half's evidence: every Gradle results XML, its newest mtime, and the failure total.
 *
 * A module with no results directory contributes **nothing** rather than a zero — a tally that ran
 * over nothing is not a count of zero, which is the rule `scripts/adb-count.sh` was written for two
 * days ago in a different medium. The modules that contributed nothing are named in the output.
 */
export function readPhoneEvidence(root, fsLike = { existsSync, readdirSync, readFileSync, statSync }) {
  let newestMs = 0;
  let tests = 0;
  let failures = 0;
  const modulesSeen = [];
  for (const m of GRADLE_MODULES) {
    const dir = join(root, m, 'build', 'test-results', 'testDebugUnitTest');
    if (!fsLike.existsSync(dir)) continue;
    const xmls = fsLike.readdirSync(dir).filter((f) => f.endsWith('.xml'));
    if (xmls.length === 0) continue;
    modulesSeen.push(m);
    for (const f of xmls) {
      const full = join(dir, f);
      newestMs = Math.max(newestMs, fsLike.statSync(full).mtimeMs);
      const head = fsLike.readFileSync(full, 'utf8').slice(0, 4000);
      const t = head.match(/tests="(\d+)"/);
      const fl = head.match(/failures="(\d+)"/);
      const e = head.match(/errors="(\d+)"/);
      if (t) tests += Number(t[1]);
      if (fl) failures += Number(fl[1]);
      if (e) failures += Number(e[1]);
    }
  }
  if (modulesSeen.length === 0) return null;
  return {
    newestMs,
    tests,
    failures,
    modulesSeen,
    modulesMissing: GRADLE_MODULES.filter((m) => !modulesSeen.includes(m)),
  };
}

/** The Mac half's evidence: the record `npm test` leaves behind. */
export function readMacEvidence(root, fsLike = { existsSync, readFileSync }) {
  const path = join(root, 'desktop', '.test-run.json');
  if (!fsLike.existsSync(path)) return null;
  let record;
  try {
    record = JSON.parse(fsLike.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof record.ranAtMs !== 'number') return null;
  return {
    newestMs: record.ranAtMs,
    tests: record.counts?.tests ?? null,
    // The exit code is the authority; counts are informational and may be absent.
    failures: record.green ? 0 : (record.counts?.fail ?? null),
    green: record.green === true,
  };
}

/**
 * The verdict per half, and it has **four** values rather than two.
 *
 * `unrun`, `stale` and `red` are different findings needing different sentences, and collapsing
 * them is the empty-versus-failed mistake this repo has a whole proposal about. A half with no
 * artifact has not said anything; a half with a failing one has; a half with an old one said
 * something about different bytes.
 */
export function verdictFor({ touched, evidence, newestSourceMs }) {
  if (!touched) return { state: 'untouched' };
  if (!evidence) return { state: 'unrun', detail: 'no results artifact at all' };
  if (evidence.failures === null) {
    return { state: 'unrun', detail: 'an artifact with no readable count' };
  }
  if (evidence.failures > 0) {
    return { state: 'red', detail: `${evidence.failures} failing`, evidence };
  }
  if (evidence.newestMs < newestSourceMs) {
    return {
      state: 'stale',
      detail:
        `results are ${Math.round((newestSourceMs - evidence.newestMs) / 1000)}s older than ` +
        'the newest changed source',
      evidence,
    };
  }
  return { state: 'green', evidence };
}

// ---- the run ---------------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function changedPaths(mode) {
  const args = mode === '--worktree'
    ? ['diff', '--name-only', 'HEAD']
    : ['diff', '--cached', '--name-only'];
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
}

const HALF_NAMES = {
  mac: 'Mac   (npm test in desktop/)',
  phone: 'phone (./gradlew testDebugUnitTest)',
};

function main() {
  const mode = process.argv.includes('--worktree') ? '--worktree' : '--staged';
  const paths = changedPaths(mode);
  const halves = halvesTouched(paths);

  const newestSource = { mac: 0, phone: 0 };
  for (const p of paths) {
    const h = halfOf(p);
    if (!h) continue;
    const full = join(root, p);
    if (!existsSync(full)) continue;
    newestSource[h] = Math.max(newestSource[h], statSync(full).mtimeMs);
  }

  const results = {
    phone: verdictFor({
      touched: halves.has('phone'),
      evidence: readPhoneEvidence(root),
      newestSourceMs: newestSource.phone,
    }),
    mac: verdictFor({
      touched: halves.has('mac'),
      evidence: readMacEvidence(root),
      newestSourceMs: newestSource.mac,
    }),
  };

  const lines = [];
  for (const half of ['phone', 'mac']) {
    const v = results[half];
    const name = HALF_NAMES[half];
    if (v.state === 'untouched') {
      lines.push(`  ${name}: NOT CHECKED — this commit does not touch it`);
      continue;
    }
    const age = v.evidence ? `${Math.round((Date.now() - v.evidence.newestMs) / 1000)}s old` : 'no artifact';
    const count = v.evidence?.tests != null ? `${v.evidence.tests} tests` : 'count unknown';
    lines.push(`  ${name}: ${v.state.toUpperCase()} — ${count}, ${age}${v.detail ? `, ${v.detail}` : ''}`);
    if (half === 'phone' && v.evidence?.modulesMissing?.length) {
      lines.push(`      modules that contributed no results: ${v.evidence.modulesMissing.join(', ')}`);
    }
  }

  console.log('check-suites-run:');
  console.log(lines.join('\n'));
  console.log(
    '  (mtime comparison: an operation that restores old mtimes can make a source look older than\n' +
      '   an artifact that never tested it. This checks whether you ran it, not that the artifact\n' +
      '   is of these exact bytes.)',
  );

  const bad = Object.entries(results).filter(([, v]) => ['red', 'unrun', 'stale'].includes(v.state));
  process.exit(bad.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    // Fails open, like check-defects.sh: a checker that can wedge the repo gets deleted by the
    // first person it wedges, and then there is no checker.
    console.error(`check-suites-run: checker failed (${e.message}) — allowing the commit`);
    process.exit(2);
  }
}
