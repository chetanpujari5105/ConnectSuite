/**
 * Files keyboard access, live: real key events (CDP `Input.dispatchKeyEvent`) on the real DOM over
 * Received files (generated test files). After each key, focus is read independently of the pane's
 * own state — `document.activeElement`, its `:focus-visible`, its accessible name — and compared with
 * the selection the pane draws. This file's socket sends key events only; reads go through probe.mjs.
 */
import { openProbe, format } from './probe.mjs';

const p = await openProbe({ port: 9222 });
const target = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page' && t.url.includes('/renderer/index.'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
const cdp = (method, params) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const KEYS = { Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37, Enter: 13, ' ': 32 };
const press = async (key, shift = false) => {
  const base = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: KEYS[key], modifiers: shift ? 8 : 0 };
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (key === ' ' || key === 'Enter') await cdp('Input.dispatchKeyEvent', { type: 'char', text: key === ' ' ? ' ' : '\r', ...base });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await new Promise((r) => setTimeout(r, 120));
};
const FOCUS = `(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { tag: a.tagName.toLowerCase(), cls: typeof a.className === 'string' ? a.className.split(' ')[0] : 'svg', name: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 24), focusVisible: a.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, tabIndex: a.tabIndex, isEntry: !!a.dataset?.id, entryId: a.dataset?.id ?? null, selectedIds: [...files.selectedIds], tabStops: [...document.querySelectorAll('#files-table [data-id]')].filter(e => e.tabIndex === 0).length }; })()`;
const focus = async (label) => { const r = await p.read({ question: label, read: FOCUS, control: `document.activeElement ? 1 : 0` }); return r.value; };
const line = (label, v) => console.log(`  ${label.padEnd(28)} → ${v.tag}.${v.cls} "${v.name}" focusVisible=${v.focusVisible} outline=${v.outline}${v.isEntry ? ` | selected=${v.selectedIds.length === 1 && v.selectedIds[0] === v.entryId ? 'this row' : JSON.stringify(v.selectedIds.length)} tabStops=${v.tabStops}` : ''}`);

await p.act({ what: 'Received files, list, name ↑, nothing selected, focus in the filter', run: `(() => { if (shell.screen !== 'files') shell.route('files'); return true; })()`,
  expect: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r && !/received/i.test(document.querySelector('#files-crumbs')?.textContent||'')) r.click(); if (files.viewMode !== 'list') document.querySelector('#files-view-list').click(); if (!/received/i.test(document.querySelector('#files-crumbs')?.textContent||'') || files.entries.length === 0 || files.loading) return false; files.selectedIds.clear(); files.selected = null; files.focusId = null; files.render(); document.querySelector('#files-search').focus(); return document.activeElement.id === 'files-search'; })()`, within: 20000 });

console.log('== Tab from the filter field');
for (let i = 1; i <= 9; i += 1) {
  await press('Tab');
  const v = await focus(`after Tab ${i}`);
  line(`Tab ${i}`, v);
  if (v.isEntry) break;
}
console.log('== in the list');
await press('ArrowDown'); line('ArrowDown', await focus('ArrowDown'));
await press('ArrowDown'); line('ArrowDown', await focus('ArrowDown 2'));
await press('ArrowDown', true); const ext = await focus('Shift+ArrowDown'); line('Shift+ArrowDown', ext);
console.log(`    shift extended the selection to ${ext.selectedIds.length} rows`);
await press('ArrowUp'); line('ArrowUp', await focus('ArrowUp'));
await press(' '); line('Space', await focus('Space'));
// Enter on a FILE: expect the double-click action — Copy to Mac of a generated test file.
const beforePull = await p.read({ question: 'pulls before Enter', read: `files.lastPull?.text ?? null`, control: '1' });
await press('Enter');
const afterEnter = await p.read({ question: 'after Enter on a file: what the pane did', read: `({ copying: files.copying.size, lastPull: files.lastPull?.text?.slice(0, 60) ?? null, stillFocusedOnEntry: !!document.activeElement.dataset?.id })`, control: '1', settle: { until: (v) => v.copying === 0 && v.lastPull !== null, within: 15000 } });
console.log('  Enter on a file             → ' + JSON.stringify(afterEnter.value) + `  (before: ${JSON.stringify(beforePull.value)})`);

console.log('== in the grid');
await p.act({ what: 'grid, focus the tab stop', run: `(() => { document.querySelector('#files-view-grid').click(); setTimeout(() => document.querySelector('#files-table [data-id][tabindex="0"]').focus(), 50); return true; })()`, expect: `files.viewMode === 'grid' && !!document.activeElement?.dataset?.id`, within: 5000 });
const cols = (await p.read({ question: 'tiles per row', read: `(() => { const t=[...document.querySelectorAll('.files-tile')]; const top=t[0].getBoundingClientRect().top; return t.filter(x=>Math.abs(x.getBoundingClientRect().top-top)<2).length; })()`, control: `__probe.count('.files-tile')` })).value;
const idx = async () => (await p.read({ question: 'focused tile index', read: `[...document.querySelectorAll('.files-tile')].indexOf(document.activeElement)`, control: '1' })).value;
const i0 = await idx(); await press('ArrowRight'); const i1 = await idx(); await press('ArrowDown'); const i2 = await idx(); await press('ArrowLeft'); const i3 = await idx();
line('grid focus now', await focus('grid'));
console.log(`    ${cols} per row; index ${i0} → Right ${i1} → Down ${i2} (expect +${cols}) → Left ${i3}`);
await p.act({ what: 'back to list', run: `(() => { document.querySelector('#files-view-list').click(); return true; })()`, expect: `files.viewMode === 'list'` });
ws.close();
process.exit(0);
