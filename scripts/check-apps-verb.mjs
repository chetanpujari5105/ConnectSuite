#!/usr/bin/env node
/**
 * `apps.launch` may never reach shipping source, on either side.
 *
 * ### Why a rule that "exactly one of two names ships" needs a check
 *
 * `docs/protocol.md` carried both names before the measurement, deliberately, so that a refusal
 * could not be absorbed into a verb promising more than the platform allows. The measurement
 * (`docs/phase-7-apps-proposal.md` §2.4) landed on the notification path, so the contract now says
 * `apps.launch` is *not implemented, not advertised, and not defined* — and that sentence is a rule
 * enforced by someone remembering, which `CLAUDE.md` is explicit about the worth of.
 *
 * What makes it likelier than most to be broken is that the name is *better* than the one that
 * ships. `apps.launch` is shorter, reads as the obvious verb, and is what anyone would autocomplete
 * to. The rule is not defending against carelessness; it is defending against the more attractive
 * option.
 *
 * And the failure would be silent in the specific way this repo keeps writing rules about. Adding
 * the constant breaks nothing. Registering a handler for it breaks nothing. It is only wrong at the
 * far end, where a Mac dims a tile because the launch "succeeded" and a person watches an app not
 * open.
 *
 * ### The discriminator, and why the easy one is worse than none
 *
 * A grep for `apps.launch` fires on this file, on `docs/protocol.md`'s section explaining the
 * prohibition, on the proposal that measured it, and on every comment justifying the absence. That
 * is defect 41 exactly — the force-stop hook that denied every command talking *about* force-stop,
 * including the commit writing the document that explained it. **A guard that forbids writing its
 * own other half has broken the pair it is supposed to be.**
 *
 * So this separates a *use* from a *mention*, and the split is syntactic:
 *
 *  - a **use** is the wire literal in quotes — `'apps.launch'`, `"apps.launch"` — or an identifier
 *    `APPS_LAUNCH` / `appsLaunch` / `appLaunch`. Those are the only shapes that can reach a socket.
 *  - a **mention** is the name in a comment or in Markdown. Free, everywhere, always.
 *
 * Comments are stripped before matching, so the KDoc on `MessageType.APPS_OPEN_ASK` explaining why
 * its sibling is absent stays legal — which it must, because that comment is the most valuable
 * sentence in the namespace.
 *
 * ### What it does not claim
 *
 * It sees source. It cannot see a string assembled at runtime (`'apps.' + verb`), and says so on
 * every run rather than leaving the reader to assume completeness — `CLAUDE.md`'s rule that every
 * bound an instrument imposes must appear in what it reports. A guard is not a proof.
 *
 * Fixtures are in `check-apps-verb.test.mjs`, each carrying its opposite, including the two that
 * matter most: prose about `apps.launch` must pass, and a constant declaring it must fail.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Shipping source on both sides. Docs are absent on purpose: prose is where the argument lives. */
const SEARCH = [
  { dir: 'desktop/src', exts: ['.ts'] },
  { dir: 'core/src', exts: ['.kt'] },
  { dir: 'sync-module/src', exts: ['.kt'] },
  { dir: 'app/src', exts: ['.kt'] },
  { dir: 'mirror-module/src', exts: ['.kt'] },
  { dir: 'input-module/src', exts: ['.kt'] },
];

/**
 * This file and its fixtures, which have to write the forbidden shapes to test for them.
 *
 * Not under `SEARCH` anyway — they live in `scripts/` — and listed here so that moving the guard
 * into the tree does not silently make it deny itself.
 */
export const SELF = ['scripts/check-apps-verb.mjs', 'scripts/check-apps-verb.test.mjs'];

/**
 * Uses, never mentions. Each is a shape that can put the name on a socket.
 *
 * The identifier pattern requires a word boundary on both sides so `APPS_LAUNCHER_FOO` — a name
 * about launchers rather than about the verb — is not caught. That is a real distinction: the
 * feature is a launcher grid, and forbidding the word *launcher* would forbid naming the thing
 * correctly. Its fixture is in the test.
 */
export const PATTERNS = [
  {
    what: "the wire literal — this is the only shape that reaches a socket",
    re: /(['"`])apps\.launch\1/g,
  },
  {
    what: 'an identifier that would carry the verb',
    re: /\b(APPS_LAUNCH|appsLaunch|appLaunch)\b/g,
  },
];

/**
 * Comments out, string literals kept.
 *
 * Deliberately crude and deliberately biased toward **over**-reporting: a `//` inside a string
 * (a URL, say) truncates that line early and could hide a use that follows it on the same line.
 * The bias is the right way round — a guard that occasionally demands a second look is recoverable,
 * one that occasionally misses the thing it exists for is not — and this is stated rather than left
 * for someone to discover, because an unstated bound read as a clean result is this repo's most
 * repeated failure.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^([^\n]*?)\/\/[^\n]*$/gm, (_line, before) => before);
}

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

/** Findings in one file's text. Exported so the fixtures drive the real matcher, not a copy. */
export function findingsIn(rel, source) {
  const code = stripComments(source);
  const found = [];
  for (const { what, re } of PATTERNS) {
    for (const match of code.matchAll(new RegExp(re.source, re.flags))) {
      found.push({
        file: rel,
        line: code.slice(0, match.index).split('\n').length,
        text: match[0].trim(),
        what,
      });
    }
  }
  return found;
}

export function scan(root = ROOT) {
  const findings = [];
  let filesRead = 0;
  for (const { dir, exts } of SEARCH) {
    for (const file of walk(join(root, dir), exts)) {
      const rel = relative(root, file).split('\\').join('/');
      if (SELF.includes(rel)) continue;
      filesRead += 1;
      findings.push(...findingsIn(rel, readFileSync(file, 'utf8')));
    }
  }
  return { findings, filesRead };
}

if (process.argv[1] && process.argv[1].endsWith('check-apps-verb.mjs')) {
  const { findings, filesRead } = scan();

  console.log(`apps-verb scan: ${filesRead} source files read on both sides`);
  console.log('  bound: source text only — a name assembled at runtime is not visible here');

  // The instrument's own control. A scan that read nothing prints a clean pass, and a clean pass
  // from a run that did not happen is the stale-results-XML row of CLAUDE.md's table.
  if (filesRead < 50) {
    console.log('  INSTRUMENT FAILURE: too few files read — the scan is looking in the wrong place');
    process.exit(1);
  }

  if (findings.length === 0) {
    console.log('  OK: apps.launch appears in no shipping source; apps.open.ask is the only open verb');
    process.exit(0);
  }
  for (const f of findings) {
    console.log(`  FAIL: ${f.file}:${f.line} uses \`${f.text}\` — ${f.what}`);
  }
  process.exit(1);
}
