#!/usr/bin/env node
/**
 * A debt list is only read if something reads it. This is that something.
 *
 * ### The failure it exists for
 *
 * `check-protocol-spec.mjs` has printed `debt: battery.state — Unscheduled. No handler on either
 * side` on **every run for a whole phase**. The list was correct, complete, and printed in full.
 * Then `docs/RESUME.md` said `battery.state` and `net.state` were *"already on the wire"*, and an
 * O4 sitting started on that basis. The list did not stop it, and nothing else could have.
 *
 * **The list was right and nobody read it, which costs exactly what an empty list costs.**
 *
 * ### Why printing it harder would not have worked
 *
 * The debt list is printed at the end of a **passing** run. Nobody reads the output of a check that
 * passes — that is what passing is *for*. Louder, coloured, or first-in-the-output changes nothing:
 * the reader is not there. And the claim was not in code, it was in **prose**, which no code check
 * looks at.
 *
 * So the rule is not "make the list more visible". It is:
 *
 *   **A debt entry has to be able to DENY something. A list that can only inform is decoration.**
 *
 * The moment worth failing is not the moment the debt is created — that is deliberate and fine —
 * it is the moment somebody writes a sentence that contradicts it. That is when a person is
 * present, is making a decision, and can be told.
 *
 * ### The discriminator
 *
 * A guard on prose that searches for a type name matches the sentence *recording the debt*, which
 * is this file's own third bullet and `CLAUDE.md`'s rule about it. Searching for a forbidden thing
 * finds the sentence forbidding it — the failure this repo has caught three times.
 *
 * So a sentence is a violation only when it names a debt-listed type **and** claims it works
 * **and** does not also say it is owed. Claim words and debt words are both enumerated below, and
 * `check-debt-claims.test.mjs` holds fixtures for both directions.
 *
 * Run: node scripts/check-debt-claims.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pulled from the spec checker so there is one debt list and not two.
 *
 * `DEBT_SOURCE` overrides the path, and exists only so the fixtures can restore a type to the list
 * without **writing to the real file**. They used to patch `check-protocol-spec.mjs` in place for
 * the length of a run, which is a mutation of shared state that `node --test` runs files in
 * parallel over: `check-protocol-spec.test.mjs` would read the patched copy and report
 * `battery.state is on the debt list and is in fact specified` — a true statement about a file that
 * existed for forty milliseconds. It surfaced when a ninth test file changed the scheduling, which
 * is the way a latent race always surfaces: something unrelated moves and an unrelated test fails.
 */
function debtTypes() {
  const source = readFileSync(process.env.DEBT_SOURCE ?? 'scripts/check-protocol-spec.mjs', 'utf8');
  const block = /const UNSPECIFIED\s*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!block) return null;
  return [...block[1].matchAll(/'([a-z]+\.[a-z.]+)'\s*:/g)].map((m) => m[1]);
}

/** Saying it works. */
const CLAIMS = [
  'already on the wire',
  'on the wire',
  'is implemented',
  'are implemented',
  'both implemented',
  'is handled',
  'are handled',
  'is sent',
  'are sent',
  'ships',
  'works today',
];

/** Saying it is owed. Any of these in the same sentence makes the claim a description of the debt. */
const DEBT = [
  'debt',
  'unspecified',
  'unscheduled',
  'not implemented',
  'implemented nowhere',
  'no handler',
  'nowhere',
  'not on the wire',
  'never',
  'would be',
  'was wrong',
  'wrongly',
  'claimed',
  'is not',
  'are not',
];

function markdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

const types = debtTypes();
if (types === null) {
  console.log('check-debt-claims: INSTRUMENT FAILURE — could not read the debt list; nothing checked');
  process.exit(0);
}
if (types.length === 0) {
  console.log('check-debt-claims: the debt list is empty, so there is nothing to contradict');
  process.exit(0);
}

const files = ['CLAUDE.md', ...markdownFiles('docs')];
const violations = [];
let sentencesScanned = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const raw of text.split(/(?<=[.!?])\s+|\n\n+|\n(?=[-*|#])/)) {
    const sentence = raw.replace(/\s+/g, ' ').trim();
    if (!sentence) continue;
    sentencesScanned += 1;
    const named = types.filter((t) => sentence.includes(t));
    if (named.length === 0) continue;
    const lower = sentence.toLowerCase();
    const claim = CLAIMS.find((c) => lower.includes(c));
    if (!claim) continue;
    if (DEBT.some((d) => lower.includes(d))) continue;
    violations.push({ file, type: named[0], claim, sentence: sentence.slice(0, 150) });
  }
}

console.log(`  debt list: ${types.join(', ')}`);
console.log(`  scanned ${sentencesScanned} sentences across ${files.length} documents`);

if (violations.length) {
  console.error('\ncheck-debt-claims: prose claims a message type works that the debt list says is unimplemented\n');
  for (const v of violations) {
    console.error(`  FAIL: ${v.file} claims "${v.claim}" of ${v.type}`);
    console.error(`        ${v.sentence}`);
  }
  console.error('\nEither implement it and take it off the debt list, or fix the sentence.');
  process.exit(1);
}
console.log('check-debt-claims: no document claims a debt-listed type works');
