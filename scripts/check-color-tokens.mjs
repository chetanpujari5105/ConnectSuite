#!/usr/bin/env node
/*
 * A colour written outside `tokens.css` is a colour that will be wrong in one of the two themes.
 *
 * ### Why this exists
 *
 * Four sightings before light mode was built, each found by eye and each after it had shipped:
 * styles.css's own `:root` block, which loaded second and silently beat the token sheet on
 * `--accent` and `--bg`; `.nav-pill`'s hardcoded tint; the `#111219` well with no token; and the
 * `accent-color: auto` that drew the user's macOS accent on two sliders. `stylesheets.test.ts`
 * caught the *first* shape — a stray `--token:` declaration — and by construction cannot see the
 * others, because they are raw values rather than declarations. tokens.css says so in a comment.
 *
 * The sweep that preceded light mode found **150 raw literals against 856 colour-valued
 * declarations**, plus five colour sources outside CSS entirely — `CATEGORY_TINTS`, the nav tints,
 * an SVG gradient still carrying a superseded accent, and both `BrowserWindow` grounds.
 *
 * Light mode doubles the cost of every one of them: a literal is merely *unthemed* in a one-theme
 * app and *wrong* in a two-theme one.
 *
 * ### The discriminator, which is the whole guard
 *
 * This repo has been bitten four times by a search that matched the prose *about* the thing it
 * forbids — a degraded banner apologising for an absent affordance, a `why` string explaining a
 * banned phrase. So:
 *
 *  - **comments are stripped before matching**, in CSS and in TS, because tokens.css's own prose
 *    quotes `#f3f2f2`, `#ec3013` and `#8b6bff` and every one is a mention rather than a use;
 *  - **only colour-valued declarations count.** `white-space: nowrap` contains the word `white`
 *    and is not a colour. The first version of this sweep reported 20 such lines as violations;
 *  - **`#000` / `#fff` inside `color-mix()` are mixing primitives, not palette choices**, and are
 *    permitted. `color-mix(in srgb, rgb(var(--tint-blue-rgb)), #000 var(--tint-darken))` names no
 *    colour — it darkens whatever the token holds, which is the mechanism light mode runs on.
 *
 * ### What it checks
 *
 *  1. No raw colour literal in a colour-valued declaration outside tokens.css.
 *  2. No colour literal in renderer or shared TypeScript, or in the two HTML files.
 *  3. **Every colour token declared for dark has a light counterpart**, or an allowlist entry with
 *     a reason. This is the check that actually keeps light mode alive: adding a dark token and
 *     forgetting the light one is silent, renders fine in the theme you are looking at, and is
 *     found by a user on the other one.
 *  4. The two `BrowserWindow` grounds in `shared/appearance.ts` equal `--canvas` and
 *     `--float-canvas` for both themes. Those are painted before any stylesheet loads, so they
 *     cannot read a token and have to be kept in step by hand — which is a rule enforced by
 *     someone remembering unless something checks it.
 *
 * Exit 0 clean, 1 on any violation. Prints what it read and how much of it, because an instrument
 * that hides its own bounds produces results shaped by those bounds.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const TOKENS = 'desktop/src/renderer/tokens.css';
const SHEETS = [
  'desktop/src/renderer/shell.css',
  'desktop/src/renderer/styles.css',
  'desktop/src/renderer/float.css',
];
const SOURCES = [
  'desktop/src/renderer',
  'desktop/src/shared',
];
const HTML = ['desktop/src/renderer/index.html', 'desktop/src/renderer/float.html'];

/*
 * Tokens that are deliberately the SAME in both themes, each with the reason.
 *
 * An allowlist nobody prunes is how a guard stops guarding, so an entry that no longer matches a
 * declared token is itself a failure — the same rule `check-apps-verb.mjs` applies to its debt list.
 */
export const SAME_IN_BOTH = new Map([
  ['--media-scrim', 'sits over an arbitrary user photo; a light scrim over a light photo is unreadable'],
  ['--media-scrim-soft', 'as --media-scrim'],
  ['--text-on-media', 'white, because it sits on --media-scrim, which does not invert'],
  ['--text-on-media-dim', 'as --text-on-media — the hint weight on the same scrim'],
  ['--qr-ground', 'a QR code is a data matrix; invert it and it stops scanning'],
  ['--traffic-close', "macOS's own window-control colour, which does not change with the system theme"],
  ['--traffic-min', 'as --traffic-close'],
  ['--traffic-zoom', 'as --traffic-close'],
  ['--switch-knob', 'white in both: it sits on --accent when on and --switch-track when off'],
  // The Now Playing card, dark in both themes. Same argument as --media-scrim and not a new one:
  // a surface whose subject is an arbitrary user image does not invert. tokens.css carries it in
  // full, including the one line that matters — this is not a licence for a second dark island.
  ['--np-surface', 'the media card does not invert; its subject is an album cover — see tokens.css'],
  ['--np-surface-top', 'as --np-surface'],
  ['--np-text', 'as --np-surface — it sits on it'],
  ['--np-text-dim', 'as --np-surface'],
  ['--np-text-meta', 'as --np-surface'],
  ['--np-control', 'as --np-surface'],
  ['--np-control-hover', 'as --np-surface'],
  ['--np-hairline', 'as --np-surface'],
  ['--np-track', 'as --np-surface'],
  ['--np-knob', 'white on a dark card that does not invert'],
  ['--fill-on-bubble', 'black at low alpha, on --bubble-out, which is violet in both themes'],
  ['--tint-violet-rgb', 'a hue, not a drawn colour — --tint-darken adapts it'],
  ['--tint-blue-rgb', 'as --tint-violet-rgb'],
  ['--tint-teal-rgb', 'as --tint-violet-rgb'],
  ['--tint-amber-rgb', 'as --tint-violet-rgb'],
  ['--tint-green-rgb', 'as --tint-violet-rgb'],
  ['--tint-cyan-rgb', 'as --tint-violet-rgb'],
  ['--tint-pink-rgb', 'as --tint-violet-rgb'],
  ['--tint-red-rgb', 'as --tint-violet-rgb'],
  ['--tint-grey-rgb', 'as --tint-violet-rgb'],
  ['--text-on-bubble', 'white in both: --bubble-out is a violet dark enough for white in each theme'],
]);

const COLOR_PROPS = new Set([
  'color', 'background', 'background-color', 'background-image', 'border', 'border-top',
  'border-right', 'border-bottom', 'border-left', 'border-color', 'border-top-color',
  'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', 'text-shadow',
  'outline', 'outline-color', 'fill', 'stroke', 'caret-color', 'accent-color', 'scrollbar-color',
  'text-decoration-color', 'column-rule', 'column-rule-color',
]);
const NAMED = new Set(['white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
  'pink', 'gray', 'grey', 'silver', 'gold', 'cyan', 'magenta', 'lime', 'navy', 'teal', 'olive',
  'maroon', 'aqua', 'fuchsia']);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** Strip block comments, preserving line numbers so a report points at the right line. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * HTML comments too, and this is not a detail.
 *
 * `index.html` explains the float button's "6px green dot", and `float.html` explains why the
 * green traffic light smart-fits — both are prose *about* a colour, and both were reported as
 * violations by the first run. Same discriminator as everywhere else in this repo: a guard that
 * searches for a forbidden thing finds the sentence forbidding it.
 */
export function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Strip `//` line comments too, for TypeScript. */
export function stripTsComments(src) {
  return stripComments(src).replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p);
}

/**
 * Blank out every `name(...)` call of the given function, balanced-paren aware.
 *
 * Paren balance is not fussiness: every colour function in this codebase now nests another —
 * `rgba(var(--overlay-rgb), 0.04)`, `color-mix(in srgb, rgb(var(--tint-blue-rgb)), #000 …)`. A
 * `[^)]*` regex stops at the **first** close paren, which reports `rgba(var(--overlay-rgb)` as a
 * literal. That is this checker's own version of the mistake it exists to catch: a query that
 * cannot tell its target from something that resembles it. It produced 103 confident false
 * positives on its first run, every one of them a correct token read.
 */
function stripCall(value, name) {
  let out = '', i = 0;
  const open = `${name}(`;
  while (i < value.length) {
    const at = value.indexOf(open, i);
    if (at === -1) { out += value.slice(i); break; }
    out += value.slice(i, at);
    let depth = 0, j = at + open.length - 1;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')') { depth--; if (depth === 0) { j++; break; } }
    }
    i = j;
  }
  return out;
}

export function stripColorMix(value) {
  return stripCall(value, 'color-mix');
}

/**
 * Every balanced `rgb()/rgba()/hsl()/hsla()` call in a value, split into the ones that **read a
 * token** and the ones that name a colour. `rgba(var(--overlay-rgb), 0.04)` is the fix; the alpha
 * carries the meaning and the base comes from the theme.
 */
export function colorCalls(value) {
  const calls = [];
  const re = /\b(rgba?|hsla?)\(/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    let depth = 0, j = m.index + m[0].length - 1;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')') { depth--; if (depth === 0) { j++; break; } }
    }
    calls.push(value.slice(m.index, j));
    re.lastIndex = j;
  }
  return calls;
}

/** Colour literals in one declaration value, with color-mix operands removed. */
export function literalsIn(value) {
  const v = stripColorMix(value);
  const found = [];
  // A colour function that reads a custom property is a token use, not a literal.
  const calls = colorCalls(v);
  for (const call of calls) if (!/var\(--/.test(call)) found.push(call);
  // Hexes and named colours, outside any colour function (their args are numbers, not hexes).
  let bare = v;
  for (const call of calls) bare = bare.replace(call, ' ');
  found.push(...(bare.match(HEX) || []));
  for (const w of bare.split(/[\s,()/]+/)) if (NAMED.has(w.toLowerCase())) found.push(w);
  return found;
}

/** Every `prop: value` declaration in a sheet, with its line. */
export function declarations(src) {
  const clean = stripComments(src);
  const out = [];
  const re = /([-a-zA-Z]+)\s*:\s*([^;{}]*)[;}]/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    out.push({
      prop: m[1].toLowerCase(),
      value: m[2].trim(),
      line: clean.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

/** Does this token's value hold a colour? An rgb triple counts; a length or a duration does not. */
export function isColorToken(value) {
  const v = stripColorMix(value);
  HEX.lastIndex = 0;
  if (HEX.test(v)) { HEX.lastIndex = 0; return true; }
  if (/\b(?:rgba?|hsla?)\(/.test(v)) return true;
  if (/^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/.test(v)) return true;
  return false;
}

export function tokenBlock(src, selector) {
  const clean = stripComments(src);
  const at = clean.indexOf(selector);
  if (at === -1) return new Map();
  let depth = 0, start = -1, end = -1;
  for (let i = at; i < clean.length; i++) {
    if (clean[i] === '{') { if (depth === 0) start = i + 1; depth++; }
    else if (clean[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = clean.slice(start, end);
  const out = new Map();
  const re = /(--[-a-zA-Z0-9]+)\s*:\s*([^;]*);/g;
  let m;
  while ((m = re.exec(body)) !== null) out.set(m[1], m[2].trim());
  return out;
}

/**
 * `root` is a parameter so the test can point the whole checker at a fixture tree.
 *
 * Not a convenience: the alternative is testing the exported matchers and trusting the wiring, and
 * the wiring is where two of this repo's guards had holes — one enumerated the wrong surface, one
 * passed with the thing it was named for deleted. The fixtures below run the real `run()`.
 */
export function run(root = REPO) {
  const R = (p) => join(root, p);
  const ROOT = root;
  const problems = [];
  const notes = [];
  let declCount = 0, colorDeclCount = 0, filesRead = 0;

  // ---- 1 · raw literals in the stylesheets
  for (const rel of SHEETS) {
    const path = R(rel);
    if (!existsSync(path)) { problems.push(`missing sheet: ${rel}`); continue; }
    filesRead++;
    for (const d of declarations(readFileSync(path, 'utf8'))) {
      declCount++;
      if (!COLOR_PROPS.has(d.prop) && !d.prop.startsWith('--')) continue;
      const lits = literalsIn(d.value);
      if (lits.length === 0) continue;
      colorDeclCount++;
      if (d.prop.startsWith('--')) {
        problems.push(`${rel}:${d.line}  declares a custom property with a colour — tokens.css owns colour\n      ${d.prop}: ${d.value}`);
      } else {
        problems.push(`${rel}:${d.line}  raw colour ${lits.join(', ')} — use a token from tokens.css\n      ${d.prop}: ${d.value}`);
      }
    }
  }

  // ---- 2 · literals in TypeScript and HTML
  const walk = (dir) => {
    const out = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.ts$/.test(name) && !/\.test\.ts$|\.testkit\.ts$/.test(name)) out.push(full);
    }
    return out;
  };
  for (const relDir of SOURCES) {
    const dir = R(relDir);
    if (!existsSync(dir)) continue;
    for (const full of walk(dir)) {
      /*
       * The one exempt file, and it is exempt because it *cannot* read a token: `backgroundColor`
       * is painted by AppKit before any stylesheet loads. Exempting it would be a hole, so check 4
       * below asserts both of its values equal `--canvas` and `--float-canvas` in both themes —
       * the exemption and the thing that makes it safe are the same commit.
       */
      if (/shared\/appearance\.ts$/.test(full)) { filesRead++; continue; }
      filesRead++;
      const src = stripTsComments(readFileSync(full, 'utf8'));
      const rel = relative(ROOT, full);
      src.split('\n').forEach((line, i) => {
        for (const lit of literalsIn(line)) {
          // A token reference inside a string is the fix, not the defect.
          if (/var\(--/.test(line)) continue;
          problems.push(`${rel}:${i + 1}  colour literal ${lit} in source — put it in tokens.css and read it with var()\n      ${line.trim().slice(0, 110)}`);
        }
      });
    }
  }
  for (const rel of HTML) {
    const path = R(rel);
    if (!existsSync(path)) continue;
    filesRead++;
    const src = stripHtmlComments(stripComments(readFileSync(path, 'utf8')));
    src.split('\n').forEach((line, i) => {
      if (/var\(--/.test(line)) return;
      for (const lit of literalsIn(line)) {
        problems.push(`${rel}:${i + 1}  colour literal ${lit} in markup\n      ${line.trim().slice(0, 110)}`);
      }
    });
  }

  // ---- 3 · every dark colour token has a light counterpart
  const tokenSrc = readFileSync(R(TOKENS), 'utf8');
  filesRead++;
  const dark = tokenBlock(tokenSrc, ':root {');
  const light = tokenBlock(tokenSrc, ":root[data-theme='light']");
  if (light.size === 0) problems.push(`${TOKENS}: no :root[data-theme='light'] block found`);
  const colorTokens = [...dark].filter(([, v]) => isColorToken(v)).map(([k]) => k);
  for (const name of colorTokens) {
    if (light.has(name)) continue;
    if (SAME_IN_BOTH.has(name)) continue;
    problems.push(`${TOKENS}: --${name.slice(2)} is a colour and has no light value.\n      Override it in :root[data-theme='light'], or add it to SAME_IN_BOTH with the reason.`);
  }
  for (const [name, reason] of SAME_IN_BOTH) {
    if (!dark.has(name)) {
      problems.push(`allowlist entry ${name} matches no declared token — prune it (reason was: ${reason})`);
    } else if (light.has(name)) {
      problems.push(`allowlist entry ${name} says "same in both" and a light override exists — remove one.`);
    }
  }

  // ---- 4 · the grounds painted before any stylesheet loads
  const appearance = R('desktop/src/shared/appearance.ts');
  if (existsSync(appearance)) {
    filesRead++;
    const src = stripTsComments(readFileSync(appearance, 'utf8'));
    const pick = (name) => {
      const m = new RegExp(`${name}[^=]*=\\s*\\{([^}]*)\\}`).exec(src);
      if (!m) return null;
      const dm = /dark:\s*'([^']+)'/.exec(m[1]);
      const lm = /light:\s*'([^']+)'/.exec(m[1]);
      return dm && lm ? { dark: dm[1].toLowerCase(), light: lm[1].toLowerCase() } : null;
    };
    const pairs = [
      ['WINDOW_GROUND', '--canvas'],
      ['FLOAT_GROUND', '--float-canvas'],
    ];
    for (const [constName, token] of pairs) {
      const got = pick(constName);
      if (!got) { problems.push(`shared/appearance.ts: could not read ${constName}`); continue; }
      const wantDark = (dark.get(token) || '').toLowerCase();
      const wantLight = (light.get(token) || '').toLowerCase();
      if (got.dark !== wantDark) problems.push(`shared/appearance.ts: ${constName}.dark is ${got.dark}, tokens.css ${token} (dark) is ${wantDark}`);
      if (got.light !== wantLight) problems.push(`shared/appearance.ts: ${constName}.light is ${got.light}, tokens.css ${token} (light) is ${wantLight}`);
      if (got.dark === wantDark && got.light === wantLight) {
        notes.push(`${constName} matches ${token} in both themes (${got.dark} / ${got.light})`);
      }
    }
  }

  return { problems, notes, declCount, colorDeclCount, colorTokens: colorTokens.length,
           lightTokens: light.size, filesRead };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = run();
  console.log('check-color-tokens');
  console.log(`  read ${r.filesRead} files — ${SHEETS.length} stylesheets, ${SOURCES.length} source trees, ${HTML.length} html`);
  console.log(`  ${r.declCount} declarations parsed; ${r.colorTokens} colour tokens in dark, ${r.lightTokens} declarations in the light block`);
  for (const n of r.notes) console.log(`  ok   ${n}`);
  if (r.problems.length === 0) {
    console.log('  OK — every colour outside tokens.css reads a token, and every colour token has both themes');
    process.exit(0);
  }
  console.log(`\n  ${r.problems.length} problem(s):\n`);
  for (const p of r.problems) console.log(`   ✗ ${p}`);
  process.exit(1);
}
