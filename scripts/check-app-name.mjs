#!/usr/bin/env node
/**
 * The app is called **Sidekick**. A sentence a person reads must not call it ConnectSuite (2026-10-12).
 *
 *   node scripts/check-app-name.mjs
 *
 * Found by the owner in the Mac's Files pane: *"Add a folder in ConnectSuite on the phone, under Sync ›
 * Folders"* — the phone's `grantHint`, drawn verbatim. Enumerating rather than fixing the one on
 * screen found thirteen more on the phone, most of them `Settings > Apps > ConnectSuite > Permissions`:
 * an instruction to find an app by a name Android does not show (`app_name` is *Sidekick*).
 *
 * ### What counts
 *
 * **String literals in shipping source**, comments stripped — on the phone every module's
 * `src/main/**.kt`, on the Mac `desktop/src/**.ts` (tests excluded). A comment is prose for the next
 * engineer and may say anything. A literal is what can reach a screen, a notification or a log.
 *
 * The name legitimately survives in literals for technical reasons, and each is **allowed by a
 * fragment with its reason** below: the real folder `Download/ConnectSuite` (renaming it would strand
 * every file already there), wake-lock and log tags, the certificate's `O=`, the mDNS instance name,
 * the virtual display's name, and the Mac's own copy explaining the rename. An allowed fragment that
 * matches nothing fails the check, so the list cannot rot.
 *
 * ### What it does not claim
 *
 * It reads literals as written. A name assembled at run time is invisible to it, and so is any
 * Android resource (`strings.xml` holds none today; `app_name` is Sidekick).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OLD = 'ConnectSuite';

/** Allowed uses, by a fragment of the literal and the reason it may keep the old name. */
export const ALLOWED = Object.freeze([
  { fragment: 'Download › ConnectSuite', why: 'the real folder on the phone; files already there would be stranded by a rename' },
  { fragment: 'Download/ConnectSuite', why: 'the real folder on the phone, as a path' },
  { fragment: 'Downloads/ConnectSuite', why: 'the real folder on the phone, as the transfers list names it' },
  { fragment: '"/ConnectSuite"', why: 'the folder name as a path component' },
  { fragment: '~/Downloads/ConnectSuite', why: 'the Mac\'s earlier downloads folder, left where it was' },
  { fragment: 'ConnectSuite:link', why: 'wake-lock tag — shows in dumpsys, read by the battery measurements' },
  { fragment: 'ConnectSuiteLink', why: 'logcat tag the measurement scripts filter on' },
  { fragment: 'O=ConnectSuite', why: 'TLS certificate subject; changing it changes nothing a person sees' },
  { fragment: 'ConnectSuite $deviceName', why: 'mDNS service instance name, a discovery handle' },
  { fragment: '"ConnectSuite"', why: 'MediaProjection virtual display name' },
  { fragment: "'ConnectSuite'", why: 'the earlier build\'s profile and downloads folder names, which the Mac reads to migrate' },
  { fragment: 'Sidekick replaced ConnectSuite', why: 'the Mac telling a person the app was renamed — the name is the subject' },
  { fragment: 'ConnectSuite downloads folder', why: 'the Mac naming its earlier folder, which really is called that' },
  { fragment: 'ConnectSuite folder:', why: 'a log line about the legacy profile folder' },
  { fragment: 'Earlier ConnectSuite logs', why: 'a log line about the legacy log folder' },
  { fragment: 'ConnectSuite identity', why: 'a log line about the legacy identity' },
  { fragment: 'named for Sidekick’s earlier name', why: 'the Mac explaining the old folder name' },
]);

const SOURCES = [
  ...['app', 'core', 'sync-module', 'mirror-module', 'input-module', 'camera-module'].map((m) => ({ dir: `${m}/src/main`, ext: '.kt' })),
  { dir: 'desktop/src', ext: '.ts' },
];

function walk(dir, ext, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (name.endsWith(ext) && !/\.(test|testkit)\.ts$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * The string literals of a source file, comments skipped. Pure, for the fixtures.
 *
 * A scanner rather than a regex, because a regex pairs quotes across a trailing `// it's` comment and
 * then reads code as a string and strings as code — the first version did exactly that, and invented
 * two literals that are not in the file while missing a real one.
 */
export function literals(source) {
  const found = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' && source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      const stop = end < 0 ? n : end + 3;
      found.push(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && source[j] !== c) {
        if (source[j] === '\\') j += 1;
        else if (source[j] === '\n' && c !== '`') break;
        j += 1;
      }
      found.push(source.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return found;
}

/** Literals naming the old app name that no allowed fragment explains. */
export function offenders(source) {
  return literals(source).filter((lit) => lit.includes(OLD) && !ALLOWED.some((a) => lit.includes(a.fragment)));
}

function main() {
  const failures = [];
  const used = new Set();
  let files = 0;
  for (const { dir, ext } of SOURCES) {
    for (const path of walk(join(ROOT, dir), ext)) {
      files += 1;
      const text = readFileSync(path, 'utf8');
      for (const lit of literals(text)) {
        if (!lit.includes(OLD)) continue;
        // Every fragment a literal matches is credited, not only the first — or a fragment shadowed by a
        // broader one would be reported as unused and deleted while it still explains a literal.
        const allowed = ALLOWED.filter((a) => lit.includes(a.fragment));
        for (const a of allowed) used.add(a.fragment);
        if (allowed.length === 0) failures.push(`${relative(ROOT, path)}: ${lit.slice(0, 120)}`);
      }
    }
  }
  if (files < 100) {
    console.log(`INSTRUMENT FAILURE: only ${files} source files read — the scan did not see the apps`);
    process.exit(2);
  }
  for (const a of ALLOWED) if (!used.has(a.fragment)) failures.push(`allowed fragment matches nothing any more — delete it: ${a.fragment}`);
  console.log(`check-app-name: ${files} source files read (Kotlin main sources, Mac TypeScript; comments stripped); ${ALLOWED.length} allowed technical uses`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAIL: ${f}`);
    process.exit(1);
  }
  console.log('PASS — no sentence calls the app ConnectSuite');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
