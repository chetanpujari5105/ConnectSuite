/**
 * Opening the float into a session that is already running — the after reading for defects 115–117.
 *
 * ### The three questions, and why each is read where it is
 *
 * **Defect 116.** Does the window know the shape of the phone's screen the moment it opens? The
 * reading is `capture` in `float.ts`, which is the field every gesture is stamped from and the one
 * whose being `null` produced *"The phone has not said what shape its screen is yet"*. Read from the
 * float's own realm, because that is the only place the answer exists — the main window's copy is a
 * different object and reading it would be measuring the wrong window.
 *
 * **Defect 115.** Are the phone controls visible *at rest*, with no pointer in the window? Counted as
 * controls, never matched as text: an affordance is a `button`, and a text search finds the sentence
 * apologising for its absence. `opacity` is read as well as the rect, because the pill this replaced
 * was at a perfectly good position and invisible.
 *
 * **Defect 117.** Is there a control that leads back to the main window, and does its label promise
 * that pressing it does not close this one?
 *
 * The stimulus is a click on the main window's own toolbar button, by its id, and it reports whether
 * the window appeared rather than assuming it did — `openProbe` refuses to attach to a float that is
 * not there, so the attach is itself the check.
 */
import { openProbe, format, formatAct } from './probe.mjs';

const main = await openProbe({ port: 9222, window: 'index' });

const alreadyOpen = await main.read({
  question: 'is a float window already open? (the stimulus is skipped if so)',
  read: `(document.getElementById('mirror-float-label').textContent || '').trim() === 'Close floating window'`,
  control: `__probe.count('#mirror-float-label')`,
});
console.log('  ' + format(alreadyOpen));

const opened = alreadyOpen.value ? { what: 'float was already open — no stimulus needed', landed: true, waitedMs: 0, stopped: 'settled' } : await main.act({
  what: 'press the main window\'s "Floating window" button',
  run: `(() => { const b = document.getElementById('mirror-float'); if (b) b.click(); return !!b; })()`,
  // The main window's own button label is the state — floatButtonLabelsFor flips it on open, so this
  // is the main process having answered, not this script having clicked.
  expect: `(document.getElementById('mirror-float-label').textContent || '').trim() === 'Close floating window'`,
  within: 6000,
});
console.log('  ' + formatAct(opened));
if (!opened.landed) {
  console.log('  NOT A PREMISE — nothing below is about a float window that opened.');
  main.close();
  process.exit(1);
}

// Attaching at all is the control on every reading below: openProbe throws when no float page exists.
const float = await openProbe({ port: 9222, window: 'float' });
const FRAME = `__probe.one('#float-frame').getBoundingClientRect().height > 0`;
const show = async (spec) => {
  const r = await float.read(spec);
  console.log('  ' + format(r));
  return r;
};

console.log('\n--- defect 116: does it know the phone\'s screen shape on open? ---');
await show({
  question: 'float.ts `capture`, the geometry every gesture is stamped with',
  read: `(() => { try { return typeof capture === 'undefined' ? 'UNDECLARED' : JSON.stringify(capture); } catch (e) { return 'THREW: ' + e.message; } })()`,
  control: FRAME,
  // Both clocks: the field is written from three sources and the window has only just loaded, so a
  // read taken before `stream-start` has answered is a transition, not a state.
  settle: { until: (v) => typeof v === 'string' && v.startsWith('{'), within: 8000 },
});
await show({
  question: 'the overlay sentence, if any — a transient state must clear itself',
  read: `(() => { const o = document.getElementById('float-overlay'); return o.hidden ? '(hidden — a picture is live)' : (document.getElementById('float-reason').textContent || '').trim(); })()`,
  control: FRAME,
  settle: { until: (v) => v === '(hidden — a picture is live)', within: 10000 },
});

console.log('\n--- defects 115 + 118: are the phone controls visible, and is the bar under the picture? ---');
await show({
  question: 'controls on the bar (counted, not text-matched)',
  read: `__probe.count('#float-bar button.bar-button')`,
  control: `__probe.count('#float-bar')`,
});
await show({
  question: 'the bar at rest: opacity, height, which edge, and whether it overlaps the picture',
  read: `(() => {
     const r = document.getElementById('float-bar');
     const rb = r.getBoundingClientRect();
     const sb = document.getElementById('float-screen').getBoundingClientRect();
     return JSON.stringify({
       opacityAtRest: getComputedStyle(r).opacity,
       barHeight: Math.round(rb.height),
       barWidth: Math.round(rb.width),
       spansTheWindow: Math.abs(rb.width - window.innerWidth) <= 2,
       // The whole point of BOTTOM_BAR being a height: the bar starts where the picture ends.
       overlapsPicture: rb.top < sb.bottom - 0.5,
       gapToPicture: Math.round(rb.top - sb.bottom),
       edge: rb.top > sb.top ? 'bottom' : 'top',
       everyButtonOnScreen: [...r.querySelectorAll('button')].every((b) => {
         const x = b.getBoundingClientRect();
         return x.width > 0 && x.height > 0 && x.top >= 0 && x.bottom <= window.innerHeight
             && x.left >= 0 && x.right <= window.innerWidth;
       }),
       orderLeftToRight: [...r.querySelectorAll('button')]
         .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
         .map((b) => b.dataset.bar),
     });
   })()`,
  control: FRAME,
});
await show({
  question: 'picture aspect vs the aspect the phone announced — the rail must not distort it',
  read: `(() => {
     const s = document.getElementById('float-screen').getBoundingClientRect();
     const cap = (typeof capture !== 'undefined' && capture) ? capture : null;
     return JSON.stringify({
       pictureBox: { w: Math.round(s.width), h: Math.round(s.height) },
       pictureRatio: +(s.height / s.width).toFixed(3),
       captureRatio: cap ? +(cap.height / cap.width).toFixed(3) : null,
       agree: cap ? Math.abs(s.height / s.width - cap.height / cap.width) < 0.02 : null,
     });
   })()`,
  control: FRAME,
});

console.log('\n--- defect 117: is there a way back to the main window? ---');
await show({
  question: 'the reveal control, and what its accessible name promises',
  read: `(() => {
     const b = __probe.one('#float-bar-reveal');
     return JSON.stringify({ label: b.getAttribute('aria-label'), disabled: b.disabled, hasGlyph: b.querySelector('svg') !== null });
   })()`,
  control: `__probe.count('#float-bar button')`,
});

console.log('\n--- defect 118: the tooltip, on hover and on keyboard focus ---');

/*
 * Both paths are exercised through the real listeners — `pointerenter` and `focusin` — rather than
 * by calling the show function, which would be the instrument supplying its own input. The hover arm
 * settles on the tooltip appearing rather than sleeping for the delay, so a run that passes has
 * proven the timer fired and not that the sleep was generous.
 */
/*
 * **Both arms need the window forward, and for two different reasons.**
 *
 * *Focus:* Chromium defers focus events in an unfocused document — `.focus()` moves
 * `document.activeElement` and `focusin` never fires — so a background run reports
 * `shownImmediately: false` over a feature that works, with `activeElement` making the obvious sanity
 * check agree.
 *
 * *Hover:* the product hides the tooltip on `window` blur, which is correct — a tooltip should not
 * stay painted when you leave the app — and that **cancels the pending 450 ms timer**. With the
 * terminal holding focus, the blur lands inside the delay and the tooltip never appears. The first
 * version of this probe hovered before bringing the window forward and read `DID NOT LAND` over a
 * tooltip that had worked a minute earlier.
 *
 * Both are the same rule: establish that the thing you are waiting for can happen at all.
 * `document.hasFocus()` is carried on the readings rather than assumed behind them.
 */
await main.act({
  what: 'bring the float window forward, so hover timers survive and focus events are delivered',
  run: `connect.floatOpen()`,
  expect: `true`,
  within: 3000,
});
await new Promise((r) => setTimeout(r, 700));
await show({
  question: 'CONTROL — does the float window actually hold focus now?',
  read: `document.hasFocus()`,
  control: `__probe.count('#float-bar')`,
  settle: { until: (v) => v === true, within: 5000 },
});

/*
 * **The stimulus is applied once and the settle only reads.** The first version put the
 * `pointerenter` inside the polled read, so every poll re-entered the button — and `scheduleTip`
 * clears the pending timer before starting a new one, so each poll cancelled the 450 ms delay a few
 * milliseconds before it would have fired. It passed twice by luck of poll timing and then reported
 * `shown: false` over a tooltip that works. A probe whose read re-applies its own stimulus is not
 * measuring the thing, it is fighting it.
 */
const hover = await float.act({
  what: 'pointer rests on Screenshot (one enter, not one per poll)',
  run: `(() => {
     const b = __probe.one('#float-bar-shot');
     b.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
     return true;
   })()`,
  // The effect, read at the boundary the stimulus crosses: the tooltip element stops being hidden.
  expect: `document.getElementById('float-tip').hidden === false`,
  within: 4000,
});
console.log('  ' + formatAct(hover));
await show({
  question: 'the tooltip that appeared: text, whether it can block anything, and where it sits',
  read: `(() => {
     const t = document.getElementById('float-tip');
     if (t.hidden) return JSON.stringify({ shown: false });
     const tb = t.getBoundingClientRect();
     const sb = document.getElementById('float-screen').getBoundingClientRect();
     const bb = document.getElementById('float-bar-shot').getBoundingClientRect();
     return JSON.stringify({
       shown: true,
       documentHasFocus: document.hasFocus(),
       text: (t.textContent || '').trim(),
       pointerEvents: getComputedStyle(t).pointerEvents,
       insideWindow: tb.left >= 0 && tb.right <= window.innerWidth && tb.top >= 0,
       coversTheButton: !(tb.bottom <= bb.top || tb.top >= bb.bottom),
       overlapsPictureBy: Math.max(0, Math.round(Math.min(tb.bottom, sb.bottom) - Math.max(tb.top, sb.top))),
     });
   })()`,
  control: `__probe.count('#float-bar-shot')`,
});
await show({
  question: 'pointer-leave hides it immediately (no delay to wait out)',
  read: `(() => {
     __probe.one('#float-bar-shot').dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
     return document.getElementById('float-tip').hidden;
   })()`,
  control: `__probe.count('#float-tip')`,
});

/*
 * The focus arm blurs first, and that is not tidiness. `.focus()` on an element that is **already**
 * the active element fires no `focusin`, so a second run of this probe would dispatch nothing, read
 * `hidden`, and report the feature broken — while `document.activeElement === b` made the obvious
 * sanity check say everything was fine. It did exactly that once. Establish that the thing you are
 * waiting for has actually been triggered.
 */
await show({
  question: 'keyboard focus shows it with no delay — the thing `title` cannot do',
  read: `(() => {
     const b = __probe.one('#float-bar-reveal');
     const focused = document.hasFocus();
     const wasActive = document.activeElement === b;
     b.blur();
     b.focus();
     const t = document.getElementById('float-tip');
     return JSON.stringify({
       documentHasFocus: focused,
       shownImmediately: !t.hidden,
       text: (t.textContent || '').trim(),
       accessibleNameStillFull: b.getAttribute('aria-label'),
       stimulusWasATransition: !wasActive,
     });
   })()`,
  control: `__probe.count('#float-bar-reveal')`,
  // Both clocks: the reading only exists once the document is focused AND the tooltip has answered.
  settle: { until: (v) => typeof v === 'string' && v.includes('"documentHasFocus":true'), within: 6000 },
});
await show({
  question: 'blur hides it',
  read: `(() => { const b = __probe.one('#float-bar-reveal'); b.blur();
     return document.getElementById('float-tip').hidden; })()`,
  control: `__probe.count('#float-tip')`,
});
float.close();
main.close();
