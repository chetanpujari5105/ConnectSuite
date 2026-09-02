#!/usr/bin/env node
/**
 * The two apps must agree about what version of ConnectSuite this is.
 *
 * ### Why this needed a check rather than a note
 *
 * On 2026-09-02 the Android app said `versionName = "1.0.0"` and the Mac app said
 * `"version": "2.0.0"`, and **nothing in the repo said which was the version of the product.** Both
 * had been sitting there since their respective first commits, neither was wrong on its own, and
 * the disagreement was invisible because no build reads both. That is the same shape as a phase
 * table nothing can check and a defect register that drifts from its evidence — a fact living in
 * two places with nothing comparing them.
 *
 * It is cheap to fix now and it will never be cheap again: an Android `versionCode` may never go
 * down, so the first release freezes both numbers into everybody's installed app.
 *
 * ### What it checks, and the one it deliberately leaves alone
 *
 *  1. `app/build.gradle.kts` `versionName` equals `desktop/package.json` `version`.
 *  2. Both are `MAJOR.MINOR.PATCH`, all digits.
 *  3. `versionCode` is a positive integer.
 *
 * It does **not** check `Link.PROTOCOL_MAJOR`. That is a third number and it means something else
 * entirely — the wire contract's compatibility generation, which changes when a message changes and
 * not when the product ships. Tying it to the product version would either force a protocol bump
 * for a copy fix or block a product release behind a wire change. `docs/versioning.md` §3.
 *
 * It also does **not** derive `versionCode` from `versionName`. Every `major*10000 + minor*100 +
 * patch` scheme breaks the first time a component reaches 100, and the failure is a Play upload
 * refused after the release notes are written.
 *
 * Usage: node scripts/check-versions.mjs      (exit 0 clean, 1 on drift)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

export function readVersions(root = ROOT) {
  const gradle = readFileSync(join(root, 'app/build.gradle.kts'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8'));

  const nameMatch = /^\s*versionName\s*=\s*"([^"]+)"/m.exec(gradle);
  const codeMatch = /^\s*versionCode\s*=\s*(\d+)/m.exec(gradle);

  return {
    androidName: nameMatch ? nameMatch[1] : null,
    androidCode: codeMatch ? Number(codeMatch[1]) : null,
    desktop: typeof pkg.version === 'string' ? pkg.version : null,
  };
}

if (process.argv[1] && process.argv[1].endsWith('check-versions.mjs')) {
  const v = readVersions();
  let failures = 0;
  const fail = (message) => {
    console.log(`  FAIL: ${message}`);
    failures += 1;
  };

  // The instrument reports its own bound first: a regex that stopped matching would otherwise
  // report two nulls as agreeing, which is the clean-looking wrong answer.
  console.log(
    `version scan: android versionName=${v.androidName} versionCode=${v.androidCode} · ` +
      `desktop version=${v.desktop}`,
  );
  if (v.androidName === null || v.androidCode === null || v.desktop === null) {
    console.log('  INSTRUMENT FAILURE: a version could not be read — the scan is looking in the wrong place');
    process.exit(1);
  }

  if (v.androidName !== v.desktop) {
    fail(
      `the two apps disagree about the product version: Android says ${v.androidName}, ` +
        `the Mac says ${v.desktop}. One scheme, one number — docs/versioning.md`,
    );
  }
  for (const [where, value] of [['android versionName', v.androidName], ['desktop version', v.desktop]]) {
    if (!SEMVER.test(value)) fail(`${where} is "${value}", which is not MAJOR.MINOR.PATCH`);
  }
  if (!Number.isInteger(v.androidCode) || v.androidCode < 1) {
    fail(`versionCode is ${v.androidCode}; it must be a positive integer and must never go down`);
  }

  console.log(failures === 0 ? `  OK: both apps are ${v.desktop}` : `  ${failures} problem(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
