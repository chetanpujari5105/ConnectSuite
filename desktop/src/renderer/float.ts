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
 * **The canvas takes no taps or swipes in this slice.** Pointer input has to quote the geometry
 * stamp the frame was captured against, and cancel an in-flight drag when the phone turns — defect
 * 19 and defect 20, both of which cost real damage on a real phone and both of which live in
 * `mirror.ts`. Retyping that here would be a second copy of safety-critical code, and the copy that
 * does not get the next fix. The hover dock's Back / Home / Recents are `input.global`
 * (`performGlobalAction`) and carry no coordinates at all, so they need none of it and ship now.
 * The gap is row **M13** in `docs/design-departures.md`, with the seam that would close it named.
 */

interface FloatBridge {
  onVideoFrame(callback: (frame: FloatFrame) => void): void;
  onMirrorStopped(callback: (info: { reason?: string }) => void): void;
  onMirrorState(callback: (state: { state?: string; message?: string }) => void): void;
  onStatus(callback: (status: FloatStatus | null) => void): void;
  onFloatChanged(callback: (state: { focused: boolean; pinned: boolean }) => void): void;
  mirrorKeyframe(reason?: string): Promise<unknown>;
  /** One line into the Mac's own log file. See preload.ts — the float had no durable voice before. */
  logLine(where: string, line: string): void;
  mirrorCapture(dataUrl: string): Promise<{ ok?: boolean; path?: string; reason?: string }>;
  inputGlobal(action: string): Promise<{ ok?: boolean; reason?: string }>;
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
const floatBridge = (globalThis as unknown as { connect: FloatBridge }).connect;

const frame = document.getElementById('float-frame') as HTMLElement;
const overlay = document.getElementById('float-overlay') as HTMLElement;
const reasonLine = document.getElementById('float-reason') as HTMLElement;
const canvas = document.getElementById('float-canvas') as HTMLCanvasElement;
const deviceName = document.getElementById('float-device-name') as HTMLElement;
const pin = document.getElementById('float-pin') as HTMLButtonElement;
const toast = document.getElementById('float-toast') as HTMLElement;
const dock = document.getElementById('float-dock') as HTMLElement;

/**
 * Whether the phone has advertised `input`.
 *
 * The dock's three global actions are disabled without it rather than hidden. Hiding would make the
 * buttons appear and disappear as the accessibility service is toggled, which reads as the window
 * breaking; disabled with a sentence on press is the "unavailable, here is why" rule.
 */
let inputAdvertised = false;

let toastTimer: number | null = null;

/** Provided by floatWait.js, loaded ahead of this file. See defect 94 for why it is not imported. */
declare function floatWaitState(input: {
  hasDecoder: boolean; decoding: boolean; requested: number; answered: number;
}): { kind: string; sentence: string; detail: string | null; blocking: boolean };

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
  for (const button of Array.from(dock.querySelectorAll<HTMLButtonElement>('[data-global]'))) {
    button.disabled = !inputAdvertised;
  }
  if (!connected) {
    decoder.teardown();
    showOverlay('The link to the phone dropped, so there is nothing to show.');
  }
});

// ---- Window chrome ------------------------------------------------------------------------------

floatBridge.onFloatChanged((state) => {
  frame.classList.toggle('focused', state.focused);
  pin.setAttribute('aria-pressed', String(state.pinned));
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

for (const button of Array.from(dock.querySelectorAll<HTMLButtonElement>('[data-global]'))) {
  button.addEventListener('click', async () => {
    const action = button.dataset.global!;
    if (!inputAdvertised) {
      // The disabled state already stops this, so reaching here means something else did — and a
      // press that produces neither an action nor a sentence is the silent no-op class defect 18
      // is about. Say it rather than return.
      say('Controlling the phone needs ConnectSuite Input turned on under Accessibility.');
      return;
    }
    const result = await floatBridge.inputGlobal(action).catch(() => ({ ok: false, reason: 'the Mac could not reach the phone' }));
    if (!result.ok) say(capitalise(result.reason ?? `${action} was refused by the phone`) + '.');
  });
}

/**
 * Screenshot. A canvas readback on this Mac — no protocol message, no phone round trip.
 *
 * The main process answers with **the path the file actually landed at** rather than this window
 * asserting "saved to Desktop" without knowing. That is the same shape as the Mirror pane's Capture,
 * and it is why the toast quotes a path instead of a place.
 */
document.getElementById('float-shot')!.addEventListener('click', async () => {
  if (decoder.framesPainted() === 0) {
    say('There is no picture to save yet.');
    return;
  }
  const result = await connect
    .mirrorCapture(canvas.toDataURL('image/png'))
    .catch(() => ({ ok: false, path: undefined, reason: 'the Mac could not write the file' }));
  say(result.ok && result.path ? `Screenshot saved to ${result.path}` : capitalise(result.reason ?? 'the screenshot could not be saved') + '.');
});

// ---- First paint --------------------------------------------------------------------------------

// The window opens into a stream that is already running, so there is nothing to show until the
// phone answers the keyframe request main.ts makes on open. Saying so beats an empty black frame
// that is indistinguishable from a dead window.
refreshOverlay();
void floatBridge.floatState().then((state) => {
  frame.classList.toggle('focused', state.focused);
  pin.setAttribute('aria-pressed', String(state.pinned));
});
