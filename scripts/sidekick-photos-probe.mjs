/**
 * Feature C, live: the Photos detail stage over two **generated** samples the Mac sent to the
 * phone's Received files (a 3000×4000 portrait JPEG and a 12 s 1280×720 H.264 MP4). Only those two
 * items are selected, found by their exact byte sizes; no other photo is opened or read.
 *
 * Usage: node scripts/sidekick-photos-probe.mjs <jpegBytes> <mp4Bytes>
 */
import { openProbe, format } from './probe.mjs';

const [jpgBytes, mp4Bytes] = process.argv.slice(2).map(Number);
const p = await openProbe({ port: 9222 });
const show = (r) => { console.log('  ' + format(r)); return r; };

await p.act({ what: 'route to photos', run: `(() => { shell.route('photos'); return true; })()`, expect: `shell.screen === 'photos' && __probe.count('#photos-albums .photos-album') > 0`, within: 30000 });
const album = await p.act({
  what: 'open the album holding the samples (the phone’s ConnectSuite downloads bucket)',
  run: `(() => { const a = [...document.querySelectorAll('#photos-albums .photos-album')].find(x => /connectsuite/i.test(x.textContent||'')); if (a) a.click(); return !!a; })()`,
  expect: `photos.items.some(i => i.size === ${jpgBytes}) && photos.items.some(i => i.size === ${mp4Bytes})`,
  within: 30000,
});
console.log(`  album holds both samples: ${album.landed}`);
if (!album.landed) process.exit(1);

// ---- the photo ----
await p.act({
  what: 'select the sample photo by its size',
  run: `(() => { const id = photos.items.find(i => i.size === ${jpgBytes}).id; document.querySelector('#photos-tiles [data-id="' + id + '"]').click(); return true; })()`,
  expect: `!!document.querySelector('#photos-detail .photos-stage-caption')`,
});
show(await p.read({
  question: 'photo stage straight after selection (512 preview or earlier)',
  read: `(() => ({ caption: document.querySelector('#photos-detail .photos-stage-caption').textContent, src: (document.querySelector('#photos-detail img.photos-stage-media').getAttribute('src')||'').slice(0, 22) }))()`,
  control: `__probe.count('#photos-detail .photos-stage')`,
  settle: { until: (v) => /512/.test(v.caption), within: 10000 },
}));
show(await p.read({
  question: 'photo stage once the original has decoded',
  read: `(() => { const img = document.querySelector('#photos-detail img.photos-stage-media'); const r = img.getBoundingClientRect(); return { caption: document.querySelector('#photos-detail .photos-stage-caption').textContent, scheme: (img.getAttribute('src')||'').split(':')[0], natural: img.naturalWidth + 'x' + img.naturalHeight, drawn: Math.round(r.width) + 'x' + Math.round(r.height), fit: getComputedStyle(img).objectFit, frameAspect: getComputedStyle(img.parentElement).aspectRatio }; })()`,
  control: `__probe.count('#photos-detail .photos-stage')`,
  settle: { until: (v) => v.scheme === 'sidekick-media' && /Original/.test(v.caption), within: 20000 },
}));
show(await p.read({
  question: 'the facts beside it',
  read: `[...document.querySelectorAll('#photos-detail .photos-detail-facts > div')].map(d => d.textContent)`,
  control: `__probe.count('#photos-detail .photos-detail-facts')`,
}));

// ---- the video ----
await p.act({
  what: 'select the sample video by its size',
  run: `(() => { const id = photos.items.find(i => i.size === ${mp4Bytes}).id; document.querySelector('#photos-tiles [data-id="' + id + '"]').click(); return true; })()`,
  expect: `/Video/.test(document.querySelector('#photos-detail .photos-stage-caption')?.textContent||'')`,
});
show(await p.read({
  question: 'video stage before Play — nothing fetched, no autoplay',
  read: `(() => ({ caption: document.querySelector('#photos-detail .photos-stage-caption').textContent, action: document.querySelector('#photos-stage-action').hidden ? null : document.querySelector('#photos-stage-action').textContent, videos: document.querySelectorAll('#photos-detail video').length }))()`,
  control: `__probe.count('#photos-stage-action')`,
}));
await p.act({ what: 'press Play', run: `(() => { document.querySelector('#photos-stage-action').click(); return true; })()`, expect: `!!document.querySelector('#photos-detail video') && document.querySelector('#photos-detail video').readyState >= 1`, within: 30000 });
const v = show(await p.read({
  question: 'the real player: metadata, controls, not playing on its own',
  read: `(() => { const v = document.querySelector('#photos-detail video'); return { caption: document.querySelector('#photos-detail .photos-stage-caption').textContent, controls: v.controls, autoplay: v.autoplay, paused: v.paused, duration: +v.duration.toFixed(2), size: v.videoWidth + 'x' + v.videoHeight, seekable: v.seekable.length ? [+v.seekable.start(0).toFixed(2), +v.seekable.end(0).toFixed(2)] : null }; })()`,
  control: `__probe.count('#photos-detail video')`,
  settle: { until: (x) => x.duration > 0 && /1280/.test(x.caption), within: 10000 },
}));
await p.act({ what: 'seek to 7 s', run: `(() => { document.querySelector('#photos-detail video').currentTime = 7; return true; })()`, expect: `(() => { const v = document.querySelector('#photos-detail video'); return !v.seeking && Math.abs(v.currentTime - 7) < 0.5 && v.readyState >= 2; })()`, within: 10000 });
show(await p.read({
  question: 'after the seek: where the player is, and whether it has frame data there',
  read: `(() => { const v = document.querySelector('#photos-detail video'); return { currentTime: +v.currentTime.toFixed(2), readyState: v.readyState, error: v.error ? v.error.code : null }; })()`,
  control: `__probe.count('#photos-detail video')`,
}));
process.exit(0);
