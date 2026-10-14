// Fixtures for scripts/check-before-sharing.mjs: the combining rule on its own, then the real two checks
// end to end. The end-to-end pass needs a real signed APK, which only the repo's own release build output can
// supply (agents may not sign); it is skipped, saying so, when that file is absent or unsigned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { combine } from './check-before-sharing.mjs';
import { findBuildTools, checkApk } from './check-share-apks.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts', 'check-before-sharing.mjs');
const run = (dir, ...extra) => spawnSync(process.execPath, [SCRIPT, dir, ...extra], { encoding: 'utf8' });

test('combine: 0 only when both pass; a refusal outranks a could-not-check; a crash is not a pass', () => {
  assert.equal(combine([0, 0]), 0);
  assert.equal(combine([1, 0]), 1);
  assert.equal(combine([0, 1]), 1);
  assert.equal(combine([1, 2]), 1);
  assert.equal(combine([2, 1]), 1);
  assert.equal(combine([0, 2]), 2);
  assert.equal(combine([2, 0]), 2);
  assert.equal(combine([0, -1]), 2, 'a check that died is not a pass');
  assert.equal(combine([0, 13]), 2);
  assert.equal(combine([]), 2, 'no checks run is not a pass');
});

test('end to end: a token file is refused even though the folder has no APK at all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'before-sharing-'));
  writeFileSync(join(dir, 'README.txt'), 'read me');
  writeFileSync(join(dir, 'someone.sidekick-token'), 'dummy, not a token');
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /── check-share-folder \(exit 1\)/);
  assert.match(r.stdout, /REFUSED: someone\.sidekick-token/, 'the inner check’s own lines are printed, not summarised away');
  assert.match(r.stdout, /── before sharing: REFUSED/);
});

test('end to end: a clean folder with no APK is could-not-check (2), not a pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'before-sharing-'));
  writeFileSync(join(dir, 'README.txt'), 'read me');
  const r = run(dir);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /check-share-folder 0, check-share-apks 2/);
});

const tools = findBuildTools();
const releaseApk = join(REPO, 'app/build/outputs/apk/release/app-release.apk');
const signedRelease = tools && existsSync(releaseApk) && checkApk(releaseApk, tools).refusals.length === 0;

test('end to end: a folder with a real release-signed APK passes, and pinning another signer refuses it', { skip: !signedRelease && 'no release-signed app-release.apk in app/build/outputs (or no SDK)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'before-sharing-'));
  writeFileSync(join(dir, 'README.txt'), 'read me');
  copyFileSync(releaseApk, join(dir, 'Sidekick-android.apk'));
  const ok = run(dir);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /── before sharing: OK — both checks passed/);
  const pinned = run(dir, '--expect-signer', 'cd'.repeat(32));
  assert.equal(pinned.status, 1, 'the signer flag reaches check-share-apks');
  assert.match(pinned.stdout, /is not the expected/);
});
