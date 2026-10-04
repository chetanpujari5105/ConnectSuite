/**
 * Camera v2 (Sidekick Camera), the pieces of the wire Electron main needs — docs/protocol.md → Webcam.
 *
 * Main-process only: `index.html` does not load this file, so it is an ordinary module with exports.
 * Electron-free, so its tests run it against the golden access unit `docs/fixtures/webcam-au-v1.hex`.
 *
 * ### What main reads, and what it leaves to the bridge
 *
 * Main splits the claimed 42502 socket into access units and hands each one to the bridge
 * **verbatim**. The bridge (`desktop/native/SidekickCamera`, `WebcamAUCodec` + `SessionGate`) is the
 * one full implementation of the AU rules: NAL structure, the IDR-with-SPS-and-PPS rule per generation,
 * sequence and PTS order. Main does not carry a second copy of those rules. It reads only what it must
 * act on itself:
 *
 * - the 13-byte frame header's **length**, refused before the body is buffered (2 MiB cap);
 * - its **flags**, for the keyframe rule at the main → bridge bound;
 * - the webcam header's **version** and **codec**, so a stream that is not this one is closed;
 * - the webcam header's **generation**, so a stale generation is not forwarded.
 *
 * A stream main cannot frame is closed, never resynced — a resync heuristic is how a garbled AU ends up
 * fed to a decoder as though it were the phone's camera.
 *
 * **Not on the wire.** The four message names below are deliberately **not** in `MessageType`:
 * `scripts/check-protocol-spec.mjs` lists them as specified-not-on-the-wire, and no phone implements
 * them yet (W2). They are named here only for the W3 controller, which no part of the running app
 * constructs.
 */

/** The four `webcam.*` messages. Local to Camera v2's controller until W2 exists and wiring is approved. */
export const WebcamMessage = Object.freeze({
  REQUEST: 'webcam.request',
  STATE: 'webcam.state',
  STOP: 'webcam.stop',
  SWITCH: 'webcam.switch',
} as const);

/**
 * `webcam.stop`'s `cause`, and the phone's `stopped` `reason` each one produces — docs/protocol.md →
 * `webcam.stop`. Held to `docs/fixtures/webcam-vocabulary-v1.json`, which the phone reads too.
 *
 * `failure` was added on 2026-10-04 (W3 correction): before it, a Mac that could not continue — its
 * stream, its bridge or Sidekick Camera failing — said `shutdown`, which the phone words as the Mac
 * stopping it on purpose.
 */
export const WEBCAM_STOP_REASON_FOR_CAUSE = Object.freeze({
  person: 'stopped-by-mac',
  'no-consumers': 'no-consumers',
  shutdown: 'stopped-by-mac',
  failure: 'mac-failed',
} as const);
export type WebcamStopCause = keyof typeof WEBCAM_STOP_REASON_FOR_CAUSE;

/** `detail` with cause `failure`: what failed on the Mac. A closed set; the phone never displays it. */
export const WEBCAM_FAILURE_DETAILS = Object.freeze([
  'stream-malformed',
  'stream-unavailable',
  'bridge-failed',
  'producer-refused',
  'device-unavailable',
  'no-answer',
] as const);
export type WebcamFailureDetail = (typeof WEBCAM_FAILURE_DETAILS)[number];

/** What a `webcam.stop` carries besides the session: a cause, and a detail only with `failure`. */
export type WebcamWireStop =
  | { cause: Exclude<WebcamStopCause, 'failure'> }
  | { cause: 'failure'; detail: WebcamFailureDetail };

/** The phone's closed set of `stopped` reasons — docs/protocol.md → `webcam.state`. */
export const WEBCAM_STOPPED_REASONS = Object.freeze([
  'declined', 'expired', 'permission-denied', 'camera-unavailable', 'camera-in-use', 'stopped-by-mac',
  'mac-failed', 'no-consumers', 'stopped-on-phone', 'left-screen', 'stream-closed', 'capture-failed',
  'too-hot',
] as const);

/** The capability and the `ext` key share one name. */
export const WEBCAM = 'webcam';
/** The `ext` version this Mac implements. */
export const WEBCAM_EXT_VERSION = 1;
/** The release twin of the phone's `Extensions.WEBCAM_RELEASE`. Flipped only in a commit with its evidence. */
export const WEBCAM_RELEASE = false;

export const FRAME_HEADER_BYTES = 13;
export const WEBCAM_HEADER_BYTES = 16;
/** `WEBCAM_MAX_AU`: one access unit's payload, header included. */
export const WEBCAM_MAX_AU = 2 * 1024 * 1024;
/** The header, a 4-byte start code and one NAL header byte. */
export const WEBCAM_MIN_PAYLOAD = 21;
export const WEBCAM_VERSION = 1;
export const WEBCAM_CODEC_H264 = 1;

const SESSION_ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[0-9a-f]{64}$/;

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

/**
 * The claim a webcam socket opens with — docs/protocol.md → The webcam stream claim on 42502.
 * 104 bytes. Throws rather than building a claim from anything malformed.
 */
export function webcamClaim(token: string, sessionId: string): string {
  if (!TOKEN.test(token)) throw new Error('webcam claim: the session token is not 64 hex digits');
  if (!isSessionId(sessionId)) throw new Error('webcam claim: the sessionId is not 32 lowercase hex digits');
  return `${token} webcam ${sessionId}`;
}

/**
 * Whether this Mac advertises `ext.webcam` — docs/protocol.md → Development and release gates. Both
 * must hold: the development gate (unpackaged, with the development switch on) or the release flag,
 * **and** the bridge helper present beside the app.
 *
 * Not called by the running app. `MAC_EXT` is unchanged; wiring this into `hello` is a separate step.
 */
export function webcamExt(opts: {
  packaged: boolean;
  devSwitch: boolean;
  bridgePresent: boolean;
  release?: boolean;
}): Readonly<Record<string, number>> {
  const gateOpen = (!opts.packaged && opts.devSwitch) || (opts.release ?? WEBCAM_RELEASE);
  return gateOpen && opts.bridgePresent ? { [WEBCAM]: WEBCAM_EXT_VERSION } : {};
}

/** A stream main cannot frame. The socket is closed; `reason` is for the log and the pane. */
export class WebcamStreamError extends Error {
  constructor(readonly reason: string) {
    super(`webcam stream: ${reason}`);
  }
}

/** One access unit as main forwards it: the whole frame, verbatim, and the few fields main acts on. */
export interface WebcamFrame {
  /** Frame header and payload, exactly as they arrived. A copy, never an alias of the reader's buffer. */
  bytes: Buffer;
  /** Flags bits 0 and 1 both set: an IDR carrying SPS and PPS — where a broken chain can resume. */
  keyframe: boolean;
  generation: number;
}

/**
 * Splits the claimed socket's byte stream into access units. `push` returns every whole AU the chunk
 * completes and throws {@link WebcamStreamError} on the first one main cannot frame; after a throw the
 * reader is spent. The buffer never holds more than one AU's header and body.
 */
export class WebcamStreamReader {
  private buffer: Buffer = Buffer.alloc(0);
  private broken = false;

  /** Bytes held for an AU not yet complete — the bound the tests read. */
  get buffered(): number {
    return this.buffer.length;
  }

  push(chunk: Buffer): WebcamFrame[] {
    if (this.broken) throw new WebcamStreamError('reader already closed by an earlier malformed access unit');
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const out: WebcamFrame[] = [];
    try {
      for (;;) {
        if (this.buffer.length < FRAME_HEADER_BYTES) break;
        const length = this.buffer.readUInt32BE(9);
        // Before waiting for the body: a lying length cannot make this side buffer it.
        if (length > WEBCAM_MAX_AU) throw new WebcamStreamError(`length ${length} is over the ${WEBCAM_MAX_AU}-byte cap`);
        if (length < WEBCAM_MIN_PAYLOAD) throw new WebcamStreamError(`payload of ${length} bytes is under ${WEBCAM_MIN_PAYLOAD}`);
        if (this.buffer.length < FRAME_HEADER_BYTES + length) break;
        out.push(readFrame(this.buffer.subarray(0, FRAME_HEADER_BYTES + length)));
        this.buffer = this.buffer.subarray(FRAME_HEADER_BYTES + length);
      }
    } catch (error) {
      this.broken = true;
      this.buffer = Buffer.alloc(0);
      throw error;
    }
    if (this.buffer.length > 0 && this.buffer.byteOffset !== 0) this.buffer = Buffer.from(this.buffer);
    return out;
  }
}

function readFrame(bytes: Buffer): WebcamFrame {
  const flags = bytes.readUInt8(0);
  if ((flags & ~0x03) !== 0) throw new WebcamStreamError(`reserved frame flag bits set (${flags})`);
  const h = FRAME_HEADER_BYTES;
  const version = bytes.readUInt8(h);
  const codec = bytes.readUInt8(h + 1);
  if (version !== WEBCAM_VERSION) throw new WebcamStreamError(`version ${version} is not ${WEBCAM_VERSION}`);
  if (codec !== WEBCAM_CODEC_H264) throw new WebcamStreamError(`codec ${codec} is not H.264`);
  const generation = bytes.readUInt16BE(h + 6);
  if (generation === 0) throw new WebcamStreamError('generation 0');
  return { bytes: Buffer.from(bytes), keyframe: (flags & 0x03) === 0x03, generation };
}

/**
 * A bounded queue of access units with the contract's keyframe rule (docs/protocol.md → Bounded
 * buffering): when full, an IDR with SPS and PPS replaces everything waiting, and anything else is
 * dropped — and once anything has been dropped, every non-keyframe is dropped until the next keyframe,
 * because a decoder that missed a reference cannot show what follows it. AUs are never superseded one
 * by one: skipping one breaks H.264's reference chain.
 */
export class KeyframeQueue<T> {
  private items: Array<{ item: T; keyframe: boolean }> = [];
  private awaitingKeyframe = false;
  /** AUs this queue refused or discarded under the bound. */
  dropped = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('KeyframeQueue capacity must be ≥ 1');
  }

  get length(): number {
    return this.items.length;
  }

  /** Whether a keyframe is needed before anything else may pass. */
  get waitingForKeyframe(): boolean {
    return this.awaitingKeyframe;
  }

  /**
   * Offers [item]. [inFlight] is how many of the capacity's slots the caller holds outside this queue
   * (an AU handed to a pipe that has not taken it yet). Returns whether it was taken.
   */
  offer(item: T, keyframe: boolean, inFlight = 0): boolean {
    let free = this.capacity - inFlight - this.items.length;
    if (keyframe) {
      if (free <= 0) {
        // Everything waiting predates this keyframe and is useless now.
        this.dropped += this.items.length;
        this.items = [];
        free = this.capacity - inFlight;
      }
      if (free <= 0) {
        // Every slot is in flight: nothing can be held, so the keyframe itself is the drop.
        this.dropped += 1;
        this.awaitingKeyframe = true;
        return false;
      }
      this.awaitingKeyframe = false;
      this.items.push({ item, keyframe });
      return true;
    }
    if (this.awaitingKeyframe || free <= 0) {
      this.dropped += 1;
      this.awaitingKeyframe = true;
      return false;
    }
    this.items.push({ item, keyframe });
    return true;
  }

  shift(): T | undefined {
    return this.items.shift()?.item;
  }

  /** Removes everything matching [predicate]; returns how many. Not counted as a drop by the bound. */
  removeWhere(predicate: (item: T) => boolean): number {
    const before = this.items.length;
    this.items = this.items.filter((entry) => !predicate(entry.item));
    return before - this.items.length;
  }

  clear(): number {
    const n = this.items.length;
    this.items = [];
    this.awaitingKeyframe = false;
    return n;
  }
}
