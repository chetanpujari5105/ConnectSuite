#!/usr/bin/env node
/*
 * Every text/surface token pair, in both themes, against WCAG AA — read out of `tokens.css` rather
 * than held as a second copy of the palette.
 *
 * ### Why a checker and not a note in the design doc
 *
 * The Muted pill was **2.23:1** once, and nobody found it by reading a stylesheet: a specificity
 * collision made the active tab take the disabled tab's colour, so the value in the token file was
 * correct and the pixels were not. Contrast is a property of a *pair*, and a pair is exactly what
 * no single declaration shows you.
 *
 * Light doubles the number of pairs and inverts which ones are dangerous: a green that reads at
 * 11:1 on `#07070a` is 1.8:1 on white. Deriving the light palette by eye would have shipped four
 * failures — this script is what said so before anything was drawn, and it caught a fifth
 * (`--text-on-warning`) that only appears once the warning fill itself darkens.
 *
 * ### The one documented exception
 *
 * `--text-meta` is below AA in both themes, by the design's own instruction: its contrast table
 * lists `#5B5E6E on panel → 2.6:1` and restricts it to "10–11px non-essential meta ONLY, never
 * body copy". It is held to a *band* here rather than exempted, so it cannot quietly drift further
 * down, and light is held to the same band as dark rather than being improved on one side only.
 *
 * ### Controls
 *
 * The instrument is checked against five published WCAG reference pairs before it reports anything.
 * That is not ceremony: a luminance formula with a wrong exponent produces plausible numbers that
 * are all slightly wrong, and every verdict below would inherit the error silently.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = join(REPO, 'desktop/src/renderer/tokens.css');

const AA = 4.5;
/** The design's own band for meta. Below `META_LO` it is drifting; above `META_HI` it is body copy. */
const META_LO = 2.4;
const META_HI = 3.6;

export function parseColor(s) {
  s = String(s).trim();
  let m = /^#([0-9a-fA-F]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return null;
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** `stack` is outermost-first: the canvas, then each surface painted on top of the last. */
export function contrast(fg, stack, canvas) {
  let bg = parseColor(canvas);
  for (const s of stack) bg = over(parseColor(s), bg);
  return ratio(over(parseColor(fg), bg), bg);
}

/** Read one `:root`-ish block's custom properties out of the token sheet. */
export function tokenBlock(src, selector) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const at = clean.indexOf(selector);
  if (at === -1) return new Map();
  let depth = 0, start = -1, end = -1;
  for (let i = at; i < clean.length; i++) {
    if (clean[i] === '{') { if (depth === 0) start = i + 1; depth++; }
    else if (clean[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const out = new Map();
  const re = /(--[-a-zA-Z0-9]+)\s*:\s*([^;]*);/g;
  let m;
  while ((m = re.exec(clean.slice(start, end))) !== null) out.set(m[1], m[2].trim());
  return out;
}

const SURFACES = ['--canvas', '--elev-1', '--elev-2', '--elev-3', '--control', '--well'];
const FOREGROUNDS = ['--text-primary', '--text-body', '--text-on-control', '--text-meta',
  '--accent-text', '--secondary', '--live', '--warning', '--destructive'];
/** Pairs where the foreground sits on a *fill* rather than on a surface. */
const ON_FILL = [
  ['--accent-on-fill', '--accent'],
  ['--text-on-warning', '--warning'],
  ['--text-on-bubble', '--bubble-out'],
  // The scrim pairs. Both tokens are deliberately identical in both themes, and both sit on a
  // surface that is too — which is exactly why they need checking here: nothing else would.
  ['--text-on-media', '--media-scrim'],
  ['--text-on-media-dim', '--media-scrim'],
  ['--disc-fg', null],
];

function themeOf(tokens, name) {
  const rows = [];
  const canvas = tokens.get('--canvas');
  for (const fg of FOREGROUNDS) {
    for (const surface of SURFACES) {
      const stack = surface === '--canvas' ? [] : [tokens.get(surface)];
      rows.push({ fg, bg: surface, r: contrast(tokens.get(fg), stack, canvas) });
    }
  }
  for (const [fg, fill] of ON_FILL) {
    if (!tokens.has(fg)) continue;
    if (fill === null) {
      // The avatar disc is its own background: hue varies, S and L do not, so the worst case over
      // every hue is what has to clear AA. Sampled every 15°, which is 24 readings, not one.
      let worst = Infinity, worstHue = 0;
      const sat = parseFloat(tokens.get('--disc-sat')), lig = parseFloat(tokens.get('--disc-lig'));
      for (let h = 0; h < 360; h += 15) {
        const r = contrast(tokens.get(fg), [hslHex(h, sat, lig)], canvas);
        if (r < worst) { worst = r; worstHue = h; }
      }
      rows.push({ fg, bg: `--disc (worst of 24 hues, ${worstHue}°)`, r: worst });
      continue;
    }
    const stack = [tokens.get('--elev-2'), tokens.get(fill)].filter(Boolean);
    rows.push({ fg, bg: fill, r: contrast(tokens.get(fg), stack, canvas) });
  }
  return { name, rows };
}

function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = h / 60, x = c * (1 - Math.abs((hp % 2) - 1));
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hp) % 6];
  const m = l - c / 2;
  return '#' + t.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

export function controlsPass() {
  const cases = [['#ffffff', '#000000', 21.00], ['#767676', '#ffffff', 4.54],
    ['#777777', '#ffffff', 4.48], ['#595959', '#ffffff', 7.00], ['#0000ff', '#ffffff', 8.59]];
  return cases.map(([a, b, want]) => {
    const got = ratio(parseColor(a), parseColor(b));
    return { a, b, want, got, ok: Math.abs(got - want) < 0.01 };
  });
}

export function run(tokensPath = TOKENS) {
  const src = readFileSync(tokensPath, 'utf8');
  const dark = tokenBlock(src, ':root {');
  /*
   * Light is dark **merged with** its overrides, because that is what the cascade does: the light
   * block holds only what changes, and a token it does not mention is inherited from `:root`.
   *
   * Reading the light block alone is what the first version did, and it did not error — it silently
   * checked **56 pairs against dark's 58**, skipping every pair whose foreground is deliberately
   * the same in both themes. `--text-on-bubble` and `--disc-fg` were the two, and both sit on a
   * fill that DOES change, so they are exactly the pairs most worth checking. An instrument that
   * drops a reading and still prints a verdict is this repo's most-repeated failure; the pair count
   * is printed per theme so the next version of this mistake is visible in the output.
   */
  const light = new Map(dark);
  for (const [k, v] of tokenBlock(src, ":root[data-theme='light']")) light.set(k, v);
  return [themeOf(dark, 'dark'), themeOf(light, 'light')];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const verbose = process.argv.includes('--all');
  console.log('check-contrast');
  const controls = controlsPass();
  for (const c of controls) {
    console.log(`  ${c.ok ? 'ok  ' : 'BAD '} control ${c.a} on ${c.b} = ${c.got.toFixed(2)} (published ${c.want.toFixed(2)})`);
  }
  if (controls.some((c) => !c.ok)) {
    console.log('\n  The instrument disagrees with the published reference pairs. Every number below');
    console.log('  would inherit that error, so nothing below is a reading. Fix the formula first.');
    process.exit(1);
  }
  let failures = 0;
  for (const theme of run()) {
    const bad = [];
    console.log(`\n  ---- ${theme.name} — ${theme.rows.length} pairs`);
    for (const row of theme.rows) {
      const meta = row.fg === '--text-meta';
      const ok = meta ? row.r >= META_LO && row.r <= META_HI : row.r >= AA;
      if (!ok) bad.push(row);
      if (verbose || !ok) {
        console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${row.r.toFixed(2).padStart(6)}:1  ${row.fg} on ${row.bg}`);
      }
    }
    const metaRows = theme.rows.filter((r) => r.fg === '--text-meta');
    const lo = Math.min(...metaRows.map((r) => r.r)), hi = Math.max(...metaRows.map((r) => r.r));
    console.log(`    ${bad.length === 0 ? 'OK' : bad.length + ' FAILING'} — ${theme.rows.length - metaRows.length} pairs held to AA ${AA}, ` +
      `${metaRows.length} meta pairs held to the design's ${META_LO}–${META_HI} band (actual ${lo.toFixed(2)}–${hi.toFixed(2)})`);
    failures += bad.length;
  }
  console.log(failures === 0 ? '\n  OK — both themes clear AA, and meta sits in its stated band in both' : `\n  ${failures} failing pair(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
