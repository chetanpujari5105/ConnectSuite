/**
 * Feature C review: one real video from the paired phone, chosen by metadata alone, played **muted**
 * (nothing is heard on the Mac). Reports numbers only — no name, no frame.
 *
 * Usage: node scripts/sidekick-video-review-probe.mjs <albumRegex> <landscape|portrait|square|any> [nth]
 */
import { openProbe, format } from './probe.mjs';

const [albumRe, orientation, nthArg] = process.argv.slice(2);
const nth = Number(nthArg ?? 0);
const p = await openProbe({ port: 9222, userGesture: true });
const opened = await p.act({
  what: `open album /${albumRe}/`,
  run: `(() => { if (shell.screen !== 'photos') shell.route('photos'); return true; })()`,
  expect: `(() => { const a=[...document.querySelectorAll('#photos-albums .photos-album')].find(x => new RegExp(${JSON.stringify(albumRe)}, 'i').test((x.querySelector('.photos-album-name')||x).textContent.trim())); if (a && !a.classList.contains('on')) a.click(); return !!a && a.classList.contains('on') && photos.items.length > 0 && !photos.loading; })()`,
  within: 30000,
});
if (!opened.landed) process.exit(1);
const PICK = `(() => { const o = (i) => i.height > i.width ? 'portrait' : i.width > i.height ? 'landscape' : 'square';
  return photos.items.filter(i => i.kind === 'video' && (${JSON.stringify(orientation)} === 'any' || o(i) === ${JSON.stringify(orientation)}))[${nth}] ?? null; })()`;
const chosen = await p.read({ question: 'chosen video, metadata only', read: `(() => { const i = ${PICK}; return i && { mime: i.mime, listed: i.width + 'x' + i.height, bytes: i.size, durationMs: i.durationMs }; })()`, control: `photos.items.length` });
console.log('  ' + format(chosen));
if (!chosen.value) process.exit(1);
await p.act({ what: 'select', run: `(() => { const i = ${PICK}; window.__sel = i.id; const t = document.querySelector('#photos-tiles [data-id="' + i.id + '"]'); t.scrollIntoView({ block: 'center' }); t.click(); return true; })()`, expect: `!!document.querySelector('#photos-stage-action:not([hidden])') || /cannot play/.test(document.querySelector('#photos-detail .photos-stage-caption')?.textContent || '')`, within: 10000 });
console.log('  ' + format(await p.read({ question: 'before Play: caption, action, video elements, bytes fetched so far', read: `({ caption: document.querySelector('#photos-detail .photos-stage-caption').textContent, action: document.querySelector('#photos-stage-action').hidden ? null : document.querySelector('#photos-stage-action').textContent, videos: document.querySelectorAll('#photos-detail video').length, originalState: photos.originals.get(window.__sel)?.phase ?? null })`, control: `__probe.count('#photos-detail .photos-stage')` })));
const played = await p.act({ what: 'press Play (by id)', run: `(() => { document.querySelector('#photos-stage-action').click(); return true; })()`, expect: `(() => { const v = document.querySelector('#photos-detail video'); return (!!v && v.readyState >= 1) || /cannot play|did not load/.test(document.querySelector('#photos-detail .photos-stage-caption').textContent); })()`, within: 120000 });
console.log(`  Play → video ready or refusal: ${played.landed} after ${played.waitedMs} ms`);
const META = `(() => { const v = document.querySelector('#photos-detail video'); const f = document.querySelector('#photos-detail .photos-stage-frame').getBoundingClientRect(); const r = v ? v.getBoundingClientRect() : null;
  return v ? { caption: document.querySelector('#photos-detail .photos-stage-caption').textContent, controls: v.controls, autoplay: v.autoplay, paused: v.paused, muted: v.muted, duration: +v.duration.toFixed(2), decoded: v.videoWidth + 'x' + v.videoHeight, frameCss: getComputedStyle(v.parentElement).aspectRatio, frame: Math.round(f.width) + 'x' + Math.round(f.height), videoBox: Math.round(r.width) + 'x' + Math.round(r.height), fit: getComputedStyle(v).objectFit, seekable: v.seekable.length ? [+v.seekable.start(0).toFixed(1), +v.seekable.end(0).toFixed(1)] : null, error: v.error ? v.error.code : null }
    : { caption: document.querySelector('#photos-detail .photos-stage-caption').textContent, tone: document.querySelector('#photos-detail .photos-stage-caption').dataset.tone }; })()`;
const meta = await p.read({ question: 'the player once metadata is in', read: META, control: `__probe.count('#photos-detail .photos-stage')`, settle: { until: (v) => !v.controls || v.duration > 0, within: 15000 } });
console.log('  ' + format(meta));
if (!meta.value?.controls) process.exit(0);
await p.act({ what: 'mute, then play() — nothing is heard', run: `(() => { const v = document.querySelector('#photos-detail video'); v.muted = true; window.__t = []; v.play().then(() => window.__t.push('play() resolved')).catch((e) => window.__t.push('play() rejected: ' + e.name)); return true; })()`, expect: `window.__t.length > 0`, within: 5000 });
const running = await p.read({ question: 'is it actually playing? currentTime twice, 1.2 s apart', read: `(async () => { const v = document.querySelector('#photos-detail video'); const a = v.currentTime; await new Promise(r => setTimeout(r, 1200)); return { play: window.__t[0], paused: v.paused, t0: +a.toFixed(2), t1: +v.currentTime.toFixed(2), advanced: v.currentTime > a }; })()`, control: `__probe.count('#photos-detail video')` });
console.log('  ' + format(running));
await p.act({ what: 'pause', run: `(() => { document.querySelector('#photos-detail video').pause(); return true; })()`, expect: `document.querySelector('#photos-detail video').paused` });
await p.act({ what: 'seek to 60% of the duration', run: `(() => { const v = document.querySelector('#photos-detail video'); v.currentTime = v.duration * 0.6; return true; })()`, expect: `(() => { const v = document.querySelector('#photos-detail video'); return !v.seeking && Math.abs(v.currentTime - v.duration * 0.6) < 0.6 && v.readyState >= 2; })()`, within: 10000 });
console.log('  ' + format(await p.read({ question: 'after pause and seek', read: `(() => { const v = document.querySelector('#photos-detail video'); return { paused: v.paused, at: +v.currentTime.toFixed(2), of: +v.duration.toFixed(2), readyState: v.readyState, error: v.error ? v.error.code : null }; })()`, control: `__probe.count('#photos-detail video')` })));
await p.act({ what: 'leave it paused and unmuted as the player had it', run: `(() => { const v = document.querySelector('#photos-detail video'); v.pause(); v.muted = false; return true; })()`, expect: `document.querySelector('#photos-detail video').paused` });
process.exit(0);
