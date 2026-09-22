/**
 * Evidence crops of the Photos detail column over the two GENERATED samples only (found by byte
 * size). The grid is never in frame — it shows the owner's real library.
 * Usage: node scripts/sidekick-photos-shots.mjs <outDir> <jpegBytes> <mp4Bytes>
 */
import { openProbe } from './probe.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const [outDir, jpg, mp4] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const p = await openProbe({ port: 9222 });
async function crop(name) {
  const r = (await p.read({ question: `detail rect for ${name}`, read: `(() => { const d = __probe.one('#photos-detail').getBoundingClientRect(); const last = [...document.querySelectorAll('#photos-detail > *')].pop().getBoundingClientRect(); return { x: d.x, y: d.y, w: d.width, h: Math.min(last.bottom, innerHeight) - d.y + 12, dpr: devicePixelRatio }; })()`, control: `__probe.count('#photos-detail .photos-stage')` })).value;
  const tmp = join(outDir, `.tmp-${name}.png`);
  writeFileSync(tmp, Buffer.from(await p.rawCapture(), 'base64'));
  execFileSync('python3', ['-c', `from PIL import Image\nimport os\nim=Image.open(${JSON.stringify(tmp)}); d=${r.dpr}\nim.crop((int(${r.x}*d), int(${r.y}*d), int((${r.x}+${r.w})*d), int((${r.y}+${r.h})*d))).save(${JSON.stringify(join(outDir, `c-${name}.png`))}); os.remove(${JSON.stringify(tmp)})`]);
  console.log(`wrote c-${name}.png`);
}
const pick = (bytes) => p.act({ what: `select ${bytes}`, run: `(() => { const id = photos.items.find(i => i.size === ${bytes}).id; document.querySelector('#photos-tiles [data-id="' + id + '"]').click(); return true; })()`, expect: `!!document.querySelector('#photos-detail .photos-stage-caption')` });
await pick(jpg);
await p.act({ what: 'original decoded', run: 'true', expect: `/Original/.test(document.querySelector('#photos-detail .photos-stage-caption').textContent)`, within: 20000 });
await crop('photo-original');
await pick(mp4);
await p.act({ what: 'video Play offered', run: 'true', expect: `!document.querySelector('#photos-stage-action').hidden`, within: 5000 });
await crop('video-before-play');
await p.act({ what: 'video ready (cached original)', run: `(() => { document.querySelector('#photos-stage-action').click(); return true; })()`, expect: `(() => { const v = document.querySelector('#photos-detail video'); return !!v && v.readyState >= 2; })()`, within: 20000 });
await p.act({ what: 'seek to 4 s for a frame', run: `(() => { document.querySelector('#photos-detail video').currentTime = 4; return true; })()`, expect: `(() => { const v = document.querySelector('#photos-detail video'); return !v.seeking && v.readyState >= 2; })()`, within: 5000 });
await crop('video-player');
process.exit(0);
