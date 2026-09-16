/**
 * The detached mirror window's geometry. Pure arithmetic, no Electron.
 *
 * Transcribed from `design_handoff_connectsuite/README.md` §3, which records it as an invariant
 * learned from a real bug and states the reason plainly: *"Clamping drag alone is not enough —
 * presets and corner-resize escape the desktop without it."*
 *
 * ```
 * TITLE = 34; BOTTOM_BAR = 40; MARGIN = 8
 * picture      = width                       (no side chrome — the bar is a height)
 * height       = width * ratio + TITLE + BOTTOM_BAR
 * maxPicture() = floor((availableHeight - TITLE - BOTTOM_BAR - MARGIN*2) / ratio)
 * clampY(y, w) = clamp(area.y + MARGIN, y, max(…, area.y + availableHeight - height - MARGIN))
 * ```
 *
 * Three properties the README is explicit about, and which the tests pin down:
 *
 *  1. **Width is the only input.** Height and Y follow from it. Nothing sets a height directly, so
 *     the phone's aspect cannot be broken by a caller that forgets it.
 *  2. **`maxWidth` is derived from the available height, never hard-coded.** The README's ≈401 is
 *     an illustration at 920px tall, not a constant — a smaller display, or a Mac with a menu bar
 *     and a Dock, has less room and the cap has to follow it.
 *  3. **Y is re-clamped with the same expression drag uses, on *every* width change** — corner
 *     resize, size presets and smart-fit alike. A window that is legal while being dragged and
 *     illegal after a preset is the bug this file exists to prevent.
 *
 * It lives in `src/shared/` because that is the electron-free layer, which is where a testable seam
 * belongs — the same move that took `session.ts` out of `link.ts`. The window lifecycle in the main
 * process holds a `BrowserWindow`; this holds the arithmetic, and only this is tested.
 *
 * ### Three things changed on 2026-09-15, each for a bug found in real use
 *
 * **Defect 113 — a [WorkArea] now carries its origin, and that is the whole of why the window could
 * not be dragged to a second monitor.** Every coordinate in this file is a *global* screen point:
 * on a two-display desk the second display's work area starts at x = 1512, or at x = -1920 when it
 * sits to the left. The old `WorkArea` was `{ width, height }` with no origin, so `clampX` measured
 * a global x against a width as though every display began at (0,0) and pulled anything past the
 * primary display's right edge back inside it. `moveTo` re-clamps on every pointer move, so the
 * window did not merely refuse the second display — it snapped back under the cursor, once per
 * event, which reads as the window being glued down. The display was always chosen correctly by
 * `getDisplayMatching`; its origin was thrown away one line later.
 *
 * **Defect 114 — the ratio is a parameter, not a constant.** It was `RATIO = 19.5 / 9`, module
 * scope, read by four functions, so the window was permanently portrait: when the phone turned, the
 * main window's stage followed through `--capture-aspect` and this window did not, leaving a
 * landscape picture letterboxed into a portrait frame at a fifth of the area. The ratio now comes
 * from the capture geometry the phone announces, and [PORTRAIT_RATIO] is only the value to use
 * before it has said anything.
 *
 * **Defect 115 — the controls are real estate, not an overlay.** The float's global actions were a
 * hover-only pill floating over the picture; they are a permanent strip now. It is taken out of the
 * window rather than drawn on top, because the picture's aspect ratio is the invariant this file
 * exists to hold: a strip overlaying the canvas would cover part of the phone's screen and make a
 * slice of it untappable, which is the silent dead zone `float.css` already warns about for the old
 * dock's invisible pill.
 *
 * ### Defect 118 — the strip changed axis, and so did the arithmetic
 *
 * That strip was a **width** on the right edge (`RAIL = 36`). It is a **height** along the bottom
 * now (`BOTTOM_BAR = 40`), so the window reads like a phone with Android's own navigation bar under
 * the screen rather than like a phone with a toolbar bolted to its side.
 *
 * `RAIL` is **deleted rather than set to zero.** A constant left at 0 is one autocomplete away from
 * being subtracted again by somebody who finds the name and assumes it is live — the same reason
 * `MessageType` has no `APPS_LAUNCH`. Removing it made the compiler name every call site, which is
 * how this change was made rather than remembered.
 *
 * The swap is not one subtraction moved from one axis to another, because **the two axes are not
 * symmetric here**:
 *
 *  - Width had *one* consumer of the side chrome and it was arithmetic only. Taking it away gives
 *    the picture the whole window width, and nothing else changes.
 *  - Height already had `TITLE`, and the bar joins it — so the **height budget** shrinks, and every
 *    function that turns available height into a width (`maxPictureWidthFor`, and `maxWidthFor` and
 *    `clampWidth` through it) caps lower than it did. The README's ≈401 at 920pt tall becomes 383,
 *    and the transcription test asserts *both* numbers so the document's own formula stays checkable
 *    beside ours.
 *  - Defect 114's landscape width cap is **re-checked rather than assumed to survive**: it reads
 *    `area.width`, which this change does not touch, and its test is kept and still green.
 */

/** The title bar, in points. Part of the window's height and not part of the phone screen. */
export const TITLE = 34;

/**
 * The control bar along the bottom, in points. Part of the window's **height**, not of the picture.
 *
 * Tall enough for a 26pt control with 7pt of breathing room above and below. Defect 118 — it was
 * `RAIL = 36`, a width on the right edge, until the owner asked for Android's own nav-bar shape.
 *
 * It sits beside [TITLE] in every height expression, and the pair of them is the whole of this
 * window's chrome: `height = width * ratio + TITLE + BOTTOM_BAR`.
 */
export const BOTTOM_BAR = 40;

/** The phone's aspect ratio, height over width, *before the phone has said what it is*. */
export const PORTRAIT_RATIO = 19.5 / 9;

/**
 * The old name for [PORTRAIT_RATIO], kept because the README quotes it and the transcription test
 * checks this file against the document. It is a **default**, not the ratio in force — reading it as
 * the latter is defect 114.
 */
export const RATIO = PORTRAIT_RATIO;

/** Clearance kept between the window and every edge of the work area. */
export const MARGIN = 8;

/**
 * The narrowest the window may be dragged.
 *
 * Unchanged at 220, and it now has a **second** reason to exist that the vertical rail never gave
 * it: five 26pt controls with 8pt gaps and 8pt of padding need 210pt of bar, so a floor below that
 * would ship a control row that overflows or wraps. `floatGeometry.test.ts` asserts the headroom,
 * because nothing about the picture would ever notice.
 */
export const MIN_WIDTH = 220;

/** What a double-click on the title bar, or the green light, smart-fits back to. */
export const DEFAULT_WIDTH = 300;

/**
 * How wide the picture is inside a window of this width — **the whole of it**, since defect 118.
 *
 * An identity, and kept as a named function rather than inlined. It is the one place that would
 * change if side chrome ever came back, and every caller reading `pictureWidthFor(b.width)` states
 * what it means instead of asserting by omission that width and picture are the same thing.
 */
export function pictureWidthFor(width: number): number {
  return Math.max(1, Math.round(width));
}

/**
 * Total window height for a given width — the phone screen plus the title bar.
 *
 * Rounded, because window bounds are integers and an unrounded height accumulates a sub-pixel
 * error across successive resizes until the ratio visibly drifts.
 */
export function heightFor(width: number, ratio: number = PORTRAIT_RATIO): number {
  return Math.round(pictureWidthFor(width) * usable(ratio)) + TITLE + BOTTOM_BAR;
}

/**
 * The widest **picture** that fits the height available.
 *
 * The README's ≈401 at 920pt tall was this number when `TITLE` was the only vertical chrome. With
 * `BOTTOM_BAR` it is **383**, and the test asserts both — the document's own formula written out
 * (still 401) beside ours (383) — so the transcription stays checkable rather than being quietly
 * redefined by a change that made it smaller. Defect 118.
 */
export function maxPictureWidthFor(availableHeight: number, ratio: number = PORTRAIT_RATIO): number {
  return Math.floor((availableHeight - TITLE - BOTTOM_BAR - MARGIN * 2) / usable(ratio));
}

/**
 * The widest the window may be, given the height actually available.
 *
 * Floored to at least [MIN_WIDTH]: on a display too short to hold even the minimum window, a cap
 * below the floor would make every width invalid and the clamp below would invert.
 */
export function maxWidthFor(availableHeight: number, ratio: number = PORTRAIT_RATIO): number {
  // No `+ RAIL`: there is no side chrome to add back. The window IS the picture, horizontally.
  return Math.max(MIN_WIDTH, maxPictureWidthFor(availableHeight, ratio));
}

/**
 * Width held inside `[MIN_WIDTH, the cap]`, where the cap is whichever axis runs out first.
 *
 * **Both axes, and the second one was missing.** `maxWidthFor` is derived from the available
 * *height*, which is the only bound that can bite a portrait window — a window 19.5:9 tall is always
 * narrower than the display long before it is shorter than it. In landscape that stops being true
 * and nothing was checking: found by a test written for defect 114, which asked a 500pt-wide work
 * area for a landscape window and got 985. The height cap answered honestly and the width was never
 * asked about.
 *
 * So the README's rule stands and gains a sibling rather than being replaced: the widest window is
 * the narrower of *what the height allows* and *what the width allows*.
 */
export function clampWidth(
  width: number,
  area: WorkArea,
  ratio: number = PORTRAIT_RATIO,
): number {
  const byHeight = maxWidthFor(area.height, ratio);
  const byWidth = area.width - MARGIN * 2;
  const max = Math.max(MIN_WIDTH, Math.min(byHeight, byWidth));
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(width)));
}

/**
 * Y held on the desktop for a window of this width, **in the coordinates of the display it is on**.
 *
 * The inner `Math.max` is not decoration: when the window is taller than the work area — which
 * happens on a short display, where `clampWidth`'s floor wins over the cap — the upper bound goes
 * negative, and without it this would clamp Y to a value above the top edge. The README writes the
 * same guard for the same reason.
 */
export function clampY(
  y: number,
  width: number,
  area: WorkArea,
  ratio: number = PORTRAIT_RATIO,
): number {
  const highest = area.y + MARGIN;
  const lowest = Math.max(highest, area.y + area.height - heightFor(width, ratio) - MARGIN);
  return Math.min(lowest, Math.max(highest, Math.round(y)));
}

/** X held on the desktop, by the same rule. The ratio does not constrain it; the work area does. */
export function clampX(x: number, width: number, area: WorkArea): number {
  const leftmost = area.x + MARGIN;
  const rightmost = Math.max(leftmost, area.x + area.width - width - MARGIN);
  return Math.min(rightmost, Math.max(leftmost, Math.round(x)));
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A display's usable rectangle **in global screen coordinates**, origin included.
 *
 * `x` and `y` are not decoration and are not always zero: they are 0 only for the display macOS
 * happens to treat as the origin. Dropping them is defect 113 — see the file header.
 */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A ratio that can actually be divided by. Guards a phone that reports a zero-width capture. */
function usable(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 ? ratio : PORTRAIT_RATIO;
}

/**
 * The one function every caller goes through: a requested position and width in, a legal window
 * out, with height derived and both axes re-clamped.
 *
 * Drag, corner-resize, size preset and smart-fit all call this, which is what makes "re-clamped
 * with the same expression drag uses" structurally true rather than a thing four call sites each
 * remember to do. There is no path that sets a width without re-clamping Y, because there is no
 * other path.
 */
export function resolveBounds(
  requested: { x: number; y: number; width: number },
  area: WorkArea,
  ratio: number = PORTRAIT_RATIO,
): Bounds {
  const width = clampWidth(requested.width, area, ratio);
  return {
    width,
    height: heightFor(width, ratio),
    x: clampX(requested.x, width, area),
    y: clampY(requested.y, width, area, ratio),
  };
}

/**
 * Where a grabbed window should sit, given where the pointer is now.
 *
 * Drag is the one gesture the README's four-method list does not cover — `openFloat`, `closeFloat`,
 * `smartFit` and `setWidth` are lifecycle and sizing, and its interaction table has a *Drag title
 * bar* row that has to move the window. So the arithmetic lives here, in the same file as the
 * clamps, rather than in the Electron shell where nothing could test it.
 *
 * `grab` is the pointer's offset inside the window at mousedown, in screen points. Holding it fixed
 * for the length of the gesture is what makes the window track the cursor exactly instead of
 * snapping its corner to the pointer on the first move.
 *
 * The result goes through [resolveBounds] like everything else, so a drag toward the edge is
 * clamped by the same expression a preset is — which is the invariant, and the reason there is no
 * second door. **The `area` a drag is clamped against is the display the pointer is over**, not the
 * one the window started on; see `FloatMirrorWindow.moveTo` for why that is the caller's job.
 */
export function boundsForDrag(
  pointer: { x: number; y: number },
  grab: { x: number; y: number },
  width: number,
  area: WorkArea,
  ratio: number = PORTRAIT_RATIO,
): Bounds {
  return resolveBounds({ x: pointer.x - grab.x, y: pointer.y - grab.y, width }, area, ratio);
}

/**
 * Where a corner drag should leave the window, given the pointer.
 *
 * Width is the pointer's distance from the window's left edge, and that is the *only* thing read —
 * the vertical component of a corner drag is deliberately discarded. Honouring it would let the
 * pointer ask for a height, and a height that did not come from the width is the one way to break
 * the aspect lock. The README says it in one line: *"width is the only input, height and Y follow"*.
 */
export function boundsForCornerDrag(
  pointer: { x: number },
  origin: { x: number; y: number },
  area: WorkArea,
  ratio: number = PORTRAIT_RATIO,
): Bounds {
  return resolveBounds({ x: origin.x, y: origin.y, width: pointer.x - origin.x }, area, ratio);
}

/**
 * The window to use when the phone turns — defect 114.
 *
 * The naive answer is to keep the width and let the height follow, and it is wrong in the direction
 * that hurts: a 300pt-wide portrait window is 684 tall, and keeping 300 through a turn to 19.5:9
 * leaves a window 300 x 157, a picture a fifth of the area it had. That is "landscape content
 * renders tiny", and it is what a caller that only re-derived the height would produce.
 *
 * So the **picture's area** is preserved instead and the width is solved for it, which is the
 * reading of *"roughly its footprint"*: the same number of pixels of phone screen, in the new shape.
 * The top-left corner is held, then both axes are re-clamped by [resolveBounds] like everything
 * else, because a window that was legal in portrait can be illegal in landscape on the same display.
 */
export function boundsForRatioChange(current: Bounds, previousRatio: number, nextRatio: number, area: WorkArea): Bounds {
  const picture = pictureWidthFor(current.width);
  const area2 = picture * picture * usable(previousRatio);
  const width = Math.round(Math.sqrt(area2 / usable(nextRatio)));
  return resolveBounds({ x: current.x, y: current.y, width }, area, nextRatio);
}

/**
 * The aspect ratio of a capture geometry, height over width, or null when there is nothing to read.
 *
 * Null rather than a portrait guess: "the phone has not said" and "the phone is portrait" are
 * different facts, and a caller that cannot tell them apart cannot know whether it is drawing a
 * shape or a default. Same discrimination the Files pane's empty-versus-failed split turns on.
 */
export function ratioOfCapture(capture: { width?: number; height?: number } | null): number | null {
  if (!capture?.width || !capture.height) return null;
  if (capture.width <= 0 || capture.height <= 0) return null;
  return capture.height / capture.width;
}
