// Fixtures for scripts/tile-centre-sweep.mjs's verdict. The live sweep is the regression check;
// these prove its decision can see the defect it exists for, and cannot be satisfied by boxes alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { verdict, heroLayoutFailures, spacingFailures, MIN_INK_GAP_PX, TOLERANCE_PX, CONTROL_LABELS, HERO_FACTS_GAP_PX } from './tile-centre-sweep.mjs';

const hero = (optical, box = 0) => CONTROL_LABELS.map((l) => ({
  where: 'div.hero-facts>dl#hero-facts.hero-details>div.detail>span.detail-icon', text: `${l} / x`, box, optical,
}));
const CENTRED = Object.freeze({ gapAbove: HERO_FACTS_GAP_PX, columnMinusPhone: 0, rowTopDelta: [0, 0], colLeftDelta: [0, 0] });
const reading = (pairs, extra = {}) => ({ screen: 'overview', size: '1440x900', theme: 'dark', pairs, heroLayout: CENTRED, ...extra });

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

// ---- The facts block's place in the card (second report, 2026-10-11) ----

test('the shipped layout: facts pinned to the bottom, 102 px under the pill — fails on the gap', () => {
  // Verbatim from the before run at every size: gap above 102, below 0, column −3 px off the phone.
  const v = verdict([reading(hero(0), { heroLayout: { gapAbove: 102, columnMinusPhone: 3, rowTopDelta: [0, 0], colLeftDelta: [0, 0] } })]);
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.where === 'hero layout' && /pill-to-facts gap 102/.test(f.text)));
});

test('facts centred in the space under the pill (option A, not chosen) still fails — it floats 51 px off the pill', () => {
  const f = heroLayoutFailures({ gapAbove: 51, columnMinusPhone: -22.5, rowTopDelta: [0, 0], colLeftDelta: [0, 0] });
  assert.equal(f.length, 2);
});

test('a column centred on the phone with the facts still pushed down fails on the gap alone', () => {
  const f = heroLayoutFailures({ gapAbove: 60, columnMinusPhone: 0, rowTopDelta: [0, 0], colLeftDelta: [0, 0] });
  assert.equal(f.length, 1);
  assert.match(f[0].rule, /gap 60/);
});

test('the right gap with the column off the phone centre fails on centring alone', () => {
  const f = heroLayoutFailures({ gapAbove: 24, columnMinusPhone: -18, rowTopDelta: [0, 0], colLeftDelta: [0, 0] });
  assert.equal(f.length, 1);
  assert.match(f[0].rule, /column centre/);
});

test('fact columns out of line fail', () => {
  assert.equal(heroLayoutFailures({ ...CENTRED, rowTopDelta: [0, 3] }).length, 1);
  assert.equal(heroLayoutFailures({ ...CENTRED, colLeftDelta: [-2, 0] }).length, 1);
});

test('control: the chosen layout passes, at tolerance passes, just over fails', () => {
  assert.equal(verdict([reading(hero(0))]).ok, true);
  assert.deepEqual(heroLayoutFailures({ ...CENTRED, gapAbove: HERO_FACTS_GAP_PX + TOLERANCE_PX, columnMinusPhone: -TOLERANCE_PX }), []);
  assert.equal(heroLayoutFailures({ ...CENTRED, gapAbove: HERO_FACTS_GAP_PX - TOLERANCE_PX - 0.01 }).length, 1);
});

test('a live scan that could not read the card is refused, not passed', () => {
  assert.equal(verdict([reading(hero(0), { heroLayout: null })]).refused.length, 1);
  const { heroLayout, ...noField } = reading(hero(0));
  assert.equal(verdict([noField]).refused.length, 1, 'a missing field is refused by default');
  assert.equal(verdict([noField], TOLERANCE_PX, { requireLayout: false }).ok, true, 'archived runs from before the field');
});

// The recorded runs, when present: the before run must be red on exactly the hero facts, the after
// run green. This is the verbatim defect, not a reconstruction of it.
const evidence = new URL('../docs/evidence/tile-centre-2026-10-11/', import.meta.url);
test('recorded before/after readings: before red on the hero facts only, after green', { skip: !existsSync(new URL('before/readings.json', evidence)) }, () => {
  const before = JSON.parse(readFileSync(new URL('before/readings.json', evidence), 'utf8')).readings;
  const after = JSON.parse(readFileSync(new URL('after/readings.json', evidence), 'utf8')).readings;
  // Recorded before `heroLayout` existed, so the layout half is not asked of them.
  const vb = verdict(before, TOLERANCE_PX, { requireLayout: false });
  assert.equal(vb.ok, false);
  assert.ok(vb.failures.length > 0);
  assert.ok(vb.failures.every((f) => f.where.includes('hero-details')), 'only the hero facts were off');
  const va = verdict(after, TOLERANCE_PX, { requireLayout: false });
  assert.equal(va.ok, true, JSON.stringify(va.failures.slice(0, 3)));
});

// The layout run: the before readings must be red on the hero layout (and only there), the after
// readings green with the tile-to-text result unchanged.
const layoutEvidence = new URL('../docs/evidence/hero-layout-2026-10-11/', import.meta.url);
test('recorded layout before/after: before red on the hero layout only, after green', { skip: !existsSync(new URL('after/readings.json', layoutEvidence)) }, () => {
  const before = JSON.parse(readFileSync(new URL('before/readings.json', layoutEvidence), 'utf8')).readings;
  const after = JSON.parse(readFileSync(new URL('after/readings.json', layoutEvidence), 'utf8')).readings;
  const vb = verdict(before);
  assert.equal(vb.ok, false);
  assert.deepEqual(vb.refused, []);
  assert.ok(vb.failures.length > 0 && vb.failures.every((f) => f.where === 'hero layout'), JSON.stringify(vb.failures.slice(0, 3)));
  const va = verdict(after);
  assert.equal(va.ok, true, JSON.stringify(va.failures.slice(0, 3)));
});

// ---- The text block's spacing (third report, 2026-10-11) ----

const recent = (spacing) => ({ where: 'div#recent-list.recent-list>button.recent-row>span.recent-tile', text: 'Sent to phone / 509 B, automatically', box: 0, optical: -0.67, spacing });

test('the shipped Recent activity rows: 1.63 px of ink between the lines, descenders cut 0.74 px — fails on both', () => {
  // Verbatim from the before run (1440×900 dark): 13/14 px title over a 12/12 px detail, boxes touching.
  const shipped = { inkGap: 1.63, boxGap: 0, top: 13.84, bottom: 10.26, descClip: -0.74, clipFirst: -0.42, clipLast: -0.74, divider: true, rowH: 48 };
  assert.equal(spacingFailures(shipped).length, 2);
  const v = verdict([reading([...hero(0), recent(shipped)])]);
  assert.equal(v.ok, false);
  assert.equal(v.failures.length, 2);
  assert.ok(v.failures.every((f) => f.spacing && f.where.includes('recent-row')));
});

test('control: the spacing every other pair already had passes, and a pair with no clipping box is not asked about clipping', () => {
  assert.deepEqual(spacingFailures({ inkGap: 5.73, descClip: 0.75 }), [], 'sidebar device card');
  assert.deepEqual(spacingFailures({ inkGap: 7.51, descClip: null }), [], 'hero facts — values clip across, not down');
  assert.deepEqual(spacingFailures(undefined), [], 'archived runs from before the field are not asked');
});

test('each spacing rule fails on its own, at its edge', () => {
  assert.equal(spacingFailures({ inkGap: MIN_INK_GAP_PX, descClip: 0 }).length, 0, 'exactly at the minimum, descenders touching the box edge: pass');
  assert.match(spacingFailures({ inkGap: MIN_INK_GAP_PX - 0.01, descClip: 1 })[0].rule, /ink between the lines/);
  assert.match(spacingFailures({ inkGap: 8, descClip: -0.01 })[0].rule, /descenders cut/);
});
