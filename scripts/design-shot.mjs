#!/usr/bin/env node
/**
 * A screenshot of one artboard of the design canvas, so a build shot has something to sit beside.
 *
 * The counterpart to `shot.mjs`, and it exists for the same reason: the last design pass produced
 * `*-design.png` files with a scratchpad script that no longer survives, so nobody could re-take
 * them when the comparison moved on.
 *
 * ### The two things it has to get right, both of which are silent when wrong
 *
 *  - **The page.** `ConnectSuite.dc.html` is one interactive artboard with a `page` in its state,
 *    not twelve files. It opens on Overview. A shot of Overview written as `photos-design.png` is
 *    the same failure `shot.mjs` refuses on the build side, so the nav click is a **stimulus that
 *    reports its effect**: the pane's own marker has to be on screen before anything is captured.
 *  - **The scale.** The artboard is a `1440px` div inside a padded, scrolling body, at DPR 1, while
 *    the build is captured at DPR 2. Comparing them without saying so makes every proportion wrong
 *    by a factor of two. The clip is read off the artboard element *after* it has settled, and the
 *    DPR goes in the sidecar.
 *
 * It drives a **separate headless Chrome**, never the app's own Electron: the design file loads a
 * `_ds_bundle.js` and a Google Fonts stylesheet, and the app's page is CSP-locked against both.
 *
 *   node scripts/design-shot.mjs --page=photos --out=docs/evidence/x/photos-design.png
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';

const arg = (n, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const DESIGN = arg(
  'design',
  '/Users/chetan/Downloads/ITR Invoices/Mac app UI mockups/ConnectSuite.dc.html',
);
const page = arg('page', 'overview');
const out = arg('out');
const port = Number(arg('port', '9333'));
if (!out) {
  console.error('design-shot.mjs: --out=<path.png> is required');
  exit(2);
}
if (!existsSync(DESIGN)) {
  console.error(`design-shot.mjs: no design file at ${DESIGN}`);
  exit(2);
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1560,1040',
    '--allow-file-access-from-files',
    '--no-first-run',
    `--user-data-dir=/tmp/design-shot-${port}`,
    `file://${encodeURI(DESIGN)}`,
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for the debugging endpoint rather than sleeping a guessed amount at it. */
async function targetOf() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      // **Match the page we launched, never "the first page".** This browser is ours and has one
      // tab today, so the loose form was safe — but it is the same expression that attached a probe
      // to ConnectSuite's float window on 2026-09-12 the moment that app grew a second window, and
      // a stray `about:blank` or a second Chrome on this port would do it here. Naming the URL costs
      // one line and makes the wrong-target case impossible rather than unlikely.
      const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      const hit = pages.find((t) => decodeURI(t.url ?? '').includes(DESIGN));
      if (hit) return hit;
      if (pages.length > 0) {
        throw new Error(
          `design-shot: ${pages.length} page(s) on :${port} and none is the design — ` +
            pages.map((t) => t.url).join(', '),
        );
      }
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`design-shot: headless Chrome never opened a page on :${port}`);
}

const target = await targetOf();
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const resolve = pending.get(msg.id);
  if (resolve) {
    pending.delete(msg.id);
    resolve(msg);
  }
};
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('design-shot: could not attach'));
});

const send = (method, params) =>
  new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page threw');
  return r.result?.value;
};

/** The artboard has rendered when its nav exists — polled, never slept at. */
async function settled(predicate, within, what) {
  const deadline = Date.now() + within;
  for (;;) {
    if (await evaluate(predicate)) return true;
    if (Date.now() >= deadline) {
      console.error(`design-shot REFUSED: ${what} did not become true within ${within}ms`);
      chrome.kill();
      exit(1);
    }
    await sleep(200);
  }
}

await settled(`document.querySelectorAll('.cs-nav').length >= 10`, 25000, 'the artboard rendering');

// The stimulus, which reports its effect: the nav row is clicked and then the pane's own marker has
// to be on screen. `page` names the design's own state id, so a typo refuses rather than silently
// screenshotting Overview under another pane's filename.
const clicked = await evaluate(
  `(() => { const n = document.querySelector('.cs-nav[data-nav=${JSON.stringify(page)}]');
    if (!n) return false; n.click(); return true; })()`,
);
if (!clicked) {
  const available = await evaluate(
    `[...document.querySelectorAll('.cs-nav')].map(n => n.getAttribute('data-nav')).join(', ')`,
  );
  console.error(`design-shot REFUSED: no nav row "${page}". The artboard has: ${available}`);
  chrome.kill();
  exit(1);
}
await settled(
  `(() => { const t = document.querySelector('h1'); return !!t && t.textContent.trim().length > 0; })()`,
  8000,
  'the page title after the nav click',
);
// The artboard animates its cards in over ~300ms and its rings over 140ms; both are declared in the
// sidecar rather than hidden inside a bare wait.
const settleMs = Number(arg('settle', '1400'));
await sleep(settleMs);

const clip = await evaluate(`(() => {
  const board = [...document.querySelectorAll('div')].find(d => d.style && d.style.width === '1440px');
  if (!board) return null;
  const r = board.getBoundingClientRect();
  return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 1 };
})()`);
if (!clip) {
  console.error('design-shot REFUSED: could not find the 1440px artboard div to clip to');
  chrome.kill();
  exit(1);
}

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
writeFileSync(
  out.replace(/\.png$/, '.json'),
  JSON.stringify(
    {
      file: out,
      source: DESIGN,
      page,
      artboard: { width: clip.width, height: clip.height },
      dpr: 1,
      settleMs,
      note: 'DPR 1. The build shots are DPR 2 — scale to a common width before comparing proportions.',
      takenAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`wrote ${out}  [artboard ${clip.width}x${clip.height} @1x, page=${page}, settled ${settleMs}ms]`);
chrome.kill();
exit(0);
