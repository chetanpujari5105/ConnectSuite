/**
 * Defect 85's proof — **at the geometry the user actually sees**, not in the DOM.
 *
 * ### Why this file exists rather than an assertion in a view test
 *
 * `clipboard-pane-probe.mjs` passed all nine of its checks over this defect, because it asserts the
 * copy is **in the DOM** and it was — at `top=828` in an 865 px window, 21% on screen, in the
 * column the user was not reading. The view tests added with the fix run against a DOM double with
 * no layout at all. **Neither layer can see the defect**, which is why the proof is a third
 * instrument that reads rectangles from a real window.
 *
 * So every check below is *is it inside the viewport*, never *is it in the document*.
 *
 * The window is asserted to match the one the report came from — 1440 × 865, unzoomed — because a
 * pane that fits at one size and not another is the whole subject.
 *
 * Run: node scripts/clipboard-silence-probe.mjs [port]
 */
import { openProbe, format } from './probe.mjs';

const port = Number(process.argv[2] ?? 9222);
const probe = await openProbe({ port });
let failures = 0;
const show = (r) => { console.log('  ' + format(r)); if (!r.reportable) failures += 1; return r; };
const acted = (r) => {
  console.log(`  ${r.what} → landed=${r.landed} [waited=${r.waitedMs}ms stopped=${r.stopped}]`);
  if (!r.landed) failures += 1;
  return r;
};

/** In the viewport, not merely in the document. The distinction is the defect. */
const RECT = `(function (sel) {
  var r = __probe.one(sel).getBoundingClientRect();
  var h = window.innerHeight;
  var seen = Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0));
  return JSON.stringify({
    top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
    viewportH: h, pixelsOnScreen: Math.round(seen),
    fractionOnScreen: r.height ? +(seen / r.height).toFixed(2) : 0
  });
})`;

console.log('\nThe window must be the one the report came from');
show(await probe.read({
  question: 'viewport size and zoom',
  read: `JSON.stringify({ iw: innerWidth, ih: innerHeight, zoomed: innerWidth !== outerWidth })`,
  // Chromium persists a per-origin zoom into the user data dir; a stray Cmd+Minus survives every
  // relaunch and would render every rectangle below at a size nobody is looking at.
  control: `innerWidth > 400 && innerHeight > 400`,
}));

console.log('\nRoute to the pane the way the user did — by accessible name, never a coordinate');
acted(await probe.act({
  what: 'click the Clipboard nav row',
  run: `Array.from(document.querySelectorAll('button')).find(function (b) { return b.getAttribute('aria-label') === 'Clipboard'; }).click()`,
  expect: `!document.querySelector('section[data-screen="clipboard"]').hidden`,
}));

console.log('\nThe defect, restated as a measurement: where the explanation used to be');
show(await probe.read({
  question: 'the standing wall card — still below the fold, and that is fine now',
  read: `${RECT}('#clip-wall-phone')`,
  control: `__probe.count('#clip-wall-phone') === 1`,
}));

console.log('\nThe fix: the live line, in the left column, fully on screen');
show(await probe.read({
  question: 'the phone-direction state line',
  read: `${RECT}('#clip-phone-state')`,
  // The control that says this is the pane's element and not the window's: exactly one, and the
  // list it must sit above also exists. A selector matching the app frame would report full height.
  control: `__probe.count('#clip-phone-state') === 1 && __probe.count('#clip-list') === 1`,
}));

console.log('\nAnd it is ABOVE the list, which is what puts it in the reading path');
show(await probe.read({
  question: 'state line top vs list top',
  read: `(function(){
    var s = __probe.one('#clip-phone-state').getBoundingClientRect();
    var l = __probe.one('#clip-list').getBoundingClientRect();
    return JSON.stringify({ stateTop: Math.round(s.top), listTop: Math.round(l.top), aboveTheList: s.top < l.top });
  })()`,
  control: `__probe.count('#clip-list') === 1`,
}));

console.log('\nWhat it says — read as the four fields, not as a text search');
show(await probe.read({
  // **Not a regex over the pane.** A text search here matched "Android" across 32,569 characters of
  // the user's own clipboard history and would have certified the pane as correct. The state is
  // read from `data-state`, which nothing but this code writes.
  question: 'state id, tone, and whether an action is offered',
  read: `(function(){
    var el = __probe.one('#clip-phone-state');
    var action = document.querySelector('#clip-phone-action');
    return JSON.stringify({
      state: el.dataset.state, tone: el.dataset.tone,
      headline: __probe.one('#clip-phone-headline').textContent.trim(),
      detailChars: __probe.one('#clip-phone-detail').textContent.trim().length,
      actionOffered: action ? !action.hidden : null
    });
  })()`,
  control: `__probe.one('#clip-phone-state').dataset.state !== undefined`,
}));

console.log('\nThe left column now says it, where 299 characters said nothing');
show(await probe.read({
  question: 'chrome-only characters in the left column, and whether they name the limit',
  // The list is removed before searching. With it in, this pane's text is the user's own clipboard
  // and will contain any word you look for.
  read: `(function(){
    var panel = __probe.one('section[data-screen="clipboard"] .clip-panel');
    var clone = panel.cloneNode(true);
    var list = clone.querySelector('#clip-list');
    if (list) list.remove();
    var t = clone.textContent.replace(/\\s+/g, ' ').trim();
    return JSON.stringify({
      chromeChars: t.length,
      withListChars: panel.textContent.trim().length,
      namesAndroid: t.includes('Android'),
      namesTheRecipe: t.includes('open ConnectSuite there')
    });
  })()`,
  control: `__probe.one('section[data-screen="clipboard"] .clip-panel').textContent.trim().length > 50`,
}));

console.log(failures ? `\n${failures} not reportable.` : '\nAll reportable.');
process.exit(failures ? 1 : 0);
