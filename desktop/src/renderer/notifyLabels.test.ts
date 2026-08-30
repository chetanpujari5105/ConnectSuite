/**
 * Defect 28's guard, re-armed against the redesign.
 *
 * The defect: a raw package name reaching a sentence somebody reads. It was found three times, and
 * the third copy only turned up by enumerating rather than by fixing the one on screen — so these
 * tests assert over `userVisibleStringsOf`, the whole enumeration, rather than over the two or
 * three functions a person would think to name.
 *
 * Per CLAUDE.md, a test must be shown to fail against the defect it is named for. It was: swapping
 * `appLabelOf(one).label` for `one.package` in `tileInitialOf` turns "the tile initial is not drawn
 * from the package id" red, and swapping it in `appTileNameOf` turns the enumeration test red. Both
 * were put back. `control_the assertion can distinguish a package id from a name` below is the
 * in-suite version of the same proof, so the discrimination is checked on every run rather than
 * only on the day somebody remembered to break it by hand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  appLabelOf,
  tileInitialOf,
  appTileNameOf,
  replyPlaceholderOf,
  repliedNoticeOf,
  fallbackChipOf,
  dismissButtonNameOf,
  noReplyActionNoteOf,
  sendButtonNameOf,
  userVisibleStringsOf,
} = require('./notifyLabels.ts');

/** A notification whose label resolved: the package and the name share nothing. */
const resolved = {
  package: 'com.techmash.playo',
  appName: 'Playo',
  title: 'Match confirmed',
  text: 'Sunday 7am, court 2',
  replyLabel: 'Reply',
};

/**
 * A notification whose label did not resolve. `AppLabels.of` returned the package as its honest
 * answer, so `appName === package` — this is the *correct* phone-side behaviour, not a bug, and the
 * Mac's job is to mark it rather than to repair it.
 */
const fellBack = {
  package: 'com.samsung.android.app.telephonyui',
  appName: 'com.samsung.android.app.telephonyui',
  title: 'Network',
  text: 'Wi-Fi calling is on',
};

test('a resolved label never lets the package id reach any string the pane draws', () => {
  // The whole enumeration, not a chosen few. This is the assertion that goes red if anyone
  // interpolates `one.package` into a new string during the redesign.
  for (const drawn of userVisibleStringsOf(resolved)) {
    assert.ok(
      !drawn.includes(resolved.package),
      `"${drawn}" carries the package id; it should carry "Playo"`,
    );
  }
});

test('the tile initial is not drawn from the package id', () => {
  // "P" for Playo. `one.package[0]` would give "c" — and would give "c" for almost every app on
  // the phone, which is what makes this the cheapest place for the defect to hide in a redesign:
  // it looks plausible on screen.
  assert.equal(tileInitialOf(resolved), 'P');
});

test('the sentences a person reads name the app, not the package', () => {
  assert.equal(replyPlaceholderOf(resolved), 'Reply to Playo…');
  assert.equal(repliedNoticeOf(resolved), 'Replied to Playo.');
});

test('an unresolved label is marked as a fallback rather than repaired', () => {
  const label = appLabelOf(fellBack);
  // Not title-cased, not split on dots, not prettified. The package is the honest answer and
  // CLAUDE.md says so: the fallback is correct and must not be "fixed".
  assert.equal(label.label, fellBack.package);
  assert.equal(label.isPackageFallback, true);
  assert.equal(fallbackChipOf(fellBack), 'package id');
});

test('a fallback package id is never the only thing a user reads', () => {
  // The rule's second half, and the part the Mac was not honouring before this pane. The handle
  // may appear; it appears with a sentence beside it.
  const name = appTileNameOf(fellBack);
  assert.ok(name.includes(fellBack.package), 'the handle should still be there');
  assert.notEqual(name, fellBack.package);
  assert.match(name, /app name unavailable/);
});

test('a resolved label gets no fallback chip and no explanatory clause', () => {
  // The other half of the control: the marking must not fire on every row, or it means nothing.
  assert.equal(fallbackChipOf(resolved), '');
  assert.equal(appTileNameOf(resolved), 'Playo');
});

test('control_the assertion can distinguish a package id from a name', () => {
  // Every negative result in this file rests on `!drawn.includes(package)` being able to tell a
  // package id from a name. A check that cannot separate the two produces a clean, specific,
  // confident pass over a broken pane — the exact failure CLAUDE.md's control rule is about, and
  // the reason `grep -c remoteinput` once reported two reply actions over two lines of
  // `android.remoteInputHistory=null`.
  //
  // So: a deliberately defective label function, run through the same predicate, must be caught.
  const defective = (one: typeof resolved): string[] => [`Reply to ${one.package}…`];
  const caught = defective(resolved).some((drawn) => drawn.includes(resolved.package));
  assert.ok(caught, 'the predicate failed to catch a package id it was handed directly');
});

test('the three strings that escaped the guard are inside it now', () => {
  // Named individually as well as counted, because a count going 7 → 10 says three arrived and
  // not which three — and these three are the ones a reviewer will want to see by name.
  const drawn = userVisibleStringsOf(resolved);
  assert.ok(drawn.includes(dismissButtonNameOf(resolved)));
  assert.ok(drawn.includes(noReplyActionNoteOf(resolved)));
  assert.ok(drawn.includes(sendButtonNameOf(resolved)));
});

test('all three name the app and none of them leaks the package id', () => {
  for (const drawn of [
    dismissButtonNameOf(resolved),
    noReplyActionNoteOf(resolved),
    sendButtonNameOf(resolved),
  ]) {
    assert.ok(drawn.includes('Playo'), `"${drawn}" should name the app`);
    assert.ok(!drawn.includes(resolved.package), `"${drawn}" leaks the package id`);
  }
});

test('the enumeration covers every label function the pane can call', () => {
  // The guard on the guard. `userVisibleStringsOf` is only worth asserting over if it is actually
  // complete, and completeness is the thing that rots: someone adds a string to the pane, wires it
  // to a new function here, and forgets the enumeration. Then the defect-28 test above still passes
  // and no longer covers the new string.
  //
  // Counting is what makes that visible. Ten strings, and the number is asserted rather than
  // described, so adding an eleventh function without listing it fails here with a diff instead of
  // silently narrowing the coverage above.
  //
  // It went 7 → 10 on 2026-08-30. The three that were missing — the dismiss button's accessible
  // name, the no-reply-action sentence, and the Send button's accessible name — were composed
  // inline in notifications.ts, correctly, and so were never covered here. That is the exact rot
  // this test is named for, caught in the file it was predicted in: nothing on screen was wrong,
  // and the guard was three strings smaller than it read as being.
  assert.equal(userVisibleStringsOf(resolved).length, 10);
  assert.equal(userVisibleStringsOf(fellBack).length, 10);
});
