#!/usr/bin/env node
/**
 * The build and the design, side by side in one image, both scaled to a common width.
 *
 * ### Why the scaling is the whole point
 *
 * The build is captured at **DPR 2** and the design artboard at **DPR 1**. Put the two PNGs next to
 * each other untouched and the build appears at twice the size, so every comparison of proportion —
 * which is what a design comparison *is* — is wrong by a factor of two while both images are
 * individually correct. That is a units error of exactly the kind `CLAUDE.md` records for
 * `query-activities`: two honest numbers of two different things.
 *
 * So both are drawn into one page at the same CSS width, and the width used is written into the
 * image itself and into the sidecar.
 *
 * ### Why it composes in a browser rather than with an image library
 *
 * There is no image-manipulation dependency in this repo and adding one for a picture would be a
 * poor trade. A headless Chrome is already here for `design-shot.mjs`, and laying two `<img>` out
 * side by side is the thing a browser is best at. The labels are drawn by the same page, so an
 * image can never be mislabelled by a filename that drifted.
 *
 *   node scripts/compare-shot.mjs --build=x/photos-build.png --design=x/photos-design.png \
 *        --out=x/photos-compare.png --title=Photos
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv, exit } from 'node:process';

const arg = (n, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const build = arg('build');
const design = arg('design');
const out = arg('out');
const title = arg('title', '');
const width = Number(arg('width', '1440'));
if (!build || !design || !out) {
  console.error('compare-shot.mjs: --build, --design and --out are all required');
  exit(2);
}
for (const [what, path] of [['build', build], ['design', design]]) {
  if (!existsSync(path)) {
    console.error(`compare-shot.mjs REFUSED: no ${what} image at ${path}`);
    exit(1);
  }
}

const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

/**
 * The two sidecars, quoted into the image.
 *
 * Every bound the instruments imposed travels with the picture rather than being remembered — the
 * window size, the DPR, the scrollbar, the settle. A comparison read six weeks later otherwise has
 * no way to know whether the build shot was taken on a scrolling page or a still one, and that is
 * an 11px column-width difference that looks like a design departure.
 */
const sidecarOf = (p) => {
  const path = p.replace(/\.png$/, '.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};
const buildMeta = sidecarOf(build);
const designMeta = sidecarOf(design);
const note = (meta, fallback) =>
  meta
    ? `${meta.window ? `${meta.window.inner}×${meta.window.innerH} @${meta.window.dpr}x` : `${meta.artboard.width}×${meta.artboard.height} @${meta.dpr}x`}` +
      `${meta.scrollbarPx !== undefined ? `, scrollbar ${meta.scrollbarPx}px` : ''}` +
      `${meta.pageScrolls !== undefined ? `, page ${meta.pageScrolls ? 'scrolls' : 'does not scroll'}` : ''}`
    : fallback;

const page = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:#0b0b10;color:#e7e7ee;
    font:500 13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
  .wrap{display:flex;gap:20px;padding:20px;align-items:flex-start;width:max-content}
  .col{width:${width}px}
  .head{display:flex;align-items:baseline;gap:10px;padding:0 2px 8px}
  .name{font-size:15px;font-weight:600;color:#f4f4f7}
  .meta{font:500 11px/1.2 "SF Mono",ui-monospace,Menlo,monospace;color:#5b5e6e}
  img{width:${width}px;display:block;border-radius:10px;border:1px solid rgba(255,255,255,.10)}
  .title{padding:16px 22px 0;font-size:17px;font-weight:600;letter-spacing:-.01em}
</style>
${title ? `<div class="title">${title} — build against design, both at ${width}px</div>` : ''}
<div class="wrap">
  <div class="col">
    <div class="head"><span class="name">Build</span><span class="meta">${note(buildMeta, 'the running app')}</span></div>
    <img id="a" src="${dataUri(build)}">
  </div>
  <div class="col">
    <div class="head"><span class="name">Design</span><span class="meta">${note(designMeta, 'ConnectSuite.dc.html')}</span></div>
    <img id="b" src="${dataUri(design)}">
  </div>
</div>`;

const pagePath = `/tmp/compare-shot-${process.pid}.html`;
writeFileSync(pagePath, page);

/*
 * A per-process port by default.
 *
 * A fixed one collided when five comparisons were composed in a loop: the previous headless Chrome
 * had exited but its debugging port was still held, and the run failed with a stack rather than a
 * message. The default is derived from the pid so concurrent or back-to-back runs cannot fight;
 * `--port=` still pins it when someone wants to attach.
 */
const port = Number(arg('port', String(9400 + (process.pid % 400))));
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width * 2 + 80},1200`,
    '--no-first-run',
    `--user-data-dir=/tmp/compare-shot-${port}`,
    `file://${pagePath}`,
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 60 && !target; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    // The page we wrote, by name — not whichever sorted first. See the note in design-shot.mjs:
    // the loose form is safe while a browser has one tab and silently wrong the moment it has two.
    const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    target = pages.find((t) => (t.url ?? '').includes(pagePath)) ?? null;
    if (!target && pages.length > 0) {
      console.error(
        `compare-shot REFUSED: ${pages.length} page(s) on :${port} and none is ${pagePath} — ` +
          pages.map((t) => t.url).join(', '),
      );
      chrome.kill();
      exit(1);
    }
  } catch {
    /* not up yet */
  }
  if (!target) await sleep(250);
}
if (!target) {
  console.error('compare-shot REFUSED: headless Chrome never opened a page');
  chrome.kill();
  exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const done = pending.get(msg.id);
  if (done) {
    pending.delete(msg.id);
    done(msg);
  }
};
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('compare-shot: could not attach'));
});
const send = (method, params) =>
  new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result?.value;
};

// Both images decoded, and both non-degenerate. A `naturalWidth` of 0 is a broken data URI, which
// would compose a clean-looking page with an empty column — the failure this whole file exists to
// make impossible.
const decoded = await (async () => {
  for (let i = 0; i < 40; i += 1) {
    const state = await evaluate(
      `(() => { const a = document.getElementById('a'), b = document.getElementById('b');
        return { a: a.complete && a.naturalWidth, b: b.complete && b.naturalWidth }; })()`,
    );
    if (state.a > 0 && state.b > 0) return state;
    await sleep(150);
  }
  return null;
})();
if (!decoded) {
  console.error('compare-shot REFUSED: one of the two images never decoded — the pair would have composed with an empty column');
  chrome.kill();
  exit(1);
}

const clip = await evaluate(`(() => { const w = document.querySelector('.wrap').getBoundingClientRect();
  return { x: 0, y: 0, width: Math.ceil(w.width), height: Math.ceil(document.body.scrollHeight), scale: 1 }; })()`);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
writeFileSync(
  out.replace(/\.png$/, '.json'),
  JSON.stringify(
    {
      file: out,
      build: resolve(build),
      design: resolve(design),
      commonWidthPx: width,
      naturalWidths: decoded,
      note:
        'Both panels are drawn at the same CSS width. The build is captured at DPR 2 and the ' +
        'design at DPR 1, so an unscaled pairing would show the build at twice the size.',
      takenAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`wrote ${out}  [both at ${width}px; natural ${decoded.a}px build / ${decoded.b}px design]`);
chrome.kill();
exit(0);
