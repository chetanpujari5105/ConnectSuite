/**
 * The gate's decision table, printed and asserted.
 *
 * Run: node scripts/step70-gate.test.mjs
 *
 * This exists to be *read before* the retry, not consulted after it. The first version of the
 * watcher had no gate and hung up the user's own outgoing call; the point of pulling the predicate
 * out is that its behaviour can be inspected without a phone ringing.
 */
import { gateReasons, skipLine } from './step70-gate.mjs';
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

console.log(bad === 0 ? 'all gate cases behave as written' : `${bad} CASE(S) WRONG`);
process.exit(bad === 0 ? 0 : 1);
