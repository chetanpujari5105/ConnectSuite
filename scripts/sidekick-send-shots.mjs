/**
 * Evidence captures for Feature B's send card, cropped to the detail column only — the rest of the
 * Files pane lists the owner's real folder contents and is never in evidence.
 *
 *   confirm   — the real confirmation card over Received files, then Cancel (nothing sent)
 *   arrived   — a real one-file send of a generated sample
 *   synthetic — the pane's own reducers fed invented ids, to show every item state at once.
 *               SYNTHETIC: no transfer took place; the file names are placeholders.
 *
 * Usage: node scripts/sidekick-send-shots.mjs <outDir> <sampleFile>
 */
import { openProbe } from './probe.mjs';
import { writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const [outDir, sample] = process.argv.slice(2);
const p = await openProbe({ port: 9222 });

async function crop(name) {
  const rect = (await p.read({
    question: `rect of #files-detail for ${name}`,
    read: `(() => { const r = __probe.one('#files-detail').getBoundingClientRect(); const c = document.querySelector('#files-detail > *'); const cr = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: cr.bottom - r.y + 24, dpr: devicePixelRatio }; })()`,
    control: `__probe.count('#files-detail .files-send')`,
  })).value;
  const png = await p.rawCapture();
  const full = join(outDir, `.tmp-${name}.png`);
  writeFileSync(full, Buffer.from(png, 'base64'));
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(full)}); d = ${rect.dpr}
x, y, w, h = ${rect.x}, ${rect.y}, ${rect.w}, ${rect.h}
im.crop((int(x*d), int(y*d), int((x+w)*d), int((y+h)*d))).save(${JSON.stringify(join(outDir, `b-send-${name}.png`))})
import os; os.remove(${JSON.stringify(full)})`]);
  console.log(`wrote b-send-${name}.png (${Math.round(rect.w)}x${Math.round(rect.h)} css px)`);
}

const over = await p.act({
  what: 'Files → Received files',
  run: `(() => { shell.route('files'); return true; })()`,
  expect: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r && !/received/i.test(document.querySelector('#files-crumbs')?.textContent||'')) r.click(); return !!document.querySelector('#files-send-to-phone') && /received/i.test(document.querySelector('#files-crumbs')?.textContent||''); })()`,
  within: 30000,
});
if (!over.landed) { console.error('not over Received files; nothing captured'); process.exit(1); }

const file = { source: sample, name: basename(sample), size: statSync(sample).size };
await p.act({ what: 'offer', run: `(() => { files.offer([${JSON.stringify(file)}], 0); return true; })()`, expect: `!!document.querySelector('#files-send-confirm')` });
await crop('confirm');
await p.act({ what: 'Send', run: `(() => { document.querySelector('#files-send-confirm').click(); return true; })()`, expect: `!!document.querySelector('#files-send-done')`, within: 20000 });
await crop('arrived');
await p.act({ what: 'Done', run: `(() => { document.querySelector('#files-send-done').click(); return true; })()`, expect: `!document.querySelector('#files-send-done')` });

// SYNTHETIC — the pane's own reducers, invented ids, no transfer.
await p.act({
  what: 'SYNTHETIC mixed-state batch',
  run: `(() => {
    let b = sendBatchCreate([
      { source: '/s/1', name: 'holiday-video.mov', size: 214748364 },
      { source: '/s/2', name: 'scan-2026.pdf', size: 1843200 },
      { source: '/s/3', name: 'notes.txt', size: 5120 },
      { source: '/s/4', name: 'photo-0042.jpg', size: 3874112 },
    ], 'Samsung SM-S938B', 'Received files');
    b = sendBatchOnAgreed(b, '/s/1', 'syn-1', 'holiday-video.mov');
    b = sendBatchOnWriteFinished(b, '/s/1', { ok: true });
    b = sendBatchOnDone(b, { transferId: 'syn-1', ok: true, bytes: 214748364, verified: false });
    b = sendBatchOnAgreed(b, '/s/2', 'syn-2', 'scan-2026 (2).pdf');
    b = sendBatchOnWriteFinished(b, '/s/2', { ok: true });
    b = sendBatchOnDone(b, { transferId: 'syn-2', ok: true, bytes: 1843200, verified: true });
    b = sendBatchOnWriteFinished(b, '/s/3', { ok: false, reason: 'Received files has 0 bytes free.', code: 'NO_SPACE' });
    b = sendBatchOnAgreed(b, '/s/4', 'syn-4', 'photo-0042.jpg');
    b = sendBatchOnProgress(b, 'syn-4', 1400000);
    files.batch = b; files.render(); return true; })()`,
  expect: `!!document.querySelector('#files-send-stop')`,
});
await crop('synthetic-states');
await p.act({ what: 'clear the synthetic batch', run: `(() => { files.batch = null; files.render(); return true; })()`, expect: `!document.querySelector('#files-detail .files-send')` });
process.exit(0);
