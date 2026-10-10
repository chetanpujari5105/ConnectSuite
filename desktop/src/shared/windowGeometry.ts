/**
 * The app window's opening size. Pure arithmetic, no Electron.
 *
 * ### Why this exists
 *
 * `createWindow` asked for a fixed `1440 x 920` — the handoff's canvas — on whatever display it
 * happened to open on. Measured on this Mac, 2026-09-05:
 *
 * | Display | Work area | 1440x920 fits |
 * |---|---|---|
 * | built-in, primary | 1512 x 865 | **no — 55px too tall** |
 * | external | 1920 x 1050 | yes |
 *
 * The work area is the screen minus the menu bar (33) and the Dock (84), and it is the only height
 * a window may occupy. The request exceeded it by 55px on the display the app opens on by default,
 * and nothing in this repository noticed, because **AppKit was quietly rescuing it**:
 * `constrainFrameRect:toScreen:` shrinks an oversized window to the visible frame, so the window
 * that appeared was 865 tall and looked deliberate.
 *
 * ### Why relying on that rescue is the bug, even though it works
 *
 * The rescue is not ours and it is applied at *specific moments* — when AppKit sets the frame. The
 * work area, meanwhile, can change **under a window that is already open**, and that path takes no
 * `setFrame` at all: the Dock un-hides, a display is disconnected, Stage Manager or Split View
 * reserves space, the menu bar auto-hide setting changes. A window sized to the old work area is
 * then taller than the new one, with nothing to shrink it.
 *
 * This is the same shape as `floatGeometry`'s own founding bug — *"clamping drag alone is not
 * enough; presets and corner-resize escape the desktop without it"* — and the answer is the same:
 * the size is **derived from the height actually available**, never a constant. The detached mirror
 * window has done this since Phase 2; the main window, which every pane inherits, never did.
 *
 * ### The rule this encodes
 *
 * The design's size is a **maximum**, not a value. On a display that can hold 1440x920 the window is
 * exactly that, and the handoff's grid is drawn as specified. On a display that cannot, every axis
 * that does not fit is reduced to what does, independently — a short display loses height and keeps
 * its width.
 */

/** A rectangle in screen coordinates, matching Electron's `Display.workArea` shape. */
export type Area = { x: number; y: number; width: number; height: number };

/** A window's bounds, matching Electron's `BrowserWindow` bounds shape. */
export type Bounds = { x: number; y: number; width: number; height: number };

/** The handoff's canvas. A ceiling now rather than a fixed size — see the header. */
export const DESIGN = Object.freeze({ width: 1440, height: 920 });

/**
 * Clearance kept between the window and every edge of the work area.
 *
 * It only ever binds on an axis that is **already constrained**: 1440 + 2*12 is still under the
 * 1512 this display offers, so a fitting axis is untouched and the margin costs nothing there. On
 * the axis that does not fit it buys the window a visible gap from the menu bar and the Dock
 * instead of sitting flush against both, and it leaves a little room for the work area to shrink
 * slightly without immediately clipping again.
 */
export const MARGIN = 12;

/**
 * The smallest window whose grids are still honest, from `createWindow`'s own note: under 1100 the
 * Notifications detail column and the Mirror side column fight, and under 700 the dock and the page
 * header collide.
 *
 * These are a floor on *resizing*, and they are deliberately **not** a floor on the opening size —
 * see [minimumsFor]. A minimum that forces a window taller than the screen reintroduces the defect
 * this file exists to remove, one layer down and harder to see.
 */
export const MIN = Object.freeze({ width: 1100, height: 700 });

/** The larger of two numbers, floored at zero, so a pathological work area cannot go negative. */
function atLeastZero(n: number): number {
  return n > 0 ? n : 0;
}

/**
 * The size to open at on a given work area: the design, capped per-axis by what is available.
 *
 * Each axis is capped **independently**. A display that is wide and short reduces the height and
 * keeps the full width, which is what the grid wants — the sidebar is a fixed 233 and the columns
 * beside it are the part that should absorb a narrow screen, not a uniform scale.
 */
export function sizeFor(area: Pick<Area, 'width' | 'height'>, design = DESIGN): { width: number; height: number } {
  return {
    width: Math.min(design.width, atLeastZero(area.width - MARGIN * 2)),
    height: Math.min(design.height, atLeastZero(area.height - MARGIN * 2)),
  };
}

/**
 * The resize minimums, themselves capped by the window we are actually opening at.
 *
 * This is the subtle half, and it is the one that would have survived the obvious fix. Capping the
 * opening size while leaving `minHeight: 700` on a display whose work area is 600 hands Electron a
 * contradiction — a window that must be at least 700 tall on a screen with room for 576 — and the
 * minimum wins. The window is oversized again, by a different route, on exactly the small displays
 * this change is for.
 *
 * So a minimum is a *preference*, applied only where the display can honour it.
 */
export function minimumsFor(size: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.min(MIN.width, size.width),
    height: Math.min(MIN.height, size.height),
  };
}

/**
 * Where to put the window: centred in the work area, and never starting outside it.
 *
 * The clamp is not redundant with the centring. A window wider than the work area — which
 * [sizeFor] does not produce, but a caller passing its own `design` could — centres to a negative
 * offset, and the top-left corner is the one that carries the title bar and the traffic lights. Off
 * the top is unrecoverable by the user; off the bottom is merely ugly.
 */
export function positionFor(area: Area, size: { width: number; height: number }): { x: number; y: number } {
  return {
    x: Math.max(area.x, Math.round(area.x + (area.width - size.width) / 2)),
    y: Math.max(area.y, Math.round(area.y + (area.height - size.height) / 2)),
  };
}

/** The whole decision in one call: the bounds to open at, and the minimums to allow. */
export function fitWindow(area: Area, design = DESIGN): { bounds: Bounds; minimum: { width: number; height: number } } {
  const size = sizeFor(area, design);
  return { bounds: { ...positionFor(area, size), ...size }, minimum: minimumsFor(size) };
}

/**
 * A View → Zoom step, decided before it is applied (2026-10-07).
 *
 * **Why.** Every pane is laid out for a CSS viewport of at least [MIN] — the window's own minimum says so
 * — but zoom divides the CSS viewport by its factor. At 125% the 1100 x 700 minimum window is an 880 x 560
 * page: measured in the isolated renderer harness, Files squeezed its listing column to ~50 px with its
 * toolbar clipped, Calls its centre column to ~78 px, and Clipboard's third filter ran under *Clear all*.
 *
 * **The rule.** A zoom step is taken only if the window's content still holds `MIN x factor` device
 * pixels — i.e. the page stays at least [MIN] in CSS pixels — and the window's minimum becomes that size
 * (never below [minimumsFor]'s) so it cannot be dragged smaller afterwards. Zooming out only grows the CSS
 * viewport and is always allowed. A refused step says why; nothing is resized behind the person's back.
 *
 * Chromium's level→factor is `1.2 ^ level`; levels are clamped to Chromium's own −8…+9 range.
 */
export type ZoomDirection = 'in' | 'out' | 'reset';

export function zoomFactorFor(level: number): number {
  return Math.pow(1.2, level);
}

export function zoomStep(
  current: number,
  direction: ZoomDirection,
  content: { width: number; height: number },
  baseMinimum: { width: number; height: number } = MIN,
): { ok: true; level: number; minimum: { width: number; height: number } } | { ok: false; reason: string } {
  const next = direction === 'reset' ? 0 : Math.max(-8, Math.min(9, current + (direction === 'in' ? 1 : -1)));
  const factor = zoomFactorFor(next);
  const needed = { width: Math.ceil(MIN.width * factor), height: Math.ceil(MIN.height * factor) };
  if (factor > 1 && (content.width < needed.width || content.height < needed.height)) {
    return {
      ok: false,
      reason:
        `zooming to ${Math.round(factor * 100)}% needs a window of at least ${needed.width} x ${needed.height}; ` +
        `this one is ${content.width} x ${content.height}`,
    };
  }
  return {
    ok: true,
    level: next,
    minimum: {
      width: Math.max(baseMinimum.width, factor > 1 ? needed.width : 0),
      height: Math.max(baseMinimum.height, factor > 1 ? needed.height : 0),
    },
  };
}

/**
 * The window after it was moved, or after the displays changed under it (2026-10-10).
 *
 * **Why.** [fitWindow] decides the size once, at open, against the display under the pointer. Nothing
 * re-decided it afterwards, so a 1440 x 920 window opened on the external display (work area
 * 1920 x 1050) and dragged onto the built-in one (1512 x 865) stayed 920 tall in an 865 work area — its
 * bottom, with the dock and the pane footers, under the Dock or off the screen — and the minimum was
 * still the one chosen for the display it left.
 *
 * **The rule — it must never fight the person.**
 *  - A window that **fits** the display it is on, moved **within** that display, is left exactly where
 *    it was put, even partly over an edge: macOS lets a window be parked that way on purpose. Only the
 *    title bar is held below the top of the work area, because a title bar under the menu bar cannot
 *    be grabbed again. A window that has just **arrived** on a display (`contain`) is held inside it.
 *  - A window that **does not fit** (wider or taller than the work area) is shrunk on that axis to the
 *    work area less [MARGIN] each side — never below the minimum unless the display itself is smaller
 *    — and then moved fully inside.
 *  - The minimum is the display's own ([minimumsFor] of [sizeFor]), raised for View → Zoom exactly as
 *    [zoomStep] raises it, and capped by the work area so a zoomed minimum can never force the window
 *    off a smaller display.
 *
 * `bounds: null` means nothing to move.
 */
export function refitWindow(
  current: Bounds,
  area: Area,
  zoomLevel = 0,
  /**
   * True when the window has just arrived on this display, or the display changed under it: then it
   * is held fully inside. A move within one display is the person's own placement and is left alone.
   * Measured 2026-10-10: a drag from the external display re-fitted the window, and the drop then
   * left it 14 px under the Dock on the built-in one — a fit in size, not a fit on the screen.
   */
  contain = false,
): { bounds: Bounds | null; minimum: { width: number; height: number } } {
  const base = minimumsFor(sizeFor(area));
  const factor = zoomFactorFor(zoomLevel);
  const zoomed = factor > 1 ? { width: Math.ceil(MIN.width * factor), height: Math.ceil(MIN.height * factor) } : base;
  const minimum = {
    width: Math.min(Math.max(base.width, zoomed.width), area.width),
    height: Math.min(Math.max(base.height, zoomed.height), area.height),
  };
  const tooWide = current.width > area.width;
  const tooTall = current.height > area.height;
  const width = tooWide ? Math.min(area.width, Math.max(minimum.width, area.width - MARGIN * 2)) : current.width;
  const height = tooTall ? Math.min(area.height, Math.max(minimum.height, area.height - MARGIN * 2)) : current.height;
  let { x, y } = current;
  if (tooWide || tooTall || contain) {
    x = Math.min(Math.max(x, area.x), area.x + area.width - width);
    y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  } else if (y < area.y) {
    y = area.y;
  }
  const changed = x !== current.x || y !== current.y || width !== current.width || height !== current.height;
  return { bounds: changed ? { x, y, width, height } : null, minimum };
}
