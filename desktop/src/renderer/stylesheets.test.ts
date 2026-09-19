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
import { readFileSync, readdirSync } from 'node:fs';
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

// ---- Defect 88: a grid container may not also carry a definite block size ------------------------

/**
 * Every top-level rule, as `{ selector, body, sheet, line }`.
 *
 * The two parsers above answer "which selectors exist"; this one is needed because the defect below
 * is about **two declarations inside one body**, which a selector set cannot see.
 */
function declarationBlocks(css: string, sheet: string): Array<{
  selector: string;
  body: string;
  sheet: string;
  line: number;
}> {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const blocks: Array<{ selector: string; body: string; sheet: string; line: number }> = [];

  // A stack, because the first version of this walked depth with a single `head` and silently
  // dropped every rule nested inside an `@media` — which is a parser wrong in the **safe**
  // direction, the variety `CLAUDE.md` records as worse than no check at all, since it makes a
  // clean result look better-evidenced than it is. Its own control caught it, which is what the
  // control is for.
  //
  // The unit is the *innermost* block: a block whose body contains no `{` is a declaration block,
  // whatever it is nested in. An at-rule's outer block is therefore never mistaken for a rule.
  const stack: Array<{ head: string; line: number; start: number }> = [];
  let head = '';
  let line = 1;

  for (let i = 0; i < blanked.length; i += 1) {
    const character = blanked[i]!;
    if (character === '\n') line += 1;
    if (character === '{') {
      stack.push({ head: head.trim(), line, start: i + 1 });
      head = '';
    } else if (character === '}') {
      const open = stack.pop();
      if (open) {
        const body = blanked.slice(open.start, i);
        const selector = open.head.replace(/\s+/g, ' ');
        if (!body.includes('{') && selector && !selector.startsWith('@')) {
          blocks.push({ selector, body, sheet, line: open.line });
        }
      }
      head = '';
    } else {
      head += character;
    }
  }
  return blocks;
}

/** `display: grid` or `inline-grid`, ignoring `grid-template-*` and friends. */
const DECLARES_GRID = /(^|[;{\s])display\s*:\s*(inline-)?grid\b/;

/**
 * A **definite** block size. `min-height` is not one: it is a floor, it cannot shrink a track, and
 * several legitimate panels use it. `height: 100%` and `height: auto` are not one either — the
 * first inherits an indefiniteness and the second is the default.
 */
const DEFINITE_BLOCK_SIZE = /(^|[;{\s])(max-)?height\s*:\s*(?!auto|100%|inherit|none|fit-content)[^;}]*(px|vh|rem|em)\b/;

/**
 * The element scrolls its own overflow.
 *
 * This is the third condition and it is what makes the check *keepable*, which is worth stating
 * because the first version did not have it and was wrong in the expensive direction — not by
 * missing the defect, but by flagging eight rules that were all fine:
 *
 * | flagged | what it is |
 * |---|---|
 * | `.app-tile`, `.icon-button`, `.state-banner-glyph`, `.clip-phone-icon`, `.apps-tile-art` | `display: grid; place-items: center` on a fixed square — a **one-cell** grid, which has no row to collapse |
 * | `.recent-row`, `.call-row` | one row, height stated outright |
 * | `.apps-grid` | **a real instance**, and it had already met this defect once |
 *
 * Eight false positives against one true one is a guard that gets an exception list, and an
 * exception list nobody prunes is how a guard stops guarding. The discriminator that separates them
 * is not subtle once looked for: **the defect needs more than one row**, and the thing that
 * guarantees more than one row is that the grid is *also the scroller*. A one-cell centering box
 * never scrolls; a photo grid always does.
 */
const SCROLLS_ITSELF = /(^|[;{\s])overflow(-y)?\s*:\s*(auto|scroll)\b/;

/**
 * **Defect 88.** A grid container with a definite block size and `auto` rows sizes those rows
 * against the space it has rather than against its items' transferred `aspect-ratio` height — and
 * `aspect-ratio` on the item then wins anyway, so every item overflows the track it was given.
 *
 * Measured in the running app rather than reasoned about: the photo grid's 24 rows resolved to
 * **32px each** under **116px** tiles, so each tile bled 79px into the two below and the grid read
 * as five smeared vertical columns. `max-height: none` restored the rows to 119px; `overflow-y`,
 * `align-content: start` and `grid-auto-rows: auto` each changed nothing.
 *
 * ### Why this test is here and not in a view test
 *
 * `CLAUDE.md`'s defect-67 rule: when a defect is in a *write* a test cannot reach, adding tests at
 * the layer that is already correct does nothing. `photosView.test.ts` renders the pane against a
 * DOM double and passed throughout — a double has no layout, so a grid that has collapsed and a
 * grid that has not are the same tree. The fault is two CSS declarations in one body, and this file
 * is the only place in the repo that can see one.
 *
 * The fix is structural for the same reason: the scroller and the grid are different elements now,
 * so the combination cannot be re-created without also failing here.
 */
/** All three at once: a grid, a definite block size, and its own scrollbar. */
const isScrollingGridWithHeight = (body: string): boolean =>
  DECLARES_GRID.test(body) && DEFINITE_BLOCK_SIZE.test(body) && SCROLLS_ITSELF.test(body);

test('a scrolling grid never also carries its own height — the scroller is a separate element', () => {
  const offenders: string[] = [];
  for (const sheet of SHEETS) {
    for (const rule of declarationBlocks(read(sheet), sheet)) {
      if (isScrollingGridWithHeight(rule.body)) offenders.push(`${rule.sheet}:${rule.line} ${rule.selector}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'defect 88: a grid container with a definite block size sizes its auto rows against the space ' +
      'it has rather than against its items, and aspect-ratio items then overflow the tracks they ' +
      'were given — measured at 32px rows under 116px tiles. Split the scroller off the grid, as ' +
      `.photos-scroll/.photos-grid and .apps-scroll/.apps-grid do:\n  ${offenders.join('\n  ')}`,
  );
});

test('control_the grid-height check can see the defect it is named for', () => {
  // The verbatim rule that shipped, restored for the length of one assertion. Without this the
  // check passes identically against a regex that matches nothing — and it *did* pass against an
  // earlier draft whose `display:\s*grid` had no word boundary and so never fired on real CSS.
  const shipped = `.photos-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: var(--space-3);
  padding: var(--space-6);
  max-height: 560px;
  overflow-y: auto;
}`;
  const rules = declarationBlocks(shipped, 'fixture.css');
  assert.equal(rules.length, 1, 'control: the parser found the rule at all');
  assert.equal(DECLARES_GRID.test(rules[0]!.body), true, 'the check cannot see display:grid');
  assert.equal(DEFINITE_BLOCK_SIZE.test(rules[0]!.body), true, 'the check cannot see max-height:560px');
  assert.equal(SCROLLS_ITSELF.test(rules[0]!.body), true, 'the check cannot see overflow-y:auto');
  assert.equal(isScrollingGridWithHeight(rules[0]!.body), true, 'the whole predicate does not fire');
});

test('control_the check clears the eight shapes the first version wrongly flagged', () => {
  // Every one of these is real code from this repo that the two-condition version reported as a
  // defect. A guard whose true-positive rate is one in nine gets an exception list instead of a fix.
  const innocent = [
    `.app-tile { display: grid; place-items: center; width: 34px; height: 34px; }`,
    `.icon-button { width: 24px; height: 24px; display: grid; place-items: center; }`,
    `.state-banner-glyph { flex: none; width: 16px; height: 16px; display: grid; place-items: center; }`,
    `.clip-phone-icon { width: 18px; height: 18px; display: grid; place-items: center; }`,
    `.apps-tile-art { width: 48px; height: 48px; display: grid; place-items: center; }`,
    `.recent-row { display: grid; grid-template-columns: 74px 26px minmax(0, 1fr) auto; height: 52px; }`,
    `.call-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; height: 56px; }`,
    `.apps-grid { display: grid; grid-auto-rows: max-content; gap: 8px; }`,
  ];
  for (const css of innocent) {
    const rule = declarationBlocks(css, 'fixture.css')[0]!;
    assert.equal(isScrollingGridWithHeight(rule.body), false, `false positive on ${rule.selector}`);
  }
});

test('control_the grid-height check does not fire on the shapes that are fine', () => {
  const fine = [
    // A grid with no height at all — the fix.
    `.photos-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }`,
    // A scroller with a height and no grid — the other half of the fix.
    `.photos-scroll { padding: 14px; max-height: 560px; overflow-y: auto; }`,
    // A floor is not a definite size: it cannot shrink a track.
    `.thing { display: grid; min-height: 32px; }`,
    // `grid-template-rows` is not `display: grid`, and `height: auto` is not definite.
    `.other { grid-template-columns: 1fr; height: auto; max-height: 100%; }`,
  ];
  for (const css of fine) {
    const rule = declarationBlocks(css, 'fixture.css')[0]!;
    assert.equal(isScrollingGridWithHeight(rule.body), false, `false positive on: ${rule.selector}`);
  }
});

test('control_the block parser saw the real sheets, and sees inside @media', () => {
  // An empty rule list would make the check above vacuously green — the same shape as an empty
  // accessibility query, which reads as evidence and is not.
  const counts = SHEETS.map((s) => declarationBlocks(read(s), s).length);
  // The real shape, named rather than a round threshold, so a parser that starts dropping half the
  // file fails here instead of squeaking past a `> 20`. tokens.css is legitimately tiny — four
  // blocks, of which one is the `:root` carrying almost the whole sheet — and asserting a big
  // number for it is how the first draft of this control failed on correct code.
  const [tokens, shell, styles] = counts as [number, number, number];
  assert.ok(tokens >= 4, `tokens.css parsed to only ${tokens} declaration blocks`);
  assert.ok(shell > 150, `shell.css parsed to only ${shell} declaration blocks`);
  assert.ok(styles > 300, `styles.css parsed to only ${styles} declaration blocks`);

  // The half the first parser got wrong: a rule nested inside an at-rule is still a rule, and a
  // grid/height collision inside a media query is exactly as broken as one outside it.
  const nested = declarationBlocks(
    '@media (max-width: 700px) { .inner { display: grid; max-height: 400px; } }',
    'fixture.css',
  );
  assert.equal(nested.length, 1, 'the parser cannot see inside an at-rule');
  assert.equal(nested[0]!.selector, '.inner');
  assert.equal(
    isScrollingGridWithHeight(`${nested[0]!.body} overflow-y: auto;`),
    true,
    'the whole predicate does not fire inside an at-rule',
  );
});

// ---- Defect 90: the 32px button floor silently raises anything shorter --------------------------

/** The floor every button sits on, declared once in styles.css and read from it rather than typed. */
const BUTTON_FLOOR_PX = 32;

/**
 * Whether a selector names something that inherits the `button` floor.
 *
 * Only a `<button>` or a `.button` does — a `<span>` inside one does not, and neither does a
 * pseudo-element. Both of those were false positives on the first version of this check, which
 * matched the control vocabulary as a **substring** anywhere in the selector:
 *
 * | flagged | what it is |
 * |---|---|
 * | `.switch-knob` (18px) | the `<span>` **inside** the switch — matched on "switch" |
 * | `.pill-tab.unbuilt::after` (5px) | a 5px dot — matched on "tab" |
 *
 * So the test is on the **trailing token**: the last class in the selector, whole, against a
 * vocabulary of control suffixes. `switch-knob` is not `switch`; `-tab` still catches `.calls-tab`
 * and `.clip-tab`. Pseudo-elements are excluded outright — an `::after` is never a button.
 *
 * This is the same discipline the guard above it needed: a substring match over selector text finds
 * the thing's children and its decorations, and an exception list is not the fix.
 */
function looksLikeAControl(selector: string): boolean {
  if (selector.includes('::')) return false;
  for (const part of selector.split(',')) {
    const simple = part.trim().split(/[\s>+~]+/).pop() ?? '';
    const last = simple.split('.').pop() ?? '';
    if (/^button$/i.test(simple)) return true;
    if (/^(switch|button)$/i.test(last)) return true;
    if (/-(tab|button|btn|clear|disconnect|key)$/i.test(last)) return true;
  }
  return false;
}

/** An explicit pixel height, if the body declares one. */
function declaredHeightPx(body: string): number | null {
  const match = /(^|[;{\s])height\s*:\s*(\d+(?:\.\d+)?)px/.exec(body);
  return match ? Number(match[2]) : null;
}

/** `min-height: 0` — the only thing that releases the floor. */
const RELEASES_FLOOR = /(^|[;{\s])min-height\s*:\s*0(px)?\s*[;}]/;

/**
 * **Defect 90.** `button, .button { min-height: 32px }` is a floor, and a floor beats `height` in
 * the cascade — always, in every browser, silently.
 *
 * The base rule's own comment reasons only about controls that need to be *taller*: *"32px is the
 * design's control height and the floor everything sits on; anything that needs to be taller simply
 * is."* Nothing considered a control that needs to be **shorter**, and the design has several.
 *
 * Measured in the running app, each on its own routed pane, every one of them wrong since it was
 * written:
 *
 * | rule | declares | drew |
 * |---|---|---|
 * | `.switch` | `24px` | **32px** |
 * | `.calls-tab` | `28px` | **32px** |
 * | `.clip-tab` | `28px` | **32px** |
 * | `.clip-clear` | `28px` | **32px** |
 * | `.overview-disconnect` | `28px` | **32px** |
 *
 * The switch is the sharpest: its own comment says *"a 42×24 track, an 18px knob at 3px margin"*,
 * its declared value is exactly that, and inside a 32px track the knob sat 3px from the top and
 * 11px from the bottom — off-centre, on five panes, with the correct number written directly above
 * it.
 *
 * Nothing could have caught it. `tsc` is clean, no selector collides, the declaration is right, and
 * a screenshot of a toggle that is 8px too tall looks like a toggle. It was found by asking a
 * different question — *which rules declare a height under the floor?* — rather than by looking.
 */
test('a control shorter than the button floor releases it explicitly', () => {
  const offenders: string[] = [];
  for (const sheet of SHEETS) {
    for (const rule of declarationBlocks(read(sheet), sheet)) {
      const height = declaredHeightPx(rule.body);
      if (height === null || height >= BUTTON_FLOOR_PX) continue;
      if (RELEASES_FLOOR.test(rule.body)) continue;
      if (!looksLikeAControl(rule.selector)) continue;
      offenders.push(`${rule.sheet}:${rule.line} ${rule.selector} — height: ${height}px`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'defect 90: `button, .button { min-height: 32px }` beats `height` in the cascade, so each of ' +
      'these draws at 32px however tall it says it is. Add `min-height: 0` beside the height:\n  ' +
      offenders.join('\n  '),
  );
});

test('control_the floor check can see the defect it is named for', () => {
  // The verbatim rule that shipped for months, restored for one assertion.
  const shipped = `.switch {
  flex: none;
  width: 42px;
  height: 24px;
  padding: 0;
  border-radius: 999px;
}`;
  const rule = declarationBlocks(shipped, 'fixture.css')[0]!;
  assert.equal(declaredHeightPx(rule.body), 24, 'the check cannot read the declared height');
  assert.equal(RELEASES_FLOOR.test(rule.body), false, 'the check thinks an unreleased rule is released');
});

test('control_the floor check clears the shapes that are fine', () => {
  const fine = [
    // Released — the fix.
    `.switch { width: 42px; height: 24px; min-height: 0; }`,
    // At or above the floor: unaffected by it.
    `.toolbar-button { height: 32px; }`,
    `.dialkey { height: 52px; }`,
    // Not a control. A 7px dot is a span and inherits nothing from the button rule.
    `.activity-dot { width: 7px; height: 7px; }`,
    `.clip-step-dot { height: 24px; }`,
    // The two the first version of this check wrongly flagged, verbatim: a span **inside** the
    // switch, and a pseudo-element. Neither is a button and neither inherits the floor.
    `.switch-knob { width: 18px; height: 18px; margin: 3px; }`,
    `.pill-tab.unbuilt::after { width: 5px; height: 5px; }`,
  ];
  for (const css of fine) {
    const rule = declarationBlocks(css, 'fixture.css')[0]!;
    const height = declaredHeightPx(rule.body);
    const flagged =
      height !== null &&
      height < BUTTON_FLOOR_PX &&
      !RELEASES_FLOOR.test(rule.body) &&
      looksLikeAControl(rule.selector);
    assert.equal(flagged, false, `false positive on ${rule.selector}`);
  }
});

test('the floor is still 32px, and this test knows it from the sheet rather than from memory', () => {
  // A threshold typed from memory is a pass criterion quoting a string the code does not write —
  // this file's own sibling failure. If someone changes the base rule, this goes red rather than
  // guarding a number that no longer exists.
  const base = declarationBlocks(read('styles.css'), 'styles.css').find(
    (r) => r.selector === 'button, .button',
  );
  assert.ok(base, 'control: the base button rule was not found at all');
  assert.match(base!.body, new RegExp(`min-height:\\s*${BUTTON_FLOOR_PX}px`));
});

// ---- Defect 92: a custom property used but never declared ----------------------------------------

/**
 * Every `--name` a stylesheet declares, **plus every one the renderer sets at runtime**.
 *
 * The second half is not an allowance, it is the other half of the codebase. `--dock-tint` is set
 * per tile by `shell.ts` from `navModel.DOCK` and is deliberately absent from every sheet; so is
 * any property a pane sets per element. A check that read only the CSS would report such a one as
 * orphans, and the fix would be an exception list — which is how a guard stops guarding.
 *
 * Reading `setProperty('--x', …)` out of the TypeScript keeps one question with one answer: a
 * property is declared if *something in this app declares it*, wherever that is.
 */
function declaredProperties(): Set<string> {
  const declared = new Set<string>();
  for (const sheet of SHEETS) {
    for (const rule of declarationBlocks(read(sheet), sheet)) {
      for (const match of rule.body.matchAll(/(^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g)) {
        declared.add(match[2]!);
      }
    }
  }
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(__dirname, file), 'utf8');
    for (const match of source.matchAll(/setProperty\(\s*['"`](--[A-Za-z0-9_-]+)['"`]/g)) {
      declared.add(match[1]!);
    }
  }
  return declared;
}

/** Every `var(--name)` referenced, with where it was referenced from. */
function referencedProperties(): Array<{ name: string; where: string }> {
  const used: Array<{ name: string; where: string }> = [];
  for (const sheet of SHEETS) {
    for (const rule of declarationBlocks(read(sheet), sheet)) {
      for (const match of rule.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,|\))/g)) {
        // `var(--x, fallback)` is a deliberate optional read and cannot break: skip it.
        if (match[2] === ',') continue;
        used.push({ name: match[1]!, where: `${rule.sheet}:${rule.line} ${rule.selector}` });
      }
    }
  }
  return used;
}

/**
 * **Defect 92.** `var(--text-strong)` and `var(--text-muted)` were used **five times** and declared
 * nowhere.
 *
 * A custom property that has never been declared makes the whole declaration *invalid at
 * computed-value time*: the property is not skipped and it does not fall back to a sensible
 * default — it becomes `inherit`. So `color: var(--text-strong)` silently means *whatever my parent
 * is*, and nothing errors, nothing warns, `tsc` is clean and no selector collides.
 *
 * Measured in the running app before the fix. Two of the five were **correct by accident** —
 * `.ring-value` inherited `#f4f4f7`, which is what `--text-primary` would have given it anyway. The
 * other three were not: `.ring-caption` drew `#f4f4f7` where `--text-meta` (`#5b5e6e`) belonged, so
 * the caption *Charging* was set at exactly the weight of the 13px/600 value directly above it and
 * the pair had no hierarchy at all.
 *
 * That mixture is what makes this class of fault survive. Some of it looks right, some of it looks
 * like a design decision, and the same misspelling produces both.
 *
 * The guard is the natural sibling of *"only tokens.css declares a colour token"* one test up: that
 * one says where a token may be **born**, and this one says a token must be born before it is
 * **used**.
 */
test('every custom property used is declared somewhere', () => {
  const declared = declaredProperties();
  const orphans = referencedProperties().filter((one) => !declared.has(one.name));
  assert.deepEqual(
    orphans.map((o) => `${o.name} at ${o.where}`),
    [],
    'defect 92: an undeclared custom property makes the whole declaration invalid at ' +
      'computed-value time, so the property silently becomes `inherit` — it does not error and it ' +
      'does not fall back',
  );
});

test('control_the undeclared-property check can see the defect it is named for', () => {
  // The two verbatim rules that shipped, restored for one assertion.
  const shipped = `.ring-value { font-size: 13px; color: var(--text-strong); }
.ring-caption { font-size: 11px; color: var(--text-muted); }`;
  const declared = declaredProperties();
  const rules = declarationBlocks(shipped, 'fixture.css');
  assert.equal(rules.length, 2, 'control: the parser found both rules');
  const orphans = rules.flatMap((rule) =>
    [...rule.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)]
      .map((m) => m[1]!)
      .filter((name) => !declared.has(name)),
  );
  assert.deepEqual(orphans, ['--text-strong', '--text-muted']);
});

test('control_a fallback read is not an orphan, and a real token is not either', () => {
  // `var(--x, 260)` cannot break — the fallback is the point — and the apps and calls panes both
  // set a hue that way. Flagging those would be an exception list a week later.
  const declared = declaredProperties();
  const fine = `.tile { --tile-hue: 260; background: hsl(var(--tile-hue, 260) 60% 62%); color: var(--text-primary); }`;
  const rules = declarationBlocks(fine, 'fixture.css');
  const orphans = [...rules[0]!.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)]
    .map((m) => m[1]!)
    .filter((name) => !declared.has(name));
  assert.deepEqual(orphans, []);
});

test('control_the property scan saw a real number of declarations and uses', () => {
  // Both halves non-trivially non-empty, or the check above is vacuously green.
  const declared = declaredProperties();
  const used = referencedProperties();
  assert.ok(declared.size > 40, `only ${declared.size} custom properties declared`);
  assert.ok(used.length > 200, `only ${used.length} var() reads found`);
});

test('every class the renderer toggles for emphasis resolves to a rule', () => {
  /*
   * A class name that exists in no stylesheet is the empty-ring icon defect in CSS: `tsc` is clean,
   * a test asserting `classList.contains(name)` passes, and the element draws exactly as it did
   * before. It is only visible in a screenshot.
   *
   * It shipped once, in the line below's first version — `button-primary`, against a stylesheet
   * whose class is `primary-action` — and the write test that was supposed to cover it asserted the
   * class was *applied*, which is a claim about the string and not about the pixel.
   *
   * Scoped to the emphasis toggles rather than every class in the renderer: those are the ones
   * whose whole job is to change an appearance, so one that changes nothing is always a defect. A
   * general scan would need an allowlist for classes that exist only as query hooks.
   */
  const sheets = ['tokens.css', 'shell.css', 'styles.css']
    .map((f) => readFileSync(join(__dirname, f), 'utf8'))
    .join('\n');
  const renderer = readFileSync(join(__dirname, 'renderer.ts'), 'utf8');

  const toggled = [...renderer.matchAll(/classList\.toggle\(\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(toggled.length > 0, 'control — the scan found emphasis toggles to check');
  for (const name of toggled) {
    assert.ok(
      new RegExp(`\\.${name}\\b`).test(sheets),
      `renderer.ts toggles ".${name}" and no stylesheet defines it`,
    );
  }

  // The control, both ways: a name that is certainly there, and one that is certainly not.
  assert.ok(/\.primary-action\b/.test(sheets));
  assert.ok(!/\.button-primary\b/.test(sheets));
});
