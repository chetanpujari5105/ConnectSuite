import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVersions } from './check-versions.mjs';

/**
 * Fixtures for the version check, each with its opposite.
 *
 * A matcher without fixtures is a rule you are guessing about — `no-force-stop.sh` learned that by
 * forbidding the writing of its own documentation. The two that matter here are the *reader*
 * failing silently: a regex that stops matching returns `null`, and two `null`s compare equal.
 */

function fixture(gradleBody, pkgVersion) {
  const root = mkdtempSync(join(tmpdir(), 'cs-versions-'));
  mkdirSync(join(root, 'app'), { recursive: true });
  mkdirSync(join(root, 'desktop'), { recursive: true });
  writeFileSync(join(root, 'app/build.gradle.kts'), gradleBody);
  writeFileSync(
    join(root, 'desktop/package.json'),
    JSON.stringify({ name: 'connectsuite-desktop', version: pkgVersion }),
  );
  return root;
}

const GRADLE = (code, name) => `
android {
    defaultConfig {
        applicationId = "com.chetan.connectsuite"
        versionCode = ${code}
        versionName = "${name}"
    }
}
`;

test('it reads both versions out of the real files', () => {
  // The control, and it is the one that matters: run against the repo itself, the reader must come
  // back with three real values. Everything below is worthless if this returns nulls.
  const v = readVersions();
  assert.match(v.androidName ?? '', /^\d+\.\d+\.\d+$/, 'android versionName did not parse');
  assert.match(v.desktop ?? '', /^\d+\.\d+\.\d+$/, 'desktop version did not parse');
  assert.ok(Number.isInteger(v.androidCode) && v.androidCode >= 1, 'versionCode did not parse');
});

test('the repo it guards currently agrees with itself', () => {
  const v = readVersions();
  assert.equal(v.androidName, v.desktop);
});

test('a fixture where they agree parses as agreeing', () => {
  const root = fixture(GRADLE(7, '2.1.0'), '2.1.0');
  try {
    const v = readVersions(root);
    assert.deepEqual(v, { androidName: '2.1.0', androidCode: 7, desktop: '2.1.0' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a fixture where they disagree is visible to the reader', () => {
  // The exact state the repo was in on 2026-09-02, before this check existed.
  const root = fixture(GRADLE(1, '1.0.0'), '2.0.0');
  try {
    const v = readVersions(root);
    assert.notEqual(v.androidName, v.desktop);
    assert.equal(v.androidName, '1.0.0');
    assert.equal(v.desktop, '2.0.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a gradle file the regex cannot read answers null rather than a wrong version', () => {
  // The failure this reader is most likely to have: someone moves versionName into a variable or a
  // version catalogue, the regex stops matching, and two nulls compare equal — a clean pass over a
  // file it could not read. The runner treats a null as an INSTRUMENT FAILURE for that reason.
  const root = fixture('android { defaultConfig { versionName = libs.versions.app.get() } }', '2.0.0');
  try {
    const v = readVersions(root);
    assert.equal(v.androidName, null);
    assert.equal(v.androidCode, null);
    assert.notEqual(v.androidName, v.desktop, 'a null must not read as agreement');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a package.json with no version answers null', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-versions-'));
  try {
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'desktop'), { recursive: true });
    writeFileSync(join(root, 'app/build.gradle.kts'), GRADLE(1, '2.0.0'));
    writeFileSync(join(root, 'desktop/package.json'), JSON.stringify({ name: 'x' }));
    assert.equal(readVersions(root).desktop, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
