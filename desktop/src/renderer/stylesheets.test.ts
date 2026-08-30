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
/**
 * Every top-level selector a sheet declares, **with the line it was declared on**.
 *
 * Comments are blanked to spaces rather than removed, so line numbers survive.
 */
function topLevelSelectorLines(css: string): Map<string, number[]> {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const found = new Map<string, number[]>();
  let depth = 0;
  let head = '';
  let line = 1;

  for (const character of blanked) {
    if (character === '\n') line += 1;
    if (character === '{') {
      depth += 1;
      if (depth === 1) {
        const selector = head.trim();
        if (!selector.startsWith('@')) {
          for (const part of selector.split(',')) {
            const normalised = part.trim().replace(/\s+/g, ' ').toLowerCase();
            if (normalised) {
              const at = found.get(normalised) ?? [];
              at.push(line);
              found.set(normalised, at);
            }
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

/**
 * How far apart two declarations of one selector may sit before the earlier one is presumed dead.
 *
 * From the data, not from taste. When this rule was written, every *deliberate* override in the
 * codebase sat 5–19 lines from what it overrode (`.island-dot`, `body`, `.stop-button`), and a
 * whole dead pre-redesign notification block sat 408–593 lines from its live replacement. There was
 * nothing in between, so 100 separates the two populations with an order of magnitude to spare.
 */
const DEAD_DECLARATION_GAP = 100;

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

test('no selector is declared twice in one sheet, far apart', () => {
  /*
   * The between-sheets rule above has an inside-one-sheet twin, and it cost a real defect.
   *
   * `styles.css` carried the entire pre-redesign notification block — `.notif-row`, `.notif-head`,
   * `.notif-title` and six more — 400 to 600 lines above their live replacements. The later
   * declarations silently won, exactly as a later *sheet* does, so the file's own top-down reading
   * described a row the app had not drawn since the pane was rebuilt. It was found by measuring the
   * row against the prototype (ours was 28px taller) and then discovering the padding that
   * explained it was in the second of two declarations.
   *
   * Adjacent re-declaration is legitimate and is not flagged: a rule that deliberately overrides
   * the one above it is readable precisely because it is next to it.
   */
  const offences: string[] = [];
  for (const name of SHEETS) {
    for (const [selector, lines] of topLevelSelectorLines(read(name))) {
      if (lines.length < 2) continue;
      const gap = Math.max(...lines) - Math.min(...lines);
      if (gap > DEAD_DECLARATION_GAP) {
        offences.push(`${name}: "${selector}" declared on lines ${lines.join(', ')} (${gap} apart)`);
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    'a re-declaration this far from the original is a dead block, not an override:\n  ' +
      offences.join('\n  '),
  );
});

test('control_the dead-declaration check can see a dead block, and lets an override through', () => {
  // Both halves. A check that only ever says "clean" is the shape this repo keeps recording, and a
  // check that flags every legitimate override gets deleted by the first person it wakes.
  const dead = ['.a { color: red }', ...Array(120).fill('/* x */'), '.a { color: blue }'].join('\n');
  const deadLines = topLevelSelectorLines(dead).get('.a')!;
  assert.ok(Math.max(...deadLines) - Math.min(...deadLines) > DEAD_DECLARATION_GAP);

  const override = '.a { color: red }\n.a { color: blue }';
  const overrideLines = topLevelSelectorLines(override).get('.a')!;
  assert.ok(Math.max(...overrideLines) - Math.min(...overrideLines) <= DEAD_DECLARATION_GAP);
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

/**
 * Where a selector is declared, as one comparable position in the single cascade the three sheets
 * form. Sheet order first, then line — which is exactly how the browser breaks a specificity tie.
 */
function declarationPosition(selector: string): { sheet: string; line: number } | null {
  for (let i = 0; i < SHEETS.length; i += 1) {
    const name = SHEETS[i]!;
    const lines = topLevelSelectorLines(read(name)).get(selector.toLowerCase());
    if (lines && lines.length) return { sheet: name, line: i * 1_000_000 + Math.min(...lines) };
  }
  return null;
}

/** Every class that shares an element with the `button` class, read from the markup. */
function buttonModifierClasses(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    const classes = match[1]!.trim().split(/\s+/).filter(Boolean);
    if (!classes.includes('button')) continue;
    for (const c of classes) if (c !== 'button') found.add(c);
  }
  return [...found];
}

test('a .button modifier is declared after the base button rule', () => {
  /*
   * The between-sheets rule above catches *the same selector* in two sheets. This catches the
   * other half of the same defect: two **different** selectors that collide on one element at
   * equal specificity, where document order decides and the later sheet wins silently.
   *
   * It is named for `.primary-action`, the Overview screen's call to action. It was declared in
   * shell.css with `background: var(--accent); color: #fff; font-weight: 600`, and none of it ever
   * reached the screen. The element is `class="button primary-action"`, so the base rule
   * `button, .button` in styles.css matched it through `.button` — specificity (0,1,0), a tie with
   * `.primary-action`, broken by load order in styles.css's favour. It took `background` and
   * `color`, and `font-weight` too, since `font:` is a shorthand that resets the weight.
   *
   * The result was a primary CTA that drew as a plain secondary control, on the first screen of the
   * app, looking entirely deliberate. `tsc` was clean and 110 tests were green.
   *
   * The invariant, derived from the markup rather than from a hand-kept list: **every class that
   * shares an element with `button` must be declared later in the cascade than the base rule**, so
   * that its intent survives the tie. Adding a new modifier to index.html and putting it in
   * shell.css turns this red.
   *
   * **Shown to fail**: moving `.primary-action` back to shell.css reports
   * `.primary-action is declared in shell.css, before the base button rule in styles.css`. Put back.
   */
  const html = read('index.html');
  const base = declarationPosition('.button');
  assert.ok(base, 'the base `button, .button` rule was not found in any sheet');

  const offences: string[] = [];
  for (const modifier of buttonModifierClasses(html)) {
    const at = declarationPosition(`.${modifier}`);
    if (!at) continue; // a class used only as a JS hook declares no rule and cannot lose a tie
    if (at.line < base!.line) {
      offences.push(
        `.${modifier} is declared in ${at.sheet}, before the base button rule in ${base!.sheet} — ` +
          'at equal specificity the base rule wins and this modifier draws nothing',
      );
    }
  }
  assert.deepEqual(offences, [], offences.join('\n  '));
});

test('control_the modifier check can see a modifier, and a losing position', () => {
  // Both halves, per the control rule. An empty offence list is only evidence once the same
  // predicate has been shown to find a modifier at all and to judge an order wrong.
  assert.deepEqual(
    buttonModifierClasses('<button class="button primary-action">x</button>').sort(),
    ['primary-action'],
    'the reader failed to find a modifier sharing an element with `button`',
  );
  assert.deepEqual(
    buttonModifierClasses('<button class="nav-row">x</button>'),
    [],
    'a button element without the `button` class has no tie to lose and must not be reported',
  );
  // shell.css is earlier in SHEETS than styles.css, so any line in it must lose to any line here.
  const inShell = 1 * 1_000_000 + 9_999;
  const inStyles = 2 * 1_000_000 + 1;
  assert.ok(inShell < inStyles, 'sheet order must dominate line number in the cascade position');
});
