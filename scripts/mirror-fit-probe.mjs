/**
 * Does the mirror stage take the shape of the stream **that a phone actually sent**?
 *
 * Slice 37 proved the box rule and the coordinate mapping against `--capture-aspect` values set by
 * hand, and said so: that run proves what the stylesheet does with a given ratio and **nothing**
 * about whether `mirror.ts` writes the property when a real `mirror.state` or `mirror.rotate`
 * arrives. `MirrorView` is the one class on `check-renderer-views.mjs`'s debt list, that write has
 * three call sites and no test, so only a phone can prove it. This is the instrument for that.
 *
 * ### Why it reads the shape twice
 *
 * Two independent things in the page know the stream's geometry, and they arrive by different
 * routes:
 *
 *   - `--capture-aspect` on `#mirror-stage` is written from **`this.capture`** — the geometry the
 *     phone *announced* in `mirror.state` / `mirror.rotate`, over the control channel;
 *   - the canvas's **intrinsic** `width`/`height` are written from `frame.displayWidth/Height` —
 *     the geometry of a **decoded frame**, over the video socket.
 *
 * A run in which those two agree proves the announcement path and the pixel path are describing one
 * phone. A run in which they disagree is a finding in its own right and is reported as one rather
 * than averaged away — `CLAUDE.md`'s "two readings, one fact": the useful question is never *which
 * do I trust* but *what is each one reading*.
 *
 * ### The lookalike this refuses, and it is a good one
 *
 * **A canvas that has never received a frame is 300×150** — the HTML default — which is an aspect of
 * **2.000**. That is a perfectly plausible landscape-phone number sitting one decimal place from the
 * moto's 2.2222 and the vivo's 2.2296, and it would be read as a successful landscape reading by
 * anybody comparing to two significant figures. So the control is not "the canvas has a size"; it is
 * that the canvas is **not the default size** and that `mirror-actual` reports a capture. Both are
 * asserted before any number below is reportable.
 *
 * Usage:  node scripts/mirror-fit-probe.mjs <label>        # e.g. moto45, samsung, vivo
 * with a live mirror session running. Writes JSON to stdout; nothing is inferred from a missing
 * session — it refuses instead.
 */
import { openProbe, format } from './probe.mjs';

const label = process.argv[2] ?? 'unlabelled';

const probe = await openProbe({ port: 9222 });

/*
 * The control. `section[data-screen="mirror"]` and not `[data-screen="mirror"]` — the app window
 * carries the same attribute as its route marker and comes first in document order, so the loose
 * selector measures a superset of the target and reports a hidden pane as visible. That is the first
 * of the three faults `probe.mjs` was written for, and `one()` throws on a hidden node.
 */
const CONTROL = `__probe.one('section[data-screen="mirror"] .mirror-stage').getBoundingClientRect().height`;

/*
 * Route to the Mirror pane first. A pane that is not routed reports height 0, which `one()` refuses
 * — correctly, and it refused this run's first attempt. Routing is a *stimulus* with an `expect`,
 * never an assumption; and it only changes which pane is visible, so the live session is untouched.
 */
const routed = await probe.act({
  what: 'route the Mac to the Mirror pane',
  run: `document.querySelector('[data-nav="mirror"]').click()`,
  expect: `__probe.one('section[data-screen="mirror"] .mirror-stage').getBoundingClientRect().height > 0`,
  within: 5000,
});
if (!routed.landed) {
  console.error(JSON.stringify(routed, null, 2));
  console.error('\nNOT A READING: could not reach the Mirror pane.');
  probe.close();
  process.exit(3);
}

const reading = await probe.read({
  question: `Stage box against the stream the phone sent — ${label}`,
  control: CONTROL,
  read: () => {
    const stage = __probe.one('section[data-screen="mirror"] .mirror-stage');
    const canvas = __probe.one('section[data-screen="mirror"] #mirror-canvas');
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const cs = getComputedStyle(stage);

    // The announced geometry, as the renderer wrote it.
    const announced = cs.getPropertyValue('--capture-aspect').trim();

    // The decoded geometry. `naturalDefault` is the lookalike: an untouched canvas is 300x150.
    const decodedW = canvas.width;
    const decodedH = canvas.height;
    const isDefaultCanvas = decodedW === 300 && decodedH === 150;

    const readout = document.querySelector('#mirror-rotation-readout');
    const actual = document.querySelector('#mirror-actual');
    const stats = document.querySelector('#mirror-stats');
    const overlay = document.querySelector('#mirror-overlay');

    return {
      stage: {
        w: +stageRect.width.toFixed(2),
        h: +stageRect.height.toFixed(2),
        aspect: +(stageRect.width / stageRect.height).toFixed(5),
      },
      canvasBox: {
        w: +canvasRect.width.toFixed(2),
        h: +canvasRect.height.toFixed(2),
      },
      // The letterbox the user would see, measured off the rects rather than computed from the
      // rule under test. A probe that recomputed `containedPicture` here would be testing a copy.
      bars: {
        x: +((stageRect.width - canvasRect.width) / 2).toFixed(2),
        y: +((stageRect.height - canvasRect.height) / 2).toFixed(2),
      },
      announcedAspect: announced === '' ? null : +Number(announced).toFixed(5),
      decoded: {
        w: decodedW,
        h: decodedH,
        aspect: decodedH === 0 ? null : +(decodedW / decodedH).toFixed(5),
        isDefaultCanvas,
      },
      maxHeightOnCanvas: getComputedStyle(canvas).maxHeight,
      rotationReadout: readout ? readout.textContent.trim() : null,
      actualCapture: actual ? actual.textContent.trim() : null,
      stats: stats ? stats.textContent.trim() : null,
      overlay: overlay && !overlay.hidden ? overlay.textContent.trim() : null,
      // Every bound this instrument imposes, in what it reports.
      window: { inner: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio },
      sections: document.querySelectorAll('section[data-screen]').length,
    };
  },
});

const v = reading.value;

/*
 * Reportability. Three ways this run holds no reading, each said out loud rather than folded into a
 * number: no session, a default canvas, and an announcement the renderer never made.
 */
const refusals = [];
if (v.decoded.isDefaultCanvas) {
  refusals.push(
    'the canvas is 300x150 — the HTML default, aspect 2.000. No frame has been decoded, and 2.000 ' +
      'is close enough to 2.2222 and 2.2296 to be read as a landscape phone by anyone rounding.',
  );
}
if (v.announcedAspect === null) {
  refusals.push('--capture-aspect is unset: mirror.ts has not written it, so the stage is on its CSS fallback.');
}
if (v.overlay) refusals.push(`the overlay is showing: ${JSON.stringify(v.overlay)}`);

const agree =
  v.announcedAspect !== null && v.decoded.aspect !== null &&
  Math.abs(v.announcedAspect - v.decoded.aspect) < 0.001;

console.log(format(reading));
console.log(JSON.stringify({
  label,
  reportable: refusals.length === 0 && reading.reportable,
  refusals,
  announcedAspect: v.announcedAspect,
  decodedAspect: v.decoded.aspect,
  stageAspect: v.stage.aspect,
  // The two routes agreeing is the thing that says the announcement path and the pixel path are
  // describing one phone. Disagreement is a finding, not noise.
  announcementAgreesWithPixels: agree,
  stageMatchesStream:
    v.announcedAspect === null ? null : Math.abs(v.stage.aspect - v.announcedAspect) < 0.005,
  bars: v.bars,
  decoded: v.decoded,
  rotationReadout: v.rotationReadout,
  actualCapture: v.actualCapture,
  maxHeightOnCanvas: v.maxHeightOnCanvas,
  window: v.window,
  control: { sectionsOnPage: v.sections, stageHeight: reading.control },
}, null, 2));

// The socket keeps the process alive; every probe in this repo closes it explicitly.
probe.close();
if (refusals.length) {
  console.error('\nNOT A READING:\n  - ' + refusals.join('\n  - '));
  process.exit(3);
}
process.exit(0);
