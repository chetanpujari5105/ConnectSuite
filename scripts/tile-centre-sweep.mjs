#!/usr/bin/env node
/**
 * Is every icon tile vertically centred on the two lines of text beside it?
 *
 *   node scripts/tile-centre-sweep.mjs                       # every pane, 4 sizes, both themes
 *   node scripts/tile-centre-sweep.mjs --screens=overview --sizes=1440x900 --themes=dark
 *   node scripts/tile-centre-sweep.mjs --out=docs/evidence/…  # also writes readings.json
 *
 * Exit 0 when every pair is within TOLERANCE_PX, 1 when one is not, 2 when the instrument could not
 * take its reading (a pane did not land, or the control below failed).
 *
 * Written for the device card on Overview (2026-10-11), whose four fact tiles sat visibly low beside
 * their label/value pair. **The first reading is the reason this measures glyphs, not boxes:** by
 * `getBoundingClientRect` every one of those cells was already centred to 0.00 px — `align-items:
 * center` was doing exactly what it says — and the tile still looked low. The box of a line of text
 * is its line-height, not its letters: a caption's box has a little space above the capitals, and a
 * value's box has its half-leading *plus the descender band* below the baseline. Two lines stacked
 * put more empty box under the letters than over them, so the box centre sits below the ink centre.
 * A check of boxes reads 0.00 and passes the defect it exists for.
 *
 * ### What "the text block" is, here
 *
 * The cap top of the first line to the baseline of the last line — the band a reader sees as the
 * text. The baseline is read, not computed: a zero-size inline-block is appended to the line's
 * element, its bottom is the baseline, and it is removed in the same synchronous call (no paint can
 * happen in between). The cap height is the font's own, from canvas `measureText('H')` in the
 * element's computed font. Both numbers come from the engine drawing the page.
 *
 * Both readings are reported: `box` (what was asked for literally) and `optical` (what is seen).
 * The gate is on `optical`, and on `box` too, so a fix that centres the letters by un-centring the
 * boxes is not a pass either.
 *
 * ### What counts as a pair
 *
 * A *tile* is a square (|w − h| ≤ 1), 20–60 px, filled or bordered element holding an `svg`, laid
 * out in a row (flex row or grid). Its *text block* is a sibling in that row holding at least two
 * visible text-bearing elements on different lines. Nothing is named by class, so a new pane with
 * the same pattern is measured without anyone remembering to add it.
 *
 * **Excluded, by name and with the reason** — an exclusion that stops matching anything is
 * reported, so this list cannot rot silently:
 *  - `.pair-step-mark`: the pairing checklist's marks sit on the *title* line of each step on
 *    purpose (`align-items: start`); the second line is a note under the title, and a step list's
 *    marks align to the first line in every checklist idiom.
 *
 * ### Control
 *
 * Overview must yield the four hero fact pairs (Connection, Address, Security, Latency) at every
 * size, or the run refuses: a scan that silently found nothing would read as a clean app. Every pane
 * must also land (`shell.screen` equal, section visible) before it is read.
 *
 * ### Bounds this instrument imposes — stated so a result shaped by them is not read as the app's
 *  - sizes are **emulated** (`Emulation.setDeviceMetricsOverride`), as in `ux-sweep.mjs`; the zoom
 *    row is a 917×583 CSS viewport at dpr × 1.2, which is Chromium's zoom layout, not the app's
 *    own zoom command;
 *  - the theme is **stamped** on `<html data-theme>` for the run and restored after;
 *  - a settle of 900 ms after each route lands, and 250 ms after each resize;
 *  - only what is on screen in the pane's current state is read (a Recent activity list with no rows
 *    measures no recent rows — the count per pane is printed so that is visible).
 */
import { openProbe } from './probe.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

export const TOLERANCE_PX = 1;

export const EXCLUDED = Object.freeze([
  { selector: '.pair-step-mark', why: 'pairing checklist marks align to the step title line by design' },
]);

/** The four Overview facts the control requires. */
export const CONTROL_LABELS = Object.freeze(['Connection', 'Address', 'Security', 'Latency']);

/**
 * The verdict over one run's readings. Pure, so its fixtures need no browser.
 *
 * `readings`: [{ screen, size, theme, pairs: [{ where, text, box, optical }] }]
 * Returns { ok, refused, failures, worst } — `refused` when the control did not hold.
 */
export function verdict(readings, tolerance = TOLERANCE_PX) {
  const failures = [];
  const refused = [];
  let worst = 0;
  for (const r of readings) {
    if (r.refused) { refused.push(`${r.screen} ${r.size} ${r.theme}: ${r.refused}`); continue; }
    if (r.screen === 'overview') {
      const hero = r.pairs.filter((p) => p.where.includes('hero-details')).map((p) => p.text.split(' / ')[0]);
      const missing = CONTROL_LABELS.filter((l) => !hero.includes(l));
      if (missing.length) refused.push(`${r.size} ${r.theme}: control failed — hero facts not found: ${missing.join(', ')}`);
    }
    for (const p of r.pairs) {
      const off = Math.max(Math.abs(p.optical), Math.abs(p.box));
      worst = Math.max(worst, off);
      if (off > tolerance) failures.push({ screen: r.screen, size: r.size, theme: r.theme, ...p });
    }
  }
  return { ok: failures.length === 0 && refused.length === 0, refused, failures, worst: +worst.toFixed(2) };
}

/** Evaluated in the page. Returns { screen, vw, dpr, pairs, excludedSeen }. */
export const SCAN = (excluded) => `(() => {
  const EXCLUDED = ${JSON.stringify(excluded.map((e) => e.selector))};
  const sec = document.querySelector('section.screen[data-screen="' + shell.screen + '"]');
  const vis = (el) => el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) && el.getBoundingClientRect().height > 0;
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const cv = document.createElement('canvas').getContext('2d');
  const baseline = (el) => {
    const m = document.createElement('span');
    m.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;padding:0;margin:0;border:0';
    el.appendChild(m); const b = m.getBoundingClientRect().bottom; m.remove(); return b;
  };
  const capH = (el) => { const cs = getComputedStyle(el); cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; return cv.measureText('H').actualBoundingBoxAscent; };
  const path = (el) => { const p = []; for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) p.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ')[0] : '')); return p.join('>'); };
  const pairs = [];
  const excludedSeen = {};
  const seenTiles = new Set();
  for (const svg of document.querySelectorAll('svg')) {
    if (!vis(svg)) continue;
    let tile = svg.parentElement;
    while (tile && tile !== document.body) {
      const r = tile.getBoundingClientRect();
      if (r.width > 60) { tile = null; break; }
      const cs = getComputedStyle(tile);
      const filled = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || parseFloat(cs.borderTopWidth) > 0 || cs.backgroundImage !== 'none';
      if (filled && Math.abs(r.width - r.height) <= 1 && r.width >= 20) break;
      tile = tile.parentElement;
    }
    if (!tile || tile === document.body || seenTiles.has(tile)) continue;
    seenTiles.add(tile);
    // The sidebar is drawn on every pane; read it only on Overview so it is counted once per size.
    if (!sec || !(sec.contains(tile) || (shell.screen === 'overview' && tile.closest('aside.sidebar')))) continue;
    const ex = EXCLUDED.find((s) => tile.matches(s));
    if (ex) { excludedSeen[ex] = (excludedSeen[ex] || 0) + 1; continue; }
    const row = tile.parentElement;
    const rcs = getComputedStyle(row);
    if (!((rcs.display.includes('flex') && rcs.flexDirection.startsWith('row')) || rcs.display.includes('grid'))) continue;
    for (const sib of row.children) {
      if (sib === tile || !vis(sib)) continue;
      const leaves = [...sib.querySelectorAll('*'), sib].filter((e) => ownText(e) && vis(e));
      if (leaves.length < 2) continue;
      leaves.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      const first = leaves[0], last = leaves[leaves.length - 1];
      if (last.getBoundingClientRect().top - first.getBoundingClientRect().top < 4) continue;
      const t = tile.getBoundingClientRect(), s = sib.getBoundingClientRect();
      const tc = (t.top + t.bottom) / 2;
      const optTop = baseline(first) - capH(first), optBottom = baseline(last);
      pairs.push({ where: path(tile), text: (first.textContent.trim() + ' / ' + last.textContent.trim()).replace(/\\s+/g, ' ').slice(0, 60),
        tileCentre: +tc.toFixed(2),
        box: +(tc - (s.top + s.bottom) / 2).toFixed(2),
        optical: +(tc - (optTop + optBottom) / 2).toFixed(2) });
      break;
    }
  }
  return { screen: shell.screen, landed: !!sec && vis(sec), vw: innerWidth, dpr: devicePixelRatio, pairs, excludedSeen };
})()`;

const ALL_ROUTES = ['overview', 'mirror', 'files', 'photos', 'messages', 'notifications', 'clipboard', 'calls',
  'camera', 'apps', 'activity', 'pairing',
  'settings/general', 'settings/device', 'settings/connection', 'settings/notifications', 'settings/transfer',
  'settings/advanced', 'settings/about'];
const ALL_SIZES = ['1100x700', '1440x900', '1920x1050', '1100x700@1.2'];

async function main() {
  const arg = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const routes = (arg('screens') ?? ALL_ROUTES.join(',')).split(',');
  const sizes = (arg('sizes') ?? ALL_SIZES.join(',')).split(',');
  const themes = (arg('themes') ?? 'dark,light').split(',');
  const out = arg('out');

  const probe = await openProbe({ port: Number(arg('port', '9222')) });
  const ev = (src) => probe.rawEvaluate(src);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const original = await ev(`(() => ({ theme: document.documentElement.getAttribute('data-theme'), screen: shell.screen,
    inner: innerWidth, outer: outerWidth, dpr: devicePixelRatio }))()`);
  if (original.inner !== original.outer) {
    console.error(`tile-centre-sweep REFUSED: the window is zoomed (innerWidth ${original.inner} !== outerWidth ${original.outer}).`);
    exit(2);
  }
  const restore = async () => {
    try { await probe.rawEmulate(null); } catch {}
    try {
      await ev(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(original.theme)});
        shell.route(${JSON.stringify(original.screen)}); return true; })()`);
    } catch {}
  };
  process.on('SIGINT', async () => { await restore(); exit(130); });

  const readings = [];
  const excludedTotals = Object.fromEntries(EXCLUDED.map((e) => [e.selector, 0]));
  try {
    for (const theme of themes) {
      await ev(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); return true; })()`);
      for (const size of sizes) {
        const [dims, zoomRaw] = size.split('@');
        const [w, h] = dims.split('x').map(Number);
        const zoom = zoomRaw ? Number(zoomRaw) : 1;
        await probe.rawEmulate({ width: Math.round(w / zoom), height: Math.round(h / zoom), dpr: original.dpr * zoom });
        await sleep(250);
        for (const route of routes) {
          const [screen, sub] = route.split('/');
          await ev(`(() => { shell.route(${JSON.stringify(screen)}${sub ? ', ' + JSON.stringify(sub) : ''}); return true; })()`);
          let landed = false;
          for (let i = 0; i < 24 && !landed; i++) {
            await sleep(250);
            landed = await ev(`shell.screen === ${JSON.stringify(screen)} && !!document.querySelector('section.screen[data-screen="${screen}"]:not([hidden])')`);
          }
          if (!landed) { readings.push({ screen: route, size, theme, refused: 'route did not land' }); continue; }
          await sleep(900);
          const r = await ev(SCAN(EXCLUDED));
          if (!r.landed) { readings.push({ screen: route, size, theme, refused: 'pane not visible — no reading' }); continue; }
          for (const [k, v] of Object.entries(r.excludedSeen)) excludedTotals[k] += v;
          readings.push({ screen: route, size, theme, vw: r.vw, dpr: r.dpr, pairs: r.pairs });
        }
      }
    }
  } finally {
    await restore();
  }

  const v = verdict(readings);
  for (const r of readings) {
    if (r.refused) { console.log(`REFUSED ${r.screen} ${r.size} ${r.theme}: ${r.refused}`); continue; }
    if (!r.pairs.length) continue;
    console.log(`${r.screen} ${r.size} ${r.theme} (${r.pairs.length} pairs, vw ${r.vw})`);
    for (const p of r.pairs) {
      const bad = Math.max(Math.abs(p.optical), Math.abs(p.box)) > TOLERANCE_PX ? '  ✗' : '';
      console.log(`  box ${p.box.toFixed(2).padStart(6)}  optical ${p.optical.toFixed(2).padStart(6)}  ${p.where.split('>').slice(-2).join('>')} | ${p.text}${bad}`);
    }
  }
  const pairCount = readings.reduce((n, r) => n + (r.pairs?.length ?? 0), 0);
  console.log(`\n${pairCount} pairs over ${readings.length} pane readings; worst |offset| ${v.worst} px; tolerance ${TOLERANCE_PX} px`);
  console.log(`excluded: ${EXCLUDED.map((e) => `${e.selector} ×${excludedTotals[e.selector]} (${e.why})`).join('; ')}`);
  for (const e of EXCLUDED) if (excludedTotals[e.selector] === 0 && routes.includes('pairing')) {
    console.log(`  note: exclusion ${e.selector} matched nothing this run — if it no longer exists, delete it`);
  }
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'readings.json'), JSON.stringify({ tolerance: TOLERANCE_PX, settleMs: 900, emulated: true, readings, verdict: v }, null, 2));
  }
  if (v.refused.length) { for (const r of v.refused) console.log(`REFUSED ${r}`); exit(2); }
  if (!v.ok) { console.log(`FAIL — ${v.failures.length} pair readings off by more than ${TOLERANCE_PX} px`); exit(1); }
  console.log('PASS');
  exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
