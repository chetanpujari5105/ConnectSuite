/**
 * Screenshot a window's **own pixels**, through CDP, never the desktop around it.
 *
 * ### Why this exists rather than `screencapture -R`
 *
 * `screencapture -R` needs a rectangle, and the rectangle came from System Events. Two things went
 * wrong with that in one sitting and only the second was noticed quickly:
 *
 *  - The window **moved between reading the rect and taking the shot** (the phone rotated), so the
 *    file was a correct capture of the wrong region.
 *  - Then System Events began returning an **empty window list** for the Electron process —
 *    including the main window, which certainly exists — so the query held no reading at all, while
 *    CDP could see both pages perfectly well. A gate that compared two reads for equality passed on
 *    two identical *error strings* and captured anyway.
 *
 * A page capture has neither failure: the viewport is the window, it is atomic, and there is no
 * coordinate to go stale. It also keeps whatever else is on the owner's screen out of a file that
 * goes into `docs/evidence/` — an evidence shot of a window should contain the window.
 *
 * It does not use `Runtime.evaluate`, so it is outside `probe.test.mjs`'s scan by construction
 * rather than by exemption.
 *
 * Usage: node scripts/shoot-page.mjs <window-key> <out.png>
 */
import { writeFileSync } from 'node:fs';

const [, , want = 'float', out = 'shot.png'] = process.argv;
const port = 9222;

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const pages = targets.filter((t) => t.type === 'page');
const matching = pages.filter((t) => (t.url ?? '').includes(`/renderer/${want}.`));
if (matching.length === 0) {
  console.error(`REFUSED: no page matching /renderer/${want}. among ${pages.length} pages: ` +
    pages.map((p) => p.title).join(', '));
  process.exit(1);
}
if (matching.length > 1) {
  console.error(`REFUSED: ${matching.length} pages match — narrow it until it can only be the thing`);
  process.exit(1);
}

const ws = new WebSocket(matching[0].webSocketDebuggerUrl);
const pending = new Map();
let id = 0;
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const resolve = pending.get(msg.id);
  if (resolve) { pending.delete(msg.id); resolve(msg.result ?? {}); }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cannot attach')); });
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

const metrics = await send('Page.getLayoutMetrics');
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
ws.close();

if (!shot.data) { console.error('REFUSED: the capture returned no data'); process.exit(1); }
writeFileSync(out, Buffer.from(shot.data, 'base64'));
const v = metrics.cssVisualViewport ?? {};
console.log(`captured ${out} — page viewport ${Math.round(v.clientWidth ?? 0)}x${Math.round(v.clientHeight ?? 0)} css px, ` +
  `${Buffer.from(shot.data, 'base64').length} bytes`);
