/*
 * UI harness: loads a scratch build of the Sidekick renderer with a synthetic bridge, at several
 * window sizes, themes and data modes, and measures every pane. Not the product: no link, no phone,
 * no network, its own profile directory, hidden windows, no debugging port.
 *
 *   electron harness-main.cjs <out-dir> [jobs-json]
 */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const HERE = __dirname;
const OUT = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? join(HERE, 'out');
const JOBS_FILE = process.argv.find((a) => a.startsWith('--jobs-file='))?.split('=')[1];
const JOBS = JOBS_FILE ? JSON.parse(require('node:fs').readFileSync(JOBS_FILE, 'utf8')) : JSON.parse(process.argv.find((a) => a.startsWith('--jobs='))?.slice(7) ?? '[]');
const SHOTS = process.argv.includes('--shots');
const EXTRA = process.argv.find((a) => a.startsWith('--extra-file='))?.split('=')[1];
const EXTRA_JS = EXTRA ? require('node:fs').readFileSync(EXTRA, 'utf8') : null;
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
const INDEX = join(HERE, 'desktop', 'dist', 'renderer', 'index.html');

app.setPath('userData', join(HERE, 'userdata'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
mkdirSync(OUT, { recursive: true });

const MEASURE = String.raw`(id) => {
  const desc = (el) => {
    if (!el) return null;
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      if (a.hidden) return false;
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const section = document.querySelector('section[data-screen="' + id + '"]');
  const sectionVisible = !!section && visible(section);
  const scope = [document.querySelector('.app-window') || document.body];
  const inScope = (el) => {
    // the shell, plus the section on screen; every other section is hidden and skipped
    const sec = el.closest('section[data-screen]');
    return !sec || sec === section;
  };
  const vw = innerWidth, vh = innerHeight;
  const clipAncestor = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox !== 'visible') return { el: a, ox };
    }
    return null;
  };

  const hScroll = [];
  for (const el of document.querySelectorAll('body, body *')) {
    if (!inScope(el) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll' || el === document.body) && el.scrollWidth > el.clientWidth + 1) {
      hScroll.push({ el: desc(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
  }
  const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=checkbox], [role=menuitem], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => inScope(el) && visible(el));
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map((x) => document.getElementById(x)?.textContent?.trim() ?? '').join(' ').trim(); if (t) return t; }
    if (el.labels && el.labels.length) { const t = [...el.labels].map((l) => l.textContent.trim()).join(' ').trim(); if (t) return t; }
    const t = (el.innerText ?? el.textContent ?? '').trim();
    if (t) return t;
    const img = el.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    if (el.placeholder) return '(placeholder only) ' + el.placeholder;
    return '';
  };
  const unnamed = controls.filter((el) => !nameOf(el)).map(desc);
  const placeholderOnly = controls.filter((el) => nameOf(el).startsWith('(placeholder only)')).map(desc);

  const clippedControls = [], offViewport = [];
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    const c = clipAncestor(el);
    if (c && (c.ox === 'hidden' || c.ox === 'clip')) {
      const cr = c.el.getBoundingClientRect();
      if (r.right > cr.right + 1 || r.left < cr.left - 1) clippedControls.push({ el: desc(el), by: desc(c.el), right: Math.round(r.right), clipRight: Math.round(cr.right) });
    } else if (!c && (r.right > vw + 1 || r.bottom > vh + 1)) {
      offViewport.push({ el: desc(el), right: Math.round(r.right), bottom: Math.round(r.bottom) });
    }
  }

  const overlaps = [];
  const rects = controls.map((el) => [el, el.getBoundingClientRect()]);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, ra] = rects[i], [b, rb] = rects[j];
    if (a.contains(b) || b.contains(a)) continue;
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 2 && h > 2) overlaps.push({ a: desc(a), b: desc(b), w: Math.round(w), h: Math.round(h) });
  }

  // Controls against TEXT, not only against other controls (added 2026-10-06 for U1: the overnight
  // run scored "0 overlapping controls" over a Retry now button drawn on a card's sentence). Text is
  // measured by its own line boxes (Range.getClientRects), so a control over a paragraph's empty
  // right-hand side is not counted, and text inside the control itself is skipped.
  const textOverlaps = [];
  // What is actually painted: a rect cut by every ancestor that clips (overflow other than visible),
  // the host itself included — a line-clamped or scrolled-away line has rects but draws nothing there.
  const clipped = (start, r) => {
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let a = start; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const c = a.getBoundingClientRect();
      box = { left: Math.max(box.left, c.left), top: Math.max(box.top, c.top), right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom) };
    }
    return box;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textRects = [];
  for (let nd = walker.nextNode(); nd; nd = walker.nextNode()) {
    if (!nd.textContent.trim()) continue;
    const host = nd.parentElement;
    if (!host || !inScope(host) || !visible(host)) continue;
    if (host.closest('.visually-hidden, .sr-only')) continue;
    const range = document.createRange(); range.selectNodeContents(nd);
    for (const raw of range.getClientRects()) { const r = clipped(host, raw); if (r.right - r.left > 1 && r.bottom - r.top > 1) textRects.push([nd, host, r]); }
  }
  for (const [el, raw] of rects) {
    const rc = clipped(el.parentElement, raw);
    if (rc.right - rc.left <= 1 || rc.bottom - rc.top <= 1) continue;
    for (const [nd, host, r] of textRects) {
      if (el.contains(nd)) continue;
      const w = Math.min(rc.right, r.right) - Math.max(rc.left, r.left);
      const h = Math.min(rc.bottom, r.bottom) - Math.max(rc.top, r.top);
      if (w > 2 && h > 2) textOverlaps.push({ control: desc(el), text: desc(host), sample: nd.textContent.trim().slice(0, 24), w: Math.round(w), h: Math.round(h) });
    }
  }

  const truncated = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!inScope(el) || !visible(el)) continue;
    const hasText = [...el.childNodes].some((nd) => nd.nodeType === 3 && nd.textContent.trim());
    if (!hasText) continue;
    if (el.closest('.visually-hidden, .sr-only') || (getComputedStyle(el).clip !== 'auto' && getComputedStyle(el).position === 'absolute')) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'visible' && cs.overflow === 'visible') continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      truncated.push({ el: desc(el), ellipsis: cs.textOverflow === 'ellipsis', titled: !!el.getAttribute('title'), text: (el.textContent || '').trim().slice(0, 40) });
    }
  }

  const smallTargets = controls.map((el) => [el, el.getBoundingClientRect()])
    .filter(([, r]) => r.width < 24 || r.height < 24).map(([el, r]) => ({ el: desc(el), w: Math.round(r.width), h: Math.round(r.height) }));

  const zeroHeightText = [...document.querySelectorAll('body *')].filter((el) => inScope(el) && !el.hidden && el.tagName !== 'OPTION' && !el.closest('select')
    && [...el.childNodes].some((nd) => nd.nodeType === 3 && nd.textContent.trim())
    && el.getBoundingClientRect().height < 1 && getComputedStyle(el).display !== 'none'
    && (() => { for (let a = el.parentElement; a; a = a.parentElement) { if (a.hidden || getComputedStyle(a).display === 'none') return false; } return true; })())
    .map(desc);

  return {
    id, sectionVisible, innerWidth: vw, innerHeight: vh, docOverflow, hScroll,
    controls: controls.length, unnamed, placeholderOnly, clippedControls, offViewport, overlaps, textOverlaps: textOverlaps.slice(0, 40), textOverlapCount: textOverlaps.length,
    truncated: truncated.slice(0, 40), truncatedCount: truncated.length, smallTargets: smallTargets.slice(0, 40), smallTargetCount: smallTargets.length,
    zeroHeightText: zeroHeightText.slice(0, 20),
  };
}`;

// Controls for the instrument itself, run once per page: a node the measurement must see as
// overflowing, a button it must see as unnamed, and two it must see as overlapping.
const CONTROL = String.raw`(() => {
  const css = (el, o) => { for (const [k, v] of Object.entries(o)) el.style[k] = v; return el; };
  const host = css(document.createElement('div'), { position: 'fixed', left: '10px', top: '10px', width: '100px', height: '40px', overflowX: 'auto', zIndex: '99999' });
  host.id = 'harness-control';
  host.appendChild(css(document.createElement('div'), { width: '300px', height: '10px' }));
  const a = css(document.createElement('button'), { position: 'absolute', left: '0px', top: '0px', width: '30px', height: '30px' });
  a.id = 'hc-a';
  const b = css(document.createElement('button'), { position: 'absolute', left: '10px', top: '5px', width: '30px', height: '30px' });
  b.id = 'hc-b'; b.textContent = 'B';
  const t = css(document.createElement('span'), { position: 'absolute', left: '0px', top: '45px', width: '90px', fontSize: '12px' });
  t.id = 'hc-text'; t.textContent = 'covered sentence';
  const c = css(document.createElement('button'), { position: 'absolute', left: '0px', top: '42px', width: '60px', height: '20px' });
  c.id = 'hc-c'; c.textContent = 'C';
  host.style.height = '80px';
  host.append(a, b, t, c);
  document.body.appendChild(host);
  return true;
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(win, code, what) {
  const wrapped = `(async () => { try { return { ok: true, value: await (${code}) }; } catch (e) { return { ok: false, error: String(e && e.stack || e) }; } })()`;
  const r = await win.webContents.executeJavaScript(wrapped);
  if (!r.ok) throw new Error(`${what}: ${r.error}`);
  return r.value;
}

async function runJob(job) {
  const { mode, theme, width, height, zoom = 1, scale = 1, label } = job;
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(HERE, 'harness-preload.cjs'), contextIsolation: false, sandbox: false, nodeIntegration: false,
      additionalArguments: [`--harness-mode=${mode}`, `--harness-theme=${theme}`, `--harness-scale=${scale}`, ...(job.noshare ? ['--harness-noshare'] : []), ...(job.photosTotal ? [`--harness-photos-total=${job.photosTotal}`] : [])], backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(`${e.message} @${String(e.sourceId).split('/').pop()}:${e.lineNumber}`); });
  globalThis.__lastErrors = errors;
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`render-process-gone ${d.reason}`));
  const t0 = Date.now();
  await win.loadFile(INDEX);
  win.webContents.setZoomFactor(zoom);
  await sleep(1500);
  const bootMs = Date.now() - t0;
  const screens = await run(win, 'SCREENS.map((s) => s.id)', 'screens');
  const results = [];
  const dir = join(OUT, label);
  mkdirSync(dir, { recursive: true });
  // Instrument control, on the first screen only, then removed.
  await run(win, CONTROL, 'control');
  const control = await run(win, `(${MEASURE})('__control__')`, 'measure-control');
  await run(win, `document.getElementById('harness-control').remove()`, 'control-remove');
  const controlOk = control.hScroll.some((h) => h.el === 'div#harness-control') && control.unnamed.includes('button#hc-a')
    && control.overlaps.some((o) => (o.a === 'button#hc-a' && o.b === 'button#hc-b') || (o.a === 'button#hc-b' && o.b === 'button#hc-a'))
    && control.textOverlaps.some((o) => o.control === 'button#hc-c' && o.text === 'span#hc-text');
  for (const id of [...screens, 'pairing'].filter((x) => !ONLY || ONLY.includes(x))) {
    const tRoute = Date.now();
    await run(win, `shell.route(${JSON.stringify(id)})`, 'route ' + id);
    await sleep(700);
    const m = await run(win, `(${MEASURE})(${JSON.stringify(id)})`, 'measure ' + id);
    m.settleMs = Date.now() - tRoute;
    if (EXTRA_JS) m.extra = await run(win, `(${EXTRA_JS})(${JSON.stringify(id)})`, 'extra ' + id);
    if (SHOTS) {
      const img = await win.webContents.capturePage();
      writeFileSync(join(dir, `${id}.png`), img.toPNG());
    }
    results.push(m);
  }
  const unmodelled = await run(win, 'window.__harness.unmodelled', 'unmodelled');
  win.destroy();
  return { job, bootMs, controlOk, errors: [...new Set(errors)].slice(0, 30), unmodelled, results };
}

// The default is to quit when the last window closes, which ends the run after its first job.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.dock) app.dock.hide();
  const all = [];
  for (const job of JOBS) {
    try {
      all.push(await runJob(job));
    } catch (error) {
      all.push({ job, error: String(error && error.message || error) });
    }
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(all, null, 1));
  app.exit(0);
});
