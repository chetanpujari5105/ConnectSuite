#!/usr/bin/env node
/**
 * No private key may be committed — the trial's signing key above all (2026-10-12).
 *
 *   node scripts/check-no-private-keys.mjs          # what is staged for the next commit
 *   node scripts/check-no-private-keys.mjs --tree   # every tracked file, for an audit
 *
 * The beta trial is only as good as one Ed25519 private key that lives on the owner's Mac and nowhere
 * else (`docs/trial-licence-summary-2026-10-11.md`). A key that reaches git is copied to every clone
 * and every backup of the repository, and **cannot be taken back** — rotating it means a new public
 * key in a new build and a new token for every tester. So this refuses the commit rather than warning.
 *
 * ### What it looks for
 *
 *  - a PEM private-key block of any kind (PKCS#8, RSA, EC, OpenSSH, encrypted);
 *  - the DER prefix of an Ed25519 PKCS#8 private key, in base64 and in hex — a key pasted without its
 *    PEM header;
 *  - a JWK carrying a private component (`"d"` beside `"kty"`);
 *  - a file whose **name** says it holds key material (`.pem`, `.p8`, `.p12`, `.pfx`, `.key`, `.jks`,
 *    `.keystore`, `id_rsa`, `id_ed25519`), whatever is inside — a public `.pem` is refused too, and the
 *    message says how to commit one deliberately (as base64 in source, which is how the app embeds it).
 *
 * ### The discriminator problem, solved by construction
 *
 * A checker for a header string contains that header string, and so does its test — defect 41's
 * shape, the guard that forbids writing its own other half. Here no complete pattern appears as a
 * literal anywhere: every marker is assembled from parts at run time, and the fixtures generate a
 * throwaway key **in memory** and never write it to disk. So this file, its test and the docs that
 * describe it all pass the check they describe.
 *
 * ### What it does not claim
 *
 * It reads what git would commit, as text. It cannot see a key that has been encrypted, split,
 * compressed or re-encoded beyond the shapes above, and says so on every run. A guard is not a proof;
 * keeping the key outside the repository is the real protection.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Assembled from parts so that no complete marker exists as a literal in this file.
const DASHES = '-'.repeat(5);
const PEM_PRIVATE = new RegExp(`${DASHES}BEGIN (?:[A-Z0-9]+ )*PRIVATE ${'KEY'}${DASHES}`);
const ED25519_PKCS8_B64 = 'MC4CAQAw' + 'BQYDK2VwBCIEI';
const ED25519_PKCS8_HEX = '302e0201003005' + '06032b657004220420';
const JWK_PRIVATE = /"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/;
const JWK_KTY = /"kty"\s*:/;
const KEY_FILE = /(?:\.(?:pem|p8|p12|pfx|key|jks|keystore)$)|(?:(?:^|\/)id_(?:rsa|ed25519|ecdsa)$)/i;

/**
 * Every reason `text` (the content of `path`) holds or is named like key material. Pure, so the
 * fixtures need no git. Returns `[]` for a clean file.
 */
export function findPrivateKeys(text, path = '') {
  const reasons = [];
  if (KEY_FILE.test(path)) reasons.push('a key-material file name');
  if (PEM_PRIVATE.test(text)) reasons.push('a PEM private-key block');
  if (text.includes(ED25519_PKCS8_B64)) reasons.push('an Ed25519 private key (PKCS#8, base64)');
  if (text.toLowerCase().includes(ED25519_PKCS8_HEX)) reasons.push('an Ed25519 private key (PKCS#8, hex)');
  if (JWK_PRIVATE.test(text) && JWK_KTY.test(text)) reasons.push('a JWK with a private component');
  return reasons;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 30 });
}

function main() {
  const tree = process.argv.includes('--tree');
  let paths;
  try {
    paths = tree
      ? git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)
      : git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).toString('utf8').split('\0').filter(Boolean);
  } catch (error) {
    console.log(`INSTRUMENT FAILURE: could not list ${tree ? 'tracked' : 'staged'} files — ${error.message.split('\n')[0]}`);
    process.exit(2);
  }
  const failures = [];
  let read = 0;
  for (const path of paths) {
    let text;
    try {
      // The staged blob, not the working copy: what the commit would record.
      text = (tree ? git(['show', `HEAD:${path}`]) : git(['show', `:${path}`])).toString('latin1');
    } catch (error) {
      // A path in the list that cannot be read is a hole in the reading, and is said to be one.
      console.log(`INSTRUMENT FAILURE: could not read ${path} — ${error.message.split('\n')[0]}`);
      process.exit(2);
    }
    read += 1;
    for (const reason of findPrivateKeys(text, path)) failures.push(`${path} — ${reason}`);
  }
  const scope = tree ? 'tracked files at HEAD' : 'staged files';
  console.log(`check-no-private-keys: ${read} of ${paths.length} ${scope} read; shapes: PEM private blocks, Ed25519 PKCS#8 (base64, hex), JWK "d", key-file names. Not seen: keys encrypted, split or re-encoded beyond these.`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAIL: ${f}`);
    process.exit(1);
  }
  console.log('PASS — no private key material');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
