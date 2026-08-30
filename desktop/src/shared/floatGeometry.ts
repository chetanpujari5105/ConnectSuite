/**
 * The detached mirror window's geometry. Pure arithmetic, no Electron.
 *
 * Transcribed from `design_handoff_connectsuite/README.md` §3, which records it as an invariant
 * learned from a real bug and states the reason plainly: *"Clamping drag alone is not enough —
 * presets and corner-resize escape the desktop without it."*
 *
 * ```
 * TITLE = 34; RATIO = 19.5/9; MARGIN = 8
 * height       = width * RATIO + TITLE
 * maxWidth()   = floor((availableHeight - TITLE - MARGIN*2) / RATIO)
 * clampY(y, w) = clamp(MARGIN, y, max(MARGIN, availableHeight - (w*RATIO + TITLE) - MARGIN))
 * ```
 *
 * Three properties the README is explicit about, and which the tests pin down:
 *
 *  1. **Width is the only input.** Height and Y follow from it. Nothing sets a height directly, so
 *     the 9:19.5 lock cannot be broken by a caller that forgets it.
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
 */

/** The title bar, in points. Part of the window's height and not part of the phone screen. */
export const TITLE = 34;

/** The phone's aspect ratio, height over width. */
export const RATIO = 19.5 / 9;

/** Clearance kept between the window and every edge of the work area. */
export const MARGIN = 8;

/** The narrowest the window may be dragged. */
export const MIN_WIDTH = 220;

/** What a double-click on the title bar, or the green light, smart-fits back to. */
export const DEFAULT_WIDTH = 300;

/**
 * Total window height for a given width — the phone screen plus the title bar.
 *
 * Rounded, because window bounds are integers and an unrounded height accumulates a sub-pixel
 * error across successive resizes until the ratio visibly drifts.
 */
export function heightFor(width: number): number {
  return Math.round(width * RATIO) + TITLE;
}

/**
 * The widest the window may be, given the height actually available.
 *
 * Derived, never a constant. At the design's 920pt this returns 401, which is the README's figure —
 * and that agreement is asserted in the tests, so the transcription can be checked against the
 * document without trusting either.
 *
 * Floored to at least [MIN_WIDTH]: on a display too short to hold even the minimum window, a cap
 * below the floor would make every width invalid and the clamp below would invert.
 */
export function maxWidthFor(availableHeight: number): number {
  const fits = Math.floor((availableHeight - TITLE - MARGIN * 2) / RATIO);
  return Math.max(MIN_WIDTH, fits);
}

/** Width held inside `[MIN_WIDTH, maxWidthFor(availableHeight)]`. */
export function clampWidth(width: number, availableHeight: number): number {
  const max = maxWidthFor(availableHeight);
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(width)));
}

/**
 * Y held on the desktop for a window of this width.
 *
 * The inner `Math.max` is not decoration: when the window is taller than the work area — which
 * happens on a short display, where `clampWidth`'s floor wins over the cap — the upper bound goes
 * negative, and without it this would clamp Y to a value above the top edge. The README writes the
 * same guard for the same reason.
 */
export function clampY(y: number, width: number, availableHeight: number): number {
  const lowest = Math.max(MARGIN, availableHeight - heightFor(width) - MARGIN);
  return Math.min(lowest, Math.max(MARGIN, Math.round(y)));
}

/** X held on the desktop, by the same rule. The ratio does not constrain it; the work area does. */
export function clampX(x: number, width: number, availableWidth: number): number {
  const rightmost = Math.max(MARGIN, availableWidth - width - MARGIN);
  return Math.min(rightmost, Math.max(MARGIN, Math.round(x)));
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkArea {
  width: number;
  height: number;
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
): Bounds {
  const width = clampWidth(requested.width, area.height);
  return {
    width,
    height: heightFor(width),
    x: clampX(requested.x, width, area.width),
    y: clampY(requested.y, width, area.height),
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
 * second door.
 */
export function boundsForDrag(
  pointer: { x: number; y: number },
  grab: { x: number; y: number },
  width: number,
  area: WorkArea,
): Bounds {
  return resolveBounds({ x: pointer.x - grab.x, y: pointer.y - grab.y, width }, area);
}

/**
 * Where a corner drag should leave the window, given the pointer.
 *
 * Width is the pointer's distance from the window's left edge, and that is the *only* thing read —
 * the vertical component of a corner drag is deliberately discarded. Honouring it would let the
 * pointer ask for a height, and a height that did not come from the width is the one way to break
 * the 9:19.5 lock. The README says it in one line: *"width is the only input, height and Y follow"*.
 */
export function boundsForCornerDrag(
  pointer: { x: number },
  origin: { x: number; y: number },
  area: WorkArea,
): Bounds {
  return resolveBounds({ x: origin.x, y: origin.y, width: pointer.x - origin.x }, area);
}
