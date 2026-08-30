/**
 * Every string the notifications pane puts in front of a person, in one place.
 *
 * ### Why this file exists — defect 28, and why a visual rewrite is when it comes back
 *
 * Defect 28 is a raw `com.techmash.playo` reaching a sentence somebody reads. It was believed to be
 * two copies and turned out to be **three**, found only by enumerating rather than by fixing the one
 * on screen. The rule in CLAUDE.md is: a package id may appear as a machine handle, never as the
 * only thing a user reads — and the practical half is *grep for every package name reaching a
 * string, not the ones a screenshot showed you*.
 *
 * A redesign is exactly when that regresses. The new pane draws a 34px app tile that did not exist
 * before, and a tile wants an initial, and `one.package[0]` is right there and one character
 * shorter than the correct answer. So the pane does not compose its own strings: it asks this file,
 * and [userVisibleStringsOf] enumerates every answer so a test can assert over **all** of them
 * rather than over the three somebody remembered. A string added to the pane later is covered the
 * day it is added, provided it comes from here.
 *
 * ### The fallback is correct and must not be "fixed"
 *
 * `appName` arrives already resolved by `AppLabels.of` on the phone, which returns the package name
 * as its honest answer for a package with no launcher icon, logs at warning level, and keeps
 * `resolved / fell back` on the line. That fallback is right — there is genuinely no better label —
 * and inventing one here (title-casing the last path segment, say) would replace an honest handle
 * with a fabricated name.
 *
 * What this file adds is the other half of the rule, which the Mac was not honouring: when the
 * label *is* the package, it must not be presented as though it were a name. So it is marked —
 * [AppLabel.isPackageFallback] — and the pane renders it in the mono face with a "package id" meta
 * chip, and the accessible name carries a clause saying the app name is unavailable. The handle
 * appears; it is never the only thing a person reads.
 *
 * Plain script, not a module: index.html loads it with its own <script> tag and the CSP-locked page
 * has no module loader, so it hangs its functions on `globalThis` and the shim at the foot is what
 * makes them reachable from `node --test`. Same shape as chips.ts and renderer/calls.ts.
 */

/** The fields of a notification this file is allowed to see. */
interface LabelSource {
  package: string;
  appName: string;
  title?: string;
  text?: string;
  replyLabel?: string;
}

interface AppLabel {
  /** What the row shows as the app's name. Never empty. */
  label: string;
  /**
   * True when [label] is the package id itself, because `AppLabels.of` could not resolve one.
   *
   * The pane uses this to change the *typeface and the accessible name*, never the text: a handle
   * rendered as a handle is honest, and a handle rendered in the UI face is defect 28.
   */
  isPackageFallback: boolean;
}

/**
 * The app's display label, and whether it is really a package id wearing a name's clothes.
 *
 * A blank `appName` counts as a fallback rather than as an empty label: a row headed by nothing at
 * all is the group-summary bug in a different costume, and the package is more use than a gap.
 */
function appLabelOf(one: LabelSource): AppLabel {
  const name = one.appName.trim();
  if (name.length === 0) return { label: one.package, isPackageFallback: true };
  return { label: name, isPackageFallback: name === one.package };
}

/**
 * The letter in the 34px app tile.
 *
 * Deliberately taken from the *label*, not the package. For a resolved label that is "S" for Slack;
 * for a fallback it is "C" for every `com.*` package on earth, which is useless and honest — the
 * tile is decoration there, and the row's text is what carries the identity. Reaching into the
 * package for a prettier initial is the fabrication this file exists to refuse.
 */
function tileInitialOf(one: LabelSource): string {
  const { label } = appLabelOf(one);
  const first = Array.from(label).find((character) => /[\p{L}\p{N}]/u.test(character));
  return (first ?? '?').toUpperCase();
}

/**
 * The name a screen reader gives the row's app tile.
 *
 * The tile is a coloured square with one letter in it; without this it announces as "C" or as
 * nothing. Defect 26 is the same shape one layer over — a chip whose entire on/off distinction was
 * a background colour, read out to a screen reader as twelve bare capability names.
 *
 * In the fallback case the clause is the point. "com.techmash.playo" alone is a package id as the
 * only thing a user reads, which is the defect; "com.techmash.playo — app name unavailable" is a
 * handle with a sentence beside it, which is the rule.
 */
function appTileNameOf(one: LabelSource): string {
  const { label, isPackageFallback } = appLabelOf(one);
  return isPackageFallback ? `${label} — app name unavailable` : label;
}

/** Placeholder in the reply field. */
function replyPlaceholderOf(one: LabelSource): string {
  return `Reply to ${appLabelOf(one).label}…`;
}

/** The confirmation after a reply lands. */
function repliedNoticeOf(one: LabelSource): string {
  return `Replied to ${appLabelOf(one).label}.`;
}

/** The label on the button that opens the reply field — the app's own, where it supplied one. */
function replyButtonLabelOf(one: LabelSource): string {
  return one.replyLabel?.trim() || 'Reply';
}

/**
 * The meta chip drawn beside a fallback label, and nothing at all beside a resolved one.
 *
 * Empty string rather than null so [userVisibleStringsOf] can enumerate it unconditionally: a
 * string that is sometimes absent is a string a test forgets to check.
 */
function fallbackChipOf(one: LabelSource): string {
  return appLabelOf(one).isPackageFallback ? 'package id' : '';
}

/**
 * **Every** string this pane draws for one notification.
 *
 * The enumeration is the test surface. `notifyLabels.test.ts` asserts over the whole array rather
 * than over named functions, so adding a twelfth string to the pane extends the defect-28 guard
 * automatically — provided it is added here and read from here.
 *
 * `title` and `text` are the notification's own content and are included on purpose: an app is free
 * to put its own package name in its own notification text, and that is the app's business, not
 * ours. The test excludes them by name and says why, which is a different thing from this function
 * quietly omitting them.
 */
function userVisibleStringsOf(one: LabelSource): string[] {
  return [
    appLabelOf(one).label,
    tileInitialOf(one),
    appTileNameOf(one),
    replyPlaceholderOf(one),
    repliedNoticeOf(one),
    replyButtonLabelOf(one),
    fallbackChipOf(one),
  ];
}

// Reachable from the pane (plain scripts, one global scope) and from `node --test` (the shim).
// `typeof` on an undeclared identifier is safe in JS, so the shim is a no-op in the browser.
if (typeof module !== 'undefined') {
  module.exports = {
    appLabelOf,
    tileInitialOf,
    appTileNameOf,
    replyPlaceholderOf,
    repliedNoticeOf,
    replyButtonLabelOf,
    fallbackChipOf,
    userVisibleStringsOf,
  };
}
