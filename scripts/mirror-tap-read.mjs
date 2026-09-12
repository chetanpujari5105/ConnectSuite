/**
 * Where does a click on the mirror picture actually land on the phone?
 *
 * ### What the first version of this got wrong, kept because it is the lesson
 *
 * It predicted two numbers — the correct mapping's answer and the **pre-fix** mapping's answer —
 * and expected them ~400 capture px apart. They came out **identical**, and the reason is that the
 * discriminator was the letterbox: the pre-fix stage was portrait-shaped, so a landscape stream sat
 * in it with 223 px bars, and the old `pointAt` divided by the element instead of the picture. With
 * the fix in, the box *is* the picture, the bars are 0, and the two mappings agree by construction.
 *
 * **So a tap cannot falsify the old bug once the box is fixed** — the box fix removes the evidence.
 * What a tap *can* still falsify is whether the mapping uses the right capture dimensions, which is
 * a live question on a rotated phone: `this.capture` carries the announced 2340×1080 while the
 * canvas's intrinsic size lags a frame behind at 1-2 fps on a static screen. A mapping that read
 * the canvas instead of the announcement would be wrong by the ratio of the two, and this measures
 * exactly that.
 *
 * ### The prediction, written before the click
 *
 * Bars are 0 and the stage matches the stream, so the mapping reduces to a pure scale: a click at
 * fraction (fx, fy) of the picture must arrive as (fx × captureW, fy × captureH). Anything else —
 * a stale RATIO, the canvas's lagging intrinsic size, an unaccounted device pixel ratio — moves it.
 *
 * The measurement is the Mac's own `[input] input.tap delivered (x,y on #id WxH)` line. That log did
 * not exist while defect 99 was live, which is why the defect could not have been found from a log.
 *
 * Usage: node scripts/mirror-tap-read.mjs [fractionX] [fractionY]     default: 0.5 0.02 (top edge)
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openProbe, format } from './probe.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FX = Number(args[0] ?? 0.5);
const FY = Number(args[1] ?? 0.02);
/** Wait for the phone to be turned. The box fix is only falsifiable off 19.5:9 — see the header. */
const WANT_LANDSCAPE = process.argv.includes('--landscape');

const MAC_LOG = join(homedir(), 'Library/Application Support/connectsuite-desktop/logs/connectsuite.log');

function lastTap() {
  if (!existsSync(MAC_LOG)) return null;
  const lines = readFileSync(MAC_LOG, 'utf8').split('\n').filter((l) => l.includes('input.tap delivered'));
  const line = lines[lines.length - 1];
  if (!line) return null;
  const m = line.match(/\((-?\d+),(-?\d+) on #(\d+) (\d+)x(\d+)\)/);
  return { line: line.trim(), parsed: m ? { x: +m[1], y: +m[2], geomId: +m[3], w: +m[4], h: +m[5] } : null };
}

const probe = await openProbe({ port: 9222 });
const STAGE = `section[data-screen="mirror"] .mirror-stage`;

const routed = await probe.act({
  what: 'route the Mac to the Mirror pane',
  run: `document.querySelector('[data-nav="mirror"]').click()`,
  expect: `__probe.one('${STAGE}').getBoundingClientRect().height > 0`,
  within: 5000,
});
if (!routed.landed) { console.error('NOT A READING: could not reach the Mirror pane.'); probe.close(); process.exit(3); }

/*
 * Settle on BOTH routes agreeing, not just the announcement. The first version settled the instant
 * `--capture-aspect` flipped and caught the canvas still holding a portrait frame — the announcement
 * path had turned and the pixel path had not, at 1-2 fps on a static screen. That is the 263 ms
 * sampling window: a predicate on one of two clocks fires before the other has moved.
 */
const geom = await probe.read({
  question: 'The picture rect and the capture geometry, with both routes agreeing',
  control: `__probe.one('${STAGE}').getBoundingClientRect().height`,
  read: `(function () {
    var stage = __probe.one('${STAGE}');
    var canvas = __probe.one('${STAGE} #mirror-canvas');
    var s = stage.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    var cs = getComputedStyle(stage).getPropertyValue('--capture-aspect').trim();
    var readout = document.querySelector('#mirror-rotation-readout');
    return {
      picture: { x: c.left, y: c.top, w: +c.width.toFixed(2), h: +c.height.toFixed(2) },
      bars: { x: +((s.width - c.width) / 2).toFixed(2), y: +((s.height - c.height) / 2).toFixed(2) },
      announcedAspect: cs === '' ? null : +Number(cs).toFixed(5),
      capture: { w: canvas.width, h: canvas.height },
      decodedAspect: canvas.height ? +(canvas.width / canvas.height).toFixed(5) : null,
      rotation: readout ? readout.textContent.trim() : null,
      dpr: window.devicePixelRatio
    };
  })()`,
  settle: {
    until: (v) => v && v.announcedAspect !== null && v.decodedAspect !== null &&
      Math.abs(v.announcedAspect - v.decodedAspect) < 0.001 &&
      (!WANT_LANDSCAPE || v.announcedAspect > 1),
    within: WANT_LANDSCAPE ? 180_000 : 30_000,
    poll: 500,
  },
});

if (WANT_LANDSCAPE) console.log('Waiting for the phone to be turned to landscape, with both routes agreeing. Deadline 180 s.\n');
console.log(format(geom));
if (!geom.reportable) {
  // Name the clause that failed, not the predicate. The first version printed "the announced and
  // decoded geometries never agreed" after a run where they agreed perfectly all 358 polls — what
  // never happened was *landscape*. A compound predicate that reports its own failure as a single
  // sentence attributes the miss to whichever clause the author had in mind, which is a confident
  // wrong diagnosis from an instrument that knows the right one.
  const v = geom.value ?? {};
  const agreed = v.announcedAspect !== null && v.decodedAspect !== null &&
    Math.abs(v.announcedAspect - v.decodedAspect) < 0.001;
  const landscape = (v.announcedAspect ?? 0) > 1;
  console.error('\nNOT A READING. Which clause never came true:');
  console.error(`  both routes agree: ${agreed ? 'YES (' + v.announcedAspect + ')' : 'no — announced ' + v.announcedAspect + ' vs decoded ' + v.decodedAspect}`);
  if (WANT_LANDSCAPE) {
    console.error(`  landscape:         ${landscape ? 'YES' : 'NO — the phone stayed at ' + v.rotation + ', aspect ' + v.announcedAspect}`);
  }
  console.error(`  polls: ${geom.polls}, waited: ${geom.waitedMs} ms, stopped: ${geom.stopped}`);
  probe.close(); process.exit(3);
}

const g = geom.value;
const clickX = Math.round(g.picture.x + FX * g.picture.w);
const clickY = Math.round(g.picture.y + FY * g.picture.h);
const predicted = {
  x: Math.round(((clickX - g.picture.x) / g.picture.w) * g.capture.w),
  y: Math.round(((clickY - g.picture.y) / g.picture.h) * g.capture.h),
};

console.log(`\nprediction, before the click:`);
console.log(`  click viewport (${clickX},${clickY}) — fraction (${FX}, ${FY}) of a ${g.picture.w}×${g.picture.h} picture`);
console.log(`  must arrive as capture (${predicted.x},${predicted.y}) on ${g.capture.w}x${g.capture.h}`);
console.log(`  a mapping reading the canvas's lagging intrinsic size instead would be wrong by the ratio of the two\n`);

const before = lastTap();

/*
 * PointerEvents, on the canvas, with a pointerId. The first version dispatched plain MouseEvents at
 * `elementFromPoint` and **nothing registered** — the listeners are `pointerdown`/`pointerup` and a
 * MouseEvent carries no `pointerId`. A stimulus that does not land is not a premise, so the check
 * below is the log advancing, not the dispatch returning.
 */
const clicked = await probe.act({
  what: `tap the picture at viewport (${clickX},${clickY})`,
  run: `(function () {
    var c = __probe.one('${STAGE} #mirror-canvas');
    function ev(type) {
      return new PointerEvent(type, { clientX: ${clickX}, clientY: ${clickY}, bubbles: true, cancelable: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true });
    }
    c.dispatchEvent(ev('pointerdown'));
    c.dispatchEvent(ev('pointerup'));
    return 'dispatched';
  })()`,
  expect: `__probe.one('${STAGE} #mirror-canvas').getBoundingClientRect().width > 0`,
  within: 3000,
});

await new Promise((r) => setTimeout(r, 2000));
const after = lastTap();
const advanced = before?.line !== after?.line;

console.log(`dispatch: ${clicked.landed ? 'ok' : 'FAILED'}`);
console.log(`Mac log: ${advanced ? 'advanced' : 'DID NOT ADVANCE — no reading about the mapping'}`);
if (after?.line) console.log(`  ${after.line}`);

const measured = advanced ? after.parsed : null;
const result = {
  rotation: g.rotation,
  picture: g.picture,
  bars: g.bars,
  capture: g.capture,
  announcedAspect: g.announcedAspect,
  decodedAspect: g.decodedAspect,
  dpr: g.dpr,
  clickedViewport: { x: clickX, y: clickY },
  predicted,
  measured,
  error: measured ? { x: Math.abs(measured.x - predicted.x), y: Math.abs(measured.y - predicted.y) } : null,
  // A tap is dispatched at whole viewport pixels onto a 560 px picture standing for 2340 capture px,
  // so one viewport pixel is ~4 capture px. Anything inside that is the instrument's own resolution.
  quantumCapturePxPerViewportPx: measured ? +(g.capture.w / g.picture.w).toFixed(2) : null,
  reportable: advanced && geom.reportable,
};
console.log('\n' + JSON.stringify(result, null, 2));
probe.close();
process.exit(result.reportable ? 0 : 3);
