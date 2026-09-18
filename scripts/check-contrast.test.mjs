#!/usr/bin/env node
/*
 * Fixtures for `check-contrast.mjs`.
 *
 * The instrument's own controls (the five published WCAG pairs) run inside the script on every
 * invocation, so they are not re-tested here. What is tested is the part a control cannot reach:
 * that the checker **goes red against a real contrast failure**, that it merges the cascade rather
 * than reading the light block alone, and that `--text-meta` is held to a band in both directions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { run, ratio, parseColor, contrast, controlsPass, tokenBlock } from './check-contrast.mjs';

const REAL = join(import.meta.dirname, '..', 'desktop/src/renderer/tokens.css');

function withTokens(src) {
  const dir = mkdtempSync(join(tmpdir(), 'ctr-'));
  const path = join(dir, 'tokens.css');
  writeFileSync(path, src);
  try { return run(path); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the published reference pairs all reproduce', () => {
  for (const c of controlsPass()) {
    assert.ok(c.ok, `${c.a} on ${c.b}: got ${c.got.toFixed(2)}, published ${c.want.toFixed(2)}`);
  }
});

test('alpha composites against what is actually behind it, in the right order', () => {
  // A translucent panel over a dark canvas is darker than the same panel over a light one, so a
  // light foreground reads HIGHER on the dark stack. Getting the order backwards inverts this.
  const onDark = contrast('#f4f4f7', ['rgba(22,24,34,0.82)'], '#07070a');
  const onLight = contrast('#f4f4f7', ['rgba(22,24,34,0.82)'], '#fafafc');
  assert.ok(onDark > onLight, `stack order is inverted: ${onDark.toFixed(2)} vs ${onLight.toFixed(2)}`);
});

test('the real token sheet passes, in both themes', () => {
  const themes = run(REAL);
  assert.equal(themes.length, 2);
  for (const theme of themes) {
    for (const row of theme.rows) {
      if (row.fg === '--text-meta') continue;
      assert.ok(row.r >= 4.5, `${theme.name}: ${row.fg} on ${row.bg} = ${row.r.toFixed(2)}`);
    }
  }
});

test('both themes check the SAME number of pairs', () => {
  const [dark, light] = run(REAL);
  // The first version read the light block in isolation and silently checked two fewer pairs than
  // dark — the tokens that are deliberately identical in both were skipped, and they sit on fills
  // that are not. A count that differs between themes means readings are being dropped.
  assert.equal(light.rows.length, dark.rows.length,
    'light must inherit every token it does not override, exactly as the cascade does');
});

test('a foreground darkened past AA goes red', () => {
  // Replace the token's value whatever it is today, and prove the replacement happened: a literal
  // match on the old value stopped matching when the palette moved, and the fixture then tested
  // the real palette instead of the mutation.
  const real = readFileSync(REAL, 'utf8');
  const src = real.replace(/--text-body: #[0-9a-f]{6};/, '--text-body: #6a6a72;');
  assert.notEqual(src, real, 'the mutation must actually change the palette');
  const [dark] = withTokens(src);
  const bad = dark.rows.filter((r) => r.fg === '--text-body' && r.r < 4.5);
  assert.ok(bad.length > 0, 'a body colour below AA must be reported');
});

test('control_the light palette is what makes the bright greens fail, and it catches them', () => {
  // The dark --live on a light ground: the single most likely light-mode mistake, since it is a
  // token that already exists and already passes in the theme somebody is looking at.
  const onWhite = contrast('#32e58a', ['#ffffff'], '#fafafc');
  assert.ok(onWhite < 4.5, `the dark green must fail on white (got ${onWhite.toFixed(2)})`);
  const shipped = contrast('#1b7c4b', ['#ffffff'], '#fafafc');
  assert.ok(shipped >= 4.5, `the light green must pass on white (got ${shipped.toFixed(2)})`);
});

test('--text-meta is held to a band, not a floor — it can fail by being too GOOD', () => {
  const real = readFileSync(REAL, 'utf8');
  const src = real.replace(/--text-meta: #[0-9a-f]{6};/, '--text-meta: #d0d0d8;');
  assert.notEqual(src, real, 'the mutation must actually change the palette');
  const [dark] = withTokens(src);
  const meta = dark.rows.filter((r) => r.fg === '--text-meta');
  // 4.0 is the checker's META_HI (see check-contrast.mjs, D19). The shipped meta sits below it.
  assert.ok(meta.some((r) => r.r > 4.0),
    'meta brightened into body-copy contrast must be reported: the design reserves that level');
});

test('tokenBlock ignores the values quoted in this file’s own comments', () => {
  const block = tokenBlock(`
/* The accent used to read #6ea8fe, a blue, and --canvas: #101014 was nine steps too light. */
:root { --canvas: #07070a; }
`, ':root {');
  assert.deepEqual([...block.keys()], ['--canvas']);
  assert.equal(block.get('--canvas'), '#07070a');
});

test('parseColor handles the four shapes the sheet actually uses', () => {
  assert.deepEqual(parseColor('#07070a'), [7, 7, 10, 1]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('rgba(22, 24, 34, 0.82)'), [22, 24, 34, 0.82]);
  assert.deepEqual(parseColor('rgb(139, 107, 255)'), [139, 107, 255, 1]);
  assert.equal(ratio(parseColor('#000'), parseColor('#fff')).toFixed(2), '21.00');
});
