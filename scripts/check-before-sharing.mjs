#!/usr/bin/env node
/**
 * The one command to run before a folder goes to testers: both share checks, one verdict (2026-10-14).
 *
 *   node scripts/check-before-sharing.mjs <folder> [--expect-signer <certificate SHA-256>]
 *   # exit 0 both passed, 1 at least one refused, 2 neither refused but at least one could not check
 *
 * It runs `check-share-folder.mjs` (no token, no private key) and `check-share-apks.mjs` (every APK signed,
 * not debug-signed, not debuggable) as separate processes, prints each one's own output in full, and combines
 * their exit codes. The two stay separate scripts on purpose — the owner's decision, 2026-10-14 — so each keeps
 * its own fixtures and its own meaning, and this file holds no rule of its own beyond the combining.
 *
 * **A refusal outranks a could-not-check.** A folder holding a token and no APK is refused, not "could not
 * check": something in it must leave whatever else is true. And a could-not-check is never a pass — a folder
 * with no APK in it has not been shown to carry a signed one.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const CHECKS = [
  { name: 'check-share-folder', script: join(HERE, 'check-share-folder.mjs'), passesSigner: false },
  { name: 'check-share-apks', script: join(HERE, 'check-share-apks.mjs'), passesSigner: true },
];

/** Exit codes in, one verdict out. Anything other than 0, 1 or 2 (a crash, a signal) is a could-not-check. */
export function combine(codes) {
  if (codes.some((c) => c === 1)) return 1;
  if (codes.some((c) => c !== 0)) return 2;
  return codes.length ? 0 : 2;
}

export function runChecks(dir, expectSigner = null, checks = CHECKS) {
  return checks.map((c) => {
    const args = [c.script, dir, ...(c.passesSigner && expectSigner ? ['--expect-signer', expectSigner] : [])];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { name: c.name, code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  });
}

if (process.argv[1] && process.argv[1].endsWith('check-before-sharing.mjs')) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--expect-signer');
  const expectSigner = at === -1 ? null : args[at + 1] ?? '';
  if (at !== -1) args.splice(at, 2);
  const dir = args[0];
  if (!dir) {
    console.log('usage: node scripts/check-before-sharing.mjs <folder> [--expect-signer <certificate SHA-256>]');
    process.exit(2);
  }
  const results = runChecks(dir, expectSigner);
  for (const r of results) {
    console.log(`── ${r.name} (exit ${r.code})`);
    console.log(r.output.trimEnd());
  }
  const verdict = combine(results.map((r) => r.code));
  const word = { 0: 'OK — both checks passed', 1: 'REFUSED — do not share this folder yet', 2: 'COULD NOT CHECK — not a pass' }[verdict];
  console.log(`── before sharing: ${word} (${results.map((r) => `${r.name} ${r.code}`).join(', ')})`);
  process.exit(verdict);
}
