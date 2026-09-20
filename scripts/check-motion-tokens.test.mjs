#!/usr/bin/env node
/*
 * Fixtures for `check-motion-tokens.mjs`, each with its opposite.
 *
 * The rule this repo applies to a new guard: **it must be shown red against the defect it is named
 * for**, not merely shown capable of failing. So the first five cases are the five real sightings,
 * reconstructed verbatim from the tree at `c0e48b4` — `.clip-tab`'s hand-typed `180ms`, the two
 * `hero-spin 1.2s`, `state-spin 900ms`, `deep-reveal-flash 1.4s ease-out`, and `--dur-bar`, the
 * token nothing read. Each is paired with the corrected form, which must pass.
 *
 * The last group is the discriminators, and it is the group that matters most: every one is a
 * *mention* of a duration that must NOT be reported. This guard's whole failure mode is matching
 * the prose that explains a duration rather than a declared one — the shape this repo has been
 * bitten by five times in five different artifacts, including in the file whose header quotes
 * `180ms`, `1.2s` and `900ms` while forbidding them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, literalsIn, maskTokens, stripComments, motionTokens, ALLOWED } from './check-motion-tokens.mjs';

/*
 * Every token declared here must be *read* by one of the base sheets below, and every allowlisted
 * literal must appear in the sheet its entry names — otherwise the baseline fails on `unused-token`
 * or `stale-allowlist` for reasons that have nothing to do with the case under test.
 *
 * That coupling is deliberate rather than awkward. It means the baseline test is itself a check on
 * the two prune rules: add a token here without a reader, or drop a reduced-motion block from a
 * base sheet, and the first test goes red before any sighting does.
 */
const TOKENS_BASE = `
:root {
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --dur-press: 100ms;
  --dur-release: 160ms;
  --dur-state: 180ms;
  --dur-spin: 1.2s;
  --dur-spin-fast: 900ms;
  --dur-flash: 1.4s;
  --press-scale: 0.97;
}
/* Every allowlisted literal needs a live declaration or the prune rule fires. */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  .motion-fade { transition: opacity var(--dur-state) linear !important; }
}
`;
const SHELL_BASE = `
.a { transition: color var(--dur-state) var(--ease); }
.a:active { transform: scale(var(--press-scale)); transition-duration: var(--dur-press); }
.spinner svg { animation: spin var(--dur-spin) linear infinite; }
`;
const STYLES_BASE = `
.b { transition: background var(--dur-state) var(--ease), transform var(--dur-release) var(--ease); }
.c svg { animation: spin var(--dur-spin-fast) linear infinite; }
.d svg { animation: spin var(--dur-spin) linear infinite; }
.f { transition: transform var(--dur-state) var(--ease-in-out); }
.g { animation: flash var(--dur-flash) var(--ease) 1; }
`;
const FLOAT_BASE = `
.e { transition: opacity var(--dur-state) var(--ease); }
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
`;

/**
 * Write a fake renderer tree and run the guard over it.
 *
 * Extra CSS is **appended** to the base sheets rather than replacing them, because the base is what
 * keeps every token in `TOKENS_BASE` read — and a fixture that silently dropped those would fail on
 * `unused-token` for reasons that have nothing to do with the case it is testing. `replace: true`
 * is for the two cases that are *about* a sheet being absent or inert.
 */
function check({ tokens = TOKENS_BASE, shell = '', styles = '', float = '', replace = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'motion-tokens-'));
  try {
    mkdirSync(join(root, 'desktop/src/renderer'), { recursive: true });
    const w = (n, s) => writeFileSync(join(root, 'desktop/src/renderer', n), s);
    w('tokens.css', tokens);
    w('shell.css', replace ? shell : SHELL_BASE + shell);
    w('styles.css', replace ? styles : STYLES_BASE + styles);
    w('float.css', replace ? float : FLOAT_BASE + float);
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const kinds = (r) => r.problems.map((p) => p.kind);

test('the fixture tree itself is clean — the baseline every case below moves off', () => {
  const r = check();
  assert.deepEqual(r.problems, [], JSON.stringify(r.problems, null, 2));
  // The control: a run that read nothing would also report no problems.
  assert.ok(r.motionDecls >= 8, `only ${r.motionDecls} motion declarations read`);
});

/* ---- The five real sightings, verbatim ------------------------------------------------------ */

test('SIGHTING 1 — `.clip-tab`\'s hand-typed 180ms, which is exactly --dur-state', () => {
  const r = check({
    styles: `
.clip-tab { transition: background 180ms var(--ease), color 180ms var(--ease); }
`,
  });
  assert.ok(kinds(r).includes('raw-duration'), 'the verbatim defect was not caught');
  assert.ok(r.problems.some((p) => p.literal === '180ms'));
});

test('SIGHTING 1 corrected — the same rule reading the token passes', () => {
  const r = check({
    styles: `
.clip-tab { transition: background var(--dur-state) var(--ease), color var(--dur-state) var(--ease); }
`,
  });
  assert.deepEqual(r.problems, []);
});

test('SIGHTING 2 — `hero-spin 1.2s` as a literal', () => {
  const r = check({ shell: `.hero-phone-spinner svg { animation: hero-spin 1.2s linear infinite; }` });
  assert.ok(r.problems.some((p) => p.kind === 'raw-duration' && p.literal === '1.2s'));
});

test('SIGHTING 3 — `state-spin 900ms` as a literal', () => {
  const r = check({ styles: `.s svg { animation: state-spin 900ms linear infinite; }` });
  assert.ok(r.problems.some((p) => p.kind === 'raw-duration' && p.literal === '900ms'));
});

test('SIGHTING 4 — `deep-reveal-flash 1.4s ease-out` is caught on BOTH axes', () => {
  const r = check({ styles: `.deep-reveal { animation: deep-reveal-flash 1.4s ease-out 1; }` });
  assert.ok(r.problems.some((p) => p.kind === 'raw-duration' && p.literal === '1.4s'), 'duration missed');
  assert.ok(r.problems.some((p) => p.kind === 'raw-easing' && p.literal === 'ease-out'), 'easing missed');
});

test('SIGHTING 5 — `--dur-bar`, a motion token nothing reads', () => {
  const r = check({
    tokens: TOKENS_BASE.replace('  --press-scale: 0.97;', '  --press-scale: 0.97;\n  --dur-bar: 600ms;'),
  });
  assert.ok(kinds(r).includes('unused-token'), 'an unread token was not reported');
  assert.ok(r.problems.some((p) => p.detail.includes('--dur-bar')));
});

test('SIGHTING 5 corrected — the same token, once something reads it', () => {
  const r = check({
    tokens: TOKENS_BASE.replace('  --press-scale: 0.97;', '  --press-scale: 0.97;\n  --dur-bar: 600ms;'),
    styles: `\n.bar { transition: transform var(--dur-bar) var(--ease-in-out); }\n`,
  });
  assert.deepEqual(r.problems, []);
});

/* ---- An inline cubic-bezier is a literal too ------------------------------------------------ */

test('a curve typed inline rather than tokenised is caught', () => {
  const r = check({ styles: `.x { transition: opacity var(--dur-state) cubic-bezier(0.1, 0.2, 0.3, 0.4); }` });
  assert.ok(r.problems.some((p) => p.kind === 'raw-easing' && p.literal.startsWith('cubic-bezier')));
});

/* ---- The discriminators — every one of these must PASS --------------------------------------- */

test('DISCRIMINATOR — a duration named in a CSS comment is prose, not a declaration', () => {
  const r = check({
    styles: `
/* --dur-state is 180ms and --dur-spin is 1.2s; the old build wrote 900ms by hand here.
   A guard that matched this paragraph would forbid explaining itself. */
.y { transition: opacity var(--dur-state) var(--ease); }
`,
  });
  assert.deepEqual(r.problems, [], 'the guard matched its own prose');
});

test('DISCRIMINATOR — a comment naming ease-out does not count as an easing literal', () => {
  const r = check({ styles: `/* --ease is a strong ease-out, not the CSS ease-out keyword. */\n.z { transition: color var(--dur-state) var(--ease); }` });
  assert.deepEqual(r.problems, []);
});

test('DISCRIMINATOR — a non-motion property carrying a number is not a duration', () => {
  const r = check({ styles: `.w { width: 180px; grid-template-columns: 1.2fr 900px; transition: opacity var(--dur-state) var(--ease); }` });
  assert.deepEqual(r.problems, []);
});

test('DISCRIMINATOR — var(--ease-in-out) is a token use, not the ease-in-out keyword', () => {
  const r = check({ styles: `.v { transition: transform var(--dur-state) var(--ease-in-out); }` });
  assert.deepEqual(r.problems, []);
});

test('DISCRIMINATOR — the allowlisted reduced-motion kill values stay legal', () => {
  const r = check();
  assert.ok(!kinds(r).includes('raw-duration'));
});

/* ---- The allowlist cannot rot ---------------------------------------------------------------- */

test('an allowlist entry matching no declaration fails the check', () => {
  // float.css loses its reduced-motion block, so the 0.001ms entry matches nothing.
  const r = check({ replace: true, shell: SHELL_BASE, styles: STYLES_BASE, float: `.e { transition: opacity var(--dur-state) var(--ease); }` });
  assert.ok(kinds(r).includes('stale-allowlist'), 'a dead allowlist entry was tolerated');
});

test('every allowlist entry carries a reason someone can read', () => {
  for (const a of ALLOWED) {
    assert.ok(a.why && a.why.length > 30, `${a.file} ${a.literal} has no usable reason`);
  }
});

/* ---- The instrument reports its own failure --------------------------------------------------- */

test('INSTRUMENT — sheets with no motion at all is a failure, not a pass', () => {
  const r = check({ replace: true, tokens: ':root { --canvas: #000; }', shell: '.a { color: red; }', styles: '.b { color: red; }', float: '.c { color: red; }' });
  assert.ok(kinds(r).includes('instrument'), 'an empty read certified the tree');
});

test('INSTRUMENT — a missing stylesheet is reported rather than skipped', () => {
  const root = mkdtempSync(join(tmpdir(), 'motion-tokens-'));
  try {
    mkdirSync(join(root, 'desktop/src/renderer'), { recursive: true });
    writeFileSync(join(root, 'desktop/src/renderer/tokens.css'), TOKENS_BASE);
    const r = run(root);
    assert.ok(kinds(r).includes('missing'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---- The helpers -------------------------------------------------------------------------- */

test('maskTokens blanks var() so a token is never read as a literal', () => {
  assert.equal(maskTokens('transform var(--dur-release) var(--ease)'), 'transform VAR VAR');
});

test('literalsIn separates durations from easings and ignores masked tokens', () => {
  assert.deepEqual(literalsIn('opacity var(--dur-state) var(--ease)'), { durations: [], easings: [] });
  assert.deepEqual(literalsIn('opacity 200ms ease-out').durations, ['200ms']);
  assert.deepEqual(literalsIn('opacity 200ms ease-out').easings, ['ease-out']);
});

test('stripComments keeps line numbers intact', () => {
  const src = 'a\n/* two\nlines */\nb';
  assert.equal(stripComments(src).split('\n').length, src.split('\n').length);
});

test('motionTokens finds durations, curves and press scales — and nothing else', () => {
  const m = motionTokens(TOKENS_BASE);
  assert.ok(m.has('--dur-press') && m.has('--ease') && m.has('--press-scale'));
  assert.ok(!m.has('--canvas'));
});
