/**
 * Defect 132, live: does a file dropped on the Files pane's tile reach the send card?
 *
 * The drop is a real Chromium drag carrying a real path (`Input.dispatchDragEvent` with `files`), so
 * the `File` objects are the browser's own, not constructed ones. A capturing listener records, for
 * the same `File`, both what the old code read (`file.path`) and what the new code reads
 * (`connect.pathForFile`, i.e. `webUtils.getPathForFile`). The card is then **cancelled** — this probe
 * sends nothing to the phone.
 *
 * The drop point is computed from the named `#files-drop` element's box immediately before the drop
 * — a named target resolved to a point, never a remembered pixel. DOM reads go through probe.mjs;
 * this file's own socket issues only `DOM.*` box queries and `Input.dispatchDragEvent`.
 *
 * Usage: node scripts/sidekick-drop-probe.mjs <file>
 */
import { openProbe, format } from './probe.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: sidekick-drop-probe.mjs <file>'); process.exit(2); }
const probe = await openProbe({ port: 9222 });

await probe.act({
  what: 'install a capturing drop recorder on #files-drop',
  run: `(() => { window.__dropProbe = []; const t = document.querySelector('#files-drop');
    t.addEventListener('drop', (e) => { for (const f of e.dataTransfer.files) window.__dropProbe.push({ name: f.name, oldPathProp: String(f.path), viaWebUtils: connect.pathForFile(f) }); }, { capture: true, once: true });
    return true; })()`,
  expect: `Array.isArray(window.__dropProbe)`,
});
const visible = await probe.read({
  question: 'is the drop tile on screen to receive a drop?',
  read: `(() => { const r = __probe.one('#files-drop').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; })()`,
  control: `__probe.count('section[data-screen="files"]:not([hidden])')`,
});
console.log('  ' + format(visible));

// Raw CDP for the drag only.
const target = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page' && t.url.includes('/renderer/index.'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
const cdp = (method, params) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const data = { items: [], files: [file], dragOperationsMask: 1 };
const { x, y } = visible.value;
console.log(`  dropping at (${x}, ${y}) — the centre of #files-drop as measured just now`);
for (const type of ['dragEnter', 'dragOver', 'drop']) {
  const r = await cdp('Input.dispatchDragEvent', { type, x, y, data });
  if (r.error) console.log(`  CDP ${type} error: ${r.error.message}`);
}
ws.close();

console.log('  ' + format(await probe.read({
  question: 'what the drop handed the page, per file: the old File.path read vs webUtils',
  read: `window.__dropProbe`,
  control: `window.__dropProbe.length`,
  settle: { until: (v) => Array.isArray(v) && v.length > 0, within: 3000 },
})));
console.log('  ' + format(await probe.read({
  question: 'the send card the drop produced',
  read: `__probe.text('#files-detail .files-send')`,
  control: `__probe.count('#files-send-cancel')`,
  settle: { until: (v) => typeof v === 'string' && v.length > 0, within: 3000 },
})));
const cancelled = await probe.act({
  what: 'press Cancel — this probe sends nothing',
  run: `(() => { document.querySelector('#files-send-cancel').click(); return true; })()`,
  expect: `!document.querySelector('#files-send-cancel')`,
});
console.log(`  cancelled: ${cancelled.landed}`);
process.exit(0);
