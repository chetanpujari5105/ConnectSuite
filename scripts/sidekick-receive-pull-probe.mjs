/**
 * Feature B, receive folder: pull one generated sample from the phone's Received files through the
 * Files pane's own **Copy to Mac** (by id), and report where it landed — or the refusal, verbatim.
 *
 * The phone's log is read by the caller to show whether the phone was asked at all: an unavailable
 * receive folder must refuse **before** `fs.transfer.begin`, so a refusal with a pull line on the
 * phone would be the defect.
 *
 * Usage: node scripts/sidekick-receive-pull-probe.mjs <exact file name in Received files>
 */
import { openProbe, format } from './probe.mjs';

const name = process.argv[2];
const p = await openProbe({ port: 9222 });
const over = await p.act({
  what: 'Files → Received files',
  run: `(() => { shell.route('files'); return true; })()`,
  expect: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r && !/received/i.test(document.querySelector('#files-crumbs')?.textContent||'')) r.click(); return /received/i.test(document.querySelector('#files-crumbs')?.textContent||'') && [...document.querySelectorAll('#files-table .files-row')].some(r => r.textContent.includes(${JSON.stringify(name)})); })()`,
  within: 30000,
});
if (!over.landed) { console.log(`  FAIL  ${name} not listed in Received files — nothing below is a reading`); process.exit(1); }
// Forget any earlier copy of this entry, so this pull is fresh. Selecting starts the pull.
await p.act({
  what: `select ${name}`,
  run: `(() => { const row = [...document.querySelectorAll('#files-table .files-row')].find(r => r.querySelector('.files-cell-name')?.textContent.includes(${JSON.stringify(name)})); files.localCopies.clear(); files.lastPull = null; row.click(); return true; })()`,
  expect: `!!document.querySelector('#files-copy-to-mac')`,
});
// Selecting a file starts the pane's own selection prefetch — the same pull Copy to Mac performs —
// after 250 ms. Racing it with a click read a button mid-redraw, so the probe waits for that pull.
await p.act({
  what: 'wait for the selection-triggered pull to finish',
  run: 'true',
  expect: `!!files.lastPull && files.copying.size === 0 && !/Copying/.test(files.lastPull.text)`,
  within: 30000,
});
console.log('  ' + format(await p.read({
  question: `what the pane says happened to ${name}`,
  read: `({ ok: files.lastPull.ok, text: files.lastPull.text, landedAt: [...files.localCopies.values()][0] ?? null })`,
  control: `__probe.count('#files-detail')`,
})));
process.exit(0);
