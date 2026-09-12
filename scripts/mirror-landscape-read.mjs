/**
 * Defect 99's falsifiable half: the stage box and the tap mapping **in landscape**, on hardware.
 *
 * ### Why portrait cannot settle this and landscape can
 *
 * The SM-S938B is exactly 19.5:9, which is the ratio the pre-fix stylesheet hard-coded. So in
 * portrait the old code drew **no bars at all** on this handset and the old `pointAt` — which
 * divided by the element — agreed with the new one to the pixel. A clean portrait reading is
 * therefore consistent with the bug being fully present, and proves nothing. It is the single-device
 * blindness that hid this for a phase, restated as a measurement problem.
 *
 * Turned, the same panel is 2340×1080 and the pre-fix table says: picture **21%** of the box height,
 * **223 px** of bar top and bottom, and up to **424 px of tap error** out of 1080. That is a
 * difference any instrument can see, which is what makes this the reading worth taking.
 *
 * ### The tap is dispatched at a computed point, not a remembered one
 *
 * The click lands on the **picture's own top edge**, computed from the canvas rect read microseconds
 * earlier. The correct mapping puts it at capture y ≈ 0. The pre-fix mapping puts it at
 * y ≈ (bar / boxHeight) × 1080 ≈ 423. Those two predictions are 400 px apart, both are written down
 * here before the run, and the measurement is the Mac's own `[input] input.tap delivered (x,y on
 * #id WxH)` line — the log that did not exist when this defect was live, and whose absence is why
 * the defect could not have been found from a log.
 *
 * Usage: node scripts/mirror-landscape-read.mjs
 * with a live mirror session. It waits for the phone to be turned; it never turns it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openProbe, format } from './probe.mjs';

const MAC_LOG = join(
  homedir(),
  'Library/Application Support/connectsuite-desktop/logs/connectsuite.log',
);

/** The last `input.tap delivered` line, parsed. Null when there is none. */
function lastTap() {
  if (!existsSync(MAC_LOG)) return null;
  const lines = readFileSync(MAC_LOG, 'utf8').split('\n').filter((l) => l.includes('input.tap delivered'));
  const line = lines[lines.length - 1];
  if (!line) return null;
  const m = line.match(/\((-?\d+),(-?\d+) on #(\d+) (\d+)x(\d+)\)/);
  if (!m) return { line, parsed: null };
  return {
    line,
    parsed: { x: +m[1], y: +m[2], geomId: +m[3], w: +m[4], h: +m[5] },
  };
}

const probe = await openProbe({ port: 9222 });

const routed = await probe.act({
  what: 'route the Mac to the Mirror pane',
  run: `document.querySelector('[data-nav="mirror"]').click()`,
  expect: `__probe.one('section[data-screen="mirror"] .mirror-stage').getBoundingClientRect().height > 0`,
  within: 5000,
});
if (!routed.landed) {
  console.error('NOT A READING: could not reach the Mirror pane.');
  probe.close();
  process.exit(3);
}

const STAGE = `section[data-screen="mirror"] .mirror-stage`;
const CONTROL = `__probe.one('${STAGE}').getBoundingClientRect().height`;

const READ = `(function () {
  var stage = __probe.one('${STAGE}');
  var canvas = __probe.one('${STAGE} #mirror-canvas');
  var s = stage.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  var cs = getComputedStyle(stage).getPropertyValue('--capture-aspect').trim();
  var readout = document.querySelector('#mirror-rotation-readout');
  var actual = document.querySelector('#mirror-actual');
  return {
    stage: { x: s.left, y: s.top, w: +s.width.toFixed(2), h: +s.height.toFixed(2), aspect: +(s.width / s.height).toFixed(5) },
    picture: { x: c.left, y: c.top, w: +c.width.toFixed(2), h: +c.height.toFixed(2) },
    bars: { x: +((s.width - c.width) / 2).toFixed(2), y: +((s.height - c.height) / 2).toFixed(2) },
    announcedAspect: cs === '' ? null : +Number(cs).toFixed(5),
    decoded: { w: canvas.width, h: canvas.height, aspect: canvas.height ? +(canvas.width / canvas.height).toFixed(5) : null,
               isDefaultCanvas: canvas.width === 300 && canvas.height === 150 },
    rotation: readout ? readout.textContent.trim() : null,
    actualCapture: actual ? actual.textContent.trim() : null,
    sections: document.querySelectorAll('section[data-screen]').length
  };
})()`;

console.log('Waiting for the phone to be turned to landscape (announced aspect > 1). Deadline 180 s.\n');

const reading = await probe.read({
  question: 'Stage box and picture, in landscape, from a live session',
  control: CONTROL,
  read: READ,
  settle: {
    until: (v) => v && v.announcedAspect !== null && v.announcedAspect > 1 && !v.decoded.isDefaultCanvas,
    within: 180_000,
    poll: 1000,
  },
});

console.log(format(reading));

if (!reading.reportable) {
  console.error(
    '\nNOT A READING: the phone did not report a landscape geometry inside the deadline. ' +
      'This is where the instrument gave up, not a statement about the fit.',
  );
  probe.close();
  process.exit(3);
}

const v = reading.value;

/*
 * The two predictions, written before the click. The picture's top edge in viewport coordinates;
 * the correct mapping sends it to capture y ~ 0, the pre-fix mapping to (barY / stageH) * captureH.
 */
const clickX = Math.round(v.picture.x + v.picture.w / 2);
const clickY = Math.round(v.picture.y + 2); // two pixels inside the picture's top edge
const predictedCorrect = Math.round((2 / v.picture.h) * v.decoded.h);
const predictedPreFix = Math.round(((v.bars.y + 2) / v.stage.h) * v.decoded.h);

console.log(`\npredictions, before the click:`);
console.log(`  correct mapping (against the picture): capture y ~ ${predictedCorrect}`);
console.log(`  pre-fix mapping (against the element): capture y ~ ${predictedPreFix}`);
console.log(`  they differ by ${Math.abs(predictedPreFix - predictedCorrect)} capture px\n`);

const before = lastTap();

const clicked = await probe.act({
  what: `click the picture's top edge at viewport (${clickX},${clickY})`,
  run: `(function () {
    var el = document.elementFromPoint(${clickX}, ${clickY});
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function (t) {
      el.dispatchEvent(new MouseEvent(t, { clientX: ${clickX}, clientY: ${clickY}, bubbles: true, cancelable: true, button: 0, buttons: 1 }));
    });
    return el.id || el.tagName;
  })()`,
  // The effect is a new line in the Mac's own log, which this page cannot see — so the expect is
  // deliberately weak (the canvas is still there) and the real check is the log diff below, stated
  // as such rather than dressed up as the stimulus having been measured.
  expect: `__probe.one('${STAGE} #mirror-canvas').getBoundingClientRect().width > 0`,
  within: 3000,
});

await new Promise((r) => setTimeout(r, 1500));
const after = lastTap();

const moved = before?.line !== after?.line;
console.log(`tap dispatched onto: ${clicked.landed ? 'ok' : 'FAILED'}`);
console.log(`Mac log line ${moved ? 'advanced' : 'DID NOT ADVANCE — no reading about the mapping'}`);
if (after?.line) console.log(`  ${after.line.trim()}`);

const result = {
  rotation: v.rotation,
  actualCapture: v.actualCapture,
  stage: v.stage,
  picture: v.picture,
  bars: v.bars,
  announcedAspect: v.announcedAspect,
  decodedAspect: v.decoded.aspect,
  decoded: v.decoded,
  announcementAgreesWithPixels: Math.abs(v.announcedAspect - v.decoded.aspect) < 0.001,
  stageMatchesStream: Math.abs(v.stage.aspect - v.announcedAspect) < 0.005,
  tap: moved
    ? {
        clickedViewport: { x: clickX, y: clickY },
        predictedCorrect,
        predictedPreFix,
        measured: after.parsed,
        errorFromCorrect: after.parsed ? Math.abs(after.parsed.y - predictedCorrect) : null,
        line: after.line.trim(),
      }
    : { reading: 'none — the Mac log did not advance' },
  control: { sectionsOnPage: v.sections, stageHeight: reading.control, polls: reading.polls },
};

console.log('\n' + JSON.stringify(result, null, 2));
probe.close();
process.exit(0);
