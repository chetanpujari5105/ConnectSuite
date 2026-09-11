/**
 * The phone's picture inside the Mac's box: one aspect ratio, one mapping, one place.
 *
 * ### Why this file exists
 *
 * The Mirror pane asserted a **9:19.5 phone** in three places — the stage's `aspect-ratio` in
 * `styles.css`, `RATIO` in `shared/floatGeometry.ts`, and a sentence inside `pointAt`'s doc comment
 * saying *"there is no letterboxing inside the element to account for"*. The first two draw black
 * bars on any phone that is not 9:19.5. **The third one moves your finger**, and that is the half
 * that made this urgent rather than cosmetic: `pointAt` divided by the canvas *element*, so once
 * `object-fit: contain` put a letterbox inside that element, every coordinate was scaled and
 * offset by the size of the bars.
 *
 * Measured on hardware-shaped numbers before the fix, in a 266 × 569.4 element:
 *
 * | stream | picture | bars | worst-case error |
 * |---|---|---|---|
 * | 1080×2408 (SM-S938B — **already not 19.5:9**) | 255.4 × 569.4 | 5.3px a side | ~21 phone px |
 * | 720×1600 (moto g34 / g45, exactly 9:20) | 256.2 × 569.4 | 4.9px a side | ~20 capture px |
 * | 2340×1080 (**any phone turned sideways**) | 266 × 122.8 | 223px top and bottom | **424 px** |
 *
 * The last row is the one to keep in mind: the picture was 22% of the box's height, and to tap the
 * top of the phone you had to click in the black bar *above* the picture.
 *
 * ### The rule this file encodes
 *
 * **The phone's announced capture geometry is the only source of the ratio.** It arrives on
 * `mirror.state` at `running` and again on every `mirror.rotate` (`width`, `height`, `dpi`,
 * `rotation`, `geometryId`), so the Mac has never had to guess and never had to infer it from a
 * decoded frame. What was missing was any code that used it for **layout** — `this.capture` fed the
 * HUD and the coordinate mapper, and nothing else.
 *
 * ### Why it is a file rather than two methods
 *
 * `docs/design-departures.md` M13 names the shared input seam as the thing the float window's
 * pointer input is waiting on, and this is its first half. A second copy of the mapping is the copy
 * that does not get the next fix — which for input means a stroke landing on the wrong app on
 * somebody's real phone, which is what defect 20 already cost.
 *
 * Plain script, not a module: the CSP-locked page has no module loader, so these are top-level
 * declarations that `mirror.js` simply has in scope. `module.exports` at the foot is what
 * `node --test` reaches. Same shape as `h264Canvas.ts` and `notifyLabels.ts` — and note the rule
 * defect 94 established, that a `function` declaration is hoisted onto the page's global scope and
 * a `class` is not, which is why everything here is a function.
 */

interface CaptureSize {
  width: number;
  height: number;
}

interface ElementBox {
  width: number;
  height: number;
}

/**
 * The picture's rectangle inside an element, under `object-fit: contain`.
 *
 * Element-local: `left`/`top` are offsets from the element's own top-left, so a caller adds the
 * element's `getBoundingClientRect()` origin to reach client coordinates. `scale` is capture pixels
 * to CSS pixels, and it is the number everything else here is a rearrangement of.
 */
interface PictureRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

/**
 * The stage's aspect ratio for a capture geometry: **width over height**, the order `aspect-ratio`
 * takes.
 *
 * Returns null rather than a default when the geometry is not usable. A default here would be the
 * 9:19.5 assumption coming back through the side door — and it would come back *silently*, which is
 * how it survived a phase in the first place. A caller with no geometry has to say so; the CSS
 * carries the portrait fallback in a `var()` so the empty stage still looks like a phone.
 */
function captureAspect(capture: CaptureSize | null | undefined): number | null {
  if (!capture) return null;
  const { width, height } = capture;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return width / height;
}

/**
 * Where the picture actually is inside the element.
 *
 * This is `object-fit: contain` written out: scale to whichever axis runs out first, centre the
 * remainder. It agrees with the browser by construction rather than by hope, which matters because
 * the two have to agree *exactly* — the browser decides where the pixels are drawn and this decides
 * where a click lands on them, and a disagreement is a tap on the wrong thing rather than a visible
 * fault.
 *
 * Once the stage takes its ratio from the same geometry, `left` and `top` are zero to within a
 * rounding pixel. They are still computed rather than assumed: the assumption that they were zero
 * *is* the defect this file is named for, and an expression that happens to evaluate to zero costs
 * nothing while an assumption that happens to be true costs a phase.
 */
function containedPicture(element: ElementBox, capture: CaptureSize): PictureRect {
  const scale = Math.min(element.width / capture.width, element.height / capture.height);
  const width = capture.width * scale;
  const height = capture.height * scale;
  return {
    left: (element.width - width) / 2,
    top: (element.height - height) / 2,
    width,
    height,
    scale,
  };
}

/**
 * A client-space point, in capture-frame pixels.
 *
 * `outsideBy` is the distance in CSS pixels from the picture's edge, zero when the point is on the
 * picture. It exists so the mapping's own assumption is **readable** rather than assumed: with the
 * stage sized from the same geometry it is always 0 or a rounding fraction, and a caller that ever
 * sees a large one is looking at a stage that has stopped agreeing with the stream.
 *
 * The returned x and y are **clamped into the capture frame**. A click a third of a pixel past the
 * edge is a click on the edge and must not become a coordinate the phone rejects; a click a hundred
 * pixels past it cannot happen while the box is right, and `outsideBy` is what would say so.
 */
function pointInCapture(
  client: { x: number; y: number },
  elementRect: { left: number; top: number; width: number; height: number },
  capture: CaptureSize,
): { x: number; y: number; outsideBy: number } {
  const picture = containedPicture(elementRect, capture);
  const offsetX = client.x - (elementRect.left + picture.left);
  const offsetY = client.y - (elementRect.top + picture.top);

  const outsideBy = Math.max(
    0,
    -offsetX,
    offsetX - picture.width,
    -offsetY,
    offsetY - picture.height,
  );

  return {
    x: clampTo(offsetX / picture.scale, capture.width),
    y: clampTo(offsetY / picture.scale, capture.height),
    outsideBy,
  };
}

/** Held inside `[0, extent]`. Named rather than inlined twice, which is how the two drift. */
function clampTo(value: number, extent: number): number {
  return Math.min(extent, Math.max(0, value));
}

// Reachable from mirror.ts (plain scripts, one global scope) and from `node --test` (the shim).
// `typeof` on an undeclared identifier is safe in JS, so this is a no-op in the browser and does
// not turn the file into a CommonJS module — which would break the no-module-loader page (defect 94).
if (typeof module !== 'undefined') {
  module.exports = { captureAspect, containedPicture, pointInCapture };
}
