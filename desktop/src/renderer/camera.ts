/**
 * The Camera pane: a live preview of the phone's camera — Camera v1, docs/protocol.md → Camera.
 *
 * ### What this pane can and cannot do
 *
 * It **asks**. The button sends `camera.request`, and the phone puts a request on its own screen; the
 * camera opens only when the phone's owner taps Start camera there. So the copy after a click is
 * "waiting for you to allow it on your phone" and never "starting the camera" — the second is a
 * claim this Mac cannot make until the phone says `starting`.
 *
 * It is **not a webcam**. Nothing here makes the picture available to other apps, records it, or
 * carries sound, and the pane's footer says so before anyone clicks.
 *
 * ### The stop policy, which is the brief's "closing the Camera view"
 *
 * Leaving this pane stops whatever it has open — a waiting request or a live stream. A camera nobody
 * is looking at is a camera held open for no one, and the phone's owner should not have to wonder
 * whether a Mac they walked away from is still watching. Coming back shows how it ended and offers to
 * ask again; it never restarts by itself.
 *
 * ### An old frame is never shown as live
 *
 * The main process marks a live stream `stalled` after two seconds without a frame, and the picture
 * is hidden — not dimmed, not captioned — until frames arrive again. Any end clears the canvas.
 *
 * Module-free like every pane: the page loads plain scripts, so the pure halves hang on `globalThis`
 * at the foot and `cameraView.test.ts` runs them rather than a copy.
 */

/** The main process's `CameraPaneState`, as this page receives it over IPC. */
type CamPaneState =
  | { kind: 'idle' }
  | {
      kind: 'requesting';
      facing: 'back' | 'front';
      streamId: string | null;
      expiresAtMs: number | null;
      message: string | null;
      fixHint: string | null;
    }
  | { kind: 'connecting'; streamId: string; facing: 'back' | 'front' }
  | {
      kind: 'live';
      streamId: string;
      facing: 'back' | 'front';
      width: number;
      height: number;
      frameRate: number | null;
      stalled: boolean;
      framesReceived: number;
      notice: string | null;
    }
  | {
      kind: 'ended';
      streamId: string | null;
      reason: string;
      message: string;
      fixHint: string | null;
      framesSent: number | null;
      framesDropped: number | null;
      framesReceived: number;
    }
  | { kind: 'refused'; code: string; message: string; fixHint: string | null }
  | { kind: 'error'; code: string; message: string };

interface CamFrame {
  streamId: string;
  sequence: number;
  facing: string;
  rotation: number;
  mirrored: boolean;
  width: number;
  height: number;
  jpeg: Uint8Array;
}

interface CameraBridge {
  cameraRequest(facing: 'back' | 'front'): Promise<{ ok: boolean; reason?: string }>;
  cameraStop(): Promise<{ ok: boolean; reason?: string }>;
  cameraSwitch(facing: 'back' | 'front'): Promise<{ ok: boolean; reason?: string }>;
  cameraCurrent(): Promise<CamPaneState>;
  cameraFrameAck(): void;
  onCameraState(callback: (state: CamPaneState) => void): void;
  onCameraFrame(callback: (frame: CamFrame) => void): void;
}

/** What the phone's capability lists say about `camera`, before any stream state matters. */
type CamAvailability =
  | { kind: 'disconnected' }
  /** Connected, and the phone names `camera` in neither list: a build from before Camera v1. */
  | { kind: 'update-required' }
  /** Connected, and the phone lists `camera` as unavailable, with its own reason. */
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready' };

function cameraAvailability(
  connected: boolean,
  capabilities: readonly string[],
  unavailable: ReadonlyArray<{ name: string; reason: string }>,
): CamAvailability {
  if (!connected) return { kind: 'disconnected' };
  if (capabilities.includes('camera')) return { kind: 'ready' };
  const off = unavailable.find((u) => u.name === 'camera');
  if (off) return { kind: 'unavailable', reason: off.reason };
  return { kind: 'update-required' };
}

/** Everything the pane draws, decided in one place from the two inputs it has. */
interface CamPaneSpec {
  /** The state block, when the pane is not showing a picture (or is hiding a stalled one). */
  block: { kind: StateKind; headline: string; body: string[]; code?: string; icon?: string } | null;
  /** The live picture: its canvas is visible only when this is true. */
  showPicture: boolean;
  /** The request button and the back/front choice beside it. */
  canRequest: boolean;
  requestLabel: string;
  /** Cancel a waiting request (it is a stop, said as what it does). */
  canCancel: boolean;
  canStop: boolean;
  /** The camera a Switch press turns to, or null when there is nothing to switch. */
  switchTo: 'back' | 'front' | null;
  /** The live status line — what is true now, with the frame rate named as the phone's cap. */
  status: string | null;
  notice: string | null;
}

function cameraPaneSpec(availability: CamAvailability, state: CamPaneState, nowMs: number): CamPaneSpec {
  const none: CamPaneSpec = {
    block: null,
    showPicture: false,
    canRequest: false,
    requestLabel: 'Ask phone for camera',
    canCancel: false,
    canStop: false,
    switchTo: null,
    status: null,
    notice: null,
  };

  if (availability.kind === 'disconnected') {
    return {
      ...none,
      block: {
        kind: 'blocked',
        headline: 'Your phone is not connected',
        body: ['Connect your phone to see its camera here. Nothing is asked of the phone until you click.'],
      },
    };
  }
  if (availability.kind === 'update-required') {
    return {
      ...none,
      block: {
        kind: 'unavailable',
        headline: 'Update Sidekick on your phone',
        body: ['This phone runs a Sidekick from before the camera preview existed, so it cannot be asked for its camera.'],
        code: 'camera.* — not offered by this phone build',
      },
    };
  }
  if (availability.kind === 'unavailable') {
    return {
      ...none,
      block: {
        kind: 'unavailable',
        headline: 'Your phone is not offering its camera',
        body: [availability.reason],
        code: 'camera — unavailable on this phone build',
      },
    };
  }

  switch (state.kind) {
    case 'idle':
      return {
        ...none,
        canRequest: true,
        block: {
          kind: 'empty',
          icon: 'camera',
          headline: "See your phone's camera here",
          body: [
            'Your phone shows a request first. Its camera stays off until you tap Start camera on the phone, and it stops when you leave this pane.',
          ],
        },
      };
    case 'requesting': {
      const left = state.expiresAtMs === null ? null : Math.max(0, Math.ceil((state.expiresAtMs - nowMs) / 1000));
      return {
        ...none,
        canCancel: true,
        block: {
          kind: 'loading',
          headline: state.streamId === null ? 'Asking your phone…' : 'Waiting for you to allow it on your phone',
          body: [
            state.message ?? 'The camera stays off until you allow it on the phone.',
            state.fixHint ?? '',
            left === null ? '' : `The request expires in ${left} s.`,
          ],
        },
      };
    }
    case 'connecting':
      return {
        ...none,
        canStop: true,
        block: { kind: 'loading', headline: "Starting your phone's camera…", body: ['Allowed on the phone. Waiting for the first picture.'] },
      };
    case 'live': {
      const facing = state.facing === 'front' ? 'front' : 'back';
      const size = state.width > 0 && state.height > 0 ? ` · ${state.width} × ${state.height}` : '';
      const rate = state.frameRate ? ` · up to ${state.frameRate} fps` : '';
      return {
        ...none,
        canStop: true,
        switchTo: facing === 'back' ? 'front' : 'back',
        showPicture: !state.stalled,
        status: `Live · ${facing} camera${size}${rate}`,
        notice: state.notice,
        block: state.stalled
          ? {
              kind: 'loading',
              headline: 'Waiting for frames from your phone',
              body: ['The picture is hidden until new frames arrive, so an old frame is never shown as live.'],
            }
          : null,
      };
    }
    case 'ended':
      return { ...none, canRequest: true, requestLabel: 'Ask again', block: endedBlock(state) };
    case 'refused':
      if (state.code === 'CAMERA_UNAVAILABLE') {
        return {
          ...none,
          block: { kind: 'wall', headline: 'Your phone has no camera Sidekick can use', body: [state.message], code: state.code },
        };
      }
      return {
        ...none,
        canRequest: true,
        requestLabel: 'Ask again',
        block: {
          kind: state.code === 'CAMERA_BUSY' ? 'permission' : 'error',
          headline: state.code === 'CAMERA_BUSY' ? 'Your phone is busy' : 'The phone refused the request',
          body: [state.message, state.fixHint ?? ''],
          code: state.code,
        },
      };
    case 'error':
      return {
        ...none,
        canRequest: true,
        requestLabel: 'Try again',
        block: { kind: 'error', headline: 'The camera stopped', body: [state.message], code: state.code },
      };
  }
}

/** How an ended stream is drawn: the phone's ending, in this Mac's words, with the frame counts. */
function endedBlock(state: Extract<CamPaneState, { kind: 'ended' }>): NonNullable<CamPaneSpec['block']> {
  const counts = cameraCountsLine(state);
  const body = [state.message, state.fixHint ?? '', counts ?? ''];
  switch (state.reason) {
    case 'permission-denied':
      return { kind: 'permission', headline: 'Camera permission is off on your phone', body };
    case 'camera-in-use':
      return { kind: 'permission', headline: "Your phone's camera is in use", body };
    case 'camera-unavailable':
    case 'capture-failed':
    case 'stream-closed':
    case 'stream-lost':
      return { kind: 'error', headline: 'The camera stopped', body, code: state.reason };
    case 'disconnected':
      return { kind: 'blocked', headline: 'Your phone disconnected', body };
    case 'declined':
      return { kind: 'empty', icon: 'camera', headline: 'Declined on your phone', body };
    case 'expired':
      return { kind: 'empty', icon: 'camera', headline: 'The request expired', body };
    default:
      return { kind: 'empty', icon: 'camera', headline: 'Camera off', body };
  }
}

/**
 * `900 frames sent by the phone, 12 dropped there; 880 received here` — the denominator rule. Null
 * when nothing was ever sent and the phone gave no counts, so a request that ended before a picture
 * does not grow a line of zeros pretending to be a measurement.
 */
function cameraCountsLine(state: Extract<CamPaneState, { kind: 'ended' }>): string | null {
  if (state.framesSent === null && state.framesReceived === 0) return null;
  const phone =
    state.framesSent === null
      ? 'The phone sent no counts'
      : `${state.framesSent} frames sent by the phone, ${state.framesDropped ?? 0} dropped there`;
  return `${phone}; ${state.framesReceived} received here.`;
}

/**
 * Where a frame lands on a canvas: rotated upright first, then mirrored left-to-right if asked,
 * scaled to fit inside the box with its aspect ratio kept, and centred. Returned as the one affine
 * matrix the painter hands to `setTransform` and then draws the frame at its own size under — so the
 * test asserts the matrix the painter uses, not a second description of it.
 */
function cameraDrawMatrix(
  frameW: number,
  frameH: number,
  rotation: number,
  mirrored: boolean,
  boxW: number,
  boxH: number,
): { a: number; b: number; c: number; d: number; e: number; f: number; drawW: number; drawH: number } {
  const quarter = ((rotation % 4) + 4) % 4;
  const uprightW = quarter % 2 === 1 ? frameH : frameW;
  const uprightH = quarter % 2 === 1 ? frameW : frameH;
  const scale = Math.min(boxW / uprightW, boxH / uprightH);
  const cos = [1, 0, -1, 0][quarter]!;
  const sin = [0, 1, 0, -1][quarter]!;
  const m = mirrored ? -1 : 1;
  // p' = T(box centre) · Mirror · Rotate · Scale · T(-frame centre) · p
  const a = m * cos * scale;
  const b = sin * scale;
  const c = -m * sin * scale;
  const d = cos * scale;
  const e = boxW / 2 - (a * frameW) / 2 - (c * frameH) / 2;
  const f = boxH / 2 - (b * frameW) / 2 - (d * frameH) / 2;
  return { a, b, c, d, e, f, drawW: uprightW * scale, drawH: uprightH * scale };
}

/**
 * Decodes and draws one frame at a time, and acks each so the main process sends the next. A frame
 * that arrives while one is decoding replaces any frame already waiting — the newest is the only one
 * worth drawing — and every decoded bitmap is closed the moment it has been drawn.
 */
class CameraCanvasPainter {
  private decoding = false;
  private waiting: CamFrame | null = null;
  private streamId: string | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ack: () => void,
  ) {}

  /** Frames for any other stream are dropped unpainted (and acked, so the next can come). */
  setStream(streamId: string | null): void {
    if (streamId === this.streamId) return;
    this.streamId = streamId;
    this.waiting = null;
    this.clear();
  }

  paint(frame: CamFrame): void {
    if (this.decoding) {
      this.waiting = frame;
      return;
    }
    void this.decodeAndDraw(frame);
  }

  clear(): void {
    const context = this.canvas.getContext?.('2d');
    context?.setTransform(1, 0, 0, 1, 0, 0);
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private async decodeAndDraw(frame: CamFrame): Promise<void> {
    this.decoding = true;
    let bitmap: ImageBitmap | null = null;
    try {
      if (frame.streamId === this.streamId) {
        const bytes = new Uint8Array(frame.jpeg);
        bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        // The stream may have ended while the JPEG decoded; an ended stream draws nothing.
        if (frame.streamId === this.streamId) this.draw(bitmap, frame);
      }
    } catch {
      // A JPEG the browser could not decode is one lost frame, not a reason to stop the stream.
    } finally {
      bitmap?.close();
      this.decoding = false;
      this.ack();
      const next = this.waiting;
      this.waiting = null;
      if (next) this.paint(next);
    }
  }

  private draw(bitmap: ImageBitmap, frame: CamFrame): void {
    const ratio = window.devicePixelRatio || 1;
    const boxW = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const boxH = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== boxW) this.canvas.width = boxW;
    if (this.canvas.height !== boxH) this.canvas.height = boxH;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    const m = cameraDrawMatrix(bitmap.width, bitmap.height, frame.rotation, frame.mirrored, boxW, boxH);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, boxW, boxH);
    context.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** The painter as the view sees it, so the DOM test can hand in a recorder instead of a canvas. */
interface CamPainter {
  setStream(streamId: string | null): void;
  paint(frame: CamFrame): void;
  clear(): void;
}

class CameraView {
  private state: CamPaneState = { kind: 'idle' };
  private availability: CamAvailability = { kind: 'disconnected' };
  private facing: 'back' | 'front' = 'back';
  private onScreen = false;
  private stopTicking: (() => void) | null = null;

  constructor(
    private readonly bridge: CameraBridge,
    private readonly els: {
      block: HTMLElement;
      stage: HTMLElement;
      controls: HTMLElement;
      status: HTMLElement;
      notice: HTMLElement;
    },
    private readonly painter: CamPainter,
    private readonly now: () => number = () => Date.now(),
    /** Calls `fn` every second until the returned function is called — the request's countdown. */
    private readonly everySecond: (fn: () => void) => () => void = (fn) => {
      const id = setInterval(fn, 1000);
      return () => clearInterval(id);
    },
  ) {
    bridge.onCameraState((state) => this.setState(state));
    bridge.onCameraFrame((frame) => {
      // Drawn only while live and not stalled; anything else is acked unpainted so the main process is
      // never left holding a frame the page will not draw.
      if (this.state.kind === 'live' && !this.state.stalled && frame.streamId === this.state.streamId) {
        this.painter.paint(frame);
      } else {
        this.bridge.cameraFrameAck();
      }
    });
    void bridge.cameraCurrent().then((state) => this.setState(state));
    this.draw();
  }

  /** The capability lists and the link, from the app's status. */
  setAvailability(availability: CamAvailability): void {
    this.availability = availability;
    this.draw();
  }

  /**
   * The route changed. **Leaving this pane stops what it has open** — the documented stop policy in
   * the file comment. Arriving does nothing by itself: the phone is asked only on a click.
   */
  routeChanged(screen: string): void {
    const wasOnScreen = this.onScreen;
    this.onScreen = screen === 'camera';
    if (wasOnScreen && !this.onScreen && this.isActive()) {
      void this.bridge.cameraStop();
    }
  }

  setState(state: CamPaneState): void {
    this.state = state;
    if (state.kind === 'requesting' && state.expiresAtMs !== null) this.startCountdown();
    else this.stopCountdown();
    this.painter.setStream(state.kind === 'live' ? state.streamId : null);
    if (state.kind !== 'live' || state.stalled) this.painter.clear();
    this.draw();
  }

  private isActive(): boolean {
    return this.state.kind === 'requesting' || this.state.kind === 'connecting' || this.state.kind === 'live';
  }

  private draw(): void {
    const spec = cameraPaneSpec(this.availability, this.state, this.now());

    this.els.stage.hidden = !spec.showPicture;
    this.els.block.hidden = spec.block === null;
    if (spec.block) {
      this.els.block.replaceChildren(
        stateBlock({
          kind: spec.block.kind,
          headline: spec.block.headline,
          body: spec.block.body,
          ...(spec.block.code ? { code: spec.block.code } : {}),
          ...(spec.block.icon ? { icon: spec.block.icon } : {}),
        }),
      );
    } else {
      this.els.block.replaceChildren();
    }

    this.els.status.textContent = spec.status ?? '';
    this.els.status.hidden = spec.status === null;
    this.els.notice.textContent = spec.notice ?? '';
    this.els.notice.hidden = !spec.notice;

    const controls: HTMLElement[] = [];
    if (spec.canRequest) {
      const group = document.createElement('div');
      group.className = 'segmented camera-facing';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Which camera');
      for (const facing of ['back', 'front'] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `segment${this.facing === facing ? ' is-on' : ''}`;
        button.textContent = facing === 'back' ? 'Back camera' : 'Front camera';
        button.setAttribute('aria-pressed', String(this.facing === facing));
        button.addEventListener('click', () => {
          this.facing = facing;
          this.draw();
        });
        group.appendChild(button);
      }
      controls.push(group);
      controls.push(
        cameraButton(spec.requestLabel, 'button primary-action camera-request', () => {
          void this.bridge.cameraRequest(this.facing);
        }),
      );
    }
    if (spec.canCancel) {
      controls.push(cameraButton('Cancel request', 'button camera-cancel', () => void this.bridge.cameraStop()));
    }
    if (spec.switchTo) {
      const to = spec.switchTo;
      const button = cameraButton(to === 'front' ? 'Switch to front camera' : 'Switch to back camera', 'button camera-switch', () => {
        void this.bridge.cameraSwitch(to);
      });
      button.prepend(cameraGlyph('refresh'));
      controls.push(button);
    }
    if (spec.canStop) {
      const button = cameraButton('Stop camera', 'button danger camera-stop', () => void this.bridge.cameraStop());
      button.prepend(cameraGlyph('close'));
      controls.push(button);
    }
    this.els.controls.replaceChildren(...controls);
  }

  private startCountdown(): void {
    if (this.stopTicking !== null) return;
    this.stopTicking = this.everySecond(() => this.draw());
  }

  private stopCountdown(): void {
    this.stopTicking?.();
    this.stopTicking = null;
  }
}

function cameraButton(label: string, className: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', run);
  return button;
}

function cameraGlyph(name: string): SVGSVGElement {
  const glyph = iconSvg(name, 14);
  glyph.setAttribute('aria-hidden', 'true');
  return glyph;
}

// Hung on the global for cameraView.test.ts, per the renderer's testable-seam rule.
{
  const g = globalThis as Record<string, unknown>;
  g.__cameraRules = { cameraAvailability, cameraPaneSpec, cameraCountsLine, cameraDrawMatrix };
  g.CameraView = CameraView;
  g.CameraCanvasPainter = CameraCanvasPainter;
}
