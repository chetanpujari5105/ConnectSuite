/**
 * Feature C review, live, on the owner's **real** library — numbers only.
 *
 * Selects one item chosen by metadata alone (album name, kind, MIME, orientation, nth match) and
 * reports: the listing's size, the 512 preview's real decoded size, the original's decoded size,
 * the frame's shape and the drawn box, whether `contain` fits it without crop, and the caption. It
 * prints **no file name, no pixels, no thumbnail**, so nothing private leaves the app.
 *
 * Usage: node scripts/sidekick-photos-review-probe.mjs <albumRegex> <kind> <mimeRegex> <orientation|any> [nth]
 */
import { openProbe, format } from './probe.mjs';

const [albumRe, kind, mimeRe, orientation, nthArg] = process.argv.slice(2);
const nth = Number(nthArg ?? 0);
const p = await openProbe({ port: 9222 });

const opened = await p.act({
  what: `open album /${albumRe}/`,
  // Route only when elsewhere: entering Photos starts a refresh that reloads the album and clears the
  // selection — re-routing every run cleared the probe's own click after it landed (runs #1–#3).
  run: `(() => { if (shell.screen !== 'photos') shell.route('photos'); return true; })()`,
  expect: `(() => { const a=[...document.querySelectorAll('#photos-albums .photos-album')].find(x => new RegExp(${JSON.stringify(albumRe)}, 'i').test((x.querySelector('.photos-album-name')||x).textContent.trim())); if (a && !a.classList.contains('on')) a.click(); return !!a && a.classList.contains('on') && photos.items.length > 0 && !photos.loading; })()`,
  within: 30000,
});
if (!opened.landed) { console.log('  FAIL  album not opened — nothing below is a reading'); process.exit(1); }

const PICK = `(() => { const o = (i) => i.width && i.height ? (i.height > i.width ? 'portrait' : i.width > i.height ? 'landscape' : 'square') : 'unknown';
  return photos.items.filter(i => i.kind === ${JSON.stringify(kind)} && new RegExp(${JSON.stringify(mimeRe)}).test(i.mime) && (${JSON.stringify(orientation)} === 'any' || o(i) === ${JSON.stringify(orientation)}))[${nth}] ?? null; })()`;
const chosen = await p.read({ question: 'the chosen item, metadata only', read: `(() => { const i = ${PICK}; return i && { kind: i.kind, mime: i.mime, listed: i.width + 'x' + i.height, bytes: i.size, durationMs: i.durationMs }; })()`, control: `photos.items.length` });
console.log('  ' + format(chosen));
if (!chosen.value) { console.log('  NO READING  no item matches in the loaded page'); process.exit(1); }

await p.act({
  what: 'select it (tile by data-id)',
  run: `(() => { const i = ${PICK}; window.__sel = i.id; window.__t0 = performance.now(); window.__captions = []; const t = document.querySelector('#photos-tiles [data-id="' + i.id + '"]'); t.scrollIntoView({ block: 'center' }); t.click();
    const tick = () => { const c = document.querySelector('#photos-detail .photos-stage-caption'); const last = window.__captions[window.__captions.length - 1]; if (c && c.textContent !== last?.[1]) window.__captions.push([Math.round(performance.now() - window.__t0), c.textContent]); if (window.__captions.length < 12 && performance.now() - window.__t0 < 30000) setTimeout(tick, 30); }; tick(); return true; })()`,
  expect: `!!document.querySelector('#photos-detail .photos-stage-caption')`,
});

const settle = kind === 'video'
  ? (v) => /Video|cannot play/.test(v.caption)
  : (v) => /Original|cannot display|did not load|Load full size/.test(v.caption);
const STAGE = `(async () => {
  const frame = document.querySelector('#photos-detail .photos-stage-frame'); const img = frame.querySelector('img.photos-stage-media');
  const fr = frame.getBoundingClientRect(); const ir = img.getBoundingClientRect();
  const pv = photos.preview512.get(window.__sel);
  let preview = null; if (pv) { const im = new Image(); im.src = 'data:image/jpeg;base64,' + pv; await im.decode().catch(() => null); preview = im.naturalWidth + 'x' + im.naturalHeight; }
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const s = nw && nh ? Math.min(ir.width / nw, ir.height / nh) : 0;
  const content = { w: Math.round(nw * s), h: Math.round(nh * s) };
  const o = photos.originals.get(window.__sel);
  return {
    caption: document.querySelector('#photos-detail .photos-stage-caption').textContent,
    tone: document.querySelector('#photos-detail .photos-stage-caption').dataset.tone,
    source: (img.getAttribute('src') || '').split(':')[0], shows: frame.dataset.show,
    preview512: preview, originalState: o ? o.phase : null, decoded: o && o.width ? o.width + 'x' + o.height : null,
    drawnFrom: nw + 'x' + nh, frameCss: getComputedStyle(frame).aspectRatio, frame: Math.round(fr.width) + 'x' + Math.round(fr.height),
    fit: getComputedStyle(img).objectFit, content: content.w + 'x' + content.h,
    // Against the FRAME — what is visible. The first version compared the picture to its own
    // element and read "not cropped" over a photo the frame's overflow was clipping to a third.
    imgBox: Math.round(ir.width) + 'x' + Math.round(ir.height),
    cropped: content.w > Math.round(fr.width) + 1 || content.h > Math.round(fr.height) + 1 || ir.height > fr.height + 1 || ir.width > fr.width + 1,
    shownFraction: +Math.min(1, (Math.min(content.w, fr.width) * Math.min(content.h, fr.height)) / Math.max(1, content.w * content.h)).toFixed(3),
    letterbox: { x: Math.round(ir.width - content.w), y: Math.round(ir.height - content.h) },
    action: document.querySelector('#photos-stage-action').hidden ? null : document.querySelector('#photos-stage-action').textContent,
    facts: [...document.querySelectorAll('#photos-detail .photos-detail-fact-label')].map(e => e.textContent),
  }; })()`;
console.log('  ' + format(await p.read({ question: 'the stage once settled', read: STAGE, control: `__probe.count('#photos-detail .photos-stage')`, settle: { until: settle, within: 30000 } })));
console.log('  ' + format(await p.read({ question: 'caption sequence as drawn, ms since select', read: `window.__captions`, control: `window.__captions.length` })));
process.exit(0);
