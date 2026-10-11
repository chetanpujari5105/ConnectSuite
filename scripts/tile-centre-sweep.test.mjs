// Fixtures for scripts/tile-centre-sweep.mjs's verdict. The live sweep is the regression check;
// these prove its decision can see the defect it exists for, and cannot be satisfied by boxes alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { verdict, TOLERANCE_PX, CONTROL_LABELS } from './tile-centre-sweep.mjs';

const hero = (optical, box = 0) => CONTROL_LABELS.map((l) => ({
  where: 'div.hero-facts>dl#hero-facts.hero-details>div.detail>span.detail-icon', text: `${l} / x`, box, optical,
}));
const reading = (pairs, extra = {}) => ({ screen: 'overview', size: '1440x900', theme: 'dark', pairs, ...extra });

test('the shipped defect: tiles 1.05–1.30 px below the letters, boxes 0.00 — fails', () => {
  const v = verdict([reading(hero(1.3, 0))]);
  assert.equal(v.ok, false);
  assert.equal(v.failures.length, 4);
  assert.equal(v.worst, 1.3);
});

test('control: centred letters and boxes pass', () => {
  const v = verdict([reading(hero(0, 0))]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.failures, []);
});

test('a fix that centres the letters by un-centring the boxes is not a pass', () => {
  const v = verdict([reading(hero(0, 1.5))]);
  assert.equal(v.ok, false);
});

test('exactly at tolerance passes, just over fails', () => {
  assert.equal(verdict([reading(hero(TOLERANCE_PX))]).ok, true);
  assert.equal(verdict([reading(hero(TOLERANCE_PX + 0.01))]).ok, false);
  assert.equal(verdict([reading(hero(-(TOLERANCE_PX + 0.01)))]).ok, false, 'a tile too HIGH fails too');
});

test('a scan that found no hero facts refuses rather than passing an empty app', () => {
  const v = verdict([reading([])]);
  assert.equal(v.ok, false);
  assert.equal(v.refused.length, 1);
  assert.match(v.refused[0], /control failed/);
});

test('a pane that did not land is refused, not counted clean', () => {
  const v = verdict([reading(hero(0)), { screen: 'files', size: '1440x900', theme: 'dark', refused: 'route did not land' }]);
  assert.equal(v.ok, false);
  assert.equal(v.refused.length, 1);
});

// The recorded runs, when present: the before run must be red on exactly the hero facts, the after
// run green. This is the verbatim defect, not a reconstruction of it.
const evidence = new URL('../docs/evidence/tile-centre-2026-10-11/', import.meta.url);
test('recorded before/after readings: before red on the hero facts only, after green', { skip: !existsSync(new URL('before/readings.json', evidence)) }, () => {
  const before = JSON.parse(readFileSync(new URL('before/readings.json', evidence), 'utf8')).readings;
  const after = JSON.parse(readFileSync(new URL('after/readings.json', evidence), 'utf8')).readings;
  const vb = verdict(before);
  assert.equal(vb.ok, false);
  assert.ok(vb.failures.length > 0);
  assert.ok(vb.failures.every((f) => f.where.includes('hero-details')), 'only the hero facts were off');
  const va = verdict(after);
  assert.equal(va.ok, true, JSON.stringify(va.failures.slice(0, 3)));
});
