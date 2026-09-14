/**
 * The mirror canvas: WebCodecs in, pixels out, and a sentence whenever there are no pixels.
 *
 * Decoding lives in the renderer because this is the only process with a GPU-backed
 * `VideoDecoder` and a canvas to paint. The main process owns the socket and forwards access
 * units; it never decodes.
 *
 * The rule this file enforces is the one from the phase brief: **the canvas is never blank
 * without a reason on it.** Every path that ends in "no video" also calls [showReason], so the
 * user is told which of the seven failures happened rather than watching an empty rectangle.
 *
 * Module-free on purpose, like renderer.ts: the page is CSP-locked and loads plain scripts, so a
 * top-level `export` here would emit a CommonJS module the renderer cannot require.
 */

interface MirrorFrame {
  keyframe: boolean;
  config: boolean;
  ptsUs: number;
  data: Uint8Array;
  /** `Date.now()` in the main process, when the frame finished arriving off the socket. */
  arrivedAt: number;
}

/** `mirror.rotate` from the phone. Not a phase change — the session never stopped. */
interface MirrorRotate {
  width?: number;
  height?: number;
  dpi?: number;
  rotation?: number;
  /** The stamp coordinates must quote. Changes on every turn, including a 180° one. */
  geometryId?: number;
}

/**
 * One frame's capture-to-paint time, split where the two halves can actually be told apart.
 *
 * [link] is the phone's encode and the network; [decode] is this Mac's IPC, WebCodecs and canvas.
 * A mirror that feels slow is one or the other, and a single total cannot say which — which is
 * why the HUD shows three numbers rather than one.
 */
/*
 * From `latencyStages.js`, loaded ahead of this file. Every renderer file is a classic script in one
 * global scope, so these are visible without an import — and must not be `declare`d beside the real
 * ones, which is a duplicate identifier.
 */
declare function stagesFor(input: {
  ptsUs: number;
  anchor: { ptsUs: number; monoUs: number } | null;
  clockOffsetMs: number | undefined;
  arrivedAtMs: number | null;
  paintedAtMs: number;
}): {
  encodeMs: number | null;
  wireMs: number | null;
  macMs: number | null;
  totalMs: number | null;
  origin: 'capture' | 'encoder-output';
  splitReliable: boolean;
};

declare function summariseMark(
  samples: readonly {
    at: number; totalMs: number; encodeMs: number | null; wireMs: number | null; macMs: number | null;
    splitReliable?: boolean;
  }[],
  markedAt: number,
  windowMs: number,
  label: string,
): unknown;

/*
 * `GestureRecogniser` comes from `pointerGestures.js`, loaded ahead of this file. No `declare` — the
 * renderer is one global script scope, so TypeScript already sees the real class, and a declaration
 * beside it is a duplicate identifier. That has now caught three files in this session.
 */

interface LatencySample {
  /** `Date.now()` when this frame was painted. Without it a mark has no window to summarise. */
  at: number;
  total: number;
  link: number | null;
  decode: number | null;
  /** Capture → encoder output, from the anchor pair. Null when PTS is not on the monotonic clock. */
  encode: number | null;
  /** Which instant `total` is measured from. A number without this was the whole of §4's anchor bug. */
  origin: 'capture' | 'encoder-output';
  /** False when the encode/wire split overshot — the total is still sound. See latencyStages.ts. */
  splitReliable: boolean;
}

interface CaptureAck {
  width?: number;
  height?: number;
  dpi?: number;
  bitrate?: number;
  frameRate?: number;
  maxResolution?: number;
  rotation?: number;
  geometryId?: number;
}

/** The screen shape a coordinate was computed against. See docs/protocol.md, "Input". */
interface GeometryStamp {
  id: number;
  width: number;
  height: number;
}

interface PhoneMirrorStats {
  encodedFrames?: number;
  encodedBytes?: number;
  droppedFrames?: number;
  ptsUs?: number;
  monoUs?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  frameRate?: number;
}

interface MirrorTelemetry {
  clockOffsetMs?: number;
  phone: PhoneMirrorStats;
}

/** The `mirror.state` payload from docs/protocol.md, as it reaches the canvas. */
interface MirrorState extends CaptureAck {
  state?: string;
  message?: string;
  fixHint?: string;
}

/**
 * What has to arrive before an overlay's reason stops being true.
 *
 * **This is the overlay-clearing rule, and it lives here rather than at the call sites.** The rule
 * used to be "any painted frame takes the overlay down", applied by the decoder's output callback
 * to every reason equally. That is right for most of them and wrong for one, and the one it is
 * wrong about is the only reason a frame does not disprove: a blanked secure surface *keeps
 * producing frames*, black ones, so the message explaining the black rectangle was wiped about
 * 16ms after it was set by the very frames it described (defect 23). Patching the secure-surface
 * call site would have left the rule itself saying the wrong thing, and the next reason with the
 * same shape would have hit it again.
 *
 * So every reason now says what would end it, and one place — [MirrorView.overlayEndedBy] —
 * decides. The evidence ranks: `pixels` is weaker than `content`, and nothing outranks `session`.
 *
 * - `pixels` — "there is no picture yet". Starting up, waiting on consent, waiting on the first
 *   frame. A painted frame is proof, whatever it contains.
 * - `content` — "there is a picture, and Android is refusing to let the Mac see what is on it".
 *   Black frames are the symptom, so they cannot be the cure: only real content ends this, which
 *   is either the phone saying so (`mirror.state: running` while frames are already decoding) or a
 *   keyframe too large to be blank.
 * - `session` — "this session is over". Stopped, denied, decoder dead, link dropped. No frame ends
 *   it, because a frame still in flight when the session ended is not evidence the session came
 *   back; only a new [MirrorView.start] replaces the reason.
 */
type OverlayEnds = 'pixels' | 'content' | 'session';

/** How strong a piece of evidence is, against the [OverlayEnds] the overlay is waiting for. */
const OVERLAY_RANK: Record<OverlayEnds, number> = { pixels: 0, content: 1, session: 2 };

/**
 * What one input intent came back as. Twin of `InputResult` in shared/protocol.ts — this file is
 * module-free on purpose (see the file comment) so it cannot import the one definition.
 *
 * A value rather than a rejection, and that is the point of it. `ipcRenderer.invoke` rewraps
 * anything the main process throws as `Error invoking remote method '<channel>': Error: …`, so
 * every carefully composed phone refusal used to reach this canvas wearing nine words of Electron
 * plumbing (defect 22). The parts arrive separately and [MirrorView.showNotice] composes them:
 * `reason` is the sentence, `fixHint` is the second line, and `code` is never shown at all.
 */
type InputResult =
  | { ok: true }
  | { ok: false; reason: string; fixHint?: string; code?: string };

interface MirrorBridge {
  mirrorStart: (
    options?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; requestedAt?: number; state?: MirrorState }>;
  mirrorStop: () => Promise<{ ok: boolean }>;
  mirrorKeyframe: (reason?: string) => Promise<void>;
  mirrorConfig: (options: Record<string, unknown>) => Promise<{ ok: boolean }>;
  /** Hands a PNG data URL to the main process, which owns file IO. Returns where it landed. */
  mirrorCapture: (dataUrl: string) => Promise<{ ok: boolean; path?: string; reason?: string }>;
  mirrorStats: () => Promise<{
    frames: number;
    bytes: number;
    kbps: number | null;
    framesPerSecond: number | null;
    clockOffsetMs?: number;
    phone: PhoneMirrorStats | null;
  }>;
  onVideoFrame: (callback: (frame: MirrorFrame) => void) => void;
  onMirrorTelemetry: (callback: (telemetry: MirrorTelemetry) => void) => void;
  onMirrorState: (callback: (state: MirrorState) => void) => void;
  onMirrorRotate: (callback: (rotate: MirrorRotate) => void) => void;
  onMirrorStopped: (
    callback: (info: { reason?: string; fixHint?: string; transient?: boolean }) => void,
  ) => void;

  inputTap: (point: {
    x: number;
    y: number;
    durationMs?: number;
    geom: GeometryStamp;
  }) => Promise<InputResult>;
  inputSwipe: (swipe: {
    points: Array<{ x: number; y: number }>;
    durationMs?: number;
    geom: GeometryStamp;
  }) => Promise<InputResult>;
  inputScroll: (scroll: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    durationMs?: number;
    geom: GeometryStamp;
  }) => Promise<InputResult>;
  inputKey: (key: string) => Promise<InputResult>;
  inputText: (text: string, mode?: 'replace' | 'append') => Promise<InputResult>;
  inputGlobal: (action: string) => Promise<InputResult>;
}

/** Everything the HUD shows about a live session. Numbers only; no formatting decisions here. */
interface MirrorReadout {
  framesDecoded: number;
  /**
   * Paints per second over the last few seconds, or null when nothing has been painted in that
   * window — see [VideoClient.stats] for why this is null and not zero.
   */
  fps: number | null;
  timeToFirstFrameMs: number | null;
  latencyMs: number | null;
  latencyPeakMs: number | null;
  /** Median of the phone-to-Mac half, in milliseconds. */
  latencyLinkMs: number | null;
  /** Median of the arrival-to-painted half, in milliseconds. */
  latencyDecodeMs: number | null;
  /** Capture → encoder output. Null when the phone's PTS is not on its monotonic clock. */
  latencyEncodeMs: number | null;
  /** Which instant the total is measured from. Null before any sample. */
  latencyOrigin: 'capture' | 'encoder-output' | null;
  /** The denominator for every median above. */
  latencySamples: number;
  capture: CaptureAck | null;
  rotation: number | null;
}

class MirrorView {
  private decoder: VideoDecoder | null = null;
  /** SPS/PPS in Annex B, prepended to the first IDR. See [onFrame]. */
  private configBytes: Uint8Array | null = null;
  private awaitingKeyframe = true;
  private framesDecoded = 0;

  /** When `mirror.start` went on the wire, from the main process. Not when the button was clicked. */
  private requestedAt = 0;
  private firstFrameAt = 0;
  private capture: CaptureAck | null = null;

  /** Paint times of recently decoded frames, for a rolling fps that reacts to a stall. */
  private paintedAt: number[] = [];

  /**
   * The clock anchor from the phone, and the offset between the two machines.
   *
   * Together they place a frame's PTS on this Mac's clock: a frame is `ptsUs` on the phone's
   * monotonic clock, `monoUs` is a reading of that same clock for a known frame, and
   * `clockOffsetMs` is how far that clock sits from `Date.now()` here.
   */
  private telemetry: MirrorTelemetry | null = null;

  /** Rolling capture-to-paint latencies, split into their two halves, newest last. */
  private latencies: LatencySample[] = [];

  /**
   * Arrival time per PTS, so a painted frame can be timed against the moment it landed.
   *
   * WebCodecs hands back a decoded frame carrying only its timestamp, so the arrival stamp has to
   * be parked somewhere between `decode()` and `output`. Entries are removed as they are used and
   * the map is capped, because a decoder that drops a frame would otherwise leak one entry per
   * drop for the life of the session.
   */
  private arrivedAt = new Map<number, number>();

  /** The phone's rotation in degrees, from `mirror.rotate`. Null until it has turned once. */
  private rotation: number | null = null;

  /** True while the phone advertises `input`. Set by the renderer from every status update. */
  private inputAdvertised = false;

  /**
   * Set when the phone announces a turn, cleared by the next painted frame.
   *
   * The third guard on the wrong-place tap, and the only one that can live here. The phone
   * announces `mirror.rotate` *before* it swaps the encoder, so for the ~100ms until the new
   * parameter sets arrive this canvas is still showing the picture from before the turn while the
   * geometry it would map against is the one from after it. A click in that window is refused
   * here, with a sentence, rather than being sent — the phone's stamp check would have caught most
   * of these, but not the case where the ids already agree and only the picture is behind.
   */
  private awaitingFreshFrame = false;

  /**
   * The gesture state machine, shared with the float window.
   *
   * It used to be three fields here — `cancelledByTurn`, `drag`, `pointerDownAt` — and a second
   * window taking pointer input would have needed its own three. The drag cancellation and the
   * geometry stamp are defects 19 and 20; a second copy of either is the copy that does not get the
   * next fix.
   */
  private readonly gesture = new GestureRecogniser();

  /** Wheel deltas accumulated since the last flush, so a burst becomes one scroll. */
  private wheel: { x: number; y: number; dx: number; dy: number } | null = null;

  private wheelTimer: number | null = null;

  /** Timer that takes the input notice down again. */
  private noticeTimer: number | null = null;

  /**
   * What the overlay currently on screen is waiting for. See [OverlayEnds].
   *
   * `session` while nothing has been asked for: the "Not mirroring." the page ships with is not
   * something a stray frame should be allowed to clear.
   */
  private overlayEnds: OverlayEnds = 'session';

  /**
   * Encoded size of the most recent keyframe, in bytes.
   *
   * The Mac's own read on whether the picture is blank, from the same number the phone judges on
   * ([BLANK_KEYFRAME_BYTES]). It is not a second opinion for its own sake: the phone's "content is
   * back" event is the primary signal, and this is what keeps a missed one from leaving the
   * secure-surface sentence sitting over a live picture — the opposite of defect 23 and just as
   * silent.
   */
  private lastKeyframeBytes = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLElement,
    private readonly notice: HTMLElement,
    /**
     * The box the picture lives in, whose aspect ratio is this class's to set.
     *
     * Passed in rather than looked up so that the one element whose shape has to track the phone
     * is visible at the construction site, beside the canvas it contains.
     */
    private readonly stage: HTMLElement,
    private readonly bridge: MirrorBridge,
  ) {
    bridge.onVideoFrame((frame) => this.onFrame(frame));
    bridge.onMirrorTelemetry((telemetry) => {
      this.telemetry = telemetry;
    });
    bridge.onMirrorState((state) => this.onState(state));
    bridge.onMirrorRotate((rotate) => this.onRotate(rotate));
    bridge.onMirrorStopped((info) =>
      // `transient` is the main process passing on what only it knows: a SECURE_SURFACE error
      // leaves the session running and every other one ends it. Without that bit the canvas has
      // to guess, and the guess it used to make — "frames are still arriving, so it must be
      // over" — is defect 23 exactly.
      this.showReason(
        info.reason ?? 'Mirroring stopped.',
        info.fixHint,
        info.transient ? 'content' : 'session',
      ),
    );
    this.attachInput();
  }

  // ---- public -----------------------------------------------------------------------------

  async start(options: Record<string, unknown> = {}): Promise<void> {
    this.showReason('Asking the phone…');
    this.resetMeasurements();
    try {
      const started = await this.bridge.mirrorStart(options);
      // The phone was asked at `requestedAt`; anything measured from the click would be measuring
      // how fast the user can pick up their phone.
      this.requestedAt = started.requestedAt ?? Date.now();
      // Deliberately no clearOverlay() here. The ack now means "the phone heard you", not "here
      // is your picture" — clearing on it is precisely what left a blank canvas with nothing
      // written on it. The overlay comes down when a frame is painted, and not before.
      if (started.state) this.onState(started.state);
    } catch (error) {
      // The phone's reason arrives as the rejection message — "Screen capture was denied on the
      // phone.", "The phone is locked…", and so on. Showing it verbatim is the whole point.
      // Every one of these ended the attempt, so no frame can disprove it.
      this.showReason(messageOf(error), undefined, 'session');
    }
  }

  /**
   * A phase from the phone, shown on the canvas until pixels replace it.
   *
   * `awaiting-foreground` is the Android 16 case and carries the instruction to go and tap the
   * phone; it is not an error and must not read like one. `running` means frames are coming but
   * none have been decoded yet, so the overlay stays up saying so rather than going blank.
   */
  /**
   * `mirror.rotate`: the phone turned, and is already capturing at the geometry named here.
   *
   * Nothing is done to the decoder from here on purpose. The event arrives on the control channel
   * *ahead* of the new SPS/PPS on the video channel, and it is that config frame — not this — that
   * rebuilds the decoder, because it is the thing that actually describes the new stream. What
   * this is for is the HUD and the window: they would otherwise learn the new shape only from the
   * first frame that happened to decode, which is one painted frame too late.
   */
  private onRotate(rotate: MirrorRotate): void {
    if (typeof rotate.rotation === 'number') this.rotation = rotate.rotation;
    if (rotate.width && rotate.height) {
      this.capture = {
        ...(this.capture ?? {}),
        width: rotate.width,
        height: rotate.height,
        dpi: rotate.dpi ?? this.capture?.dpi,
        geometryId: rotate.geometryId ?? this.capture?.geometryId,
      };
      // The box turns with the phone. Before the new parameter sets arrive the stage is briefly the
      // new shape around the old picture, which is the honest order: the phone has already turned,
      // and the alternative is a portrait box holding a landscape picture for a few frames.
      this.applyCaptureAspect();
    }
    // The picture on this canvas is still the old one until the phone's new parameter sets arrive
    // and a frame decodes. Until then there is nothing here worth clicking on.
    this.awaitingFreshFrame = true;
    // A drag that was in progress belonged to the old screen shape. Finishing it against the new
    // one would send a stroke through coordinates the user never dragged through.
    //
    // Defect 19: cancelling it is right, doing so in silence is not. A press that produces neither
    // a tap nor a sentence is indistinguishable from a phone that ignored you — the same silent
    // no-op class as defect 18, and the thing step 20 exists to rule out. `cancelledByTurn` makes
    // the pointer-up say what happened instead of returning.
    this.gesture.cancelForTurn();
  }

  private onState(state: MirrorState): void {
    if (state.width && state.height) {
      this.capture = state;
      if (typeof state.rotation === 'number') this.rotation = state.rotation;
      // `running` carries width/height/dpi/rotation/geometryId, so the stage is the right shape
      // before the first frame is decoded rather than after it.
      this.applyCaptureAspect();
    }
    if (state.state === 'running') {
      if (this.framesDecoded === 0) {
        this.showReason('Phone is capturing; waiting for the first frame…');
        return;
      }
      // A `running` that arrives while frames are already decoding is the phone retracting
      // something: it is sent again when [BlackFrameDetector] sees real content after a secure
      // surface. That is the authoritative end of the one reason a frame cannot end, and it is
      // the reason this arm is no longer a bare `return`.
      this.overlayEndedBy('content');
      return;
    }
    // `stopped` is over; the pending phases — awaiting-foreground, requesting-consent — are
    // waiting for a picture and are ended by one.
    if (state.message) {
      this.showReason(state.message, state.fixHint, state.state === 'stopped' ? 'session' : 'pixels');
    }
  }

  async stop(): Promise<void> {
    await this.bridge.mirrorStop();
    this.teardownDecoder();
    this.resetMeasurements();
    this.showReason('Mirroring stopped.', undefined, 'session');
  }

  /**
   * Applies a quality preset to a live session. No new consent tap on the phone.
   *
   * Both fields are `mirror.config`'s own. `maxResolution` cannot be changed on the live encoder —
   * MediaCodec cannot be resized in place — so the phone builds a new encoder and points its
   * existing VirtualDisplay at it. The MediaProjection is never touched, which is what keeps this
   * from needing a second consent tap and from tripping Android 14's one-display-per-projection
   * rule.
   */
  async setQuality(quality: { maxResolution: number; frameRate: number }): Promise<void> {
    await this.bridge.mirrorConfig({ ...quality });
  }

  /**
   * A still of the current frame, written from the Mac's own canvas.
   *
   * Deliberately not a phone command, and there is no message for it: the Mac already holds every
   * decoded frame, so a capture costs one readback and no round trip. It is therefore the one item
   * on the handoff's five-item tool rail that works today — see docs/design-departures.md, M3.
   *
   * Refuses rather than writing a black rectangle when nothing has been painted. A file that
   * silently contains nothing is the same failure as a silent no-op, one directory over.
   */
  async saveStill(): Promise<void> {
    if (this.framesDecoded === 0 || this.canvas.width === 0) {
      this.showNotice('There is no picture to capture yet.');
      return;
    }
    const data = this.canvas.toDataURL('image/png');
    const result = await this.bridge.mirrorCapture(data);
    this.showNotice(
      result.ok && result.path
        ? `Saved to ${result.path}`
        : (result.reason ?? 'The capture was not saved.'),
    );
  }

  stats(): MirrorReadout {
    const now = Date.now();
    this.trimPainted(now);
    const oldest = this.paintedAt[0];
    const seconds = oldest === undefined ? 0 : (now - oldest) / 1000;
    return {
      framesDecoded: this.framesDecoded,
      fps: seconds >= 0.2 ? Math.round(this.paintedAt.length / seconds) : null,
      timeToFirstFrameMs:
        this.firstFrameAt > 0 && this.requestedAt > 0 ? this.firstFrameAt - this.requestedAt : null,
      latencyMs: median(this.latencies.map((sample) => sample.total)),
      latencyPeakMs:
        this.latencies.length > 0 ? Math.max(...this.latencies.map((sample) => sample.total)) : null,
      latencyLinkMs: median(this.latencies.map((sample) => sample.link)),
      latencyDecodeMs: median(this.latencies.map((sample) => sample.decode)),
      latencyEncodeMs: median(this.latencies.map((sample) => sample.encode)),
      // The sentence that was missing from every figure this class has ever published.
      latencyOrigin: this.latencies.length === 0 ? null : this.latencies[this.latencies.length - 1]!.origin,
      latencySamples: this.latencies.length,
      capture: this.capture,
      rotation: this.rotation,
    };
  }

  /**
   * "That was bad" — the stages over the seconds before somebody said so.
   *
   * The rolling buffer is `LATENCY_SAMPLES` long, so at 120 fps it covers about two seconds and at
   * 60 fps about four. The window asked for is clamped to what the buffer can actually answer, and
   * the summary reports how many samples it found so a short window cannot masquerade as a quiet one.
   */
  markMoment(label: string, windowMs = 5_000): unknown {
    return summariseMark(
      this.latencies.map((s) => ({
        at: s.at, totalMs: s.total, encodeMs: s.encode, wireMs: s.link, macMs: s.decode,
        splitReliable: s.splitReliable,
      })),
      Date.now(),
      windowMs,
      label,
    );
  }

  private resetMeasurements(): void {
    this.requestedAt = 0;
    this.firstFrameAt = 0;
    this.framesDecoded = 0;
    this.paintedAt = [];
    this.latencies = [];
    this.telemetry = null;
    this.capture = null;
    this.rotation = null;
    // The third writer of `this.capture`, and it clears it — so the stage goes back to the CSS
    // fallback rather than keeping the shape of a phone that is no longer sending anything. Three
    // writers, one setter: two fields that must move together will otherwise move apart.
    this.applyCaptureAspect();
    this.awaitingFreshFrame = false;
    this.gesture.cancelForTurn();
    // cancelForTurn leaves the "a turn cancelled you" flag set so the release can explain it. A new
    // session is not a turn, so the flag is cleared by consuming it — the release would otherwise
    // blame a rotation that did not happen.
    this.gesture.up(null);
    this.wheel = null;
    this.lastKeyframeBytes = 0;
    this.arrivedAt.clear();
  }

  private trimPainted(now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    while (this.paintedAt.length > 0 && this.paintedAt[0]! < cutoff) this.paintedAt.shift();
  }

  /**
   * When one frame was captured on the phone, expressed on *this Mac's* `Date.now()` clock.
   *
   * Null until the first `mirror.stats` has anchored the two clocks. Everything the HUD reports
   * about latency is a subtraction from this, which is why it returns the instant rather than a
   * duration: the total and the link half are measured from the same point, and computing them
   * separately from two readings of `Date.now()` would make them disagree by the cost of the
   * arithmetic between them.
   *
   * Worth being precise about what this anchors: the moment the phone's display pipeline stamped
   * the frame. It does **not** include the phone's own touch-to-composite time ahead of the stamp,
   * nor the Mac's compositor and panel behind the draw. It is the part of the path this code owns,
   * and the part that changes when the link or the encoder changes.
   */
  private capturedAtMacMs(ptsUs: number): number | null {
    const telemetry = this.telemetry;
    if (!telemetry || telemetry.clockOffsetMs === undefined) return null;
    const { ptsUs: anchorPts, monoUs: anchorMono } = telemetry.phone;
    if (typeof anchorPts !== 'number' || typeof anchorMono !== 'number' || anchorMono <= 0) {
      return null;
    }
    // The frame's own PTS, moved onto the phone's monotonic clock via the anchor pair, then onto
    // this Mac's clock via the offset. Doing it through the anchor rather than assuming PTS *is*
    // the monotonic clock keeps this correct on encoders that rebase PTS to zero.
    const capturedAtPhoneMs = (ptsUs - anchorPts) / 1000 + anchorMono / 1000;
    return capturedAtPhoneMs + telemetry.clockOffsetMs;
  }

  // ---- decoding ---------------------------------------------------------------------------

  private onFrame(frame: MirrorFrame): void {
    if (frame.config) {
      // SPS/PPS. In Annex B these are not a `description` — they have to reach the decoder
      // in-band, ahead of the first IDR, or the keyframe arrives with no parameter sets and
      // decoding fails immediately. So they are retained here and prepended in [onFrame].
      this.configBytes = frame.data;
      this.configureDecoder();
      return;
    }

    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured') {
      // Frames before the config frame cannot be decoded. Normal for a few milliseconds at
      // startup, so it is not surfaced as a failure.
      return;
    }

    // Starting on a P-frame gives a decoder no reference and produces green mush, so wait for
    // the first IDR and ask for one if it is slow to arrive.
    if (this.awaitingKeyframe) {
      if (!frame.keyframe) {
        void this.bridge.mirrorKeyframe('main pane lost sync');
        return;
      }
      this.awaitingKeyframe = false;
      // First IDR of this decoder: carry the parameter sets in front of it.
      if (this.configBytes) {
        const withParameterSets = new Uint8Array(this.configBytes.length + frame.data.length);
        withParameterSets.set(this.configBytes, 0);
        withParameterSets.set(frame.data, this.configBytes.length);
        frame = { ...frame, data: withParameterSets };
      }
    }

    // Recorded before decoding rather than after, because the frame handed back by WebCodecs
    // carries only a timestamp — the encoded size is knowable here and nowhere else.
    if (frame.keyframe) this.lastKeyframeBytes = frame.data.length;

    try {
      this.rememberArrival(frame.ptsUs, frame.arrivedAt);
      decoder.decode(
        new EncodedVideoChunk({
          type: frame.keyframe ? 'key' : 'delta',
          timestamp: frame.ptsUs,
          data: frame.data,
        }),
      );
    } catch (error) {
      this.showReason(
        `The Mac could not decode the phone's video (${messageOf(error)}).`,
        undefined,
        'session',
      );
      this.teardownDecoder();
    }
  }

  /**
   * Parks one frame's arrival stamp until the decoder hands the frame back.
   *
   * The cap is what makes this safe to leave running for an hour: a decoder that drops a frame
   * never asks for its stamp, so without an eviction the map grows by one entry per dropped frame
   * for the life of the session. Oldest-first is right because `Map` iterates in insertion order
   * and a stamp older than the whole window belongs to a frame that will never be painted.
   */
  private rememberArrival(ptsUs: number, at: number): void {
    if (this.arrivedAt.size >= ARRIVAL_STAMPS) {
      const oldest = this.arrivedAt.keys().next();
      if (!oldest.done) this.arrivedAt.delete(oldest.value);
    }
    this.arrivedAt.set(ptsUs, at);
  }

  private configureDecoder(): void {
    this.teardownDecoder();
    const context = this.canvas.getContext('2d');
    if (!context) {
      this.showReason(
        'This Mac could not open a 2D canvas to draw the phone screen on.',
        undefined,
        'session',
      );
      return;
    }

    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
          }
          context.drawImage(frame, 0, 0);
          this.framesDecoded += 1;
          const now = Date.now();
          this.paintedAt.push(now);
          this.trimPainted(now);
          if (this.framesDecoded === 1) this.firstFrameAt = now;
          // The picture now matches the geometry the phone last announced, so clicking is safe
          // again. Cleared on any painted frame rather than on a dimension match, because a 180°
          // turn changes no dimensions at all and would otherwise never clear.
          this.awaitingFreshFrame = false;
          // A painted frame is proof there are pixels. Whether it is proof there is *content*
          // depends on what the stream is carrying, which is what the last keyframe's size says:
          // a blanked secure surface keyframes at a few hundred bytes and a real screen does not.
          // This is the whole of what the frame path decides — [overlayEndedBy] owns the rest.
          this.overlayEndedBy(
            this.lastKeyframeBytes >= BLANK_KEYFRAME_BYTES ? 'content' : 'pixels',
          );
          this.recordLatency(frame.timestamp, now);
        } finally {
          // VideoFrame holds a GPU buffer; not closing it stalls the decoder within a second.
          frame.close();
        }
      },
      error: (error) => {
        this.showReason(`The Mac's H.264 decoder failed (${messageOf(error)}).`, undefined, 'session');
        this.teardownDecoder();
      },
    });

    try {
      decoder.configure({
        // avc1.640028 = High profile, level 4.0: what MediaCodec produces for 1080p60 on this
        // Samsung. `description` is deliberately omitted — supplying one selects AVCC, and the
        // phone sends Annex B start codes. Omitting it is what puts WebCodecs in Annex B mode.
        codec: 'avc1.640028',
        optimizeForLatency: true,
      });
    } catch (error) {
      this.showReason(
        `This Mac cannot decode the phone's H.264 stream (${messageOf(error)}).`,
        undefined,
        'session',
      );
      return;
    }

    this.decoder = decoder;
    this.awaitingKeyframe = true;
    // `framesDecoded` is deliberately *not* reset here. This runs on every config frame, and a
    // mid-stream one — a resolution change or a rotation — is not a new session: zeroing it would
    // restate the first frame as having just arrived and republish a time-to-first-frame measured
    // from a `mirror.start` that happened minutes ago. `resetMeasurements` owns that reset.
  }

  /**
   * The three figures the HUD reports, from one painted frame.
   *
   * Split rather than totalled because the two halves fail for different reasons and are fixed in
   * different places: [LatencySample.link] is the phone's encoder plus the network, and
   * [LatencySample.decode] is this Mac's IPC, WebCodecs and canvas. A single total of 180ms says
   * the mirror feels slow; 30ms link and 150ms decode says which machine to look at.
   *
   * The bounds check throws out samples taken before the clock anchor settles — a PTS mapped
   * through a stale offset can land in the future — rather than letting one absurd figure drag the
   * peak for the next four seconds.
   */
  private recordLatency(ptsUs: number, paintedAt: number): void {
    const arrived = this.arrivedAt.get(ptsUs);
    this.arrivedAt.delete(ptsUs);

    /*
     * **The anchor, corrected.** `monoUs` is stamped at `dequeueOutputBuffer` — after encoding — and
     * was being used as the *capture* instant, so every total published by this class was short by
     * the anchor frame's encode duration. `stagesFor` splits the two timestamps that were already on
     * the wire into stage boundaries, and carries the origin so a figure can never again be quoted
     * as capture-to-paint when it is encoder-output-to-paint.
     */
    const phone = this.telemetry?.phone;
    const anchor =
      phone && typeof phone.ptsUs === 'number' && typeof phone.monoUs === 'number'
        ? { ptsUs: phone.ptsUs, monoUs: phone.monoUs }
        : null;
    const stages = stagesFor({
      ptsUs,
      anchor,
      clockOffsetMs: this.telemetry?.clockOffsetMs,
      arrivedAtMs: arrived === undefined ? null : arrived,
      paintedAtMs: paintedAt,
    });
    if (stages.totalMs === null) return;
    if (stages.totalMs <= -1_000 || stages.totalMs >= 10_000) return;

    this.latencies.push({
      at: paintedAt,
      total: stages.totalMs,
      link: stages.wireMs,
      decode: stages.macMs,
      encode: stages.encodeMs,
      origin: stages.origin,
      splitReliable: stages.splitReliable,
    });
    if (this.latencies.length > LATENCY_SAMPLES) this.latencies.shift();
  }

  private teardownDecoder(): void {
    const decoder = this.decoder;
    this.decoder = null;
    this.awaitingKeyframe = true;
    if (decoder && decoder.state !== 'closed') {
      try {
        decoder.close();
      } catch {
        // Already torn down by its own error callback.
      }
    }
  }

  // ---- input ------------------------------------------------------------------------------

  /** Called from every status update, so the canvas stops accepting clicks the moment it should. */
  setInputAdvertised(advertised: boolean): void {
    this.inputAdvertised = advertised;
    this.canvas.style.cursor = advertised ? 'pointer' : 'default';
  }

  /** The global actions, for the buttons under the canvas. */
  async global(action: string): Promise<void> {
    if (!this.inputAdvertised) {
      this.showInputUnavailable();
      return;
    }
    await this.deliver(this.bridge.inputGlobal(action));
  }

  /**
   * Sends one input intent and says what came back, in the phone's own words.
   *
   * The single place a refusal becomes something on the canvas. It exists because the composing
   * has to happen *after* the bridge, not before it: the main process resolves with the parts —
   * sentence, fix hint, code — precisely so that nothing between the phone and this line gets to
   * add words to them (defect 22).
   *
   * A rejection is still possible and still handled, but it now means something specific: the
   * intent never reached [InputClient] at all, because the IPC channel itself failed. That is a
   * Mac-side plumbing fault and is named as one — it is not a phone refusal and must not read
   * like a sentence the phone composed.
   */
  private async deliver(intent: Promise<InputResult>): Promise<void> {
    const result = await intent.catch(
      (error): InputResult => ({
        ok: false,
        reason: `The Mac could not reach its own input channel (${messageOf(error)}).`,
      }),
    );
    if (!result.ok) this.showNotice(result.reason, result.fixHint);
  }

  private attachInput(): void {
    this.canvas.tabIndex = 0;
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => void this.onPointerUp(event));
    this.canvas.addEventListener('pointercancel', () => {
      this.gesture.up(null);
    });
    this.canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.canvas.addEventListener('keydown', (event) => void this.onKeyDown(event));
  }

  /**
   * Where a click landed, in capture-frame pixels, with the stamp that names the screen it was
   * measured against.
   *
   * **This used to divide by the element**, on the strength of a sentence saying *"the element's
   * box is the picture … there is no letterboxing inside the element to account for"*. That was
   * true of the Phase 2 canvas, which was sized by `max-width`/`max-height` alone. It stopped being
   * true when the design pass gave the canvas `object-fit: contain` inside a fixed 9:19.5 stage,
   * and nothing failed — the sentence stayed, correct about a layout that no longer existed, while
   * every tap on every phone that is not 19.5:9 was scaled and offset by the size of the bars. In
   * landscape a tap on the top of the phone landed 40% of the way down it.
   *
   * So the mapping goes through [pointInCapture], which computes the contained picture and maps
   * against *that*. With the stage now taking its ratio from the same geometry the bars are zero to
   * within a rounding pixel and the two agree — but the expression no longer depends on that being
   * true, which is the whole point: the previous version was correct only by a coincidence nobody
   * was checking.
   *
   * The announced capture geometry is used rather than `canvas.width` because an encoder may pad
   * the coded frame to a macroblock boundary: the two are equal in practice, and where they are
   * not, the announced one is the one the phone will check against.
   */
  private pointAt(event: PointerEvent | WheelEvent): { x: number; y: number; geom: GeometryStamp } | null {
    const capture = this.capture;
    if (!capture?.width || !capture.height || capture.geometryId === undefined) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const mapped = pointInCapture(
      { x: event.clientX, y: event.clientY },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      { width: capture.width, height: capture.height },
    );
    return {
      x: mapped.x,
      y: mapped.y,
      geom: { id: capture.geometryId, width: capture.width, height: capture.height },
    };
  }

  /**
   * Point the stage at the shape the phone says it is capturing.
   *
   * Called from the two places `this.capture` is written and nowhere else, which is what keeps the
   * box and the coordinate mapping reading one fact. `--capture-aspect` is consumed by
   * `.pane-mirror .mirror-stage` in styles.css; removing it restores the CSS fallback, which is the
   * right behaviour for a session that has ended — an empty stage has no stream to be the shape of.
   */
  private applyCaptureAspect(): void {
    const aspect = captureAspect(
      this.capture?.width && this.capture?.height
        ? { width: this.capture.width, height: this.capture.height }
        : null,
    );
    if (aspect === null) {
      this.stage.style.removeProperty('--capture-aspect');
      return;
    }
    this.stage.style.setProperty('--capture-aspect', String(aspect));
  }

  /**
   * The checks a click has to pass before it is worth sending, each with its own sentence.
   *
   * Nothing here fails silently. A dead click on a picture of a phone is indistinguishable from a
   * phone that ignored you, which is the whole failure this project keeps ruling out.
   */
  private canSend(): boolean {
    if (!this.inputAdvertised) {
      this.showInputUnavailable();
      return false;
    }
    if (this.framesDecoded === 0) {
      this.showNotice('Nothing is being mirrored yet, so there is nothing to click on.');
      return false;
    }
    if (this.awaitingFreshFrame) {
      this.showNotice('The phone just turned — waiting for the new picture before sending that.');
      return false;
    }
    return true;
  }

  private showInputUnavailable(): void {
    this.showNotice(
      'This phone is not accepting taps or typing yet.',
      'On the phone: Settings > Accessibility > Installed apps > ConnectSuite Input, and turn it on.',
    );
  }

  private onPointerDown(event: PointerEvent): void {
    this.canvas.focus();
    if (!this.canSend()) return;
    const point = this.pointAt(event);
    if (!point) {
      // Defect 19's siblings. `canSend` has a sentence for each of its three refusals; this fourth
      // path had none, and a press that vanishes is the failure step 20 exists to rule out.
      this.showNotice('The phone has not said what shape its screen is yet, so that was not sent.');
      return;
    }
    this.canvas.setPointerCapture(event.pointerId);
    this.gesture.down(point);
  }

  /**
   * Collects the drag rather than sending it.
   *
   * One `input.swipe` per pointer-move would be thirty gestures for one drag, and the phone
   * dispatches one gesture at a time — so twenty-nine of them would be dropped and the result
   * would be neither a drag nor a tap. The path is accumulated here and sent as a single stroke on
   * pointer-up, which is also what makes it a drag on the phone rather than a row of taps.
   */
  private onPointerMove(event: PointerEvent): void {
    this.gesture.move(this.pointAt(event));
  }

  private async onPointerUp(event: PointerEvent): Promise<void> {
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    const result = this.gesture.up(this.pointAt(event));

    if (result.kind === 'none') {
      // Defect 19: cancelling a press is right, doing so in silence is not. Each refusal has its own
      // sentence — `never-started` is the one that does not, because `canSend` has already put one
      // on the canvas for the reason it refused.
      if (result.reason === 'cancelled-by-turn') {
        this.showNotice(
          'The phone turned while you were pressing, so that was not sent.',
          'Click again — the Mac is showing the phone\'s new screen shape now.',
        );
      } else if (result.reason === 'geometry-gone') {
        this.showNotice('The mirror stopped while you were pressing, so that was not sent.');
      }
      return;
    }

    if (result.kind === 'tap') {
      await this.deliver(
        this.bridge.inputTap({
          x: result.x,
          y: result.y,
          durationMs: result.durationMs,
          geom: result.geom,
        }),
      );
      return;
    }

    await this.deliver(
      this.bridge.inputSwipe({
        points: result.points,
        durationMs: result.durationMs,
        geom: result.geom,
      }),
    );
  }

  /**
   * Wheel events, coalesced into one scroll per window.
   *
   * A trackpad produces these faster than any phone can dispatch gestures, so they are summed and
   * sent once — which is also closer to what the user meant: one flick, not forty.
   */
  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (!this.canSend()) return;
    const point = this.pointAt(event);
    if (!point) {
      this.showNotice('The phone has not said what shape its screen is yet, so that was not sent.');
      return;
    }

    // A wheel notch moves the *content*, and so does the protocol's dx/dy — so the signs carry
    // through unchanged and the phone works out which way the finger goes.
    const dx = -event.deltaX * WHEEL_SCALE;
    const dy = -event.deltaY * WHEEL_SCALE;
    if (this.wheel) {
      this.wheel.dx += dx;
      this.wheel.dy += dy;
    } else {
      this.wheel = { x: point.x, y: point.y, dx, dy };
    }
    if (this.wheelTimer !== null) return;
    this.wheelTimer = window.setTimeout(() => {
      this.wheelTimer = null;
      void this.flushWheel();
    }, WHEEL_WINDOW_MS);
  }

  private async flushWheel(): Promise<void> {
    const pending = this.wheel;
    this.wheel = null;
    const capture = this.capture;
    if (!pending || !capture?.width || !capture.height || capture.geometryId === undefined) return;
    if (pending.dx === 0 && pending.dy === 0) return;
    await this.deliver(
      this.bridge.inputScroll({
        x: pending.x,
        y: pending.y,
        dx: pending.dx,
        dy: pending.dy,
        geom: { id: capture.geometryId, width: capture.width, height: capture.height },
      }),
    );
  }

  /**
   * Typing on the canvas.
   *
   * Three kinds of key, and the third is the interesting one. A printable character becomes an
   * append to the focused field; Backspace, Enter and Escape become the `input.key` actions that
   * genuinely exist; and everything else is **sent anyway** so that the phone can refuse it by
   * name. That last choice is deliberate: a user who presses an arrow key deserves to read that no
   * app can synthesise one on Android, rather than to press it four more times wondering whether
   * the link is broken.
   */
  private async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (event.metaKey || event.ctrlKey) return; // Cmd-C and friends belong to the Mac.
    if (!this.inputAdvertised) {
      this.showInputUnavailable();
      return;
    }
    event.preventDefault();

    if (event.key.length === 1) {
      // One character, appended. `input.text` sets a field rather than typing into it, so an
      // append of a single character is the closest honest thing to a keypress: the phone reads
      // the field, adds the character and writes it back. Composing state and autocorrect are
      // lost — a platform limit, documented in docs/protocol.md, not a shortcut taken here.
      await this.deliver(this.bridge.inputText(event.key, 'append'));
      return;
    }
    const key = KEY_ALIASES[event.key];
    await this.deliver(this.bridge.inputKey(key ?? event.key.toLowerCase()));
  }

  // ---- overlay ----------------------------------------------------------------------------

  /**
   * The canvas never sits blank and silent; this is what goes there instead.
   *
   * [ends] is not decoration: it is the whole of the overlay-clearing rule, and every caller has
   * to have an opinion about it. See [OverlayEnds]. The default is `pixels` because most reasons
   * here mean "there is no picture yet" — the ones that do not say so explicitly.
   */
  private showReason(reason: string, fixHint?: string, ends: OverlayEnds = 'pixels'): void {
    this.overlay.hidden = false;
    this.overlayEnds = ends;
    paint(this.overlay, reason, fixHint);
  }

  /**
   * The one place an overlay comes down: when what it was waiting for has arrived.
   *
   * Callers report *evidence*, not a decision — a painted frame does not know what the overlay
   * says, and the secure-surface message does not know which frame will end it. Keeping the
   * judgement here is what stops defect 23 from being re-introduced one call site at a time.
   */
  private overlayEndedBy(evidence: 'pixels' | 'content'): void {
    if (this.overlay.hidden) return;
    if (OVERLAY_RANK[evidence] < OVERLAY_RANK[this.overlayEnds]) return;
    this.clearOverlay();
  }

  /**
   * Input feedback, over a live picture, on its own timer.
   *
   * Deliberately not [showReason]. The overlay means "there is no video and here is why", and any
   * painted frame takes it down — which is what makes a secure surface recoverable. An input
   * refusal happens while frames are still flowing at 60fps, so routing it through the overlay
   * would have shown it for one frame and then wiped it: the user clicks, nothing happens, and
   * nothing says why. That is the exact silent no-op step 20 exists to catch, and it was found by
   * reading this code rather than by running the step.
   */
  private showNotice(text: string, hint?: string): void {
    this.notice.hidden = false;
    paint(this.notice, text, hint);
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    // Long enough to read two sentences, short enough not to sit over the picture. A newer
    // message replaces an older one rather than queueing: the latest refusal is the relevant one.
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.notice.hidden = true;
      this.notice.textContent = '';
    }, NOTICE_MS);
  }

  private clearOverlay(): void {
    this.overlay.hidden = true;
    this.overlay.textContent = '';
    // Nothing is on screen, so nothing is waiting for anything. `session` rather than `pixels`
    // because an empty overlay must not be clearable — [overlayEndedBy] returns on `hidden`, and
    // this keeps the two agreeing rather than relying on that one check.
    this.overlayEnds = 'session';
  }
}

/**
 * Writes a reason and its fix hint into an element, as two lines that are also two sentences.
 *
 * The second part is why this is a function rather than two assignments. Setting `textContent` and
 * then appending a `<div class="hint">` reads correctly on screen — the hint is a block — but the
 * element's own `textContent` comes back as `...typing yet.On the phone: Settings > ...`, with the
 * two sentences run together. Anything that reads the canvas as text rather than as pixels gets
 * that string: the acceptance harness did, which is how it was found. The separator is a leading
 * space on the hint, which the block layout swallows and a string read does not.
 */
function paint(target: HTMLElement, text: string, hint?: string): void {
  target.textContent = text;
  if (!hint) return;
  const line = document.createElement('div');
  line.className = 'hint';
  line.textContent = ` ${hint}`;
  target.appendChild(line);
}

/** How long an input refusal stays on the picture. Two sentences' worth of reading. */
const NOTICE_MS = 6_000;

/**
 * Encoded keyframe size, in bytes, below which the picture is judged blank rather than dark.
 *
 * Twin of `BlackFrameDetector.maxBytes` in
 * mirror-module/.../mirror/v2/ScreenEncoder.kt, and it has to stay equal to it: the phone decides
 * on that number whether to *say* the surface is secure, and this decides on the same number
 * whether the sentence may come off the canvas. A looser number here would wipe the message over
 * frames the phone still calls blank, which is defect 23 with an extra step.
 *
 * Not imported from shared/protocol.ts because this file is module-free on purpose — see the file
 * comment. One definition per side is the rule; this is the Mac's.
 *
 * Android renders FLAG_SECURE content as solid black and H.264 compresses a solid frame to almost
 * nothing: the Knox `ConfirmLockPassword` screen in step 28 keyframed at 511 bytes. A real screen,
 * however dark, carries noise and never compresses that hard repeatedly.
 */
const BLANK_KEYFRAME_BYTES = 2_000;

/** Rolling window for fps, matching the main process's bitrate window. */
const RATE_WINDOW_MS = 3_000;

/*
 * The gesture constants and the recogniser that uses them moved to `pointerGestures.ts` on
 * 2026-09-14, so the float window shares them rather than copying them. See that file's header.
 */

/**
 * Wheel delta to capture pixels.
 *
 * macOS reports pixel deltas already, so this is close to 1:1 — slightly under, because a phone's
 * scrolling is tuned for a finger travelling a shorter distance than a trackpad flick does.
 */
const WHEEL_SCALE = 0.8;

/** How long wheel events are gathered before one scroll is sent. About four trackpad frames. */
const WHEEL_WINDOW_MS = 60;

/**
 * Mac key names to the phone's `input.key` names.
 *
 * Escape is Back because that is what every user expects, and because there is no Escape on a
 * phone to send. Everything absent from here is passed through as typed and refused by name.
 */
const KEY_ALIASES: Record<string, string> = {
  Backspace: 'backspace',
  Delete: 'backspace',
  Enter: 'enter',
  Escape: 'back',
  Home: 'home',
};

/** About 4 seconds of frames at 60fps: enough to see a spike without averaging it away. */
const LATENCY_SAMPLES = 240;

/**
 * How many arrival stamps may be in flight at once.
 *
 * Generous next to the handful a decoder actually holds — this is a leak bound, not a queue depth.
 */
const ARRIVAL_STAMPS = 600;

/**
 * Median, not mean: one scheduling stall should not move the number the HUD reports.
 *
 * Nulls are dropped rather than counted as zero. A half that could not be measured — a frame the
 * decoder handed back with no arrival stamp — must not pull the figure towards zero and make the
 * link look faster than it is.
 */
function median(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) return null;
  const sorted = known.sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]!);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
