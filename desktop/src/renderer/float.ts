/**
 * The detached mirror window's renderer. Handoff §3.
 *
 * A title bar and a phone screen. It decodes the same access units the embedded preview does —
 * `main.ts` broadcasts them to every window — and paints them on its own canvas. It never starts,
 * stops or reconfigures the session: *"Opening or closing the detached window never starts, stops,
 * or duplicates the mirroring session."* The one message it sends about the stream is
 * `mirror.keyframe`, which asks for an IDR and changes nothing about what is being captured.
 *
 * ### Why the window's geometry is not computed here
 *
 * Every gesture in this file ends in an IPC call carrying a *pointer position*, and the main process
 * turns that into a window through `shared/floatGeometry.ts`. Nothing here knows the ratio, the
 * title height, the margins or the work area. That is the point of the isolation the README asks
 * for: the clamp cannot be forgotten by a gesture, because no gesture is in a position to do the
 * arithmetic in the first place.
 *
 * ### What this window deliberately does not do
 *
 * **The canvas takes taps and swipes as of 2026-09-14, through the shared seam and not a copy.**
 * It was held back because pointer input has to quote the geometry stamp the frame was captured
 * against and cancel an in-flight drag when the phone turns — defects 20 and 19, both of which cost
 * real damage on a real phone — and retyping those here would have been the copy that does not get
 * the next fix. `renderer/pointerGestures.ts` now holds that state machine and `MirrorView` was
 * refactored onto it in the same change, so there is one copy and both windows call it.
 *
 * **`mirror-rotate` had to be fixed first, and it was one word.** `main.ts` sent it with `send`
 * rather than `sendAll`, so this window never learned the phone had turned: it would have stamped
 * every gesture with the pre-rotation `geometryId` and would not have cancelled a drag across a
 * turn. Defects 19 and 20 reintroduced in the second window, by omission. Row **M13** in
 * `docs/design-departures.md`.
 */

interface FloatBridge {
  onVideoFrame(callback: (frame: FloatFrame) => void): void;
  onMirrorStopped(callback: (info: { reason?: string }) => void): void;
  onMirrorState(callback: (state: FloatMirrorState) => void): void;
  /** The phone turned. Reaches this window only because main.ts now uses `sendAll`. */
  onMirrorRotate(callback: (r: { width?: number; height?: number; rotation?: number; geometryId?: number }) => void): void;
  inputTap(p: { x: number; y: number; durationMs: number; geom: { id: number; width: number; height: number } }): Promise<unknown>;
  inputSwipe(s: {
    points: { x: number; y: number }[];
    durationMs: number;
    geom: { id: number; width: number; height: number };
  }): Promise<unknown>;
  onStatus(callback: (status: FloatStatus | null) => void): void;
  onFloatChanged(callback: (state: { focused: boolean; pinned: boolean }) => void): void;
  mirrorKeyframe(reason?: string): Promise<unknown>;
  streamStart(): Promise<{
    config: { ptsUs: number; bytes: number } | null;
    sessionRunning: boolean;
    /** The shape the phone is capturing, retained by main. Defect 116 — see `askForTheStream`. */
    capture: { width: number; height: number; geometryId: number } | null;
  }>;
  debugSwitches(): Promise<{ delayFloatListeners: boolean }>;
  /** One line into the Mac's own log file. See preload.ts — the float had no durable voice before. */
  logLine(where: string, line: string): void;
  mirrorCapture(dataUrl: string): Promise<{ ok?: boolean; path?: string; reason?: string }>;
  inputGlobal(action: string): Promise<{ ok?: boolean; reason?: string }>;
  /** Scroll, same message and same coalescing rule the Mirror pane uses. Defects 111 and 112. */
  inputScroll(s: {
    x: number; y: number; dx: number; dy: number;
    geom: { id: number; width: number; height: number };
  }): Promise<{ ok?: boolean; reason?: string }>;
  /** Bring the main window forward without closing this one. Defect 117. */
  showMainWindow(): Promise<{ floatStillOpen?: boolean }>;
  floatClose(): void;
  floatMinimize(): void;
  floatSmartFit(): void;
  floatMove(pointer: { x: number; y: number }, grab: { x: number; y: number }): void;
  floatResize(pointer: { x: number }): void;
  floatSetPinned(pinned: boolean): void;
  floatState(): Promise<{ focused: boolean; pinned: boolean }>;
}

interface FloatFrame {
  keyframe: boolean;
  config?: boolean;
  ptsUs: number;
  data: Uint8Array;
}

interface FloatMirrorState {
  state?: string;
  message?: string;
  width?: number;
  height?: number;
  geometryId?: number;
}

interface FloatStatus {
  phase?: string;
  deviceName?: string;
  capabilities?: string[];
}

/**
 * The preload bridge.
 *
 * Read off the global rather than `declare`d, because every renderer file is one TypeScript program
 * as well as one runtime global scope: `renderer.ts` already declares `connect` with the main
 * window's much larger bridge type, and a second `declare const connect` here is a redeclaration
 * error even though the two pages never load together. Naming it locally also keeps this window's
 * surface honest — the type below is exactly what the float window is allowed to reach for.
 */
/*
 * The float window stamps the same attribute from the same push. It is a second `BrowserWindow`
 * loading the same `tokens.css`, so without this it would sit in the default (dark) theme beside a
 * light main window — the two-views-of-one-session pair disagreeing about the theme.
 */
connect.onAppearance?.((state) => {
  document.documentElement.setAttribute('data-theme', state.theme);
});
void (async () => {
  const result = await connect.appearanceGet?.();
  if (result?.ok) document.documentElement.setAttribute('data-theme', result.data.theme);
})();

const floatBridge = (globalThis as unknown as { connect: FloatBridge }).connect;

const frame = document.getElementById('float-frame') as HTMLElement;
const overlay = document.getElementById('float-overlay') as HTMLElement;
const reasonLine = document.getElementById('float-reason') as HTMLElement;
const canvas = document.getElementById('float-canvas') as HTMLCanvasElement;
const deviceName = document.getElementById('float-device-name') as HTMLElement;
const pin = document.getElementById('float-pin') as HTMLButtonElement;
const toast = document.getElementById('float-toast') as HTMLElement;
const bar = document.getElementById('float-bar') as HTMLElement;
const tip = document.getElementById('float-tip') as HTMLElement;

/**
 * Whether the phone has advertised `input`.
 *
 * The dock's three global actions are disabled without it rather than hidden. Hiding would make the
 * buttons appear and disappear as the accessibility service is toggled, which reads as the window
 * breaking; disabled with a sentence on press is the "unavailable, here is why" rule.
 */
let inputAdvertised = false;

/**
 * The scroll pump, the same class the Mirror pane uses. Defects 111 and 112.
 *
 * The float had **no scroll at all** before this — a mirror you cannot scroll is most of a mirror you
 * cannot use — and it gets the backpressure version rather than the fixed 60 ms window that shipped
 * in the main window, because there was never a reason to build the bug twice.
 */
const wheel = new WheelPump();

let toastTimer: number | null = null;

/*
 * The float's own two counters. Not `KeyframeTrace` — that is a main-process module and counts the
 * request/ack side. These count what *this window* asked for and what reached *its* decoder, which
 * is a different vantage point and the one the overlay needs. Both feed the same rule function, so
 * the two windows cannot describe the same state differently.
 */
let keyframesRequested = 0;
let keyframesAnswered = 0;

/** One line into the Mac's log file. The float had no durable voice at all before this. */
function trace(line: string): void {
  floatBridge.logLine('float', line);
}

const decoder = new H264Canvas(canvas, {
  requestKeyframe: () => {
    keyframesRequested += 1;
    trace(`asking the phone for a keyframe (${keyframesRequested} asked / ${keyframesAnswered} answered)`);
    // The failure reaches the log with its text intact. `.catch(() => undefined)` here was the
    // `getOrNull` shape on the one request whose entire purpose is to produce a frame — and it is
    // half of why no evidence exists that a single `mirror.keyframe` has ever produced an IDR.
    void floatBridge
      .mirrorKeyframe('float decoder armed, no reference frame yet')
      .catch((error: unknown) => trace(`keyframe request failed: ${String(error)}`));
    refreshOverlay();
  },
  onPainted: () => {
    hideOverlay();
  },
  onFailed: (reason) => showOverlay(capitalise(reason) + '.'),
  onTrace: (line) => {
    trace(line);
    if (line.startsWith('keyframe reached the decoder')) keyframesAnswered += 1;
    refreshOverlay();
  },
});

/**
 * Draw whichever of the states is true, rather than one sentence for all of them.
 *
 * The old copy said *"Waiting for the phone's next keyframe…"* whatever was wrong — including the
 * one case where no keyframe can arrive at all, because the code that would ask for it sits below a
 * return that fires first. See `renderer/floatWait.ts`.
 */
function refreshOverlay(): void {
  const s = decoder.state();
  const wait = floatWaitState({
    hasDecoder: s.hasDecoder,
    decoding: s.decoding,
    requested: keyframesRequested,
    answered: keyframesAnswered,
  });
  if (wait.kind === 'running') {
    hideOverlay();
    return;
  }
  showOverlay(wait.detail ? `${wait.sentence} ${wait.detail}` : wait.sentence);
}

function showOverlay(reason: string): void {
  reasonLine.textContent = reason;
  overlay.hidden = false;
}

function hideOverlay(): void {
  overlay.hidden = true;
}

/**
 * A line that appears while frames are flowing.
 *
 * Not the overlay, and the distinction is defect 23: the overlay means "there is no picture, here
 * is why" and any painted frame takes it down, so a refusal put there at 60fps is gone before it
 * can be read. Everything that happens *during* a live picture — a saved screenshot, a refused
 * global action — lands here instead.
 */
function say(message: string): void {
  toast.textContent = message;
  toast.classList.add('shown');
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('shown'), 2400);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---- Frames -------------------------------------------------------------------------------------

floatBridge.onVideoFrame((one) => {
  decoder.push(one);
  refreshOverlay();
});

floatBridge.onMirrorStopped((info) => {
  decoder.teardown();
  showOverlay(info.reason ?? 'Mirroring stopped.');
});

floatBridge.onMirrorState((state) => {
  // Defect 116. `mirror.state` carries the capture geometry and this window was throwing it away,
  // reading only the message — so the shape was learned from `mirror.rotate` alone, which arrives when
  // the phone turns and at no other time. A float opened into a running session therefore held no
  // geometry until the user physically rotated their phone, and every press answered "the phone has
  // not said what shape its screen is yet" about a shape the main window had known all along.
  noteCapture(state);
  // Only the states that mean "there is no picture" reach the overlay. `running` says nothing about
  // whether a frame has been painted yet, so it is left alone — the decoder's first paint is what
  // takes the overlay down, and it is the only thing that actually knows.
  if (state.state && state.state !== 'running' && state.message) showOverlay(state.message);
});

floatBridge.onStatus((status) => {
  const connected = status?.phase === 'connected';
  frame.classList.toggle('offline', !connected);
  deviceName.textContent = status?.deviceName ?? 'Phone';
  inputAdvertised = status?.capabilities?.includes('input') ?? false;
  // Only the controls that need the phone. A screenshot is a canvas readback on this Mac and
  // revealing a window is this Mac's own business; greying those out with the accessibility service
  // off would be refusing two things that work.
  for (const item of FLOAT_RAIL.filter((i) => i.needsInput)) {
    const button = document.getElementById(`float-bar-${item.id}`) as HTMLButtonElement | null;
    if (button) button.disabled = !inputAdvertised;
  }
  if (!connected) {
    decoder.teardown();
    showOverlay('The link to the phone dropped, so there is nothing to show.');
  }
});

// ---- Window chrome ------------------------------------------------------------------------------

/* ---- pointer input, on the seam MirrorView uses -------------------------------------------------
 *
 * Everything safety-critical here is borrowed, not rewritten: `pointInCapture` maps against the
 * *picture* rather than the element (defect 99), and `GestureRecogniser` owns the drag, the
 * cancellation on rotation (defect 19) and the geometry stamp the phone checks (defect 20).
 * This file contributes the DOM and nothing else, which is the whole reason it took until now.
 */

/** The capture geometry the phone last announced. Null until it says. */
let capture: { width: number; height: number; geometryId: number } | null = null;
const gesture = new GestureRecogniser();

floatBridge.onMirrorRotate((r) => {
  noteCapture(r);
  // A press in flight was aimed at a screen shape that no longer exists. Cancelled, and the release
  // says so rather than vanishing — which is the half of defect 19 that was the actual defect.
  gesture.cancelForTurn();
  // And the scroll that was owed was summed against the old screen. It has no press to explain itself
  // at, so it goes rather than being aimed at a list that may not be there.
  wheel.reset();
});

/**
 * Record the shape of the phone's screen, from whichever of the three sources said it. Defect 116.
 *
 * Three now, where there was one: `mirror.rotate` (the phone turned), `mirror.state` (the phone is
 * capturing, and this was being ignored), and the answer to `stream-start` (the retained value, for a
 * window that opened into a session already running and will be told nothing again).
 *
 * One function so the field has one writer. Two of those three arrive on channels this file already
 * listened to, which is the part worth noticing: the data was here and nothing read it.
 */
function noteCapture(g: { width?: number; height?: number; geometryId?: number } | null): boolean {
  if (!g || typeof g.width !== 'number' || typeof g.height !== 'number' || typeof g.geometryId !== 'number') {
    return false;
  }
  capture = { width: g.width, height: g.height, geometryId: g.geometryId };
  return true;
}

/** Map a pointer event into capture pixels, or null when the shape is not known yet. */
function pointAt(event: PointerEvent): { x: number; y: number; geom: { id: number; width: number; height: number } } | null {
  if (!capture) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const mapped = pointInCapture(
    { x: event.clientX, y: event.clientY },
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    { width: capture.width, height: capture.height },
  );
  return { x: mapped.x, y: mapped.y, geom: { id: capture.geometryId, width: capture.width, height: capture.height } };
}

canvas.addEventListener('pointerdown', (event) => {
  if (!inputAdvertised) {
    say('The phone is not accepting input — turn Accessibility on for ConnectSuite.');
    return;
  }
  if (gesture.down(pointAt(event)) === 'no-geometry') {
    say('The phone has not said what shape its screen is yet, so that was not sent.');
    return;
  }
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => gesture.move(pointAt(event)));

/**
 * Scroll. Defects 111 and 112, and the float had none of this at all until now.
 *
 * `{ passive: false }` because `preventDefault` has to work: without it the page itself scrolls, and
 * a 100vh frameless window scrolling by a pixel is a picture that jumps.
 */
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    if (!inputAdvertised) {
      say('The phone is not accepting input — turn Accessibility on for ConnectSuite.');
      return;
    }
    const point = pointAt(event as unknown as PointerEvent);
    if (!point) {
      say('The phone has not said what shape its screen is yet, so that was not sent.');
      return;
    }
    // Signs carry through unchanged: dx/dy are how far the *content* should move and so is a wheel
    // notch. WHEEL_SCALE is the Mirror pane's 0.8 — kept in step by being the same number here rather
    // than a second constant, and there is a test asserting the two agree.
    wheel.add({ x: point.x, y: point.y, dx: -event.deltaX * 0.8, dy: -event.deltaY * 0.8 });
    void pumpWheel();
  },
  { passive: false },
);

/** One scroll in flight at a time; see `wheelPump.ts` for the two rates that made this necessary. */
async function pumpWheel(): Promise<void> {
  if (!capture) return;
  const next = wheel.due();
  if (!next) return;
  const geom = { id: capture.geometryId, width: capture.width, height: capture.height };
  try {
    const result = await floatBridge
      .inputScroll({ x: next.x, y: next.y, dx: next.dx, dy: next.dy, geom })
      .catch((error: unknown) => ({ ok: false, reason: String(error) }));
    if (!result.ok) say(capitalise(result.reason ?? 'that scroll was refused') + '.');
  } finally {
    // In the `finally`: a refused scroll releases the phone exactly as a delivered one does, and
    // releasing only on success would stall the pump on the first refusal.
    wheel.settled();
  }
  if (wheel.owing) void pumpWheel();
}
canvas.addEventListener('pointercancel', () => void gesture.up(null));

canvas.addEventListener('pointerup', (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const result = gesture.up(pointAt(event));
  if (result.kind === 'none') {
    // `never-started` already had its sentence at pointerdown; the other two get one here. A press
    // that produces neither a gesture nor a sentence is the silent no-op defect 19 was.
    if (result.reason === 'cancelled-by-turn') {
      say('The phone turned while you were pressing, so that was not sent.');
    } else if (result.reason === 'geometry-gone') {
      say('The mirror stopped while you were pressing, so that was not sent.');
    }
    return;
  }
  if (result.kind === 'tap') {
    void floatBridge
      .inputTap({ x: result.x, y: result.y, durationMs: result.durationMs, geom: result.geom })
      .catch((error: unknown) => trace(`input.tap failed: ${String(error)}`));
    return;
  }
  void floatBridge
    .inputSwipe({ points: result.points, durationMs: result.durationMs, geom: result.geom })
    .catch((error: unknown) => trace(`input.swipe failed: ${String(error)}`));
});

floatBridge.onFloatChanged((state) => {
  frame.classList.toggle('focused', state.focused);
  pin.setAttribute('aria-pressed', String(state.pinned));
});

/*
 * **Every listener above is now registered, so the stream may be asked for.** This ordering is the
 * whole contract: the ask is emitted by the only participant that knows the handlers exist, and it
 * happens *after* them in the same synchronous run, so there is nothing to race.
 *
 * `delayFloatListeners` delays this ask to widen the window the old push used to lose in. Under the
 * old code that window was fatal — the config arrived, found no handler, and nothing asked again.
 * Under the contract the delay is harmless: main is not pushing anything, and the ask arrives
 * whenever it arrives. That difference is the proof, and it is why the switch stays after the fix.
 */
void floatBridge
  .debugSwitches()
  .catch(() => ({ delayFloatListeners: false }))
  .then((switches) => {
    const delayMs = switches.delayFloatListeners ? 3_000 : 0;
    if (delayMs > 0) {
      trace(`delayFloatListeners is ON — holding the stream-start ask for ${delayMs}ms on purpose`);
    }
    if (delayMs === 0) return askForTheStream('listeners registered');
    return new Promise<void>((resolve) => {
      window.setTimeout(() => void askForTheStream('listeners registered (delayed)').then(resolve), delayMs);
    });
  });

document.getElementById('float-close')!.addEventListener('click', () => floatBridge.floatClose());
document.getElementById('float-minimize')!.addEventListener('click', () => floatBridge.floatMinimize());
// Green light and a double-click on the bar are the same gesture, per the handoff, so they are the
// same call rather than two paths that could drift into two different "default" sizes.
document.getElementById('float-smart-fit')!.addEventListener('click', () => floatBridge.floatSmartFit());

pin.addEventListener('click', () => {
  floatBridge.floatSetPinned(pin.getAttribute('aria-pressed') !== 'true');
});

// ---- Drag ---------------------------------------------------------------------------------------

/**
 * Title-bar drag.
 *
 * `screenX`/`screenY` are screen coordinates, which is what the main process needs — the window is
 * moving underneath, so anything measured relative to the window would chase itself. The grab offset
 * is captured once at mousedown and held for the whole gesture; recomputing it per move is what
 * makes a window snap its corner to the pointer.
 *
 * Pointer capture rather than a document-level listener: it keeps the moves coming when the cursor
 * outruns the window, and it guarantees the `pointerup` that ends the gesture, which a listener on
 * a moving element does not.
 */
const title = document.getElementById('float-title') as HTMLElement;
let grab: { x: number; y: number } | null = null;

title.addEventListener('pointerdown', (event) => {
  // Only a plain press on the bar itself. A press that started on a light or the pin is that
  // control's, and dragging from it would move the window instead of pressing it.
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
  grab = { x: event.screenX - window.screenX, y: event.screenY - window.screenY };
  frame.classList.add('dragging');
  title.setPointerCapture(event.pointerId);
});

title.addEventListener('pointermove', (event) => {
  if (!grab) return;
  floatBridge.floatMove({ x: event.screenX, y: event.screenY }, grab);
});

for (const end of ['pointerup', 'pointercancel'] as const) {
  title.addEventListener(end, () => {
    grab = null;
    frame.classList.remove('dragging');
  });
}

title.addEventListener('dblclick', (event) => {
  if ((event.target as HTMLElement).closest('button')) return;
  floatBridge.floatSmartFit();
});

// ---- Corner resize ------------------------------------------------------------------------------

/**
 * Only the pointer's X is sent. The main process turns it into a width, and the width into a height
 * and a Y — see `boundsForCornerDrag`. Sending Y as well would be offering the main process a chance
 * to honour it, and a height that did not come from the width is the one way out of the ratio lock.
 */
const handle = document.getElementById('float-resize') as HTMLElement;
let resizing = false;

handle.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  resizing = true;
  frame.classList.add('dragging');
  handle.setPointerCapture(event.pointerId);
});

handle.addEventListener('pointermove', (event) => {
  if (!resizing) return;
  floatBridge.floatResize({ x: event.screenX });
});

for (const end of ['pointerup', 'pointercancel'] as const) {
  handle.addEventListener(end, () => {
    resizing = false;
    frame.classList.remove('dragging');
  });
}

// ---- Hover dock ---------------------------------------------------------------------------------

/**
 * The control strip, built from `FLOAT_RAIL`. Defect 115.
 *
 * Built rather than written into the HTML so the icon names are inside the enumeration
 * `floatRail.test.ts` asserts over — an icon name that is not in an enumeration is an icon nobody can
 * check, and this project has already shipped two buttons that drew as empty rings.
 *
 * `aria-label` and `title` are the same string from the same field, because a control whose accessible
 * name differs from its tooltip is defect 26 and the cheapest fix is for neither to be typed twice.
 */
const groupStart = floatRailGroupStart();
for (const [index, item] of FLOAT_RAIL.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  // The controls that act on this Mac rather than on the phone are grouped behind a hairline, and
  // the boundary is named by the table — not by `:first-of-type`, which matched nothing at all.
  const classes = ['bar-button'];
  if (item.kind !== 'global') classes.push('bar-mac');
  if (index === groupStart) classes.push('bar-group-start');
  button.className = classes.join(' ');
  button.id = `float-bar-${item.id}`;
  button.dataset.bar = item.id;
  /*
   * The accessible name stays the **full** sentence — the reveal control's whole promise, which
   * `floatRail.test.ts` asserts contains "without closing this one" (defect 117). The visible
   * tooltip is the short form. Both come from the same row of the same table.
   *
   * There is deliberately **no `title` attribute**. It is the app's pattern everywhere else (11
   * uses) and it is the right one there, but it never fires on keyboard focus and its delay is the
   * OS's, not ours. Setting it *as well* would draw two tooltips on hover, which is the one thing
   * worse than either. See `showTip`.
   */
  button.setAttribute('aria-label', item.label);
  button.appendChild(iconSvg(item.icon, 16));
  button.addEventListener('click', () => {
    hideTip();
    void onRailPress(item);
  });
  attachTip(button, floatRailTooltip(item));
  bar.appendChild(button);
}

/* ---- The tooltip -------------------------------------------------------------------------------
 *
 * ### Why this is not the `title` attribute
 *
 * `title` is what the rest of this app uses and it was what these buttons used. It fails one thing
 * the owner asked for outright: **it does not appear on keyboard focus**, ever, on any platform. A
 * control reachable by Tab whose only affordance is a mouse-only tooltip is a control a keyboard
 * user meets unlabelled, and the `:focus-within` reveal this window already has for exactly that
 * reason (defect 115) would be half a fix.
 *
 * So this draws its own, and takes on the two things `title` was doing for free:
 *
 *  - **Delay.** 450 ms on hover, which is inside the 400-600 ms the owner named, and **zero on
 *    keyboard focus** — a person who has tabbed to a control has already committed to it, and a
 *    delay there is just a label that arrives late.
 *  - **Dismissal.** Pointer-leave, blur, click, and Escape. Click matters most: without it the
 *    tooltip survives the press that made the window change underneath it.
 *
 * ### Where it is allowed to be
 *
 * Above the button, which is over the bottom edge of the picture. A 40 px bar cannot contain it and
 * below the bar is outside the window, so there is no third direction; saying so beats claiming a
 * clearance that does not exist. `pointer-events: none` is what makes that harmless — it cannot
 * block the control it describes, and it cannot swallow a tap meant for the phone, which is exactly
 * the silent dead zone the old hover pill created.
 */

/** How long the pointer must rest before a tooltip appears. Standard OS range; 0 for the keyboard. */
const TIP_DELAY_MS = 450;

let tipTimer: number | null = null;

function attachTip(button: HTMLElement, text: string): void {
  button.addEventListener('pointerenter', () => scheduleTip(button, text, TIP_DELAY_MS));
  button.addEventListener('pointerleave', hideTip);
  // `focusin`/`focusout` rather than focus/blur: they bubble, and a button focused by Tab should be
  // named immediately rather than after a delay it did not earn.
  button.addEventListener('focusin', () => scheduleTip(button, text, 0));
  button.addEventListener('focusout', hideTip);
}

function scheduleTip(button: HTMLElement, text: string, delayMs: number): void {
  if (tipTimer !== null) clearTimeout(tipTimer);
  const show = () => {
    tipTimer = null;
    // Re-read the rect at show time, not at schedule time: the window can be dragged or resized
    // during the delay, and a tooltip placed against where the button was is worse than none.
    tip.textContent = text;
    tip.hidden = false;
    const r = button.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    // Centred on the button, then held inside the window — a tooltip clipped by the window edge is
    // a label the user cannot read, and the end buttons are the ones most likely to hit it.
    const left = Math.min(
      Math.max(4, r.left + r.width / 2 - t.width / 2),
      Math.max(4, window.innerWidth - t.width - 4),
    );
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(r.top - t.height - 6)}px`;
  };
  if (delayMs === 0) show();
  else tipTimer = window.setTimeout(show, delayMs);
}

function hideTip(): void {
  if (tipTimer !== null) clearTimeout(tipTimer);
  tipTimer = null;
  tip.hidden = true;
}

// Escape closes it too, and a window that loses focus should not leave one painted on screen.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideTip();
});
window.addEventListener('blur', hideTip);


async function onRailPress(item: (typeof FLOAT_RAIL)[number]): Promise<void> {
  if (item.kind === 'reveal') {
    // Reported as it happened, not as intended. The one fear this control has to answer is that it
    // costs the floating window, so the answer comes from the main process's own reading of whether
    // the float is still open rather than from this window assuming it survived.
    const result = await floatBridge
      .showMainWindow()
      .catch(() => ({ floatStillOpen: undefined }));
    say(
      result.floatStillOpen === false
        ? 'The Sidekick window is in front — and this window closed, which it should not have.'
        : 'The Sidekick window is in front. This window stayed open.',
    );
    return;
  }
  if (item.kind === 'shot') {
    await saveScreenshot();
    return;
  }
  if (!inputAdvertised) {
    // The disabled state already stops this, so reaching here means something else did — and a press
    // that produces neither an action nor a sentence is the silent no-op class defect 18 is about.
    say('Controlling the phone needs ConnectSuite Input turned on under Accessibility.');
    return;
  }
  const result = await floatBridge
    .inputGlobal(item.action!)
    .catch(() => ({ ok: false, reason: 'the Mac could not reach the phone' }));
  if (!result.ok) say(capitalise(result.reason ?? `${item.action} was refused by the phone`) + '.');
}

/**
 * Screenshot. A canvas readback on this Mac — no protocol message, no phone round trip.
 *
 * The main process answers with **the path the file actually landed at** rather than this window
 * asserting "saved to Desktop" without knowing. That is the same shape as the Mirror pane's Capture,
 * and it is why the toast quotes a path instead of a place.
 */
async function saveScreenshot(): Promise<void> {
  if (decoder.framesPainted() === 0) {
    say('There is no picture to save yet.');
    return;
  }
  const result = await floatBridge
    .mirrorCapture(canvas.toDataURL('image/png'))
    .catch(() => ({ ok: false, path: undefined, reason: 'the Mac could not write the file' }));
  say(result.ok && result.path ? `Screenshot saved to ${result.path}` : capitalise(result.reason ?? 'the screenshot could not be saved') + '.');
}

// ---- First paint --------------------------------------------------------------------------------

// The window opens into a stream that is already running, so there is nothing to show until the
// phone answers the keyframe request main.ts makes on open. Saying so beats an empty black frame
// that is indistinguishable from a dead window.
refreshOverlay();

/**
 * **The start contract, asking half.** Defect 105.
 *
 * `main.ts` used to push the retained parameter sets when this window finished loading, which says
 * nothing about whether `onVideoFrame` had been registered. The push and the registration raced,
 * both orderings were legal, and the loser got nothing for the life of the session — silently,
 * because `H264Canvas.push` drops every frame above the branch that would ask for more.
 *
 * This call happens **after** the listeners below are installed, which is a fact only this window
 * can know. There is no event to lose.
 *
 * Gated by `StartRequestGate`: one request in flight, a floor between attempts. A window that asked
 * on every dropped frame would ask sixty times a second, which is the storm the obvious fix for
 * defect 105 would have produced.
 */
/*
 * `StartRequestGate` and `actionFor` come from `streamStart.js`, loaded ahead of this file, and
 * `floatWaitState` from `floatWait.js`. No `declare` for any of them: every renderer file is a
 * classic script sharing one global scope, so TypeScript already sees them — and a `declare class`
 * beside the real one is a duplicate identifier, which is how this was found.
 */
const startGate = new StartRequestGate(() => Date.now());

async function askForTheStream(why: string): Promise<void> {
  const verdict = startGate.may();
  if (!verdict.ask) {
    trace(`stream-start not asked (${why}): ${verdict.reason}` +
      (verdict.reason === 'in-flight' ? ` for ${verdict.outstandingForMs}ms` : ` — ${verdict.waitMs}ms to wait`));
    return;
  }
  startGate.sent();
  trace(`stream-start asking (${why}), attempt ${verdict.attempt}`);
  try {
    const answer = await floatBridge.streamStart();
    startGate.settled();
    const action = actionFor(answer);
    // Defect 116. The shape comes back with the parameter sets, for the same reason and through the
    // same door: the session started before this window existed and neither will be announced again.
    const learned = noteCapture(answer.capture);
    trace(
      `stream-start answered: ${answer.config ? `${answer.config.bytes}B of parameter sets` : 'no retained config'}` +
        `, sessionRunning=${answer.sessionRunning}` +
        `, capture=${answer.capture ? `${answer.capture.width}x${answer.capture.height} #${answer.capture.geometryId}${learned ? ' (adopted)' : ''}` : 'not announced yet'}` +
        ` → ${action}`,
    );
    if (action === 'ask-again') {
      // A session is running and nothing has been retained: the keyframe request is what fills that
      // gap, because a config frame precedes the IDR that answers one.
      void floatBridge
        .mirrorKeyframe('float asked for the stream and there was no retained config')
        .catch((error: unknown) => trace(`keyframe request failed: ${String(error)}`));
    }
    refreshOverlay();
  } catch (error) {
    startGate.settled();
    // The reason reaches the log. A swallowed failure here is indistinguishable from an answer of
    // "no config", and those need different responses.
    trace(`stream-start failed: ${String(error)}`);
  }
}

void floatBridge.floatState().then((state) => {
  frame.classList.toggle('focused', state.focused);
  pin.setAttribute('aria-pressed', String(state.pinned));
});
