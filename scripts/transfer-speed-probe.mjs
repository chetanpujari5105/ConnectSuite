/**
 * Transfer speed, end to end, through the product's own paths — never a second client.
 *
 *   push <file> [<file> …]   Mac → phone: the Files pane's Send to phone into Received files, pressed by id.
 *   pull <name> [<name> …]   phone → Mac: the Files pane's selection pull from Received files, one at a time.
 *
 * What it measures, and what it does not:
 *
 * - **push:** a MutationObserver timestamps every per-file phase the send card draws. `sending` begins
 *   once the Mac has hashed the file (≤ 64 MiB) and the phone has agreed; `confirming` means **this Mac
 *   finished writing to the socket**, which is not delivery; `arrived` is drawn only on the phone's own
 *   `fs.transfer.done ok` — the receiver's verdict after it hashed what landed. The rate reported is bytes
 *   over click → `arrived`, i.e. receiver-verified. The sender-side rate (click → `confirming`) is printed
 *   beside it, labelled, because the gap between the two is itself a finding.
 * - **pull:** the pane's own `files.lastPull`, which settles after the Mac wrote, hashed and renamed the
 *   file and compared the digest the phone agreed in advance (`verified`). Timed from the row's click.
 * - The instrument's own bounds are printed: the deadline, and that timestamps are renderer
 *   `performance.now()` (a MutationObserver callback; not throttled by timers).
 *
 * Usage: node scripts/transfer-speed-probe.mjs push a.bin b.bin
 *        node scripts/transfer-speed-probe.mjs pull a.bin
 */
import { openProbe, format } from './probe.mjs';
import { statSync } from 'node:fs';
import { basename } from 'node:path';

const [mode, ...args] = process.argv.slice(2);
if (!['push', 'pull'].includes(mode) || args.length === 0) {
  console.error('usage: transfer-speed-probe.mjs push <file>… | pull <name>…');
  process.exit(2);
}
const DEADLINE_MS = 15 * 60 * 1000;
const p = await openProbe({ port: 9222 });

const receivedOpen = await p.act({
  what: 'Files → Received files',
  run: `(() => { shell.route('files'); return true; })()`,
  // Clicked from the expect, as the pull probe does: the rail may not be drawn when the route lands.
  expect: `(() => { const onIt = () => /received/i.test(document.querySelector('#files-crumbs')?.textContent||''); if (!onIt()) { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r) r.click(); } return onIt() && !!document.querySelector('#files-table'); })()`,
  within: 30000,
});
if (!receivedOpen.landed) { console.log('  FAIL  Received files did not open — nothing below is a reading'); process.exit(1); }

const free = await p.read({
  question: 'free bytes the phone reports for Received files (fs.roots)',
  read: `(() => { const r = files.roots.find(x => /received/i.test(x.label)); return r ? r.freeBytes : null; })()`,
  control: `files.roots.length`,
});
console.log('  ' + format(free));

const mb = (b) => (b / 1e6).toFixed(2);
const rate = (bytes, ms) => (ms > 0 ? `${(bytes / 1e6 / (ms / 1000)).toFixed(2)} MB/s` : 'n/a');

if (mode === 'push') {
  const items = args.map((source) => ({ source, name: basename(source), size: statSync(source).size }));
  const total = items.reduce((a, i) => a + i.size, 0);
  await p.act({
    what: 'install the phase recorder',
    run: `(() => {
      window.__speed?.obs?.disconnect();
      const s = { t0: 0, ev: [], seen: new Map() };
      const scan = () => { for (const li of document.querySelectorAll('#files-detail .files-send-item')) {
        const n = li.querySelector('.files-send-name')?.textContent ?? '?'; const ph = li.dataset.phase;
        if (s.seen.get(n) !== ph) { s.seen.set(n, ph); s.ev.push([n, ph, performance.now()]); } } };
      s.obs = new MutationObserver(scan);
      s.obs.observe(document.querySelector('#files-detail'), { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] });
      window.__speed = s; return true; })()`,
    expect: `!!window.__speed`,
  });
  const offered = await p.act({
    what: `offer ${items.length} file(s) through the pane's own offer()`,
    run: `(() => { files.offer(${JSON.stringify(items)}, 0); return true; })()`,
    expect: `!!document.querySelector('#files-send-confirm')`,
    within: 5000,
  });
  if (!offered.landed) { console.log('  FAIL  no confirmation card'); process.exit(1); }
  const sent = await p.act({
    what: 'press Send (by id) and wait for every verdict',
    run: `(() => { window.__speed.t0 = performance.now(); document.querySelector('#files-send-confirm').click(); return true; })()`,
    expect: `!!document.querySelector('#files-send-done')`,
    within: DEADLINE_MS,
  });
  const got = await p.read({
    question: 'phase timestamps and final lines',
    read: `({ t0: window.__speed.t0, ev: window.__speed.ev, lines: [...document.querySelectorAll('#files-detail .files-send-item')].map(li => [li.querySelector('.files-send-name').textContent, li.dataset.phase, li.querySelector('.files-send-meta').textContent]) })`,
    control: `__probe.count('#files-detail .files-send-item')`,
  });
  if (!sent.landed) { console.log(`  DEADLINE  not every verdict arrived within ${DEADLINE_MS} ms — no rate is reportable`); }
  const { t0, ev, lines } = got.value;
  let lastArrived = 0; let lastConfirming = 0;
  console.log(`  push: ${items.length} file(s), ${total} bytes (${mb(total)} MB); timestamps in ms after Send`);
  for (const it of items) {
    const at = (ph) => { const e = ev.find(([n, x]) => n === it.name && x === ph); return e ? Math.round(e[2] - t0) : null; };
    const s = at('sending'); const c = at('confirming'); const a = at('arrived');
    if (a !== null) lastArrived = Math.max(lastArrived, a);
    if (c !== null) lastConfirming = Math.max(lastConfirming, c);
    const line = lines.find(([n]) => n === it.name);
    console.log(`    ${it.name}  ${it.size} B  sending@${s}  mac-finished-writing@${c}  arrived(phone verdict)@${a}  — ${line?.[1]} | ${line?.[2]}`);
  }
  console.log(`  TOTAL receiver-verified: ${total} B in ${lastArrived} ms = ${rate(total, lastArrived)}   (sender-side only: ${rate(total, lastConfirming)}, NOT delivery)`);
  console.log(`  bounds: deadline ${DEADLINE_MS} ms; renderer performance.now(); probe poll 100 ms does not affect timestamps`);
  process.exit(sent.landed && lines.every(([, ph]) => ph === 'arrived') ? 0 : 1);
}

// pull
// The pane draws a listing as rows (list view) or tiles (grid view) — the owner's choice, not ours to
// change. Both carry one shared click handler (`wireEntry` in files.ts), so either is the same pull.
// The first version knew rows only and reported "not listed" for every file in grid view (2026-10-11).
const ENTRIES = `[...document.querySelectorAll('#files-table .files-row, #files-table .files-tile')]`;
const ENTRY_NAME = (r) => `(${r}.querySelector('.files-cell-name, .files-tile-name')?.textContent ?? '').replace(/^·/, '')`;
let failures = 0;
for (const name of args) {
  const listed = await p.act({
    what: `${name} listed`,
    run: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r) r.click(); return true; })()`,
    expect: `${ENTRIES}.some(r => ${ENTRY_NAME('r')} === ${JSON.stringify(name)})`,
    within: 30000,
  });
  if (!listed.landed) { console.log(`  FAIL  ${name} not listed in Received files`); failures += 1; continue; }
  await p.act({
    what: 'deselect, and forget earlier copies so this pull is fresh',
    run: `(() => { files.localCopies.clear(); files.lastPull = null; return true; })()`,
    expect: `files.lastPull === null`,
  });
  const pulled = await p.act({
    what: `select ${name} (the pane's own selection pull) and wait for it to settle`,
    run: `(() => { window.__pullT0 = performance.now(); const row = ${ENTRIES}.find(r => ${ENTRY_NAME('r')} === ${JSON.stringify(name)}); row.click(); return true; })()`,
    expect: `!!files.lastPull && files.copying.size === 0 && !/Copying/.test(files.lastPull.text) && (window.__pullT1 ??= performance.now()) > 0`,
    within: DEADLINE_MS,
  });
  const r = await p.read({
    question: `what the pane says happened to ${name}`,
    read: `({ ok: files.lastPull.ok, text: files.lastPull.text, landedAt: [...files.localCopies.values()][0] ?? null, ms: Math.round(window.__pullT1 - window.__pullT0) })`,
    control: `__probe.count('#files-detail')`,
  });
  const v = r.value;
  let size = null;
  try { size = v.landedAt ? statSync(v.landedAt).size : null; } catch { size = null; }
  console.log(`  pull ${name}: ok=${v.ok} ${size ?? '?'} B in ${v.ms} ms (click → settled, incl. the 250 ms selection delay) = ${size ? rate(size, v.ms) : 'n/a'} — "${v.text}" → ${v.landedAt}`);
  await p.act({ what: 'reset timer', run: `(() => { delete window.__pullT1; return true; })()`, expect: `window.__pullT1 === undefined` });
  if (!pulled.landed || !v.ok) failures += 1;
}
process.exit(failures ? 1 : 0);
