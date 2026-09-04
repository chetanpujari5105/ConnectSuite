#!/usr/bin/env node
/**
 * Every message type on the wire must be *specified* in `docs/protocol.md`, not merely listed in it.
 *
 * This exists because `media.buckets`, `media.list`, `media.thumb` and `media.original` sat in the
 * contract's message-type list for an entire phase and were specified nowhere in it. Nothing in the
 * build could tell. It was found by eye, on 2026-09-01, while `fs.thumb` was being written
 * deliberately in the shape of a `media.thumb` the contract did not describe — and the note left
 * behind said the migration was *owed by whoever next touches `media.*`*, which is a rule enforced
 * by someone remembering. `CLAUDE.md` is explicit about what that is worth.
 *
 * ### The discriminator, and why a weaker one is worse than none
 *
 * The obvious check — does the type name appear in the document — passes on a passing mention. Two
 * of the four missing types *did* appear: `media.thumb` is named five times in the `fs.thumb`
 * section, in sentences about something else. A checker that counted those would have reported the
 * namespace as documented on the day it was not, which is the "clean, specific, confident wrong
 * answer" this repo keeps writing rules about.
 *
 * So a type counts as specified only where it is the **subject** of a heading or of a paragraph:
 * a line that begins with the backticked type name and follows a blank line or a heading. That is
 * how this document actually specifies things — ``### `fs.stat` ``, ``  `sms.threads` — **request**. ``
 * — and it is a property a mid-sentence mention cannot have. Markdown hard-wrapping is the reason
 * the preceding line matters: `docs/protocol.md` wraps at 100 columns, so plenty of *lines* start
 * with a backticked type in the middle of a paragraph about something else.
 *
 * The control is recorded in `docs/testing.md`: run against the tree as it stood before the
 * migration, this reports exactly the four `media.*` types — including the two that are mentioned
 * five times — and against the tree after it, none of them.
 *
 * ### Two allowlists, and they are not the same thing
 *
 * `SPECIFIED_UNDER` is for types whose home is a section named for the concept rather than for the
 * type: `ping` belongs to *Heartbeat*, `error` to *Errors*. Each names the heading it lives under
 * and the heading is checked to still exist, so a rename orphans nothing silently.
 *
 * `UNSPECIFIED` is **debt**, with a reason per entry and a count printed on every run. An entry
 * here that turns out to be specified after all is a failure, not a pass: an allowlist nobody
 * prunes is how a guard stops guarding.
 *
 * ### Failure mode
 *
 * Findings exit 1. The checker's own errors — a missing file, a parse that yields no types — print
 * `INSTRUMENT FAILURE` and exit 0, the same trade `check-defects.sh` makes: a checker that can
 * wedge the repo gets deleted by the first person it wedges. Both counts are printed on every run,
 * pass or fail, because a number with no denominator reads as whichever story you already believe.
 *
 * Usage: node scripts/check-protocol-spec.mjs   (exit 0 clean, 1 on drift)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MESSAGES_KT = 'core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt';
const PROTOCOL_MD = 'docs/protocol.md';
const PROTOCOL_TS = 'desktop/src/shared/protocol.ts';

/** Types specified under a section named for the concept. The heading must still exist. */
export const SPECIFIED_UNDER = {
  ack: '## Control channel (42501)',
  error: '## Errors',
  ping: '### Heartbeat',
  pong: '### Heartbeat',
  'capabilities.changed': '### Handshake',
};

/** Debt: named on the wire, specified nowhere. Every entry carries why. */
export const UNSPECIFIED = {
  'net.state': 'Unscheduled. No handler on either side; belongs to no capability.',
};

/**
 * Types the phone defines and the Mac deliberately does not, with the reason.
 *
 * Same shape and same rule as UNSPECIFIED: an entry here that turns up in the twin after all is a
 * failure, so the list gets pruned rather than accumulating.
 */
export const TWIN_EXEMPT = {
  'mirror.screenoff':
    'Not implemented anywhere. The phone keeps the constant so MirrorContractTest can assert it is ' +
    'never registered; the Mac has no such test and no reason to name it.',
};

/** Types deliberately absent from the document's own inventory list, with the reason it gives. */
export const NOT_IN_INVENTORY = {
  'mirror.screenoff': 'Not implemented; the document says so and says why it is absent from the list.',
};

/** Every `const val X = "…"` inside `object MessageType`. */
export function typesFrom(kotlin) {
  const start = kotlin.indexOf('object MessageType');
  if (start < 0) return [];
  const rest = kotlin.slice(start + 1);
  const end = rest.indexOf('\nobject ');
  const block = end < 0 ? rest : rest.slice(0, end);
  return [...block.matchAll(/const val [A-Z_0-9]+ = "([^"]+)"/g)].map((m) => m[1]);
}

/** Every `X: 'a.b',` inside the desktop twin's `MessageType` object. */
export function typesFromTwin(typescript) {
  const start = typescript.indexOf('export const MessageType');
  if (start < 0) return [];
  const rest = typescript.slice(start);
  const end = rest.indexOf('} as const;');
  const block = end < 0 ? rest : rest.slice(0, end);
  return [...block.matchAll(/[A-Z_0-9]+: '([^']+)'/g)].map((m) => m[1]);
}

/**
 * Splits the document into its inventory block and everything else.
 *
 * The inventory is the `### Message types` section. It is the list the missing namespaces were
 * hiding in, so it is excluded from the evidence by construction rather than by hoping nobody
 * writes a spec inside it.
 */
export function readDoc(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === '### Message types');
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^#{2,4} /.test(lines[end])) end += 1;
  return { lines, inventory: lines.slice(start, end), start, end };
}

/** The types that are the subject of a heading or paragraph outside the inventory. */
export function subjectsIn(doc) {
  const found = new Map();
  doc.lines.forEach((line, i) => {
    if (i >= doc.start && i < doc.end) return;
    const heading = /^#{2,6}\s/.test(line);
    const opensParagraph = heading || i === 0 || doc.lines[i - 1].trim() === '';
    if (!opensParagraph) return;
    const m = line.match(/^\s*(?:#{2,6}\s+)?\*{0,2}`([a-z]+(?:\.[a-z]+)+|[a-z]+)`/);
    if (m && !found.has(m[1])) found.set(m[1], i + 1);
  });
  return found;
}

/**
 * The two maps and the minimum parse are arguments so the fixtures can drive this without
 * depending on the state of the real wire. `minTypes` is the instrument's own bound and it is
 * reported: a parse that silently yields nothing would otherwise pass as "no findings", which is
 * the stale-results-XML failure this repo has already recorded once.
 */
export function check({
  kotlin,
  markdown,
  typescript = null,
  twinExempt = TWIN_EXEMPT,
  minTypes = 40,
  specifiedUnder = SPECIFIED_UNDER,
  unspecified = UNSPECIFIED,
  notInInventory = NOT_IN_INVENTORY,
}) {
  const findings = [];
  const types = typesFrom(kotlin);
  if (types.length < minTypes) {
    return {
      instrumentFailure:
        `parsed ${types.length} message types from ${MESSAGES_KT}, fewer than the ${minTypes} expected; ` +
        'nothing was checked',
    };
  }
  const doc = readDoc(markdown);
  if (!doc) return { instrumentFailure: `no "### Message types" section in ${PROTOCOL_MD}` };

  const subjects = subjectsIn(doc);
  const headings = new Set(doc.lines.filter((l) => /^#{2,6} /.test(l)).map((l) => l.trim()));
  const inventory = doc.inventory.join('\n');

  const specified = [];
  const debt = [];

  for (const type of types) {
    const home = specifiedUnder[type];
    if (home) {
      if (!headings.has(home)) {
        findings.push(`${type} is recorded as specified under "${home}", and that heading is gone from ${PROTOCOL_MD}`);
      } else {
        specified.push(type);
      }
    } else if (subjects.has(type)) {
      if (unspecified[type]) {
        findings.push(
          `${type} is on the UNSPECIFIED debt list and is in fact specified at ${PROTOCOL_MD}:${subjects.get(type)} — ` +
            'remove it from the list rather than leaving an allowlist nobody prunes',
        );
      }
      specified.push(type);
    } else if (unspecified[type]) {
      debt.push(type);
    } else {
      findings.push(
        `${type} is on the wire and is not the subject of any heading or paragraph in ${PROTOCOL_MD} — ` +
          'a mention inside a sentence about something else is not a specification',
      );
    }

    if (!inventory.includes(`\`${type}\``) && !notInInventory[type]) {
      findings.push(`${type} is missing from the "### Message types" inventory in ${PROTOCOL_MD}`);
    }
  }

  // The desktop twin. `CLAUDE.md`: shared message types are defined once per side and must stay in
  // sync with docs/protocol.md — which had never been checked, and was wrong. All three `clip.*`
  // names were specified in the contract, implemented on the phone, and absent from protocol.ts,
  // found only because a compile failed. A drift that does not happen to break a compile is
  // invisible: a Mac simply never sends the message.
  //
  // Only phone→Mac direction is checked — every type the phone knows must exist on the Mac —
  // because the Mac defines no types of its own.
  if (typescript !== null) {
    const twin = new Set(typesFromTwin(typescript));
    if (twin.size < minTypes) {
      return {
        instrumentFailure: `parsed ${twin.size} message types from ${PROTOCOL_TS}, fewer than the ${minTypes} expected`,
      };
    }
    for (const type of types) {
      if (!twin.has(type) && !twinExempt[type]) {
        findings.push(
          `${type} is in ${MESSAGES_KT} and missing from ${PROTOCOL_TS} — the two sides are defined ` +
            'once each and must stay in sync with docs/protocol.md; a Mac cannot send a type it has no name for',
        );
      }
    }
  }

  const twinDebt = typescript === null ? [] : types.filter((t) => twinExempt[t]);

  return { findings, specified, debt, types, twinDebt };
}

function main() {
  let result;
  try {
    result = check({
      kotlin: readFileSync(join(ROOT, MESSAGES_KT), 'utf8'),
      markdown: readFileSync(join(ROOT, PROTOCOL_MD), 'utf8'),
      typescript: readFileSync(join(ROOT, PROTOCOL_TS), 'utf8'),
    });
  } catch (error) {
    console.log(`check-protocol-spec: INSTRUMENT FAILURE — ${error.message}. Nothing was checked.`);
    process.exit(0);
  }
  if (result.instrumentFailure) {
    console.log(`check-protocol-spec: INSTRUMENT FAILURE — ${result.instrumentFailure}. Nothing was checked.`);
    process.exit(0);
  }

  const { findings, specified, debt, types } = result;
  console.log(
    `check-protocol-spec: ${specified.length} of ${types.length} message types specified in ${PROTOCOL_MD}, ` +
      `${debt.length} on the debt list, ${result.twinDebt.length} defined on the phone and not the Mac, ` +
      `${findings.length} unaccounted for`,
  );
  for (const type of debt) console.log(`  debt: ${type} — ${UNSPECIFIED[type]}`);
  for (const type of result.twinDebt) console.log(`  mac-side gap: ${type} — ${TWIN_EXEMPT[type]}`);
  for (const finding of findings) console.log(`  FAIL: ${finding}`);
  process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('check-protocol-spec.mjs')) main();
