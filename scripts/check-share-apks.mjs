#!/usr/bin/env node
/**
 * Every APK in a folder about to be shared must be signed, not debug-signed, and not debuggable (2026-10-14).
 *
 *   node scripts/check-share-apks.mjs <folder> [--expect-signer <certificate SHA-256>]
 *   # exit 0 every APK passes, 1 at least one refused, 2 could not check
 *
 * ### Why
 *
 * The beta share folder carries `Sidekick-2.0.1-android-UNSIGNED-bcb92ec.apk`, and an unsigned APK cannot be
 * installed by anyone — `INSTALL_PARSE_FAILED_NO_CERTIFICATES`, measured on hardware 2026-09-02 (D13). The file
 * name says so, which is the only reason nobody has sent it yet. When the owner signs it, three slips are
 * cheap and silent: the unsigned copy left beside the signed one, a debug build copied in instead of the
 * release (debuggable, and signed with the public `Android Debug` key every SDK ships), or an APK signed with
 * a key other than the one every later update must match. None of them errors anywhere; each is found by a
 * tester, or by the second update.
 *
 * ### What it refuses, per `*.apk` (case-insensitive, subfolders included, links not followed)
 *
 *  - `apksigner verify` does not say `Verifies` — unsigned, or a signature that no longer matches the bytes;
 *  - a signer whose certificate DN carries `CN=Android Debug` — the SDK's debug key, which is not a release key;
 *  - with `--expect-signer`, a signer whose certificate SHA-256 is not the one given;
 *  - `android:debuggable` anything but false (absent means false — the platform default);
 *  - a manifest `aapt2` cannot read, or one with no `<application>` element — not readable as an APK;
 *  - a signed APK whose file name still says `UNSIGNED`, which is a tester reading the wrong instruction.
 *
 * ### The instruments, and what they cannot prove
 *
 * It runs the SDK's own `apksigner verify -v --print-certs` and `aapt2 dump xmltree` — the tools Android's
 * installer logic is built from, and the ones every release-candidate record in `docs/` already uses. They are
 * found under `$ANDROID_HOME`, `$ANDROID_SDK_ROOT` or `~/Library/Android/sdk` (newest `build-tools/` holding
 * both), or at `$CONNECTSUITE_BUILD_TOOLS`, and the folder used is printed. Missing tools are exit 2, never a pass.
 *
 * `Verifies` is a statement about the APK's signature against its own `minSdkVersion`. It is **not** a statement
 * that a phone will install it: Play Protect, Android developer verification (2027) and a different signer
 * already installed are all decided on the phone. Only an install proves an install.
 *
 * Its own control: a manifest dump must contain an `<application>` element before an absent `debuggable` is
 * read as false, and a `Verifies` must come with at least one signer line before it counts — an instrument that
 * returned nothing is not a clean APK. A folder with no APK is exit 2: a pass over zero APKs is a green over nothing.
 *
 * It does not sign anything and cannot: signing is the owner's act (`scripts/hooks/no-release-signing.sh`).
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * `apksigner verify -v --print-certs`, stdout and stderr together, JVM warnings dropped.
 *
 * Two line formats, both read: build-tools 36 prints `Signer #1 certificate DN: …`, and 37 prints
 * `V3.0 Signer: certificate DN: …` — once per scheme, so a v2+v3 APK names its one certificate twice. Signers
 * are therefore counted by distinct certificate, beside apksigner's own `Number of signers:`. Found on this
 * script's first real run: 37 is the newest build-tools here, and the 36-only parser read no signer at all —
 * which the "Verifies with no signer read" refusal caught rather than passing.
 */
export function parseVerify({ status, output }) {
  const lines = output.split('\n').map((l) => l.trimEnd()).filter((l) => l && !/^WARNING: /.test(l));
  const verifies = status === 0 && lines.includes('Verifies');
  const blocks = new Map();
  for (const l of lines) {
    const m = /^(.*?Signer(?: #\d+)?):? certificate (DN|SHA-256 digest): (.*)$/.exec(l);
    if (!m) continue;
    const s = blocks.get(m[1]) ?? {};
    if (m[2] === 'DN') s.dn = m[3];
    else s.sha256 = m[3].toLowerCase();
    blocks.set(m[1], s);
  }
  const signers = [...new Map([...blocks.values()].map((s) => [s.sha256 ?? `?${s.dn}`, s])).values()];
  const declared = /^Number of signers: (\d+)$/m.exec(lines.join('\n'));
  const schemes = lines
    .map((l) => /^Verified using (v[\d.]+) scheme .*: true$/.exec(l))
    .filter(Boolean)
    .map((m) => m[1]);
  const error = lines.find((l) => /^ERROR: /.test(l)) ?? (verifies ? null : lines[0] ?? `apksigner exited ${status} with no output`);
  return { verifies, signers, signerCount: Math.max(signers.length, declared ? Number(declared[1]) : 0), schemes, error };
}

/** `aapt2 dump xmltree --file AndroidManifest.xml`. */
export function parseManifest({ status, output }) {
  const sawApplication = status === 0 && /^\s*E: application \(/m.test(output);
  const dbg = /:debuggable\(0x0101000f\)=(\S+)/.exec(output);
  const pkg = /^\s*A: package="([^"]*)"/m.exec(output);
  const version = /:versionName\(0x0101021c\)="([^"]*)"/.exec(output);
  return {
    sawApplication,
    debuggable: dbg ? dbg[1] : 'absent',
    package: pkg ? pkg[1] : null,
    versionName: version ? version[1] : null,
  };
}

/** The decision, over tool output already captured — pure, so the fixtures need no SDK. */
export function judgeApk({ path, verify, manifest, expectSigner = null }) {
  const v = parseVerify(verify);
  const m = parseManifest(manifest);
  const refusals = [];

  if (!m.sawApplication) refusals.push('aapt2 could not read an <application> element — not readable as an APK');
  else if (m.debuggable !== 'absent' && m.debuggable !== 'false') {
    refusals.push(m.debuggable === 'true' ? 'debuggable (android:debuggable=true)' : `android:debuggable is ${m.debuggable}, not false`);
  }

  if (!v.verifies) refusals.push(`unsigned or signature invalid — apksigner: ${v.error}`);
  else if (v.signers.length === 0 || v.signers.some((s) => !s.sha256 || !SHA256.test(s.sha256))) {
    refusals.push('apksigner said Verifies but no signer certificate was read — the check could not confirm the signer');
  } else {
    for (const s of v.signers) {
      if (/(^|,\s*)CN=Android Debug(,|$)/.test(s.dn ?? '')) refusals.push(`signed with the SDK debug key (${s.dn})`);
      if (expectSigner && s.sha256 !== expectSigner) refusals.push(`signer ${s.sha256} is not the expected ${expectSigner}`);
    }
    if (v.signerCount > 1) refusals.push(`${v.signerCount} signers — a release APK has one`);
    if (/unsigned/i.test(basename(path))) refusals.push('signed, but the file name still says UNSIGNED — rename it, and remove any unsigned copy');
  }

  return { path, refusals, package: m.package, versionName: m.versionName, debuggable: m.debuggable, schemes: v.schemes, signers: v.signers };
}

const versionKey = (name) => name.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
function newerFirst(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** The newest build-tools folder holding both `apksigner` and `aapt2`, or null. */
export function findBuildTools(env = process.env) {
  if (env.CONNECTSUITE_BUILD_TOOLS !== undefined) {
    const d = env.CONNECTSUITE_BUILD_TOOLS;
    return existsSync(join(d, 'apksigner')) && existsSync(join(d, 'aapt2')) ? d : null;
  }
  const sdks = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, join(homedir(), 'Library/Android/sdk')].filter(Boolean);
  for (const sdk of sdks) {
    const root = join(sdk, 'build-tools');
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).sort(newerFirst)) {
      const d = join(root, v);
      if (existsSync(join(d, 'apksigner')) && existsSync(join(d, 'aapt2'))) return d;
    }
  }
  return null;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { status: -1, output: `could not run ${cmd}: ${r.error.message}` };
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Runs both instruments over one APK on disk and judges it. */
export function checkApk(path, tools, expectSigner = null) {
  const verify = run(join(tools, 'apksigner'), ['verify', '-v', '--print-certs', path]);
  const manifest = run(join(tools, 'aapt2'), ['dump', 'xmltree', '--file', 'AndroidManifest.xml', path]);
  return judgeApk({ path, verify, manifest, expectSigner });
}

function walk(dir, out = { apks: [], links: 0 }) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) out.links++;
    else if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && /\.apk$/i.test(e.name)) out.apks.push(p);
  }
  return out;
}

export function checkShareApks(dir, { tools = findBuildTools(), expectSigner = null } = {}) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { error: `not a folder: ${dir}` };
  if (!tools) return { error: 'no Android build-tools with both apksigner and aapt2 (set $ANDROID_HOME or $CONNECTSUITE_BUILD_TOOLS)' };
  const { apks, links } = walk(dir);
  const results = apks.sort().map((p) => ({ ...checkApk(p, tools, expectSigner), path: relative(dir, p), bytes: statSync(p).size }));
  return { tools, links, results };
}

if (process.argv[1] && process.argv[1].endsWith('check-share-apks.mjs')) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--expect-signer');
  let expectSigner = null;
  if (at !== -1) {
    expectSigner = (args[at + 1] ?? '').replace(/:/g, '').toLowerCase();
    args.splice(at, 2);
    if (!SHA256.test(expectSigner)) {
      console.log('check-share-apks: --expect-signer needs a certificate SHA-256 (64 hex digits, colons allowed)');
      process.exit(2);
    }
  }
  const dir = args[0];
  if (!dir) {
    console.log('usage: node scripts/check-share-apks.mjs <folder> [--expect-signer <certificate SHA-256>]');
    process.exit(2);
  }
  const r = checkShareApks(dir, { expectSigner });
  if (r.error) {
    console.log(`share APKs: COULD NOT CHECK — ${r.error}`);
    process.exit(2);
  }
  console.log(`share APKs: ${r.results.length} APK(s) found; ${r.links} symbolic link(s) not followed; tools ${r.tools}`);
  console.log(`  signer expected: ${expectSigner ?? 'not given — any non-debug signer passes (pass --expect-signer to pin it)'}`);
  if (r.results.length === 0) {
    console.log('  COULD NOT CHECK — the folder holds no .apk');
    process.exit(2);
  }
  for (const a of r.results) {
    const signer = a.signers.length ? a.signers.map((s) => `${s.sha256} (${s.dn})`).join('; ') : 'none';
    console.log(`  ${a.refusals.length ? 'REFUSED' : 'OK     '} ${a.path} — ${a.bytes} bytes, ${a.package ?? '?'} ${a.versionName ?? '?'}, debuggable=${a.debuggable}, schemes=${a.schemes.join('+') || 'none'}`);
    console.log(`          signer: ${signer}`);
    for (const why of a.refusals) console.log(`          - ${why}`);
  }
  const refused = r.results.filter((a) => a.refusals.length).length;
  if (refused) {
    console.log(`  ${refused} of ${r.results.length} APK(s) must not be shared as they are.`);
    process.exit(1);
  }
  console.log(`  OK: ${r.results.length} of ${r.results.length} signed, not debug-signed, not debuggable. Only an install on a phone proves an install.`);
}
