#!/usr/bin/env node
/*
 * Fixtures for `check-color-tokens.mjs`, each with its opposite.
 *
 * The rule this repo applies to a new guard: **it must be shown red against the defect it is named
 * for**, not merely shown capable of failing. So the first five cases are the five real sightings,
 * reconstructed verbatim — the styles.css `:root` that beat the token sheet, `.nav-pill`'s literal,
 * the `#111219` well, the SVG gradient carrying a superseded accent, and a dark token with no light
 * value. Each is paired with the corrected form, which must pass.
 *
 * The last group is the discriminators, and it is the group that matters most: every one of them is
 * a *mention* of a colour that must NOT be reported. This guard's whole failure mode is matching the
 * prose that explains a colour rather than a drawn one, which this repo has now been bitten by four
 * times in four different artifacts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, literalsIn, stripComments, stripHtmlComments, colorCalls, isColorToken, SAME_IN_BOTH } from './check-color-tokens.mjs';

/*
 * The fixture's dark block declares every allowlisted token, **generated from the allowlist
 * itself** rather than typed out beside it.
 *
 * That is deliberate. The guard fails an allowlist entry that matches no declared token — an
 * allowlist nobody prunes is how a guard stops guarding — so a hand-written fixture would have to
 * be edited every time the allowlist changes, and the first person to forget would "fix" it by
 * weakening the prune rule. Deriving it means the fixture cannot drift from the thing it tests,
 * and the prune rule is exercised below by removing one entry rather than by disabling it.
 */
const ALLOWLISTED = [...SAME_IN_BOTH.keys()].map((n) => `  ${n}: #123456;`).join('\n');

const TOKENS_OK = `
:root {
  color-scheme: dark;
  --canvas: #07070a;
  --accent: #8b6bff;
  --float-canvas: #0b0c12;
  --space-1: 4px;
  --radius-pill: 999px;
${ALLOWLISTED}
}
:root[data-theme='light'] {
  color-scheme: light;
  --canvas: #fafafc;
  --accent: #5b4ae0;
  --float-canvas: #f4f4f8;
}
`;
const APPEARANCE_OK = `
const WINDOW_GROUND = { dark: '#07070a', light: '#fafafc' };
const FLOAT_GROUND = { dark: '#0b0c12', light: '#f4f4f8' };
`;

/** Build a minimal but structurally real tree, then let the caller corrupt one file. */
function fixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ctok-'));
  const files = {
    'desktop/src/renderer/tokens.css': TOKENS_OK,
    'desktop/src/renderer/shell.css': '.a { color: var(--accent); }\n',
    'desktop/src/renderer/styles.css': '.b { color: var(--accent); }\n',
    'desktop/src/renderer/float.css': '.c { color: var(--accent); }\n',
    'desktop/src/renderer/index.html': '<html></html>\n',
    'desktop/src/renderer/float.html': '<html></html>\n',
    'desktop/src/renderer/icons.ts': 'const a = 1;\n',
    'desktop/src/shared/appearance.ts': APPEARANCE_OK,
    ...overrides,
  };
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

function problems(overrides) {
  const dir = fixture(overrides);
  try { return run(dir).problems; } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- The five sightings, each red ---------------------------------------------------------------

test('sighting 1 — a second :root in styles.css, which loads later and silently wins', () => {
  const found = problems({
    'desktop/src/renderer/styles.css': ':root {\n  --accent: #6ea8fe;\n  --bg: #101014;\n}\n',
  });
  assert.ok(found.some((p) => p.includes('styles.css') && p.includes('--accent')),
    `expected the stray token declaration to be caught, got:\n${found.join('\n')}`);
});

test('sighting 2 — the nav pill with the tint hardcoded, right value in the wrong place', () => {
  const found = problems({
    'desktop/src/renderer/shell.css': '.nav-pill { background: rgba(124, 107, 255, 0.15); }\n',
  });
  assert.ok(found.some((p) => p.includes('shell.css') && p.includes('rgba(124')),
    `expected the raw rgba to be caught, got:\n${found.join('\n')}`);
});

test('sighting 3 — the #111219 well, used twice before it was ever a token', () => {
  const found = problems({
    'desktop/src/renderer/styles.css': '.diagnostics { background: #111219; }\n.log-tail { background: #111219; }\n',
  });
  assert.equal(found.filter((p) => p.includes('#111219')).length, 2,
    `both uses should be reported, not just the first: ${found.join('\n')}`);
});

test('sighting 4 — a colour literal in TypeScript, where no stylesheet checker can see it', () => {
  const found = problems({
    'desktop/src/renderer/icons.ts': "const g = '<stop stop-color=\"#8B6BFF\"/>';\n",
  });
  assert.ok(found.some((p) => p.includes('icons.ts') && p.includes('#8B6BFF')),
    `expected the SVG gradient literal to be caught, got:\n${found.join('\n')}`);
});

test('sighting 5 — a dark colour token with no light counterpart', () => {
  const found = problems({
    'desktop/src/renderer/tokens.css': TOKENS_OK.replace('  --accent: #8b6bff;', '  --accent: #8b6bff;\n  --brand-new: #123456;'),
  });
  assert.ok(found.some((p) => p.includes('--brand-new') && p.includes('no light value')),
    `expected the missing light value to be caught, got:\n${found.join('\n')}`);
});

test('sighting 6 — a window ground that has drifted from the token it mirrors', () => {
  const found = problems({
    'desktop/src/shared/appearance.ts': APPEARANCE_OK.replace("light: '#fafafc'", "light: '#ffffff'"),
  });
  assert.ok(found.some((p) => p.includes('WINDOW_GROUND') && p.includes('#ffffff')),
    `expected the drift to be caught, got:\n${found.join('\n')}`);
});

// ---- The controls: each corrected form must PASS -------------------------------------------------

test('control_the corrected forms of all six are clean', () => {
  assert.deepEqual(problems({}), [], 'the baseline fixture must be clean or every test above is meaningless');
  assert.deepEqual(problems({
    'desktop/src/renderer/shell.css': '.nav-pill { background: var(--accent-tint-selected); }\n',
    'desktop/src/renderer/styles.css': '.diagnostics { background: var(--well); }\n',
    'desktop/src/renderer/icons.ts': "const g = '<stop stop-color=\"var(--accent)\"/>';\n",
  }), []);
});

test('control_an overlay token read with its own alpha is a use, not a literal', () => {
  assert.deepEqual(problems({
    'desktop/src/renderer/shell.css':
      '.x { background: rgba(var(--overlay-rgb), 0.04); border: 1px solid rgba(var(--overlay-rgb), 0.07); }\n',
  }), [], 'rgba(var(--x), a) is the fix this guard exists to produce');
});

test('control_color-mix black is a mixing primitive, not a palette choice', () => {
  assert.deepEqual(problems({
    'desktop/src/renderer/shell.css':
      '.y { color: color-mix(in srgb, rgb(var(--tint-blue-rgb)), #000 var(--tint-darken)); }\n',
  }), []);
});

test('control_a CSS comment naming a hex is a mention', () => {
  assert.deepEqual(problems({
    'desktop/src/renderer/styles.css': '/* This used to be #111219, hardcoded, twice. */\n.z { background: var(--well); }\n',
  }), [], 'the prose explaining a banned colour must not be read as the colour');
});

test('control_an HTML comment naming a colour is a mention', () => {
  assert.deepEqual(problems({
    'desktop/src/renderer/index.html': '<!-- a 6px green dot once the window is open -->\n<div></div>\n',
  }), []);
});

test('control_white-space is not a colour', () => {
  assert.deepEqual(problems({
    'desktop/src/renderer/styles.css': '.w { white-space: nowrap; }\n',
  }), [], 'the first version of this sweep reported 20 of these');
});

test('control_a non-colour token needs no light value', () => {
  assert.deepEqual(problems({}), [], '--space-1 and --radius-pill are in the fixture and must not be demanded in light');
});

// ---- The allowlist has to be pruned -------------------------------------------------------------

test('an allowlist entry that matches no token fails, so the list cannot rot', () => {
  const found = problems({
    'desktop/src/renderer/tokens.css': TOKENS_OK.replace('  --qr-ground: #123456;\n', ''),
  });
  assert.ok(found.some((p) => p.includes('--qr-ground') && p.includes('prune it')),
    `an allowlist entry for a token nobody declares must be pruned: ${found.join('\n')}`);
});

test('a token that is BOTH allowlisted and overridden in light is a contradiction', () => {
  const found = problems({
    'desktop/src/renderer/tokens.css': TOKENS_OK.replace(
      "  --accent: #5b4ae0;", "  --accent: #5b4ae0;\n  --qr-ground: #f0f0f0;"),
  });
  assert.ok(found.some((p) => p.includes('--qr-ground') && p.includes('remove one')),
    `"same in both" and a light override cannot both be true: ${found.join('\n')}`);
});

// ---- The matchers, directly ---------------------------------------------------------------------

test('colorCalls is paren-balanced, which is what the first version got wrong', () => {
  assert.deepEqual(colorCalls('rgba(var(--overlay-rgb), 0.04)'), ['rgba(var(--overlay-rgb), 0.04)']);
  assert.deepEqual(literalsIn('rgba(var(--overlay-rgb), 0.04)'), [],
    'a token read must not be reported — this produced 103 false positives on the first run');
  assert.deepEqual(literalsIn('rgba(255, 255, 255, 0.04)'), ['rgba(255, 255, 255, 0.04)']);
});

test('isColorToken separates a colour from a length, a duration and a font', () => {
  assert.equal(isColorToken('#07070a'), true);
  assert.equal(isColorToken('rgba(14, 15, 21, 0.72)'), true);
  assert.equal(isColorToken('139, 107, 255'), true, 'an rgb triple is a colour');
  assert.equal(isColorToken('4px'), false);
  assert.equal(isColorToken('cubic-bezier(0.22, 1, 0.36, 1)'), false);
  assert.equal(isColorToken('600 31px/35.65px var(--font-ui)'), false);
  assert.equal(isColorToken('0%'), false, '--tint-darken is a percentage, not a colour');
});

test('control_both comment strippers preserve line numbers', () => {
  assert.equal(stripComments('a\n/* x\ny */\nb').split('\n').length, 4);
  assert.equal(stripHtmlComments('a\n<!-- x\ny -->\nb').split('\n').length, 4);
});
