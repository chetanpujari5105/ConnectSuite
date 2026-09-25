#!/usr/bin/env node
/*
 * Refuses a duration or an easing curve written by hand into a motion declaration, and a motion
 * token that nothing reads.
 *
 * ## Why this exists
 *
 * `tokens.css` has carried a motion scale since the native-macOS pass on 2026-09-17 — `--dur-press`,
 * `--dur-release`, `--dur-state`, `--ease`, `--ease-in-out` — with a paragraph of reasoning above
 * each one. It was still possible, and four surfaces did it, to write the number instead:
 *
 *   | `.clip-tab`                | `background 180ms var(--ease), color 180ms var(--ease)` |
 *   | `.hero-phone-spinner svg`  | `hero-spin 1.2s linear infinite`                        |
 *   | `.security-card … svg`     | `hero-spin 1.2s linear infinite`                        |
 *   | `.state-block … svg`       | `state-spin 900ms linear infinite`                      |
 *   | `.deep-reveal`             | `deep-reveal-flash 1.4s ease-out 1`                     |
 *
 * `.clip-tab`'s `180ms` is the one that makes this a guard rather than a tidy-up: it is **exactly**
 * `--dur-state`, typed out by hand, in a file whose token block explains what `--dur-state` is for.
 * Nothing was wrong on screen and nothing ever would have been — until the day somebody changes
 * `--dur-state` to 200ms and eleven surfaces move while the clipboard tabs stay behind. That is the
 * colour pass's finding in a different unit: **a literal is not drift while there is one author,
 * and it is wrong in the mode nobody is looking at the moment there are two.**
 *
 * ## The third rule, which is the colour guard's prune rule pointed at motion
 *
 * A motion token that nothing reads is a second opinion waiting to be adopted. `--dur-bar: 600ms`
 * sat in `tokens.css` marked `FIGMA` and was read by **nothing**; the bar it was named for animates
 * at `--dur-ring`, the same 600ms under a different name. Two tokens with one value are two places
 * for the next person to disagree about a duration, and the disagreement is invisible because both
 * are "the token".
 *
 * ## Its discriminator, which this repo has now paid for five times
 *
 * A guard that searches for a forbidden thing finds the sentence forbidding it. Comments are
 * stripped before anything is matched — this file's own header quotes `180ms`, `1.2s` and `900ms`,
 * and `tokens.css` explains every duration in prose directly above it. Only a **declaration**
 * counts, never a mention.
 *
 * ## Scope, stated so nobody assumes more
 *
 * It reads the four renderer stylesheets. It says nothing about *whether* a thing should animate,
 * which is a judgement, or about what the motion looks like at runtime, which is
 * `scripts/motion-sweep.mjs` and needs the app up. This checks that the vocabulary has one home.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TOKENS = 'desktop/src/renderer/tokens.css';
export const SHEETS = [
  'desktop/src/renderer/tokens.css',
  'desktop/src/renderer/shell.css',
  'desktop/src/renderer/styles.css',
  'desktop/src/renderer/float.css',
  'desktop/src/renderer/share-window.css',
];
/** Where a motion token may be *read* from. The renderer's TS sets some transitions inline. */
export const READERS = [...SHEETS, 'desktop/src/renderer'];

/**
 * The literals that are allowed to stay literal, each with the reason and the file it lives in.
 *
 * Every entry must match at least one real declaration or the check fails: an allowlist nobody
 * prunes is how a guard stops guarding, and that is the rule `check-color-tokens.mjs` already
 * enforces on its own list.
 */
export const ALLOWED = [
  {
    file: 'desktop/src/renderer/tokens.css',
    literal: '0.01ms',
    why: 'the reduced-motion kill. Not a duration anyone chose — it is "off", expressed as the smallest number that still lets a transitionend fire.',
  },
  {
    file: 'desktop/src/renderer/float.css',
    literal: '0.001ms',
    why: 'the float window\'s own reduced-motion kill, same reason.',
  },
  {
    file: 'desktop/src/renderer/tokens.css',
    literal: 'linear',
    why: '`.motion-fade` under reduced motion. A cross-fade that exists to be *unnoticeable* must not accelerate; `--ease` would give it a shape, which is the thing being removed.',
  },
  {
    file: 'desktop/src/renderer/shell.css',
    literal: 'linear',
    why: 'an indeterminate spinner. AUDIT.md: constant motion is `linear` — a spinner that eases has a front and a back, which implies progress it does not know.',
  },
  {
    file: 'desktop/src/renderer/styles.css',
    literal: 'linear',
    why: 'the two pane spinners, same reason as shell.css.',
  },
];

/** Comments out, newlines kept so line numbers survive. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Every declaration, with the line it sits on. */
export function declarations(src) {
  const clean = stripComments(src);
  const out = [];
  const re = /([-a-zA-Z]+)\s*:\s*([^;{}]*)[;}]/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    out.push({
      prop: m[1].toLowerCase(),
      value: m[2].trim().replace(/\s+/g, ' '),
      line: clean.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

const MOTION_PROP = /^(transition|animation)(-|$)/;
/** A duration anywhere in a value, as CSS writes them. */
const DURATION = /(?<![\w.-])(\d*\.?\d+)(ms|s)(?![\w-])/g;
/** The keyword easings. `cubic-bezier(...)` written inline counts too. */
const EASING = /\b(ease-in-out|ease-out|ease-in|ease|linear|step-start|step-end)\b|cubic-bezier\([^)]*\)/g;

/** `var(--x)` and `cubic-bezier(...)` hide real tokens; blank them before hunting literals. */
export function maskTokens(value) {
  return value.replace(/var\(\s*--[\w-]+\s*\)/g, 'VAR');
}

/** Literal durations and easings in one motion declaration. */
export function literalsIn(value) {
  const masked = maskTokens(value);
  const durations = [...masked.matchAll(DURATION)].map((m) => m[0]);
  const easings = [...masked.replace(DURATION, ' ').matchAll(EASING)].map((m) => m[0]);
  return { durations, easings };
}

/** The motion tokens `tokens.css` defines: durations, curves, and the press scales. */
export function motionTokens(tokensSrc) {
  const clean = stripComments(tokensSrc);
  const out = new Map();
  const re = /(--(?:dur|ease|press-scale)[\w-]*)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    out.set(m[1], { value: m[2].trim(), line: clean.slice(0, m.index).split('\n').length });
  }
  return out;
}

export function run(root = REPO) {
  const problems = [];
  const read = (rel) => {
    try {
      return readFileSync(join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  const sources = new Map();
  for (const rel of SHEETS) {
    const src = read(rel);
    if (src === null) {
      problems.push({ kind: 'missing', file: rel, detail: 'stylesheet not found' });
      continue;
    }
    sources.set(rel, src);
  }
  /*
   * The control. An enumeration that finds nothing passes trivially, which is the failure this
   * whole file is about — so a run that sees no motion declarations at all is an instrument
   * failure, not a clean bill.
   */
  let motionDecls = 0;

  const allowHits = new Map(ALLOWED.map((a, i) => [i, 0]));
  const allowedFor = (file, literal) => {
    for (const [i, a] of ALLOWED.entries()) {
      if (a.file === file && a.literal === literal) {
        allowHits.set(i, allowHits.get(i) + 1);
        return true;
      }
    }
    return false;
  };

  for (const [rel, src] of sources) {
    for (const d of declarations(src)) {
      if (!MOTION_PROP.test(d.prop)) continue;
      motionDecls += 1;
      const { durations, easings } = literalsIn(d.value);
      for (const lit of durations) {
        if (allowedFor(rel, lit)) continue;
        problems.push({
          kind: 'raw-duration',
          file: rel,
          line: d.line,
          detail: `${d.prop}: ${d.value}`,
          literal: lit,
        });
      }
      for (const lit of easings) {
        if (allowedFor(rel, lit)) continue;
        problems.push({
          kind: 'raw-easing',
          file: rel,
          line: d.line,
          detail: `${d.prop}: ${d.value}`,
          literal: lit,
        });
      }
    }
  }

  if (motionDecls === 0) {
    problems.push({
      kind: 'instrument',
      file: '(all sheets)',
      detail:
        'no transition or animation declaration was found in any sheet. That is not a pass — ' +
        'it is this check failing to read the files it is named for.',
    });
  }

  // Rule 3: a motion token nothing reads.
  const tokensSrc = sources.get(TOKENS);
  const defined = tokensSrc ? motionTokens(tokensSrc) : new Map();
  if (tokensSrc) {
    const bodies = [...sources.values()].map(stripComments).join('\n');
    for (const [name, meta] of defined) {
      const uses = bodies.split(`var(${name})`).length - 1;
      if (uses === 0) {
        problems.push({
          kind: 'unused-token',
          file: TOKENS,
          line: meta.line,
          detail: `${name}: ${meta.value} — defined and read by nothing`,
        });
      }
    }
  }

  // Rule 4: an allowlist entry matching nothing.
  for (const [i, hits] of allowHits) {
    if (hits > 0) continue;
    const a = ALLOWED[i];
    problems.push({
      kind: 'stale-allowlist',
      file: a.file,
      detail: `allowlist entry "${a.literal}" matches no declaration any more — remove it`,
    });
  }

  return { problems, motionDecls, tokenCount: defined.size };
}

function main() {
  const { problems, motionDecls, tokenCount } = run();
  console.log('check-motion-tokens:');
  console.log(`  ${motionDecls} motion declarations read, ${tokenCount} motion tokens defined`);
  if (problems.length === 0) {
    console.log('  OK — every duration and curve comes from tokens.css, and every token is read.');
    return 0;
  }
  console.log(`  ${problems.length} problem(s):\n`);
  for (const p of problems) {
    const where = p.line ? `${p.file}:${p.line}` : p.file;
    console.log(`  [${p.kind}] ${where}`);
    console.log(`      ${p.detail}`);
    if (p.kind === 'raw-duration' || p.kind === 'raw-easing') {
      console.log(
        `      "${p.literal}" is written by hand. Motion values live in tokens.css so that ` +
          'changing one changes every surface that meant it.',
      );
    }
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
