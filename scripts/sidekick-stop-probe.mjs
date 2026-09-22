/**
 * Feature B, live: Stop in the middle of a send, then the same file again.
 *
 * The settle predicate names **both clocks** — the Mac's (`phase`) and the phone's (`delivered`) —
 * because the first version of this probe required `phase === 'sending'` and the Mac's write had
 * already finished (`confirming`) while the phone was at 30%: it could never settle, and its
 * control then failed when the batch ended. That was the instrument; it also exposed a real Stop
 * defect, fixed in the same sitting.
 *
 * Destination: the grant-free Received files root, generated sample bytes only.
 * Usage: node scripts/sidekick-stop-probe.mjs <file>
 */
import { openProbe, format } from './probe.mjs';
import { statSync } from 'node:fs';
import { basename } from 'node:path';

const source = process.argv[2];
const file = { source, name: basename(source), size: statSync(source).size };
const probe = await openProbe({ port: 9222 });
const show = (r) => { console.log('  ' + format(r)); return r; };

const routed = await probe.act({
  what: 'route to files and select Received files',
  run: `(() => { [...document.querySelectorAll('.nav-item, nav button, nav a')].find(x => (x.textContent||'').trim().toLowerCase().startsWith('files'))?.click(); return true; })()`,
  expect: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r && !/received/i.test(document.querySelector('#files-crumbs')?.textContent||'')) r.click(); return !!document.querySelector('#files-send-to-phone') && /received/i.test(document.querySelector('#files-crumbs')?.textContent||''); })()`,
  within: 30000,
});
if (!routed.landed) { console.log('  FAIL  not over Received files — nothing below is a reading'); process.exit(1); }

const ITEM = `(() => { const li = document.querySelector('#files-detail .files-send-item'); const bar = document.querySelector('#files-detail progress.files-send-bar'); return li ? { phase: li.dataset.phase, meta: li.querySelector('.files-send-meta').textContent, batchBar: +bar.value.toFixed(3) } : null; })()`;

async function send(label) {
  await probe.act({ what: 'dismiss', run: `(() => { document.querySelector('#files-send-done')?.click(); return true; })()`, expect: `!document.querySelector('#files-send-done')` });
  await probe.act({ what: `offer (${label})`, run: `(() => { files.offer([${JSON.stringify(file)}], 0); return true; })()`, expect: `!!document.querySelector('#files-send-confirm')` });
  await probe.act({ what: `Send (${label})`, run: `(() => { document.querySelector('#files-send-confirm').click(); return true; })()`, expect: `!!document.querySelector('#files-detail .files-send-item')`, within: 10000 });
}

// ---- 1. Stop mid-way ----
await send('first');
const mid = show(await probe.read({
  question: 'in flight, by the phone’s count, before Stop',
  read: ITEM,
  control: `__probe.count('#files-detail .files-send')`,
  // Both clocks: the Mac may say sending or confirming; the phone must have reported real bytes
  // and not all of them.
  settle: { until: (v) => v && (v.phase === 'sending' || v.phase === 'confirming') && v.batchBar > 0.05 && v.batchBar < 0.9, within: 30000, poll: 40 },
}));
if (!mid.reportable) { console.log('  NO READING  the in-flight window was not caught; Stop not pressed'); process.exit(1); }
await probe.act({ what: 'press Stop', run: `(() => { document.querySelector('#files-send-stop').click(); return true; })()`, expect: `!!document.querySelector('#files-send-done')`, within: 30000 });
show(await probe.read({ question: 'after Stop', read: `[${ITEM}, document.querySelector('#files-detail .files-send .files-detail-title').textContent]`, control: `__probe.count('#files-send-done')` }));

// ---- 2. The same file again: resumes, arrives under its own name ----
await send('again');
await probe.act({ what: 'wait for the second batch to settle', run: `true`, expect: `!!document.querySelector('#files-send-done')`, within: 60000 });
show(await probe.read({ question: 'second send, settled', read: `[${ITEM}, document.querySelector('#files-detail .files-send .files-detail-title').textContent]`, control: `__probe.count('#files-send-done')` }));
process.exit(0);
