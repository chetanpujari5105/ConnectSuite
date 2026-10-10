#!/usr/bin/env node
/**
 * Every pane, at every size and theme the UX audit is scored at, with a clipping reading per shot.
 *
 *   node scripts/ux-sweep.mjs --out=docs/evidence/ux-audit-2026-10-10/mac
 *   node scripts/ux-sweep.mjs --out=… --screens=files,photos --sizes=1100x700 --themes=light
 *
 * Written for docs/ux-audit-2026-10-10.md (sections 0 and 4 of that batch). It is `shot.mjs`
 * repeated over a matrix, plus one reading `shot.mjs` does not take: **what is cut off**.
 *
 * ### The sizes, and what each one stands for
 *
 * | Size | Stands for |
 * |---|---|
 * | 1100x700 | the window's resize floor (`windowGeometry.MIN`) |
 * | 1440x900 | a common laptop window |
 * | 1920x1050 | the owner's external display's work area (`windowGeometry.ts` header) |
 * | 1100x700@1.2 | View → Zoom In once at the floor: a 917x583 CSS viewport drawn at dpr 2.4 |
 *
 * The zoom row is **emulated**, not the app's own zoom. Chromium's zoom shrinks the CSS viewport by
 * the factor and scales the device pixel ratio by it; `Emulation.setDeviceMetricsOverride` with
 * `width/1.2`, `height/1.2` and `dpr*1.2` produces the same CSS layout. It is said in the sidecar,
 * because the two differ in one place that matters to nobody here — the app's `zoomStep` refusal.
 *
 * ### The theme is stamped, not set
 *
 * `appearanceSet` persists the owner's preference. A sweep must not change a setting, so it stamps
 * `data-theme` on `<html>` directly for the length of each shot and restores the value it found —
 * a second writer for seconds, on purpose, and put back on every exit path.
 *
 * ### The clipping reading — every bound it imposes, in what it reports
 *
 * Per shot, inside the routed pane only:
 *  - `offRight`  : a visible control (button, a, input, select, [role=button], [tabindex]) whose
 *                  rect ends past the viewport's right edge — unreachable without a horizontal
 *                  scroll this app does not offer;
 *  - `clippedText`: a visible element with its own text whose `scrollWidth` exceeds `clientWidth`
 *                  by >1px while `overflow` hides it and `text-overflow` is **not** `ellipsis` —
 *                  text cut mid-glyph with no sign anything is missing. An ellipsis is a decision
 *                  and is not counted;
 *  - `pageHScroll`: `#page` or the document wider than the viewport.
 * Screen-reader-only text (`.visually-hidden`) is excluded: it is clipped to 1px by design, and the
 * first run counted 49 of it on Messages as clipped text — a lookalike, not a finding.
 * Control: the pane's own section must be visible with non-zero height, or the shot is refused —
 * a hidden pane reports no overflow, which would read as a clean pane.
 */
import { openProbe } from './probe.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

const arg = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const out = arg('out');
if (!out) {
  console.error('ux-sweep.mjs: --out=<dir> is required');
  exit(2);
}
mkdirSync(out, { recursive: true });

const ALL_SCREENS = ['overview', 'mirror', 'files', 'photos', 'messages', 'notifications', 'clipboard', 'calls',
  'camera', 'apps', 'activity', 'settings', 'pairing'];
const ALL_SIZES = ['1100x700', '1440x900', '1920x1050', '1100x700@1.2'];
const screens = (arg('screens') ?? ALL_SCREENS.join(',')).split(',');
const sizes = (arg('sizes') ?? ALL_SIZES.join(',')).split(',');
const themes = (arg('themes') ?? 'dark,light').split(',');

const probe = await openProbe({ port: Number(arg('port', '9222')) });
const ev = (src) => probe.rawEvaluate(src);

const original = await ev(`(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  screen: shell.screen,
  inner: innerWidth, outer: outerWidth, dpr: devicePixelRatio,
}))()`);
if (original.inner !== original.outer) {
  console.error(`ux-sweep REFUSED: the window is zoomed (innerWidth ${original.inner} !== outerWidth ${original.outer}).`);
  exit(1);
}

const restore = async () => {
  try { await probe.rawEmulate(null); } catch {}
  try {
    await ev(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(original.theme)});
      shell.route(${JSON.stringify(original.screen)}); return true; })()`);
  } catch {}
};
process.on('SIGINT', async () => { await restore(); exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const READ = (screen) => `(() => {
  const sec = document.querySelector('section.screen[data-screen="${screen}"]');
  if (!sec || sec.hidden || sec.getBoundingClientRect().height <= 0) return { control: false };
  const vw = innerWidth;
  const vis = (el) => el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.offsetParent !== null;
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60);
  const path = (el) => { const p = []; let n = el; for (let i = 0; n && i < 3 && n !== sec; i++, n = n.parentElement) p.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList[0] ? '.' + n.classList[0] : '')); return p.join('>'); };
  const offRight = [];
  for (const el of sec.querySelectorAll('button, a[href], input, select, textarea, [role=button], [tabindex]')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1) offRight.push({ el: path(el), label: label(el), right: Math.round(r.right) });
  }
  const clippedText = [];
  for (const el of sec.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    // Screen-reader-only text is clipped to 1px on purpose; it is the lookalike, not a finding.
    if (el.closest('.visually-hidden, .sr-only')) continue;
    if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth <= 1) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'visible') continue;
    if (cs.textOverflow === 'ellipsis') continue;
    clippedText.push({ el: path(el), text: label(el), over: el.scrollWidth - el.clientWidth });
  }
  const page = document.querySelector('#page');
  return {
    control: true,
    sectionH: Math.round(sec.getBoundingClientRect().height),
    vw, vh: innerHeight, dpr: devicePixelRatio,
    theme: document.documentElement.getAttribute('data-theme'),
    pageHScroll: (page && page.scrollWidth > page.clientWidth + 1) || document.documentElement.scrollWidth > vw + 1,
    offRight: offRight.slice(0, 20), offRightCount: offRight.length,
    clippedText: clippedText.slice(0, 20), clippedTextCount: clippedText.length,
  };
})()`;

const summary = [];
try {
  for (const theme of themes) {
    await ev(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); return true; })()`);
    for (const size of sizes) {
      const [dims, zoomRaw] = size.split('@');
      const [w, h] = dims.split('x').map(Number);
      const zoom = zoomRaw ? Number(zoomRaw) : 1;
      await probe.rawEmulate({ width: Math.round(w / zoom), height: Math.round(h / zoom), dpr: original.dpr * zoom });
      await sleep(250);
      for (const screen of screens) {
        await ev(`(() => { shell.route(${JSON.stringify(screen)}); return true; })()`);
        // Settling paint after a confirmed route; declared in the sidecar, not hidden.
        let landed = false;
        for (let i = 0; i < 24 && !landed; i++) {
          await sleep(250);
          landed = await ev(`shell.screen === ${JSON.stringify(screen)} && !!document.querySelector('section.screen[data-screen="${screen}"]:not([hidden])')`);
        }
        if (!landed) {
          summary.push({ screen, size, theme, refused: 'route did not land' });
          continue;
        }
        await sleep(500);
        await ev(`(() => { const p = document.querySelector('#page'); if (p) p.scrollTop = 0; return true; })()`);
        await sleep(120);
        const reading = await ev(READ(screen));
        if (!reading.control) {
          summary.push({ screen, size, theme, refused: 'pane not visible — no reading' });
          continue;
        }
        const name = `${screen}-${size.replace('@', '-z')}-${theme}`;
        writeFileSync(join(out, `${name}.png`), Buffer.from(await probe.rawCapture(), 'base64'));
        writeFileSync(join(out, `${name}.json`), JSON.stringify({ screen, size, theme, emulated: true,
          zoomEmulated: zoom, settleMs: 620, ...reading }, null, 2));
        summary.push({ screen, size, theme, offRight: reading.offRightCount, clippedText: reading.clippedTextCount,
          pageHScroll: reading.pageHScroll });
      }
    }
  }
} finally {
  await restore();
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
for (const s of summary) {
  console.log(s.refused ? `REFUSED ${s.screen} ${s.size} ${s.theme}: ${s.refused}`
    : `${s.screen.padEnd(14)} ${s.size.padEnd(13)} ${s.theme.padEnd(5)} offRight=${s.offRight} clippedText=${s.clippedText} hscroll=${s.pageHScroll}`);
}
exit(0);
