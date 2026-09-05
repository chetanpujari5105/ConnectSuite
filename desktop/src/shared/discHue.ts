/**
 * One hue per name, for every avatar disc in the app.
 *
 * ### Why this is a file rather than a function in the pane that needed it
 *
 * The design gives each contact a solid, individual colour: a call row's disc, a Frequently-called
 * disc, a message thread's initials. The build drew every one of them in the same accent tint, so
 * fifty call rows carried fifty identical violet circles — a mark with no information in it, and
 * initials at 2.4:1 against their own background.
 *
 * The obvious move was a small hash inside `calls.ts`. `notifications.ts` **already has one**,
 * called `hueOf`, doing exactly this for app tiles. Two would have been a problem twice over:
 *
 *  - Every renderer file is loaded as a plain `<script>` into one global scope, so a second
 *    top-level `hueOf` is a redeclaration — the same trap `photos.ts` records for `PHOTOS_PAGE`,
 *    caught by the compiler here and *not* by the browser.
 *  - More importantly it is the rule this repo already names: a second expression of one rule in a
 *    second place, and the two disagree eventually. Two hash functions would mean one person is
 *    teal in Calls and amber in Notifications, and nothing would ever report it.
 *
 * So the rule has one home. `src/shared/` is the electron-free layer and its files are loaded into
 * the renderer as plain scripts *and* required by tests, which is what makes a seam here testable
 * without a browser.
 *
 * ### Why the hue only, and not the whole colour
 *
 * Saturation and lightness stay in the stylesheet. A per-contact *colour* is the design's intent; a
 * per-contact *contrast ratio* is not — and if the hash produced lightness too, some contacts would
 * get black-on-dark initials and nobody would find out which. Fixing S and L means every disc has
 * the same contrast against `#0b0b12` whatever hue it lands on.
 */

/**
 * A stable hue in `[0, 360)` for a label.
 *
 * Deterministic, so the same person is the same colour on every render and across restarts — a
 * colour that changes when a list is redrawn is worse than no colour, because it looks like the row
 * changed. `hash * 31 + charCode` is the same shape `notifications.ts` has used since Phase 4;
 * this is that function moved, not a new one.
 *
 * An empty label returns a fixed hue rather than throwing: `callInitials` already guarantees a
 * non-empty disc, but a disc is drawn from whatever a provider sent and this must not be the thing
 * that fails.
 */
function discHue(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) % 360;
  }
  return hash;
}

/*
 * Hung on the global for the same reason `icons.ts` does it: the page gets this by loading it as a
 * plain script before its callers, but under `node --test` nothing loads it, so a view test that
 * mounts a pane calling `discHue` throws on the first row it draws.
 *
 * That is the export/CommonJS trap this repo already records — a green suite exercising a loader
 * the renderer never uses — and it cost two rounds here: the pane threw first on `iconSvg` and then
 * on this, both with every test green a moment earlier because neither symbol had a caller yet.
 *
 * **And this block had never once run in the browser, which is the part worth keeping.** Until
 * 2026-09-05 the declaration above was `export function discHue`, which compiles to CommonJS whose
 * first emitted statement is `Object.defineProperty(exports, …)`. `exports` does not exist in a
 * classic script, so the file threw on its first line and everything below — this block included —
 * was dead. `discHue` was on the page anyway, because a **function declaration is hoisted onto
 * `globalThis` before the body executes**. The comment claiming this block was what made it work
 * was wrong for a whole phase, and nothing could have reported it: the page worked, the tests were
 * green, and the mechanism everyone believed in was not the mechanism operating.
 *
 * It came out when the same shape was written with a `class`, which is **not** hoisted that way —
 * `ContactPhotos` was simply `undefined` in the page while `photoKey`, four lines from it in the
 * same file, was a function. `scripts/check-renderer-scripts.mjs` is the guard.
 */
{
  const g = globalThis as Record<string, unknown>;
  g.discHue = discHue;
}

// The renderer loads this as a plain script; `module` is undefined there, so this is a no-op in the
// browser and the export exists only for the tests.
if (typeof module !== 'undefined') {
  module.exports = { discHue };
}
