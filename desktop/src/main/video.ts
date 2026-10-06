import { EventEmitter } from 'node:events';
import type { TLSSocket } from 'node:tls';
import { CANDIDATE_TIMEOUT_MS } from './discovery';
import type { Identity } from './identity';
import { log } from './logger';
import { writeFrame } from './framing';
import { PINNED_EVENT, pinnedTlsConnect } from './pinnedTls';
import { PORT_VIDEO, MAX_FRAME } from '../shared/protocol';

/** Header size and flags from docs/protocol.md. Must match VideoChannel.kt. */
const HEADER_BYTES = 13;
const FLAG_KEYFRAME = 0x01;
const FLAG_CONFIG = 0x02;

/** Rolling window for the HUD's bitrate and arrival rate. Long enough to survive one GOP. */
const RATE_WINDOW_MS = 3_000;

export interface VideoFrame {
  keyframe: boolean;
  config: boolean;
  ptsUs: number;
  data: Buffer;
  /**
   * When this frame finished arriving on the Mac, by `Date.now()`.
   *
   * Stamped here rather than in the renderer because here is where the bytes actually land; by
   * the time the renderer sees it, the figure would include IPC and would no longer separate
   * "the link was slow" from "this Mac was slow", which is the whole reason the HUD splits them.
   */
  arrivedAt: number;
}

/**
 * Reads the phone's H.264 stream off port 42502.
 *
 * The token frame goes out with the standard 4-byte length prefix; everything coming back uses
 * the 13-byte video header instead and carries no outer prefix (see docs/protocol.md). Getting
 * that asymmetry wrong desynchronises every frame after the first, so the parser below is
 * deliberately strict: a length over MAX_FRAME closes the socket rather than trying to resync.
 *
 * Decoding does not happen here. The main process owns the socket and forwards access units to
 * the renderer, which has WebCodecs and a GPU; pulling a decoder into the main process would put
 * an H.264 pipeline on the thread that also runs the control channel.
 */
export class VideoClient extends EventEmitter {
  private socket: TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private running = false;

  private framesReceived = 0;
  private bytesReceived = 0;
  private lastConfig: VideoFrame | null = null;

  /**
   * Arrival times and sizes over the last few seconds, for the HUD's bitrate.
   *
   * A cumulative average over the session is the wrong number to show: it hides the thing the
   * HUD exists to catch, which is the link degrading *now*. This is a plain ring trimmed by age
   * on each frame, so it costs nothing to keep and always describes the recent past.
   */
  private recent: Array<{ at: number; bytes: number }> = [];

  /**
   * [expectedPeer] is the control session's phone fingerprint, or null with no session; the video
   * socket is pinned to it (audit S2). [port] is for loopback tests; the product uses [PORT_VIDEO].
   */
  constructor(
    private readonly identity: Identity,
    private readonly expectedPeer: () => string | null,
    private readonly port: number = PORT_VIDEO,
  ) {
    super();
  }

  isOpen(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /**
   * `kbps` and `framesPerSecond` are **live rates over the last few seconds**, and are null when
   * there is no recent traffic to compute one from — a session that has ended, or one whose first
   * frames landed too recently to divide by.
   *
   * Null rather than zero on purpose. `frames` is cumulative and survives the end of a session,
   * so a zero next to it reads as "frames are arriving at a rate of zero", which is not a thing
   * that happens; it sent a real reader looking for a bug in the fps arithmetic when the session
   * had simply stopped. Null renders as an em dash and cannot be misread as a measurement.
   */
  stats(): { frames: number; bytes: number; kbps: number | null; framesPerSecond: number | null } {
    const now = Date.now();
    this.trimRecent(now);
    const oldest = this.recent[0]?.at;
    const seconds = oldest === undefined ? 0 : (now - oldest) / 1000;
    if (seconds < 0.2) {
      return {
        frames: this.framesReceived,
        bytes: this.bytesReceived,
        kbps: null,
        framesPerSecond: null,
      };
    }
    const bytes = this.recent.reduce((total, entry) => total + entry.bytes, 0);
    return {
      frames: this.framesReceived,
      bytes: this.bytesReceived,
      kbps: Math.round((bytes * 8) / seconds / 1000),
      framesPerSecond: Math.round(this.recent.length / seconds),
    };
  }

  private trimRecent(now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    while (this.recent.length > 0 && this.recent[0]!.at < cutoff) this.recent.shift();
  }

  /**
   * Opens the video socket and authorises it with the control session's token.
   *
   * Resolves once the socket is up; frames arrive on the `frame` event. Rejects with a reason
   * string suitable for showing the user — an unexplained blank canvas is the failure mode this
   * whole path exists to avoid.
   */
  open(host: string, token: string): Promise<void> {
    this.close('reopening');
    this.running = true;
    this.framesReceived = 0;
    this.bytesReceived = 0;
    this.recent = [];

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        log.warn('video', `Video socket failed: ${reason}`);
        this.close(reason);
        reject(new Error(reason));
      };

      // Pinned to the control session's phone before the token is written (audit S2, `pinnedTls.ts`).
      const socket = pinnedTlsConnect({
        host,
        port: this.port,
        identity: this.identity,
        expectedPeer: this.expectedPeer,
        timeoutMs: CANDIDATE_TIMEOUT_MS,
      });
      this.socket = socket;

      socket.setTimeout(CANDIDATE_TIMEOUT_MS, () => fail('the phone did not answer on the video port'));
      socket.once('error', (error) => fail(error.message));

      socket.once(PINNED_EVENT, () => {
        socket.setTimeout(0);
        socket.setNoDelay(true);
        // The token proves this socket belongs to a live control session. The phone drops it
        // after TOKEN_GRACE_MS if this does not arrive.
        writeFrame(socket, Buffer.from(token, 'utf8'));
        log.info('video', `Video socket open to ${host}:${this.port}`);
        // Frames are read only from a verified peer: nothing an unverified one sent is decoded.
        socket.on('data', (chunk: Buffer) => this.consume(chunk));
        settled = true;
        resolve();
      });

      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = null;
          if (this.running) this.emit('closed', 'the phone closed the video connection');
        }
      });
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    for (;;) {
      if (this.buffer.length < HEADER_BYTES) return;

      const flags = this.buffer.readUInt8(0);
      // PTS is 8 bytes; readBigUInt64BE then narrowed. Microseconds since capture start stays
      // far inside Number.MAX_SAFE_INTEGER (about 285 years), so this cannot lose precision.
      const ptsUs = Number(this.buffer.readBigUInt64BE(1));
      const length = this.buffer.readUInt32BE(9);

      if (length > MAX_FRAME) {
        // Resyncing a corrupted H.264 stream is not worth attempting: close and let the mirror
        // restart cleanly rather than feeding a decoder garbage.
        log.error('video', `Frame length ${length} exceeds the ${MAX_FRAME} cap; closing`);
        this.close('the video stream desynchronised');
        this.emit('closed', 'the video stream desynchronised');
        return;
      }
      if (this.buffer.length < HEADER_BYTES + length) return;

      const data = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length);
      this.buffer = this.buffer.subarray(HEADER_BYTES + length);

      const frame: VideoFrame = {
        keyframe: (flags & FLAG_KEYFRAME) !== 0,
        config: (flags & FLAG_CONFIG) !== 0,
        ptsUs,
        // Copy: subarray aliases the accumulator, which is about to be reassigned.
        data: Buffer.from(data),
        arrivedAt: Date.now(),
      };

      this.framesReceived += 1;
      this.bytesReceived += length;
      if (frame.config) {
        this.lastConfig = frame;
      } else {
        const now = Date.now();
        this.recent.push({ at: now, bytes: length });
        this.trimRecent(now);
      }

      this.emit('frame', frame);
    }
  }

  /** The retained SPS/PPS, for a decoder that has to be rebuilt mid-stream. */
  configFrame(): VideoFrame | null {
    return this.lastConfig;
  }

  close(reason = 'closed'): void {
    this.running = false;
    this.buffer = Buffer.alloc(0);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners('close');
      socket.destroy();
      log.info('video', `Video socket closed: ${reason}`);
    }
  }
}
