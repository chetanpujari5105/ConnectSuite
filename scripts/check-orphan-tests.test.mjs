/*
 * Fixtures for check-orphan-tests.mjs.  Run: node --test scripts/check-orphan-tests.test.mjs
 *
 * The first fixture is the one that matters, and it is a rule this repo has written down: a guard
 * built after a failure and never run against that failure has not been tested against the only
 * case it is known to have missed. So the exact path that sat uncompiled for a week is here
 * verbatim, not a paraphrase of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orphans, includedModules, testGlobs, globToRegExp } from './check-orphan-tests.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = 'include(":app")\ninclude(":core")\ninclude(":sync-module")\n';
const PKG = JSON.stringify({ scripts: { test: 'node --import tsx --test "src/**/*.test.ts"' } });
const ok = (files) => orphans({ files, settings: SETTINGS, desktopPackageJson: PKG }).orphans;

test('the file that actually shipped uncompiled is denied, verbatim', () => {
  const shipped = 'desktop/core/src/test/java/com/chetan/connectsuite/core/ScreenGeometryRegistryTest.kt';
  const found = ok([shipped, 'core/src/test/java/x/AT.kt', 'desktop/src/a.test.ts']);
  assert.equal(found.length, 1);
  assert.equal(found[0].file, shipped);
  assert.match(found[0].why, /no Gradle module owns "desktop\/core"/);
});

test('a Kotlin test inside an included module passes', () => {
  assert.deepEqual(ok(['core/src/test/java/x/AT.kt', 'desktop/src/a.test.ts']), []);
});

test('androidTest source sets count as owned too', () => {
  assert.deepEqual(ok(['app/src/androidTest/java/x/AT.kt', 'desktop/src/a.test.ts']), []);
});

test('a nested module path maps its colons onto directories', () => {
  const found = orphans({
    files: ['feature/alpha/src/test/java/x/AT.kt', 'desktop/src/a.test.ts'],
    settings: 'include(":feature:alpha")\n',
    desktopPackageJson: PKG,
  }).orphans;
  assert.deepEqual(found, []);
});

test('a .test.ts outside the glob is denied', () => {
  const found = ok(['core/src/test/java/x/AT.kt', 'desktop/tools/stray.test.ts']);
  assert.equal(found.length, 1);
  assert.match(found[0].why, /matched by none of the test globs/);
});

test('a .test.ts nested deep inside the glob passes — ** crosses separators', () => {
  assert.deepEqual(ok(['core/src/test/java/x/AT.kt', 'desktop/src/renderer/deep/a.test.ts']), []);
});

test('the glob comes from package.json, so narrowing it narrows the check', () => {
  const narrowed = JSON.stringify({ scripts: { test: 'node --test "src/shared/*.test.ts"' } });
  const found = orphans({
    files: ['core/src/test/java/x/AT.kt', 'desktop/src/renderer/a.test.ts'],
    settings: SETTINGS,
    desktopPackageJson: narrowed,
  }).orphans;
  assert.equal(found.length, 1, 'a renderer test is unreachable once the glob is shared-only');
});

test('production Kotlin outside every module is NOT flagged — scope discipline', () => {
  // The rule is about test files a runner cannot discover, not about stray source. A guard that
  // widened to all .kt would deny build-logic and sample directories and get switched off.
  assert.deepEqual(ok(['nowhere/src/main/java/x/Thing.kt', 'core/src/test/java/x/AT.kt', 'desktop/src/a.test.ts']), []);
});

test('a non-test .kt inside a test-looking path is still scoped by the source set', () => {
  // src/testFixtures is a real Gradle source set name; owned by an included module, so it passes.
  assert.deepEqual(ok(['core/src/testFixtures/java/x/Helper.kt', 'desktop/src/a.test.ts']), []);
});

test('the instrument fails loudly on an empty enumeration', () => {
  const { counts } = orphans({ files: [], settings: SETTINGS, desktopPackageJson: PKG });
  assert.equal(counts.kotlin, 0);
  assert.equal(counts.typescript, 0);
  // main() exits 2 on this; asserted here so the control cannot be deleted without a red test.
  const src = readFileSync(join(REPO, 'scripts/check-orphan-tests.mjs'), 'utf8');
  assert.match(src, /counts\.kotlin === 0 \|\| counts\.typescript === 0/);
  assert.match(src, /process\.exit\(2\)/);
});

test('the real repository is clean, and the scan is non-trivially large', () => {
  const { orphans: found, counts } = orphans({
    // Live, not a snapshot: a captured file list goes stale the moment anyone adds a test, and a
    // stale artifact served as a current reading is the fault this repo has recorded three times.
    files: execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean),
    settings: readFileSync(join(REPO, 'settings.gradle.kts'), 'utf8'),
    desktopPackageJson: readFileSync(join(REPO, 'desktop/package.json'), 'utf8'),
  });
  assert.deepEqual(found, [], 'a tracked test file is unreachable by any runner');
  assert.ok(counts.kotlin > 40, `only ${counts.kotlin} Kotlin test files enumerated`);
  assert.ok(counts.typescript > 40, `only ${counts.typescript} TypeScript test files enumerated`);
});

test('the helpers do what the decision assumes', () => {
  assert.deepEqual([...includedModules('include(":a")\ninclude(":b:c")')], ['a', 'b/c']);
  assert.deepEqual(testGlobs(PKG), ['src/**/*.test.ts']);
  assert.ok(globToRegExp('src/**/*.test.ts').test('src/a/b/c.test.ts'));
  assert.ok(globToRegExp('src/**/*.test.ts').test('src/c.test.ts'), '**/ must also match zero directories');
  assert.ok(!globToRegExp('src/*.test.ts').test('src/a/b.test.ts'), 'a single * must not cross a separator');
});
