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
    question: 'does the wall line state the one-directional limit?',
    read: `__probe.one('#clip-wall').textContent.includes('only send its clipboard while ConnectSuite is open')`,
    // Control: the element exists and is non-empty. An empty node would make the includes() false
    // for a reason that has nothing to do with the sentence.
    control: `__probe.one('#clip-wall').textContent.trim().length > 40`,
  }),
);

console.log('\nThe pane starts with an empty history and says so');
show(
  await probe.read({
    question: 'what does the empty history render?',
    read: `__probe.one('#clip-list').textContent.trim().slice(0, 60)`,
    control: `__probe.count('#clip-list') === 1`,
  }),
);

console.log(failures === 0 ? '\nAll reportable.\n' : `\n${failures} not reportable.\n`);
process.exit(failures === 0 ? 0 : 1);
