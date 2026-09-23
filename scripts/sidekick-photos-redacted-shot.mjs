/**
 * A REDACTED capture of the Photos detail column over a real library item: the picture area is
 * reduced to a 3 × 4 grid of flat colour and the Name and Taken values are blacked out **before the file is written** — only
 * layout, captions and numbers remain. The unredacted capture never touches disk outside the
 * scratchpad, and is deleted after.
 *
 * Usage: node scripts/sidekick-photos-redacted-shot.mjs <out.png>   (the item must already be selected)
 */
import { openProbe } from './probe.mjs';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = process.argv[2];
const p = await openProbe({ port: 9222 });
const r = (await p.read({
  question: 'rects: detail column, stage frame, Name value',
  read: `(() => { const d = __probe.one('#photos-detail').getBoundingClientRect(); const f = document.querySelector('#photos-detail .photos-stage-frame').getBoundingClientRect(); const labels = [...document.querySelectorAll('#photos-detail .photos-detail-fact-label')]; const vals = document.querySelectorAll('#photos-detail .photos-detail-fact-value'); const pick = (n) => { const i = labels.findIndex(l => l.textContent === n); return i >= 0 ? (() => { const b = vals[i].getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })() : null; }; const v = pick('Name'); const taken = pick('Taken'); const cards = [...document.querySelectorAll('#photos-detail .photos-detail-card')]; const first = cards[0].getBoundingClientRect(); return { dpr: devicePixelRatio, d: [d.x, d.y, d.width, first.bottom - d.y + 8], f: [f.x, f.y, f.width, f.height], name: v, taken }; })()`,
  control: `__probe.count('#photos-detail .photos-stage')`,
})).value;
const tmp = `${process.env.TMPDIR}/unredacted-${Date.now()}.png`;
writeFileSync(tmp, Buffer.from(await p.rawCapture(), 'base64'));
execFileSync('python3', ['-c', `
import os
from PIL import Image, ImageDraw
im = Image.open(${JSON.stringify(tmp)}).convert('RGB'); d = ${r.dpr}
def box(b): return (int(b[0]*d), int(b[1]*d), int((b[0]+b[2])*d), int((b[1]+b[3])*d))
f = box(${JSON.stringify(r.f)}); region = im.crop(f); w, h = region.size
region = region.resize((3, 4), Image.BILINEAR).resize((w, h), Image.NEAREST)
im.paste(region, f)
${r.name ? `ImageDraw.Draw(im).rectangle(box(${JSON.stringify(r.name)}), fill=(0, 0, 0))` : ''}
${r.taken ? `ImageDraw.Draw(im).rectangle(box(${JSON.stringify(r.taken)}), fill=(0, 0, 0))` : ''}
im.crop(box(${JSON.stringify(r.d)})).save(${JSON.stringify(out)})
os.remove(${JSON.stringify(tmp)})`]);
console.log(`wrote ${out} (picture pixelated, name ${r.name ? 'blacked out' : 'absent'})`);
process.exit(0);
