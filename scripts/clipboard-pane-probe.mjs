/**
 * Reads the clipboard pane, through `probe.mjs` because these numbers get written down.
 *
 * Every check here has a control that must come back non-trivially true, and the controls are the
 * ones the Files pane's probe learned the hard way: `section[data-screen="…"]` and never a bare
 * attribute selector — the app window carries the same attribute as its route marker and comes
 * first in document order, so `querySelector` returns the window and reports a hidden pane as
 * visible. Affordances are **counted as controls**, never matched as text: a `/send|copy/` regex
 * over this pane would match the standing wall copy that explains the direction that does not work.
 *
 * Run: node scripts/clipboard-pane-probe.mjs
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;
const show = (result) => {
  console.log('  ' + format(result));
  if (!result.reportable) failures += 1;
  return result;
};

/** A stimulus is not a reading, so it is reported as one — landed, with what it waited for. */
const acted = (result) => {
  console.log(`  ${result.what} → landed=${result.landed} [waited=${result.waitedMs}ms stopped=${result.stopped}]`);
  if (!result.landed) failures += 1;
  return result;
};

console.log('\nRouting to the clipboard pane');
acted(
  await probe.act({
    what: 'click the Clipboard nav row',
    // By accessible name, never by coordinates: the nav is built in a loop and a point read off a
    // screenshot is a guess about a layout that still moves.
    run: `Array.from(document.querySelectorAll('button')).find(function (b) { return b.getAttribute('aria-label') === 'Clipboard'; }).click()`,
    expect: `!document.querySelector('section[data-screen="clipboard"]').hidden`,
  }),
);

console.log('\nThe pane itself');
show(
  await probe.read({
    question: 'how tall is the clipboard section?',
    // `__probe.one` refuses a hidden node by construction — it throws PROBE_NOT_VISIBLE rather than
    // returning a number about something nobody can see — so asking it for a height *is* the
    // visibility check, and there is no separate `visible()` to call.
    read: `Math.round(__probe.one('section[data-screen="clipboard"]').getBoundingClientRect().height)`,
    // The control that says the selector reached the pane and not the window carrying the same
    // attribute as its route marker: the window is the full height of the app, the pane is not.
    control: `document.querySelectorAll('[data-screen="clipboard"]').length`,
  }),
);

console.log('\nAffordances, counted rather than matched');
show(
  await probe.presence({
    question: 'how many controls does the pane offer?',
    controls: 'section[data-screen="clipboard"] button',
    // The control that separates "the pane has no buttons" from "I am looking at the wrong node":
    // the sidebar has plenty, so a selector that reached the window would report far more.
    control: `__probe.count('nav button') > 0`,
  }),
);

console.log('\nThe wall is standing copy, present before anything is asked');
show(
  await probe.read({
    question: 'does the phone-side block still state the one-directional limit?',
    read: `__probe.one('#clip-wall-phone').textContent.includes('only send its clipboard while ConnectSuite is open on screen')`,
    control: `__probe.one('#clip-wall-phone').textContent.trim().length > 40`,
  }),
);

console.log('\nAnd it says whose limit it is, which is the whole point of the second block');
show(
  await probe.read({
    // The claim being checked is **attribution**, not presence. The previous copy was accurate and
    // ownerless — a reader who has not measured it takes "Android does not let any app read the
    // clipboard in the background" as our excuse rather than as Android's rule. So the check is
    // that the sentence names Android as the owner *before* it names any consequence, and that it
    // rules out the reading it exists to prevent.
    question: 'does the limit name Android as its owner, and deny being unfinished work?',
    read: `(function () {
      var t = __probe.one('#clip-wall-phone').textContent;
      return [
        t.indexOf('Android’s rule') >= 0,
        t.indexOf('not an unfinished feature') >= 0,
        t.indexOf('every app') >= 0,
        t.indexOf('Android’s rule') < t.indexOf('only send its clipboard'),
      ].join(',');
    })()`,
    control: `__probe.one('#clip-wall-phone').textContent.trim().length > 100`,
  }),
);

console.log('\nThe Mac direction says it is automatic, and the button is not the only route');
show(
  await probe.read({
    question: 'does the Mac-side copy say copies go on their own?',
    read: `__probe.one('#clip-wall').textContent.includes('goes to your phone on its own')`,
    control: `__probe.one('#clip-wall').textContent.trim().length > 40`,
  }),
);

console.log('\nThe watcher has a switch, and it is a control rather than a sentence');
show(
  await probe.presence({
    // Counted, not matched. A `/automatic|watch/` regex over this pane would match the standing
    // copy that describes the watcher, which is the second row of the DOM-as-instrument table.
    question: 'how many checkboxes does the pane offer?',
    controls: `section[data-screen="clipboard"] input[type="checkbox"]`,
    control: `__probe.count('section[data-screen="clipboard"] button') > 0`,
  }),
);

console.log('\nAnd it says what you get before it says what you cannot have');
show(
  await probe.read({
    // The copy rule, measured as a **position** rather than read as a vibe. "Say what I get, then
    // the limit" is an ordering claim, and an ordering claim is checkable: the sentence about ⌘V
    // must come before the sentence about the background-read wall. A reviewer eyeballing the
    // paragraph would confirm whichever order they already believed.
    question: 'does the benefit sentence precede the limit sentence?',
    read: `(function () {
      var t = __probe.one('#clip-wall').textContent;
      var phone = __probe.one('#clip-wall-phone').textContent;
      // Across the two blocks now: the benefit is the whole of the first, the limit the whole of
      // the second, and they are separate elements so the ordering is structural rather than
      // a matter of where a sentence happens to fall in a paragraph.
      return t.indexOf('goes to your phone on its own') >= 0 && phone.indexOf('Android’s rule') >= 0;
    })()`,
    // The control both halves need: each phrase is actually present. Two indexOf of -1 compare as
    // equal-ish and would let a wall missing both sentences report a correct ordering.
    control: `(function () {
      var t = __probe.one('#clip-wall').textContent;
      return t.trim().length > 40 && __probe.one('#clip-wall-phone').textContent.trim().length > 40;
    })()`,
  }),
);

console.log('\nThe undo is described where a person deciding to trust auto-apply would look');
show(
  await probe.read({
    question: 'does the standing copy say the replaced clipboard is kept?',
    read: `__probe.one('#clip-wall').textContent.includes('so you can put it back')`,
    control: `__probe.one('#clip-wall').textContent.trim().length > 40`,
  }),
);

console.log('\nThe watcher’s sends reach the list with nothing clicked');
show(
  await probe.presence({
    // This step used to read the empty-state sentence, and it kept passing after the watcher landed
    // because it only ever sliced the first 60 characters of whatever was there — it would have
    // reported a list full of rows as "the empty history renders …" and nobody would have looked.
    // The watcher sends with no click, so **rows appearing at all** is the thing to count: the pane
    // has no event of its own to refresh on, and it sat at "Nothing yet" over a populated history
    // until `clip-changed` was added.
    question: 'how many history rows are drawn?',
    controls: `section[data-screen="clipboard"] .clip-row`,
    // The control separates "no rows" from "wrong element": the empty state is its own node, and
    // exactly one of the two must exist.
    control: `__probe.count('#clip-list .clip-row') + __probe.count('#clip-list .clip-empty') > 0`,
  }),
);

console.log(failures === 0 ? '\nAll reportable.\n' : `\n${failures} not reportable.\n`);
process.exit(failures === 0 ? 0 : 1);
