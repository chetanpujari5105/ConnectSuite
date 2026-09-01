#!/usr/bin/env node
/**
 * The echo interlock has exactly one home per side, and this is what says so.
 *
 * ### Why the rule needs a check rather than a comment
 *
 * Auto-apply took the person out of the clipboard loop on both ends. Before it, a cycle needed a
 * human to press a button once per hop, which is not a cycle; after it, the only thing standing
 * between two auto-applying clipboards and a runaway is the comparison in `ClipEcho`. That rule is
 * now load-bearing, and a load-bearing rule with two homes has one that is tested and one that is
 * real — with nothing to say which is which until they disagree.
 *
 * That is not hypothetical here. The rule *did* live in two places: `shouldSend` in
 * `clipboardHistory.ts` and `ClipboardPayloads.shouldSend` on the phone, each with its own passing
 * test. When the rule moved into `ClipEcho`, both would have gone on passing over functions nothing
 * called — green tests over dead code, indistinguishable at a glance from green tests over live
 * code. They were deleted; this stops the third one.
 *
 * ### What it looks for, and why that discriminator and not an easier one
 *
 * Declarations of `lastReceived` / `lastSent`, and any reappearance of a `shouldSend` function. Not
 * *mentions*: both names appear all over the comments that explain the rule, including in this
 * file, and a checker that counted occurrences would forbid writing the argument for the thing it
 * is guarding — which is defect 41 exactly, the force-stop hook that denied every command talking
 * about force-stop, including the commit writing the doc that explained it.
 *
 * So it matches **declaration syntax**: `private lastReceived`, `var lastSent`, `let lastSent =`,
 * `function shouldSend`, `fun shouldSend`. A comment saying the words is fine. A second field
 * holding the value is not.
 *
 * Fixtures are in `check-clip-echo.test.mjs`, and each carries its opposite. A matcher without
 * fixtures is a rule you are guessing about.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The two files allowed to hold the interlock — one per runtime, no shared runtime between them. */
export const HOMES = [
  'desktop/src/shared/clipEcho.ts',
  'sync-module/src/main/java/com/chetan/connectsuite/sync/v2/ClipEcho.kt',
];

// Tests are scanned too, and deliberately. A test that declares its own `lastReceived` to model
// the rule instead of calling it is the exact failure this repo has already paid for once
// (`MediaPayloadsTest` wrote the cursor predicate a second time and stayed green with the real one
// deleted). The cycle proof's adversary is allowed to be a model of the *peer*; nothing is allowed
// to be a second model of the interlock.
const SEARCH = [
  { dir: 'desktop/src', exts: ['.ts'] },
  { dir: 'sync-module/src/main', exts: ['.kt'] },
  { dir: 'sync-module/src/test', exts: ['.kt'] },
  { dir: 'core/src/test', exts: ['.kt'] },
  { dir: 'core/src/main', exts: ['.kt'] },
  { dir: 'app/src/main', exts: ['.kt'] },
  { dir: 'mirror-module/src/main', exts: ['.kt'] },
];

/**
 * Declarations only. The names are free to appear in prose — this file is full of them.
 *
 * `lastSentPreview` and friends must not match: the phone's `PhoneState` legitimately carries a
 * preview of the last sent entry for its own card, which is a *display* value and not the
 * interlock. The trailing boundary is what keeps those out, and the test carries that fixture.
 */
export const PATTERNS = [
  // A declaration at the head of a line: Kotlin's `private var lastSent`, TypeScript's
  // `private lastReceived: string | null` — which carries **no** `let`/`var`/`const` keyword at all,
  // and was the case the first version of this matcher missed. Its fixture is what found that.
  {
    what: 'a second home for the interlock',
    re: /^[ \t]*(?:(?:@Volatile|private|public|protected|internal|static|readonly|declare)[ \t]+)*(?:val|var|let|const)?[ \t]*(lastReceived|lastSent)[ \t]*[:=]/gm,
  },
  { what: 'a second home for the interlock', re: /\bthis\.(lastReceived|lastSent)[ \t]*=/g },
  { what: 'the echo rule restated as a free function', re: /\b(?:fun|function)[ \t]+(shouldSend)\b/g },
];

function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'build' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, exts, out);
    else if (exts.some((ext) => name.endsWith(ext))) out.push(path);
  }
  return out;
}

export function scan(root = ROOT) {
  const findings = [];
  let filesRead = 0;
  for (const { dir, exts } of SEARCH) {
    for (const file of walk(join(root, dir), exts)) {
      const rel = relative(root, file).split('\\').join('/');
      if (HOMES.includes(rel)) continue;
      filesRead += 1;
      const source = readFileSync(file, 'utf8');
      for (const { what, re } of PATTERNS) {
        for (const match of source.matchAll(new RegExp(re.source, re.flags))) {
          const line = source.slice(0, match.index).split('\n').length;
          findings.push({ file: rel, line, name: match[1], what });
        }
      }
    }
  }
  return { findings, filesRead };
}

if (process.argv[1] && process.argv[1].endsWith('check-clip-echo.mjs')) {
  const { findings, filesRead } = scan();

  // **The instrument reports its own bound.** A scan that found no files would print a clean pass,
  // and a clean pass from a scan that read nothing is the eleventh row of CLAUDE.md's table: a
  // confident number about a run that did not happen. If this count is near zero, the finding is
  // about the scan.
  console.log(`clip-echo scan: ${filesRead} files read outside the ${HOMES.length} declared homes`);
  if (filesRead < 50) {
    console.log('  INSTRUMENT FAILURE: too few files read — the scan is looking in the wrong place');
    process.exit(1);
  }

  for (const home of HOMES) {
    console.log(`  home: ${home}`);
  }

  if (findings.length === 0) {
    console.log('  OK: the interlock is declared only in its two homes');
    process.exit(0);
  }
  for (const f of findings) {
    console.log(`  FAIL: ${f.file}:${f.line} declares \`${f.name}\` — ${f.what}`);
  }
  process.exit(1);
}
