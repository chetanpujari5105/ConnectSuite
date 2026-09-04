/**
 * Does the app window fit the display it opened on — and if not, which of the two bugs is it?
 *
 * The user's report is "the top is sliced off and the right column is on the desktop". Two very
 * different faults produce that screenshot and a screenshot cannot separate them:
 *
 *   A. the window is genuinely larger than the display's work area, and macOS is clipping it;
 *   B. the panes are painting outside the BrowserWindow's own bounds.
 *
 * The discriminator is not the picture, it is three numbers taken at once: where the window's frame
 * sits in screen coordinates, where the display's work area sits, and whether any laid-out element
 * has a rect outside the viewport. A window whose origin is above `availTop` is fault A. An element
 * whose rect exceeds `innerHeight` is fault B. They are independent, so both are read.
 *
 * Every read carries a control, per scripts/probe.mjs. The control here is the app window's own
 * height: a hidden or unpainted surface reports zero size, and every geometry number below would
 * then be a reading about nothing — which is exactly the fault that probe.mjs exists to refuse.
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
const CONTROL = `__probe.one('.app-window').getBoundingClientRect().height`;

const frame = await probe.read({
  question: 'Where is the window frame, and where is the display work area?',
  control: CONTROL,
  read: () => ({
    win: {
      outerW: window.outerWidth,
      outerH: window.outerHeight,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      screenX: window.screenX,
      screenY: window.screenY,
    },
    display: {
      w: screen.width,
      h: screen.height,
      availW: screen.availWidth,
      availH: screen.availHeight,
      availLeft: screen.availLeft,
      availTop: screen.availTop,
    },
    dpr: window.devicePixelRatio,
    zoom: window.visualViewport ? window.visualViewport.scale : null,
  }),
});

/*
 * Fault B, measured rather than assumed. Every element in the document, compared against the
 * viewport the window actually has. `overflow: hidden` on html/body/.app-window says this should be
 * impossible — but "should be impossible" is a deduction from a stylesheet, and the question asked
 * was whether it is happening.
 */
const outside = await probe.read({
  question: 'Do any laid-out elements have rects outside the viewport?',
  control: CONTROL,
  read: () => {
    const all = document.querySelectorAll('*');
    let past = 0;
    let worstRight = 0;
    let worstBottom = 0;
    let example = null;
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const overRight = r.right - window.innerWidth;
      const overBottom = r.bottom - window.innerHeight;
      if (overRight > 1 || overBottom > 1) {
        past += 1;
        if (overRight > worstRight) worstRight = overRight;
        if (overBottom > worstBottom) worstBottom = overBottom;
        if (!example) {
          example = (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
        }
      }
    }
    return { elementsMeasured: all.length, pastViewport: past, worstRight, worstBottom, example };
  },
});

console.log(format(frame));
console.log(format(outside));

const f = frame.value;
const workBottom = f.display.availTop + f.display.availH;
const winBottom = f.win.screenY + f.win.outerH;
console.log('\n--- the two faults, separated ---');
console.log(`A. window vs work area:`);
console.log(`   work area   : ${f.display.availW} x ${f.display.availH} at (${f.display.availLeft}, ${f.display.availTop})`);
console.log(`   window frame: ${f.win.outerW} x ${f.win.outerH} at (${f.win.screenX}, ${f.win.screenY})`);
console.log(`   top above work area by : ${f.display.availTop - f.win.screenY} px  (positive = title bar clipped)`);
console.log(`   bottom past work area by: ${winBottom - workBottom} px  (positive = bottom clipped)`);
console.log(`   height overflow: ${f.win.outerH - f.display.availH} px, width overflow: ${f.win.outerW - f.display.availW} px`);
console.log(`B. content vs viewport:`);
console.log(`   viewport ${f.win.innerW} x ${f.win.innerH}, elements measured ${outside.value.elementsMeasured}, past viewport ${outside.value.pastViewport}`);
console.log(`   worst overhang right ${outside.value.worstRight}px, bottom ${outside.value.worstBottom}px, first: ${outside.value.example}`);
console.log(`   zoom=${f.zoom} dpr=${f.dpr}`);

probe.close();
