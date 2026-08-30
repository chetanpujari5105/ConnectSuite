/**
 * The three stylesheets must not define the same selector twice.
 *
 * ### The defect this is named for, which happened three times in one sitting
 *
 * `tokens.css`, `shell.css` and `styles.css` load in that order into one cascade. Two rules with
 * the same specificity are resolved by document order, so **the later sheet silently wins** — and
 * silently is the whole problem: nothing errors, nothing logs, `tsc` is clean, the tests are green,
 * and the app renders wrong in a way that looks like a design decision.
 *
 * It cost three separate bugs on 2026-08-30, each found by eye:
 *
 * | Duplicated in styles.css | What it overrode | What was on screen |
 * |---|---|---|
 * | `:root` | every colour token | `--accent: #6ea8fe` — the design's violet never once drawn |
 * | `:root` | `--bg` vs `--canvas` | every translucent surface composited over a ground nine steps too light |
 * | `.toolbar-button` | `.mirror-only { display: none }` | the Floating window button drawn on all eleven screens |
 *
 * All three are the same mistake, so this is the enforcement point rather than a fourth fix. The
 * rule it holds: **a selector belongs to exactly one sheet.** tokens.css owns `:root` and the two
 * global requirements (`:focus-visible`, reduced motion); shell.css owns the frame; styles.css owns
 * what lives inside a screen. If a shell component needs changing, it is changed in shell.css.
 *
 * **Shown to fail**: re-adding `.toolbar-button { display: inline-flex }` to styles.css turns
 * "no selector is defined in two sheets" red and names the selector and both files. Put back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHEETS = ['tokens.css', 'shell.css', 'styles.css'] as const;

/**
 * Every selector a sheet declares at the top level, lower-cased and whitespace-normalised.
 *
 * Rules nested inside an at-rule (`@media`, `@keyframes`, `@supports`) are deliberately skipped:
 * a `*` inside `@media (prefers-reduced-motion)` and a `*` at the top level are not the same rule
 * and do not fight, and treating them as a collision would make this test cry wolf on the one
 * genuinely shared declaration in the codebase.
 */
function topLevelSelectors(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Set<string>();
  let depth = 0;
  let head = '';

  for (let i = 0; i < withoutComments.length; i += 1) {
    const character = withoutComments[i]!;
    if (character === '{') {
      depth += 1;
      if (depth === 1) {
        const selector = head.trim();
        // An at-rule opens a nested block; everything inside it is skipped by the depth check.
        if (!selector.startsWith('@')) {
          for (const part of selector.split(',')) {
            const normalised = part.trim().replace(/\s+/g, ' ').toLowerCase();
            if (normalised) found.add(normalised);
          }
        }
      }
      head = '';
    } else if (character === '}') {
      depth = Math.max(0, depth - 1);
      head = '';
    } else if (depth === 0) {
      head += character;
    }
  }
  return found;
}

const read = (name: string): string =>
  readFileSync(join(__dirname, name), 'utf8');

test('no selector is defined in two sheets', () => {
  const bySheet = SHEETS.map((name) => [name, topLevelSelectors(read(name))] as const);
  const clashes: string[] = [];

  for (let i = 0; i < bySheet.length; i += 1) {
    for (let j = i + 1; j < bySheet.length; j += 1) {
      const [nameA, a] = bySheet[i]!;
      const [nameB, b] = bySheet[j]!;
      for (const selector of a) {
        if (b.has(selector)) clashes.push(`"${selector}" is in both ${nameA} and ${nameB}`);
      }
    }
  }

  assert.deepEqual(
    clashes,
    [],
    'a duplicated selector is resolved by load order, silently:\n  ' + clashes.join('\n  '),
  );
});

test('control_the collision check can see a collision', () => {
  // An absence is only evidence once the same query has returned a known positive. This is the
  // exact shape of the three bugs above, run through the same predicate.
  const a = topLevelSelectors('.toolbar-button { display: flex }');
  const b = topLevelSelectors('.toolbar-button { display: inline-flex }');
  assert.ok([...a].some((s) => b.has(s)), 'the predicate failed to notice an identical selector');
});

test('control_the parser does not report an at-rule body as a top-level rule', () => {
  // The other half: a `*` inside @media and a `*` at the top level must not read as a collision,
  // or the test above cries wolf on the reduced-motion block and gets deleted by whoever it wakes.
  const media = topLevelSelectors('@media (prefers-reduced-motion: reduce) { * { animation: none } }');
  assert.deepEqual([...media], []);
  const both = topLevelSelectors('* { box-sizing: border-box }\n@media print { * { color: black } }');
  assert.deepEqual([...both], ['*']);
});

test('only tokens.css declares a colour token', () => {
  // The narrower rule behind the first two bugs, checked directly: a `--token: value` definition
  // outside tokens.css is a second source of truth for a colour, and the cascade decides which one
  // wins by file order rather than by anyone's intent.
  for (const name of ['shell.css', 'styles.css']) {
    const definitions = read(name).replace(/\/\*[\s\S]*?\*\//g, '').match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
    // --dock-tint is set as an inline style per tile from navModel.DOCK, never declared in a sheet.
    assert.deepEqual(
      definitions.map((d) => d.trim()),
      [],
      `${name} declares its own custom properties; they belong in tokens.css`,
    );
  }
});
