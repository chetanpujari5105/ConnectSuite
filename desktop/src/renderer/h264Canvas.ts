/**
 * H.264 access units in, painted canvas out. The float window's decoder.
 *
 * This is the part of `mirror.ts`'s frame path that has nothing to do with the Mirror pane: retain
 * the parameter sets, refuse to start on a P-frame, carry SPS/PPS in front of the first IDR, decode,
 * paint. No overlay, no HUD, no latency split, no input — the detached window draws a picture and
 * that is all the handoff asks of it (*"Contains only the title bar and the phone screen"*).
 *
 * ### Two properties that are not obvious and both come from a real failure
 *
 *  1. **The parameter sets are prepended, not passed as a `description`.** The phone sends Annex B
 *     start codes. Supplying a `description` to `VideoDecoder.configure` selects AVCC instead, and
 *     the stream then fails to decode from the first byte. Omitting it is what puts WebCodecs in
 *     Annex B mode, and the SPS/PPS have to reach the decoder *in band*, ahead of the first IDR.
 *  2. **Decoding starts on a keyframe or not at all.** A P-frame handed to a fresh decoder has no
 *     reference and paints green mush, which looks like a broken picture rather than like a window
 *     that opened mid-stream. So the first non-key frame is dropped and an IDR is requested.
 *
 * Property 2 is what makes the detached window possible at all: it opens into a stream that is
 * already running, with no config frame of its own coming. `main.ts` replays the retained config and
 * asks the phone for a keyframe on open; this class is what survives the gap in between.
 *
 * ### Why this file exists rather than a copy inside float.ts
 *
 * The same rule reaches it twice: two copies of one decoding rule drift, and the second copy is the
 * one that does not get the fix. `mirror.ts` still holds its own — it interleaves latency stamps,
 * keyframe sizing and the overlay decision into the same callbacks, and untangling a pane that
 * passed on hardware in Phase 2 is not this slice's work. **That is a known duplication with a named
 * owner**, recorded in `docs/design-departures.md` rather than left for someone to discover.
 *
 * Plain script, not a module: the CSP-locked page has no module loader, so the class is a top-level
 * declaration that `float.ts` simply has in scope, and the `module.exports` shim at the foot is what
 * `node --test` reaches. Same shape as `notifyLabels.ts` and `renderer/calls.ts`.
 */

interface H264Frame {
  keyframe: boolean;
  config?: boolean;
  ptsUs: number;
  data: Uint8Array;
}

interface H264CanvasHooks {
  /** Asks the phone for an IDR. The float window has no other way out of a mid-stream start. */
  requestKeyframe(): void;
  /** First painted frame, and every failure. Both are things the window has to say out loud. */
  onPainted?(): void;
  onFailed?(reason: string): void;
}

class H264Canvas {
  private decoder: VideoDecoder | null = null;

  /** The retained SPS/PPS, prepended to the first IDR after every (re)configure. */
  private configBytes: Uint8Array | null = null;

  /** True from a fresh decoder until an IDR has been fed to it. */
  private awaitingKeyframe = true;

  private painted = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: H264CanvasHooks,
  ) {}

  framesPainted(): number {
    return this.painted;
  }

  /**
   * One access unit from the main process.
   *
   * A config frame rebuilds the decoder rather than being decoded — it is the thing that describes
   * the stream, and a stream whose parameter sets changed cannot be decoded by the old decoder.
   */
  push(frame: H264Frame): void {
    if (frame.config) {
      this.configBytes = frame.data;
      this.configure();
      return;
    }

    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured') return;

    let data = frame.data;
    if (this.awaitingKeyframe) {
      if (!frame.keyframe) {
        // Not a failure and not surfaced as one: this is the normal state of a window that opened
        // mid-stream, and it lasts exactly as long as the phone takes to answer.
        this.hooks.requestKeyframe();
        return;
      }
      this.awaitingKeyframe = false;
      if (this.configBytes) {
        const withParameterSets = new Uint8Array(this.configBytes.length + data.length);
        withParameterSets.set(this.configBytes, 0);
        withParameterSets.set(data, this.configBytes.length);
        data = withParameterSets;
      }
    }

    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: frame.keyframe ? 'key' : 'delta',
          timestamp: frame.ptsUs,
          data,
        }),
      );
    } catch (error) {
      this.fail(`the Mac could not decode the phone's video (${h264ErrorText(error)})`);
    }
  }

  /** Drops the decoder and rearms the keyframe gate. The next config or IDR starts a fresh one. */
  teardown(): void {
    const decoder = this.decoder;
    this.decoder = null;
    this.awaitingKeyframe = true;
    if (!decoder) return;
    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch {
      // A decoder that is already gone is the state we wanted; there is nothing to report.
    }
  }

  private configure(): void {
    this.teardown();
    const context = this.canvas.getContext('2d');
    if (!context) {
      this.fail('this Mac could not open a 2D canvas to draw the phone screen on');
      return;
    }

    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (
            this.canvas.width !== frame.displayWidth ||
            this.canvas.height !== frame.displayHeight
          ) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
          }
          context.drawImage(frame, 0, 0);
          this.painted += 1;
          this.hooks.onPainted?.();
        } finally {
          // VideoFrame holds a GPU buffer; not closing it stalls the decoder within a second.
          frame.close();
        }
      },
      error: (error) => this.fail(`the Mac's H.264 decoder failed (${h264ErrorText(error)})`),
    });

    try {
      decoder.configure({
        // avc1.640028 = High profile, level 4.0 — what MediaCodec produces for 1080p60 on this
        // phone. `description` is deliberately omitted; see the Annex B note at the top.
        codec: 'avc1.640028',
        optimizeForLatency: true,
      });
    } catch (error) {
      this.fail(`this Mac's H.264 decoder would not start (${h264ErrorText(error)})`);
      return;
    }

    this.decoder = decoder;
    this.awaitingKeyframe = true;
    // The stream is already running, so nothing will arrive marked "config" again on its own.
    this.hooks.requestKeyframe();
  }

  private fail(reason: string): void {
    this.teardown();
    this.hooks.onFailed?.(reason);
  }
}

/**
 * Named `h264ErrorText` rather than `messageOf` or `describe` on purpose.
 *
 * Every renderer file is a classic script sharing one global scope, so a top-level function here
 * is a global everywhere. `mirror.ts` already declares `messageOf`, and `describe` is a global in
 * a test runner. Either name would be a silent redefinition rather than an error.
 */
function h264ErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Reachable from float.ts (plain scripts, one global scope) and from `node --test` (the shim).
// `typeof` on an undeclared identifier is safe in JS, so this is a no-op in the browser and does
// not turn the file into a CommonJS module — which would break the no-module-loader page.
if (typeof module !== 'undefined') {
  module.exports = { H264Canvas, h264ErrorText };
}
