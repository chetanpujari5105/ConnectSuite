/**
 * Feature B, live: a Mac → phone send, read from the Files pane's own send card.
 *
 * Every stimulus is safe by construction: the destination is the phone's grant-free
 * `downloads:connectsuite` root ("Received files"), which only ever **gains** files, and the files
 * are generated samples with no user data in them. Nothing on the phone is replaced — a second send
 * of the same name is the collision case and must arrive as `name (2)`.
 *
 * The picker is a native dialog and cannot be driven, so the offer is made through the pane's own
 * `offer()` — the method both the picker and a drop end in. Everything from the confirmation card
 * onwards is the real path: the Send button pressed by id, the real bridge, the real phone.
 *
 * Usage: node scripts/sidekick-send-probe.mjs <file> [<file> …]
 */
import { openProbe, format } from './probe.mjs';
import { statSync } from 'node:fs';
import { basename } from 'node:path';

const files = process.argv.slice(2).map((source) => ({ source, name: basename(source), size: statSync(source).size }));
if (files.length === 0) {
  console.error('usage: sidekick-send-probe.mjs <file> …');
  process.exit(2);
}
const probe = await openProbe({ port: 9222 });
let failures = 0;
const show = (r) => { console.log('  ' + format(r)); if (!r.reportable) failures += 1; return r; };

const connected = show(await probe.read({
  question: 'is the Mac connected to the phone?',
  read: `(document.querySelector('#files-tools') ? 1 : 0) && (window.__lastStatusPhase ?? document.body.innerText.includes('Connected') ? 1 : 0)`,
  control: `document.querySelectorAll('section[data-screen]').length`,
  settle: { until: (v) => v === 1, within: 30000 },
}));

const routed = await probe.act({
  what: 'route to files',
  run: `(() => { const b=[...document.querySelectorAll('.nav-item, nav button, nav a')].find(x => (x.textContent||'').trim().toLowerCase().startsWith('files')); if (b) b.click(); return !!b; })()`,
  expect: `(() => { const s=document.querySelector('section[data-screen="files"]'); return !!s && !s.hidden && s.getBoundingClientRect().height > 0; })()`,
  within: 5000,
});
console.log(`  route → files: landed=${routed.landed}`);

show(await probe.read({
  question: 'root rows in the rail',
  read: `__probe.count('#files-roots .files-root')`,
  control: `__probe.one('section[data-screen="files"]') ? 1 : 0`,
  settle: { until: (n) => n > 0, within: 30000 },
}));

const picked = await probe.act({
  what: 'select the Received files root',
  run: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r) r.click(); return !!r; })()`,
  expect: `(() => /received/i.test(document.querySelector('#files-crumbs')?.textContent||'') && !!document.querySelector('#files-send-to-phone'))()`,
  within: 20000,
});
console.log(`  select Received files: landed=${picked.landed}`);
if (!picked.landed) { console.log('  FAIL  no Send to phone… button over Received files — nothing below is a reading'); process.exit(1); }

const offered = await probe.act({
  what: `offer ${files.length} file(s) through the pane's own offer()`,
  run: `(() => { files.offer(${JSON.stringify(files)}, 0); return true; })()`,
  expect: `!!document.querySelector('#files-send-confirm')`,
  within: 3000,
});
console.log(`  confirmation card drawn: ${offered.landed}`);
show(await probe.read({
  question: 'the confirmation card text',
  read: `__probe.text('#files-detail .files-send')`,
  control: `__probe.count('#files-send-confirm')`,
}));

const sent = await probe.act({
  what: 'press Send',
  run: `(() => { document.querySelector('#files-send-confirm').click(); return true; })()`,
  expect: `!!document.querySelector('#files-send-done')`,
  within: 120000,
});
console.log(`  batch settled (Done drawn): ${sent.landed} after ${sent.waitedMs} ms`);
show(await probe.read({
  question: 'each item: phase and status line, as drawn',
  read: `[...document.querySelectorAll('#files-detail .files-send-item')].map(li => li.dataset.phase + ' | ' + li.querySelector('.files-send-meta').textContent)`,
  control: `__probe.count('#files-detail .files-send-item')`,
}));
show(await probe.read({
  question: 'batch headline and denominator line',
  read: `[document.querySelector('#files-detail .files-send .files-detail-title').textContent, document.querySelector('#files-detail .files-send .files-detail-note').textContent]`,
  control: `__probe.count('#files-send-done')`,
}));
process.exit(failures ? 1 : 0);
