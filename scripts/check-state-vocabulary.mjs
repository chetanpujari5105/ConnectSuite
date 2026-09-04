#!/usr/bin/env node
/**
 * Every number in `docs/empty-and-failure-states.md` is derived from its own tables.
 *
 * ### Why this exists
 *
 * The first version of that document had **four wrong numbers**: three group headers claiming 24,
 * 15 and 6 against tables of 28, 19 and 9, a total of 86 against 83, and a pane count of 17 against
 * 24. They were typed while grouping rather than counted afterwards — the counting-by-hand failure,
 * in the one document whose entire job is to be counted.
 *
 * It matters more here than in most places: the whole document is an argument *from* its numbers.
 * "28 sentences for one idea" is the finding. A header that says 24 over a table of 28 does not
 * merely look sloppy, it understates the case by four.
 *
 * So the numbers are checked rather than trusted, and this runs on `git commit` like the other
 * guards. It counts rows, not claims: a row is a table line that is not the header and not the
 * `|---|` rule.
 *
 * Run: node scripts/check-state-vocabulary.mjs
 */
import { readFileSync } from 'node:fs';

const DOC = 'docs/empty-and-failure-states.md';
const lines = readFileSync(DOC, 'utf8').split('\n');

const groups = [];
let current = null;
for (const line of lines) {
  const heading = /^## (\d+) · (.*)$/.exec(line);
  if (heading) {
    const claimed = /(\d+)\s+sentences/.exec(heading[2]);
    current = {
      number: Number(heading[1]),
      title: heading[2],
      claimed: claimed ? Number(claimed[1]) : null,
      rows: 0,
      panes: new Set(),
    };
    groups.push(current);
    continue;
  }
  if (/^## /.test(line)) current = null;
  if (!current) continue;
  if (!line.startsWith('| ') || line.startsWith('|---')) continue;
  if (/\|\s*Verbatim\s*\|/.test(line)) continue;
  current.rows += 1;
  // **Count the columns, do not guess from the content.** Group 7's table has two columns rather
  // than three — it is Mirror throughout, which its heading says — and the first version of this
  // took cell 1 as a pane regardless, so five conditions were counted as panes and the total came
  // out four too high. A parser that assumes a shape is an instrument reporting its assumption.
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length === 3) current.panes.add(cells[0].replace(/\s*\(shared\)$/, ''));
}

const failures = [];
for (const group of groups) {
  if (group.claimed === null) continue;
  if (group.claimed !== group.rows) {
    failures.push(
      `group ${group.number} claims ${group.claimed} sentences and its table has ${group.rows}`,
    );
  }
}

const total = groups.reduce((sum, g) => sum + g.rows, 0);
const panes = new Set(groups.flatMap((g) => [...g.panes]));

const totalClaim = /\*\*(\d+) states across (\d+) panes\.\*\*/.exec(readFileSync(DOC, 'utf8'));
if (!totalClaim) {
  failures.push('the summary line "**N states across M panes.**" is missing or reworded');
} else {
  if (Number(totalClaim[1]) !== total) {
    failures.push(`the summary claims ${totalClaim[1]} states; the tables hold ${total}`);
  }
  if (Number(totalClaim[2]) !== panes.size) {
    failures.push(`the summary claims ${totalClaim[2]} panes; the tables name ${panes.size}`);
  }
}

const ideas = /\*\*(\w+) ideas\. (\d+) sentences\.\*\*/.exec(readFileSync(DOC, 'utf8'));
const WORDS = { Six: 6, Seven: 7, Eight: 8, Nine: 9, Ten: 10 };
if (!ideas) {
  failures.push('the closing "**N ideas. M sentences.**" line is missing or reworded');
} else {
  if (WORDS[ideas[1]] !== groups.length) {
    failures.push(`the close says ${ideas[1]} ideas; the document has ${groups.length} groups`);
  }
  if (Number(ideas[2]) !== total) {
    failures.push(`the close says ${ideas[2]} sentences; the tables hold ${total}`);
  }
}

for (const group of groups) {
  console.log(
    `  group ${group.number}: ${String(group.rows).padStart(2)} rows` +
      (group.claimed === null ? '  (no claim in the heading)' : `, heading claims ${group.claimed}`),
  );
}
console.log(`  total: ${total} states across ${panes.size} panes, in ${groups.length} groups`);

if (failures.length) {
  console.error('\ncheck-state-vocabulary: the document disagrees with its own tables\n');
  for (const failure of failures) console.error(`  FAIL: ${failure}`);
  console.error('\nThe tables are the source. Fix the prose, never the tables.');
  process.exit(1);
}
console.log('check-state-vocabulary: every number matches the tables it is drawn from');
