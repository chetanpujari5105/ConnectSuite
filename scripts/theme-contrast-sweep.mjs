#!/usr/bin/env node
/**
 * Rendered text contrast on every pane, in **both** themes — what a token audit cannot see.
 *
 * `check-contrast.mjs` proves the palette. It cannot prove the cascade: defects 120 (an `opacity`) and
 * 121 (theme-following text on the one surface that never inverts) both passed every token check. The
 * Slice 55 rendered sweep that found them was never committed, and every pane was rebuilt after it
 * (Sidekick batches, 2026-09-19/20) — so the light theme is unmeasured on the panes people use now.
 *
 * ### What it measures, and what it does not
 *
 * - Every **visible element that directly holds text**, on every routed pane, with the theme set as the
 *   renderer sets it: `data-theme` on `<html>`. **Page only** — the saved appearance is not touched, and
 *   the original attribute is put back in a `finally`.
 * - Foreground: computed `color`, alpha multiplied by every ancestor's `opacity`.
 * - Background: ancestors walked up to the first **opaque** colour, semi-transparent layers composited
 *   over it. An ancestor with a `background-image` (gradient, picture) makes the pair **unmeasured**,
 *   counted as such, never guessed.
 * - Threshold: 4.5:1, or 3:1 for large text (≥ 24 px, or ≥ 18.66 px at weight ≥ 700).
 * - `--text-meta` is **designed** below AA (the handoff's 2.4–3.6 band, `CLAUDE.md` roadmap row 7), so
 *   pairs drawn in exactly that colour are reported in their own column, held to the band.
 *
 * **Privacy:** panes carry personal messages, contacts and notifications. Output names **element
 * classes and ratios only — never text**.
 *
 * - Text inside a **disabled** control is counted separately and not failed (WCAG 1.4.3 exempts
 *   inactive components). Icons drawn as SVG are **not text** and are not measured here — the
 *   `--accent-mark` finding (2026-09-29) was reached only because one icon is a text glyph.
 *
 * Run: node scripts/theme-contrast-sweep.mjs [port]
 */
import { openProbe } from './probe.mjs';

const port = Number(process.argv[2] ?? 9222);
const probe = await openProbe({ port });

const MEASURE = `(function(){
  function parse(c){ var m = c.match(/rgba?\\(([^)]+)\\)/); if(!m) return null; var p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; }
  function over(top, under){ var a = top.a + under.a*(1-top.a); if (a===0) return {r:0,g:0,b:0,a:0};
    return {r:(top.r*top.a+under.r*under.a*(1-top.a))/a, g:(top.g*top.a+under.g*under.a*(1-top.a))/a, b:(top.b*top.a+under.b*under.a*(1-top.a))/a, a:a}; }
  function lum(c){ function ch(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); } return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b); }
  function ratio(a,b){ var x=lum(a), y=lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
  var rootBg = parse(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1};
  var meta = getComputedStyle(document.documentElement).getPropertyValue('--text-meta').trim();
  var probeEl = document.createElement('span'); probeEl.style.color = meta; document.body.appendChild(probeEl);
  var metaRgb = getComputedStyle(probeEl).color; probeEl.remove();
  var section = document.querySelector('section[data-screen]:not([hidden])');
  var shell = Array.from(document.querySelectorAll('body *')).filter(function(el){ return !section || !section.contains(el); });
  var scope = section ? [section].concat(Array.from(section.querySelectorAll('*'))) : [];
  var out = { measured:0, below:[], meta:[], unmeasured:0, disabled:0, metaRgb: metaRgb, capped:false };
  var cache = new Map(); function st(n){ var v = cache.get(n); if (!v) { v = getComputedStyle(n); cache.set(n, v); } return v; }
  var CAP = 1500, seen = 0;
  scope.forEach(function(el){
    if (seen >= CAP) { out.capped = true; return; }
    var own = Array.from(el.childNodes).some(function(n){ return n.nodeType===3 && n.textContent.trim().length>0; });
    if (!own) return;
    seen++;
    var r = el.getBoundingClientRect(); if (r.width<1||r.height<1) return;
    if (typeof el.checkVisibility==='function' && !el.checkVisibility({checkVisibilityCSS:true, opacityProperty:true})) return;
    var cs = st(el); var fg = parse(cs.color); if(!fg) return;
    var op = 1, bgLayers = [], img = false;
    for (var n = el; n && n !== document.documentElement; n = n.parentElement) {
      var s = st(n); op *= Number(s.opacity);
      if (s.backgroundImage && s.backgroundImage !== 'none') { img = true; break; }
      var b = parse(s.backgroundColor); if (b && b.a>0) { bgLayers.push(b); if (b.a>=1) break; }
    }
    if (img) { out.unmeasured++; return; }
    var bg = rootBg; for (var i = bgLayers.length-1; i>=0; i--) bg = over(bgLayers[i], bg);
    var eff = over({r:fg.r,g:fg.g,b:fg.b,a:fg.a*op}, bg);
    var q = ratio(eff, bg); out.measured++;
    var px = parseFloat(cs.fontSize), wt = Number(cs.fontWeight)||400;
    var large = px>=24 || (px>=18.66 && wt>=700); var need = large?3:4.5;
    var who = el.tagName.toLowerCase() + (el.id?('#'+el.id):'') + (el.classList.length?('.'+Array.from(el.classList).slice(0,2).join('.')):'');
    var row = { who: who, ratio: Math.round(q*100)/100, need: need, px: px };
    // WCAG 1.4.3 exempts inactive controls; counted, never reported as a failure.
    if (el.closest('button:disabled, [aria-disabled="true"]')) { out.disabled++; return; }
    if (cs.color === metaRgb) { if (q < 2.4) out.meta.push(row); return; }
    if (q < need) out.below.push(row);
  });
  return JSON.stringify(out);
})()`;

const original = await probe.rawEvaluate(`document.documentElement.getAttribute('data-theme') || ''`);
const screens = JSON.parse(await probe.rawEvaluate(`JSON.stringify(Array.from(document.querySelectorAll('section[data-screen]')).map(s => s.dataset.screen))`));
let totalBelow = 0, totalMeasured = 0, notMeasured = 0;
try {
  for (const theme of ['dark', 'light']) {
    await probe.rawEvaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); 'ok'`);
    console.log(`\n== theme ${theme}`);
    for (const screen of screens) {
      const routed = await probe.rawEvaluate(`(function(){
        var want = ${JSON.stringify(screen)}.toLowerCase();
        // An unbuilt pane's row names itself with its reason ("Camera — not built yet. …"), so match the name or the name before the dash.
        var b = Array.from(document.querySelectorAll('button')).find(function (x) { var l = (x.getAttribute('aria-label') || '').toLowerCase(); return l === want || l.indexOf(want + ' —') === 0; });
        if (!b) return 'no-nav-row'; b.click();
        return document.querySelector('section[data-screen="' + ${JSON.stringify(screen)} + '"]').hidden ? 'refused' : 'ok'; })()`);
      if (routed !== 'ok') { console.log(`  ${screen.padEnd(14)} not measured (${routed})`); notMeasured++; continue; }
      await new Promise((r) => setTimeout(r, 250));
      const t0 = Date.now();
      process.stdout.write(`  ${screen.padEnd(14)} measuring… `);
      const m = JSON.parse(await probe.rawEvaluate(MEASURE));
      process.stdout.write(`${Date.now() - t0} ms${m.capped ? ' — CAPPED at 1,500 text elements: the rest of this pane was NOT measured' : ''}\n`);
      totalMeasured += m.measured; totalBelow += m.below.length;
      console.log(`  ${screen.padEnd(14)} measured ${String(m.measured).padStart(4)} · below AA ${m.below.length} · meta below 2.4 ${m.meta.length} · unmeasured (image/gradient ground) ${m.unmeasured} · disabled (exempt) ${m.disabled}`);
      for (const b of m.below.slice(0, 12)) console.log(`      ${b.ratio.toFixed(2)}:1 < ${b.need}  ${b.px}px  ${b.who}`);
      for (const b of m.meta.slice(0, 6)) console.log(`      meta ${b.ratio.toFixed(2)}:1 < 2.4  ${b.who}`);
    }
  }
} finally {
  await probe.rawEvaluate(original ? `document.documentElement.setAttribute('data-theme', ${JSON.stringify(original)}); 'ok'` : `document.documentElement.removeAttribute('data-theme'); 'ok'`);
}
console.log(`\nTOTAL: ${totalMeasured} text elements measured across both themes; ${totalBelow} below AA; ${notMeasured} pane-theme pairs not measured. Theme attribute restored to "${original}".`);

// The probe holds a CDP socket open, which keeps Node alive after the last line: the first two runs
// "hung" after printing their totals, and a pipe to `tail` then waited for an end of file that never came.
process.exit(totalBelow > 0 ? 1 : 0);
