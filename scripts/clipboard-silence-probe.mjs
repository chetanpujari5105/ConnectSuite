/**
 * Where the clipboard pane's phone-direction wall copy sits, relative to where a person looks
 * when they ask "did the thing I just copied arrive?"
 *
 * `clipboard-pane-probe.mjs` asserts the copy is IN THE DOM and passes every check. This asks the
 * question that probe structurally cannot: is it ON SCREEN, in the state the user was in — a
 * populated history whose newest row is not the thing they just copied.
 *
 * The first run of this file had its own lookalike fault and it is recorded rather than hidden:
 * the row selector `[data-clip-row], li` matched 0 while the canonical probe read 13, so the
 * reading was about a wrong selector and not about the pane. Rows are `#clip-list > *`.
 */
import { openProbe, format } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;
const show = (r) => { console.log('  ' + format(r)); if (!r.reportable) failures += 1; return r; };
const acted = (r) => { console.log(`  ${r.what} → landed=${r.landed} [waited=${r.waitedMs}ms stopped=${r.stopped}]`); if (!r.landed) failures += 1; return r; };

console.log('\nRoute to the pane the way the user did');
acted(await probe.act({
  what: 'click the Clipboard nav row',
  run: `Array.from(document.querySelectorAll('button')).find(function (b) { return b.getAttribute('aria-label') === 'Clipboard'; }).click()`,
  expect: `!document.querySelector('section[data-screen="clipboard"]').hidden`,
}));

console.log('\nThe state the user was in — rows, counted with the selector the pane actually uses');
show(await probe.read({
  question: 'how many history rows are drawn?',
  read: `__probe.one('#clip-list').children.length`,
  // The control that says this selector reached the list: the canonical probe reads 13 the same way.
  control: `__probe.count('#clip-list') === 1`,
}));

console.log('\nIs the phone-direction wall on screen without scrolling?');
show(await probe.read({
  question: 'wall rect vs the window',
  read: `(function(){
    var r = __probe.one('#clip-wall-phone').getBoundingClientRect();
    var h = window.innerHeight;
    var visible = Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0));
    return JSON.stringify({
      top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
      viewportH: h,
      pixelsOnScreen: Math.round(visible),
      fractionOnScreen: +(visible / r.height).toFixed(2)
    });
  })()`,
  control: `window.innerHeight > 100 && window.innerWidth === window.outerWidth`,
}));

console.log('\nWhere the list is, for comparison — the thing the user WAS looking at');
show(await probe.read({
  question: 'list rect vs the window',
  read: `(function(){
    var r = __probe.one('#clip-list').getBoundingClientRect();
    var h = window.innerHeight;
    var visible = Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0));
    return JSON.stringify({ top: Math.round(r.top), bottom: Math.round(r.bottom), viewportH: h, fractionOnScreen: +(visible / r.height).toFixed(2) });
  })()`,
  control: `__probe.count('#clip-list') === 1`,
}));

console.log('\nDoes the LEFT column — the list and its head — say anything about the phone limit?');
show(await probe.read({
  question: 'does any text in the clip-panel column mention the direction that cannot work?',
  read: `(function(){
    var panel = __probe.one('section[data-screen="clipboard"] .clip-panel');
    var t = panel.textContent;
    return JSON.stringify({
      mentionsOpenOnScreen: t.includes('open on screen'),
      mentionsAndroid: t.includes('Android'),
      panelChars: t.trim().length
    });
  })()`,
  control: `__probe.one('section[data-screen="clipboard"] .clip-panel').textContent.trim().length > 50`,
}));

console.log('\nThe notice strip — the one element in the left column that could carry a state');
show(await probe.read({
  question: 'is #clip-notice showing anything right now?',
  read: `(function(){
    var el = document.querySelector('#clip-notice');
    return JSON.stringify({ exists: !!el, hidden: el ? el.hidden : null, text: el ? el.textContent.trim().slice(0, 120) : null });
  })()`,
  control: `__probe.count('#clip-list') === 1`,
}));

console.log('\nAnd the newest row: what direction is it, and when?');
show(await probe.read({
  question: 'the newest row as drawn',
  read: `(function(){
    var list = __probe.one('#clip-list');
    if (!list.children.length) return 'no rows';
    return list.children[0].textContent.trim().replace(/\\s+/g, ' ').slice(0, 160);
  })()`,
  control: `__probe.one('#clip-list').children.length > 0`,
}));

console.log(failures ? `\n${failures} not reportable.` : '\nAll reportable.');
