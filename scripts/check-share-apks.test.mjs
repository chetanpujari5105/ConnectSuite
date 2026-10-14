// Fixtures for scripts/check-share-apks.mjs.
//
// Three layers, and each says what it reaches:
//  1. `judgeApk` over tool output captured from real runs (apksigner 36.0.0 and 37.0.0, aapt2). The release-signed
//     captures keep the real line format and replace the certificate's DN and digests with made-up values, so no
//     owner detail is in this file. Hermetic.
//  2. Real `aapt2 link` APKs built in a temp folder — unsigned, debuggable or not — run through the real tools.
//     Skipped, saying so, when no SDK is on the machine. This layer cannot produce a SIGNED APK: signing is refused
//     to agents by scripts/hooks/no-release-signing.sh, and a test that signs would be routing around it.
//  3. The repo's own build outputs, when present: a real debug-signed APK and a real release-signed one. These are
//     the only real signed inputs, and they are skipped, saying so, on a clean checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judgeApk, parseVerify, findBuildTools, checkShareApks, checkApk } from './check-share-apks.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts', 'check-share-apks.mjs');
const FAKE = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const JVM = 'WARNING: A restricted method in java.lang.System has been called\nWARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning\n';

// Captured verbatim from `apksigner verify -v --print-certs` on the 2.0.1 share APK (36.0.0 and 37.0.0 agree).
const UNSIGNED = { status: 1, output: `${JVM}DOES NOT VERIFY\nERROR: Missing META-INF/MANIFEST.MF\n` };
// 36.0.0 format, real lines, DN and digest replaced.
const SIGNED_36 = (sha = FAKE, dn = 'CN=Fixture Release, O=Example, C=XX') => ({
  status: 0,
  output: `${JVM}Verifies\nVerified using v1 scheme (JAR signing): false\nVerified using v2 scheme (APK Signature Scheme v2): false\nVerified using v3 scheme (APK Signature Scheme v3): true\nNumber of signers: 1\nSigner #1 certificate DN: ${dn}\nSigner #1 certificate SHA-256 digest: ${sha}\nSigner #1 certificate SHA-1 digest: 0000\nSigner #1 key algorithm: RSA\n`,
});
// 37.0.0 format: one block per scheme, so a v2+v3 APK names its one certificate twice.
const SIGNED_37_V2V3 = {
  status: 0,
  output: `Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true\nVerified using v3 scheme (APK Signature Scheme v3): true\nNumber of signers: 1\nV2 Signer: certificate DN: CN=Fixture Release\nV2 Signer: certificate SHA-256 digest: ${FAKE}\nV3.0 Signer: certificate DN: CN=Fixture Release\nV3.0 Signer: certificate SHA-256 digest: ${FAKE}\n`,
};
// Real 37.0.0 lines from a debug build; the Android Debug DN is the SDK's, the digest is replaced.
const DEBUG_SIGNED = { status: 0, output: `Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: 1\nV2 Signer: certificate DN: CN=Android Debug, O=Android, C=US\nV2 Signer: certificate SHA-256 digest: ${OTHER}\n` };
// aapt2 dump xmltree, real lines.
const manifest = (debuggable) => ({
  status: 0,
  output: `N: android=http://schemas.android.com/apk/res/android (line=1)\n  E: manifest (line=1)\n    A: http://schemas.android.com/apk/res/android:versionName(0x0101021c)="2.0.1" (Raw: "2.0.1")\n    A: package="com.chetan.connectsuite" (Raw: "com.chetan.connectsuite")\n      E: application (line=3)\n        A: http://schemas.android.com/apk/res/android:label(0x01010001)="Sidekick" (Raw: "Sidekick")\n${debuggable === undefined ? '' : `        A: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=${debuggable}\n`}`,
});
const UNREADABLE = { status: 1, output: 'apk.apk: error: failed opening zip: Invalid file.\n' };

const judge = (verify, man, extra = {}) => judgeApk({ path: 'Sidekick-2.0.1-android.apk', verify, manifest: man, ...extra });

test('control: a release-signed, non-debuggable APK passes — in both apksigner formats', () => {
  assert.deepEqual(judge(SIGNED_36(), manifest()).refusals, []);
  assert.deepEqual(judge(SIGNED_36(), manifest('false')).refusals, []);
  assert.deepEqual(judge(SIGNED_37_V2V3, manifest()).refusals, []);
});

test('an unsigned APK is refused, with apksigner’s own reason', () => {
  const r = judge(UNSIGNED, manifest());
  assert.equal(r.refusals.length, 1);
  assert.match(r.refusals[0], /unsigned or signature invalid — apksigner: ERROR: Missing META-INF\/MANIFEST\.MF/);
});

test('a debuggable APK is refused even when properly signed; a non-true value is not read as false', () => {
  assert.deepEqual(judge(SIGNED_36(), manifest('true')).refusals, ['debuggable (android:debuggable=true)']);
  assert.match(judge(SIGNED_36(), manifest('@0x7f050001')).refusals[0], /debuggable is @0x7f050001, not false/);
});

test('an APK signed with the SDK debug key is refused, by DN', () => {
  const r = judge(DEBUG_SIGNED, manifest());
  assert.deepEqual(r.refusals, ['signed with the SDK debug key (CN=Android Debug, O=Android, C=US)']);
  assert.deepEqual(judge(SIGNED_36(FAKE, 'CN=Android Debugger Fan Club'), manifest()).refusals, [], 'control: the DN must BE the debug CN, not start with it');
});

test('--expect-signer pins the certificate', () => {
  assert.deepEqual(judge(SIGNED_36(), manifest(), { expectSigner: FAKE }).refusals, []);
  assert.match(judge(SIGNED_36(), manifest(), { expectSigner: OTHER }).refusals[0], new RegExp(`signer ${FAKE} is not the expected ${OTHER}`));
});

test('37’s per-scheme blocks are one signer, not two; two different certificates are two', () => {
  assert.equal(parseVerify(SIGNED_37_V2V3).signers.length, 1);
  const two = { status: 0, output: `Verifies\nNumber of signers: 2\nSigner #1 certificate DN: CN=A\nSigner #1 certificate SHA-256 digest: ${FAKE}\nSigner #2 certificate DN: CN=B\nSigner #2 certificate SHA-256 digest: ${OTHER}\n` };
  assert.deepEqual(judge(two, manifest()).refusals, ['2 signers — a release APK has one']);
});

test('instrument controls: Verifies with no signer read, and a manifest with no <application>, are refusals, not passes', () => {
  assert.match(judge({ status: 0, output: 'Verifies\n' }, manifest()).refusals[0], /no signer certificate was read/);
  assert.match(judge(SIGNED_36(), UNREADABLE).refusals[0], /not readable as an APK/);
  assert.match(judge(SIGNED_36(), { status: 0, output: '  E: manifest (line=1)\n' }).refusals[0], /not readable as an APK/, 'an absent debuggable counts only once <application> was seen');
});

test('a signed APK still named UNSIGNED is refused; an unsigned one is refused for being unsigned, once', () => {
  const r = judgeApk({ path: 'Sidekick-2.0.1-android-UNSIGNED-bcb92ec.apk', verify: SIGNED_36(), manifest: manifest() });
  assert.match(r.refusals.join(' '), /still says UNSIGNED/);
  const u = judgeApk({ path: 'Sidekick-2.0.1-android-UNSIGNED-bcb92ec.apk', verify: UNSIGNED, manifest: manifest() });
  assert.equal(u.refusals.length, 1);
});

// ---- Layer 2: real tools over real (unsigned) APKs ----

const tools = findBuildTools();
const sdk = tools ? join(tools, '..', '..') : null;
const platforms = sdk && existsSync(join(sdk, 'platforms')) ? readdirSync(join(sdk, 'platforms')).filter((p) => existsSync(join(sdk, 'platforms', p, 'android.jar'))).sort() : [];
const androidJar = platforms.length ? join(sdk, 'platforms', platforms.at(-1), 'android.jar') : null;
const noSdk = !tools || !androidJar ? `no Android SDK here (build-tools ${tools ?? 'missing'}, android.jar ${androidJar ?? 'missing'})` : false;

function linkApk(dir, name, debuggable) {
  const m = join(dir, `${name}.xml`);
  const attr = debuggable === undefined ? '' : ` android:debuggable="${debuggable}"`;
  writeFileSync(m, `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="test.fixture.apk" android:versionName="0.0.1"><uses-sdk android:minSdkVersion="29" android:targetSdkVersion="36"/><application${attr}/></manifest>`);
  const out = join(dir, `${name}.apk`);
  const r = spawnSync(join(tools, 'aapt2'), ['link', '-I', androidJar, '--manifest', m, '-o', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, `aapt2 link failed: ${r.stderr}`);
  return out;
}

test('real tools: unsigned and debuggable are both read off real APKs, and a non-APK is unreadable', { skip: noSdk }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'share-apks-'));
  const build = mkdtempSync(join(tmpdir(), 'share-apks-src-'));
  mkdirSync(join(dir, 'Intel-untested'));
  const fromBuild = (name, d) => copyFileSync(linkApk(build, name, d), join(name === 'nested' ? join(dir, 'Intel-untested') : dir, `${name}.apk`));
  fromBuild('debuggable', true);
  fromBuild('release', false);
  fromBuild('nested', undefined);
  writeFileSync(join(dir, 'not-a-zip.APK'), 'this is text, not an APK');
  writeFileSync(join(dir, 'README.txt'), 'not an apk, not counted');

  const r = checkShareApks(dir, { tools });
  const by = Object.fromEntries(r.results.map((a) => [a.path, a]));
  assert.deepEqual(Object.keys(by).sort(), ['Intel-untested/nested.apk', 'debuggable.apk', 'not-a-zip.APK', 'release.apk']);
  assert.equal(by['debuggable.apk'].debuggable, 'true');
  assert.equal(by['debuggable.apk'].refusals.length, 2, by['debuggable.apk'].refusals.join(' | '));
  assert.equal(by['release.apk'].debuggable, 'false', 'control: the real dump discriminates true from false');
  assert.deepEqual(by['release.apk'].refusals.map((x) => x.split(' — ')[0]), ['unsigned or signature invalid']);
  assert.equal(by['Intel-untested/nested.apk'].debuggable, 'absent');
  assert.match(by['not-a-zip.APK'].refusals.join(' '), /not readable as an APK/);

  const cli = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', env: { ...process.env, CONNECTSUITE_BUILD_TOOLS: tools } });
  assert.equal(cli.status, 1, cli.stdout);
  assert.match(cli.stdout, /4 of 4 APK\(s\) must not be shared/);
});

test('CLI: no APK is exit 2, missing tools are exit 2, a bad --expect-signer is exit 2', () => {
  const empty = mkdtempSync(join(tmpdir(), 'share-apks-empty-'));
  writeFileSync(join(empty, 'README.txt'), 'no apk here');
  const toolsEnv = { ...process.env, CONNECTSUITE_BUILD_TOOLS: tools ?? empty };
  const none = spawnSync(process.execPath, [SCRIPT, empty], { encoding: 'utf8', env: toolsEnv });
  assert.equal(none.status, 2, none.stdout);
  if (tools) assert.match(none.stdout, /COULD NOT CHECK — the folder holds no \.apk/);
  const noTools = spawnSync(process.execPath, [SCRIPT, empty], { encoding: 'utf8', env: { ...process.env, CONNECTSUITE_BUILD_TOOLS: empty } });
  assert.equal(noTools.status, 2);
  assert.match(noTools.stdout, /COULD NOT CHECK — no Android build-tools/);
  const bad = spawnSync(process.execPath, [SCRIPT, empty, '--expect-signer', 'abc'], { encoding: 'utf8', env: toolsEnv });
  assert.equal(bad.status, 2);
});

// ---- Layer 3: the repo's own signed build outputs, when they exist ----

const debugApk = join(REPO, 'app/build/outputs/apk/debug/app-debug.apk');
const releaseApk = join(REPO, 'app/build/outputs/apk/release/app-release.apk');

test('real debug build: refused for the debug key and for debuggable', { skip: noSdk || (!existsSync(debugApk) && 'no app-debug.apk in app/build/outputs') }, () => {
  const r = checkApk(debugApk, tools);
  assert.equal(r.signers.length, 1, 'the real signer line was parsed');
  assert.match(r.refusals.join(' | '), /debuggable \(android:debuggable=true\)/);
  assert.match(r.refusals.join(' | '), /signed with the SDK debug key/);
});

test('real release build: a release-signed APK passes, and pinning another signer refuses it', { skip: noSdk || (!existsSync(releaseApk) && 'no app-release.apk in app/build/outputs') }, (t) => {
  const r = checkApk(releaseApk, tools);
  if (/unsigned or signature invalid/.test(r.refusals.join(' '))) return t.skip('app-release.apk is an unsigned assembleRelease output — nothing signed to test');
  assert.deepEqual(r.refusals, []);
  assert.equal(r.signers.length, 1, 'the real signer line was parsed');
  assert.match(checkApk(releaseApk, tools, OTHER).refusals.join(' '), /is not the expected/);
});
