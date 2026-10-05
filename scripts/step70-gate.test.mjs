/**
 * The gate's decision table, printed and asserted.
 *
 * Run: node scripts/step70-gate.test.mjs
 *
 * This exists to be *read before* the retry, not consulted after it. The first version of the
 * watcher had no gate and hung up the user's own outgoing call; the point of pulling the predicate
 * out is that its behaviour can be inspected without a phone ringing.
 */
import { gateReasons, skipLine, correctionInWatch } from './step70-gate.mjs';
import assert from 'node:assert/strict';

const WANT = '8800000004';

const cases = [
  {
    name: 'the call under test',
    card: { hidden: false, who: 'Contact D', status: 'Ringing · 8800000004' },
    expect: 'CLICK',
  },
  {
    name: 'same call, number in international form',
    card: { hidden: false, who: 'Contact D', status: 'Ringing · +91 88000 00004' },
    expect: 'CLICK',
  },
  {
    name: "the call it actually hung up on 2026-08-29 (user's own outgoing)",
    card: { hidden: false, who: 'Chetan', status: 'Dialling · +919800000001' },
    expect: 'REFUSE',
  },
  {
    name: 'an outgoing call to the right person — still not a ring',
    card: { hidden: false, who: 'Contact D', status: 'Dialling · 8800000004' },
    expect: 'REFUSE',
  },
  {
    name: 'somebody else ringing mid-test',
    card: { hidden: false, who: 'Mother', status: 'Ringing · +918300000006' },
    expect: 'REFUSE',
  },
  {
    name: 'the right call, but already answered — 35c is gone and this is a live conversation',
    card: { hidden: false, who: 'Contact D', status: 'In progress · 8800000004' },
    expect: 'REFUSE',
  },
  {
    name: 'a ring with no number at all (withheld caller ID)',
    card: { hidden: false, who: 'Unknown number', status: 'Ringing' },
    expect: 'REFUSE',
  },
  {
    name: 'no live card',
    card: { hidden: true, who: null, status: null },
    expect: 'REFUSE',
  },
];

console.log(`gate: expecting an inbound ring from …${WANT}\n`);
let bad = 0;
for (const c of cases) {
  const reasons = gateReasons(c.card, WANT);
  const got = reasons.length === 0 ? 'CLICK' : 'REFUSE';
  const mark = got === c.expect ? 'ok  ' : 'FAIL';
  if (got !== c.expect) bad += 1;
  console.log(`${mark} ${got.padEnd(6)} ${c.name}`);
  console.log(`       card: who=${JSON.stringify(c.card.who)} status=${JSON.stringify(c.card.status)}`);
  if (reasons.length) console.log(`       logs: ${skipLine(c.card, reasons).split('\n')[0]}`);
  console.log();
}

// The two that matter most, asserted rather than eyeballed.
assert.deepEqual(
  gateReasons({ hidden: false, who: 'Chetan', status: 'Dialling · +919800000001' }, WANT),
  ['state is "Dialling · +919800000001", not Ringing', 'card does not carry 8800000004'],
  'the card that was wrongly clicked must be refused, for both reasons',
);
assert.deepEqual(
  gateReasons({ hidden: false, who: 'Contact D', status: 'Ringing · 8800000004' }, WANT),
  [],
  'the call under test must be allowed',
);

/**
 * The waiver, which exists because defect 45 made clause 2 unsatisfiable on the shipped build.
 *
 * Six fixtures, in the shape the force-stop hook's fixtures take: the one card the waiver is for,
 * and five that must behave exactly as they did without it. A waiver that quietly widened the gate
 * would be worse than no gate, because the log would still read as if a check had happened.
 */
const OPEN = { allowBlankNumber: true };
const waiverCases = [
  {
    name: 'the blank inbound card the waiver is for',
    card: { hidden: false, who: 'Unknown number', status: 'Ringing' },
    expect: 'CLICK',
  },
  {
    name: 'still refused: a different caller whose number DID resolve',
    card: { hidden: false, who: 'Mother', status: 'Ringing · +918300000006' },
    expect: 'REFUSE',
  },
  {
    name: "still refused: the user's own outgoing call, blank headline or not",
    card: { hidden: false, who: 'Chetan', status: 'Dialling · +919800000001' },
    expect: 'REFUSE',
  },
  {
    name: 'still refused: blank-looking, but already answered',
    card: { hidden: false, who: 'Unknown number', status: 'In progress' },
    expect: 'REFUSE',
  },
  {
    name: 'still refused: nearly blank, but the headline is not the known fallback',
    card: { hidden: false, who: '', status: 'Ringing' },
    expect: 'REFUSE',
  },
  {
    name: 'still refused: no live card',
    card: { hidden: true, who: null, status: null },
    expect: 'REFUSE',
  },
];

console.log('--- with --allow-blank-number (defect 45 waiver) ---\n');
for (const c of waiverCases) {
  const reasons = gateReasons(c.card, WANT, OPEN);
  const got = reasons.length === 0 ? 'CLICK' : 'REFUSE';
  const mark = got === c.expect ? 'ok  ' : 'FAIL';
  if (got !== c.expect) bad += 1;
  console.log(`${mark} ${got.padEnd(6)} ${c.name}`);
  console.log(`       card: who=${JSON.stringify(c.card.who)} status=${JSON.stringify(c.card.status)}`);
  if (reasons.waived) console.log(`       waived: ${reasons.waived}`);
  if (reasons.length) console.log(`       logs: ${skipLine(c.card, reasons).split('\n')[0]}`);
  console.log();
}

// The waiver must be opt-in: the same card, without the option, is still refused.
assert.deepEqual(
  gateReasons({ hidden: false, who: 'Unknown number', status: 'Ringing' }, WANT),
  ['card does not carry 8800000004'],
  'the blank card must still be refused when the waiver is not asked for',
);
// And when it is taken, it must say so rather than pass silently.
assert.equal(
  gateReasons({ hidden: false, who: 'Unknown number', status: 'Ringing' }, WANT, OPEN).waived,
  'no number on the card; allowed by --allow-blank-number (defect 45)',
  'a waived clause must be reported, not merely skipped',
);

// --- correctionInWatch: --require-correction must be about THIS call --------------------------
//
// Added 2026-08-31 as isCorrectionFor, which read the number out of the line. 559f1da removed the
// number from the phone's log, which made that matcher refuse every correction; it is replaced by a
// match on call id against the one inbound episode of the watch. The fixture named for the original
// hole is still here: "a correction for a DIFFERENT call". Both line formats are fixtures, because
// the installed APK writes the old one until the next install.

const T = '2026-10-06T01:00:00.000+05:30 I [calls] ';
const OLD = {
  began: (id) => `${T}Call ${id} ringing from +919800000001 (Contact A)`,
  corrected: (id) => `${T}Call ${id} card corrected in place: number +919800000001 (Contact A) arrived 112ms into the RINGING — 1 of 1 episodes corrected since start`,
};
const NEW = {
  began: (id) => `${T}Call ${id} ringing: number withheld by the platform — 0 of 1 episodes with a number since start`,
  corrected: (id) => `${T}Call ${id} card corrected in place: number arrived 112ms into the ringing, contact name found — 1 of 1 episodes corrected since start`,
};

const correctionCases = [
  { name: 'new format: the episode of this watch, corrected',      lines: [NEW.began('c14'), NEW.corrected('c14')], expect: 'c14' },
  { name: 'old format (installed APK): same',                      lines: [OLD.began('c14'), OLD.corrected('c14')], expect: 'c14' },
  { name: 'a correction for a DIFFERENT call',                     lines: [NEW.began('c14'), NEW.corrected('c13')], expect: null },
  { name: 'two inbound episodes in the watch — cannot tie it',     lines: [NEW.began('c14'), NEW.began('c15'), NEW.corrected('c14')], expect: null },
  { name: 'no episode began in the watch',                         lines: [NEW.corrected('c14')], expect: null },
  { name: 'the episode began, nothing corrected it',               lines: [NEW.began('c14'), `${T}Call c14 ended missed after 9000ms`], expect: null },
  { name: 'a re-sent ringing line is one episode, not two',        lines: [NEW.began('c14'), NEW.began('c14'), NEW.corrected('c14')], expect: 'c14' },
  { name: '"into the ringing" inside a correction is not a begin', lines: [NEW.corrected('c14')], expect: null },
  { name: 'format moved — fails CLOSED, not open',                 lines: [NEW.began('c14'), `${T}Call c14 card was corrected (in place)`], expect: null },
];

console.log('\n--- correctionInWatch (--require-correction is about THIS call) ---\n');
for (const c of correctionCases) {
  const got = correctionInWatch(c.lines);
  const ok = (got.line === null ? null : got.id) === c.expect;
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(got.line === null ? null : got.id).padEnd(5)} ${c.name} — ${got.why}`);
}

// The control: the line the positive case accepts is the correction line, not the begin line.
assert.match(correctionInWatch([NEW.began('c14'), NEW.corrected('c14')]).line, /card corrected in place/);
// And no reason this function prints carries a number, whichever format it read.
for (const c of correctionCases) {
  assert.ok(!/\d{6,}/.test(correctionInWatch(c.lines).why), `a reason carried a number: ${c.name}`);
}

console.log();
console.log(bad === 0 ? 'all gate cases behave as written' : `${bad} CASE(S) WRONG`);
process.exit(bad === 0 ? 0 : 1);
