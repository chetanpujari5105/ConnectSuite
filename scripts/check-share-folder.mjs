#!/usr/bin/env node
/**
 * A folder about to be shared with testers may hold no token and no private key (2026-10-14).
 *
 *   node scripts/check-share-folder.mjs <folder>      # exit 0 clean, 1 refused, 2 could not check
 *
 * ### Why
 *
 * The beta share folder carried the owner's own `chetan-owner.sidekick-token` for two days while its
 * README told testers *"it is not in this folder"*. A token is not secret in the cryptographic sense —
 * it is signed, not encrypted — but it is **one person's 45 days of access**, and anyone holding the
 * folder could have used it. The signing key would be far worse: every token ever issued, forged at
 * will. Neither belongs in anything handed to a tester, and a copy step is exactly where one slips in.
 *
 * ### What it refuses
 *
 *  - any file named `*.sidekick-token`, whatever is inside;
 *  - any file whose **contents** carry a complete token (`SIDEKICK-TRIAL-1.<payload>.<86-char signature>`)
 *    — a token pasted into a README or a note. The bare prefix, which the README explains, is fine;
 *  - any file whose **contents** `findPrivateKeys` refuses — the same definition the commit guard uses
 *    (`check-no-private-keys.mjs`), so there is one list of what a key looks like, not two. Its file-name
 *    rule is not applied here: the first real run refused certifi's `cacert.pem`, a public CA bundle
 *    inside a project folder, by name alone. In a share folder the question is what a file holds.
 *
 * Every file is read, binaries included. **A bound worth saying:** a `.dmg` is compressed, so its bytes
 * are scanned but the app inside is not — the release-candidate checks scan the `.app` bundles, the asar
 * and the zips for key material before a DMG ever reaches this folder.
 *
 * It prints the files and bytes it read beside the verdict, and refuses to say "clean" about a folder
 * it could not read or that held nothing: a pass over zero files is a green over nothing.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findPrivateKeys } from './check-no-private-keys.mjs';

const TOKEN = /SIDEKICK-TRIAL-1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{86}/;

/** The decision, over entries already read — pure, so the fixtures never put a key on disk. */
export function checkShareEntries(entries) {
  const refusals = [];
  let bytes = 0;
  for (const { path, data } of entries) {
    bytes += data.length;
    const reasons = [];
    if (/\.sidekick-token$/i.test(path)) reasons.push('a beta token file (*.sidekick-token)');
    const text = data.toString('latin1');
    if (TOKEN.test(text)) reasons.push('contains a complete beta token');
    // An empty path: the contents rules only, not the commit guard's file-name rule (see the header).
    for (const r of findPrivateKeys(text, '')) reasons.push(r);
    if (reasons.length) refusals.push({ path, reasons });
  }
  return { files: entries.length, bytes, refusals };
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) out.push({ path: p, link: true });
    else if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push({ path: p, link: false });
  }
  return out;
}

export function checkShareFolder(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { error: `not a folder: ${dir}` };
  const found = walk(dir);
  // Links are not followed — what they point at is outside the folder — but they are counted and reported,
  // and a link *named* like a token file is still refused.
  const links = found.filter((f) => f.link).map((f) => relative(dir, f.path));
  const entries = found.filter((f) => !f.link).map((f) => ({ path: relative(dir, f.path), data: readFileSync(f.path) }));
  const result = checkShareEntries(entries);
  const linkRefusals = links.filter((p) => /\.sidekick-token$/i.test(p)).map((path) => ({ path, reasons: ['a link named as a beta token file'] }));
  return { ...result, linksSkipped: links.length, refusals: [...linkRefusals, ...result.refusals] };
}

if (process.argv[1] && process.argv[1].endsWith('check-share-folder.mjs')) {
  const dir = process.argv[2];
  if (!dir) {
    console.log('usage: node scripts/check-share-folder.mjs <folder>');
    process.exit(2);
  }
  const r = checkShareFolder(dir);
  if (r.error) {
    console.log(`share folder: COULD NOT CHECK — ${r.error}`);
    process.exit(2);
  }
  console.log(`share folder: ${r.files} files, ${(r.bytes / 1e6).toFixed(1)} MB read; ${r.linksSkipped} symbolic link(s) not followed (DMG contents are compressed and not opened here)`);
  if (r.files === 0) {
    console.log('  COULD NOT CHECK — the folder holds no files');
    process.exit(2);
  }
  if (r.refusals.length) {
    for (const f of r.refusals) console.log(`  REFUSED: ${f.path} — ${f.reasons.join('; ')}`);
    console.log(`  ${r.refusals.length} file(s) must leave the folder before it is shared.`);
    process.exit(1);
  }
  console.log('  OK: no *.sidekick-token file, no complete token, no private key.');
}
