#!/usr/bin/env node
/*
 * Refuses a tracked test file that no runner can discover.
 *
 * ## Why this exists
 *
 * `desktop/core/src/test/java/com/chetan/connectsuite/core/ScreenGeometryRegistryTest.kt` was
 * tracked in git from 2026-08-30 to 2026-09-05 and **had never compiled**. `settings.gradle.kts`
 * includes `:app :core :sync-module :mirror-module :input-module`; there is no `:desktop:core`, so
 * Gradle never saw the directory. Six tests over `ScreenGeometryRegistry` — the stamp that stops a
 * tap landing in the wrong place, which is defects 19 and 20's entire subject — sat green-looking
 * and unexecuted for a week. When finally run they passed, which is luck rather than vindication:
 * the same file could have been red the whole time and nothing would have said so.
 *
 * `CLAUDE.md` already carries defect 65's lesson — *a module contributing zero tests is invisible
 * in a total* — and the diagnostic it prescribes, `find -type d -name test`, **returns this
 * directory**. The gap is one level further in: the enumeration has to run over *test files*, not
 * over *modules*, because a file can sit in a `src/test` directory belonging to no module at all.
 *
 * ## Scope, and why it stops where it does
 *
 * Only the two runners that **discover** files are checked:
 *
 *   1. **Gradle** — a Kotlin file under `src/test*` or `src/androidTest*` is compiled only if the
 *      directory above `src/` is a module `settings.gradle.kts` includes. Module paths come from
 *      the include list, not from a directory scan, because the include list is what Gradle reads.
 *   2. **`npm test`** — the glob is read out of `desktop/package.json`'s own `test` script rather
 *      than hardcoded here, so moving the glob moves this check with it. That is the same
 *      discriminator `check-renderer-scripts.mjs` uses when it takes its scope from `index.html`.
 *
 * A runner invoked with an explicit path — `node --test scripts/foo.test.mjs` — cannot silently
 * miss a file, so those are counted and reported rather than checked. Not-run-automatically is a
 * different problem from not-discoverable, and conflating them is how a guard widens until people
 * route around it.
 *
 * ## Its own control
 *
 * An enumeration that finds nothing passes trivially, which is the failure this whole file is
 * about. Both scans fail loudly at zero.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Kotlin test sources live under `<module>/src/test.../` or `<module>/src/androidTest.../`. */
const KOTLIN_TEST = /^(.*)\/src\/(?:test|androidTest)[^/]*\/.*\.kt$/;

/** `include(":sync-module")` and `include(":a:b")` — Gradle maps the colons onto directories. */
export function includedModules(settings) {
  const out = new Set();
  for (const m of settings.matchAll(/^\s*include\s*\(\s*["']:([^"']+)["']\s*\)/gm)) {
    out.add(m[1].split(':').join('/'));
  }
  return out;
}

/** The globs `npm test` actually hands to `node --test`, read from the script it runs. */
export function testGlobs(packageJson) {
  const script = JSON.parse(packageJson).scripts?.test ?? '';
  return [...script.matchAll(/"([^"]*\*[^"]*)"|'([^']*\*[^']*)'|(\S*\*\S*)/g)]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .filter(Boolean);
}

/** Minimal glob→regexp: `**` crosses directory separators, `*` does not. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * The whole decision, over a list of tracked paths. Pure, so the fixtures can hand it the exact
 * path that shipped broken rather than a paraphrase of it.
 */
export function orphans({ files, settings, desktopPackageJson }) {
  const modules = includedModules(settings);
  const globs = testGlobs(desktopPackageJson).map((g) => ({ glob: g, re: globToRegExp(`desktop/${g}`) }));

  const kotlin = files.filter((f) => KOTLIN_TEST.test(f));
  const typescript = files.filter((f) => /\.test\.m?ts$/.test(f));
  const handRun = files.filter((f) => /^scripts\/.*\.test\.(mjs|sh)$/.test(f));

  const found = [];
  for (const f of kotlin) {
    const root = f.match(KOTLIN_TEST)[1];
    if (!modules.has(root)) {
      found.push({ file: f, why: `no Gradle module owns "${root}" — settings.gradle.kts includes ${[...modules].map((m) => `"${m}"`).join(', ')}` });
    }
  }
  for (const f of typescript) {
    if (!globs.some(({ re }) => re.test(f))) {
      found.push({ file: f, why: `matched by none of the test globs in desktop/package.json (${globs.map((g) => g.glob).join(', ') || 'none found'})` });
    }
  }
  return { orphans: found, counts: { kotlin: kotlin.length, typescript: typescript.length, handRun: handRun.length, modules: modules.size } };
}

function main() {
  const files = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  const { orphans: found, counts } = orphans({
    files,
    settings: readFileSync(join(REPO, 'settings.gradle.kts'), 'utf8'),
    desktopPackageJson: readFileSync(join(REPO, 'desktop/package.json'), 'utf8'),
  });

  // The control. A scan that enumerated nothing is the failure this file exists to prevent.
  if (counts.kotlin === 0 || counts.typescript === 0) {
    console.error(`check-orphan-tests: the scan found ${counts.kotlin} Kotlin and ${counts.typescript} TypeScript test files. At least one enumeration is broken — a check over an empty set passes and means nothing.`);
    process.exit(2);
  }

  console.log(`orphan-test scan: ${counts.kotlin} Kotlin test files across ${counts.modules} included modules, ${counts.typescript} TypeScript test files`);
  console.log(`  ${counts.handRun} test files under scripts/ are run by explicit path and are not checked here — an explicit path cannot silently miss a file`);

  if (found.length > 0) {
    for (const o of found) console.error(`  ORPHAN: ${o.file}\n          ${o.why}`);
    console.error(`check-orphan-tests: ${found.length} tracked test file(s) no runner can discover.`);
    process.exit(1);
  }
  console.log(`  OK: every tracked test file is reachable by a runner`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
