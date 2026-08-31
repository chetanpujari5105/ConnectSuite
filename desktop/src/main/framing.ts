import type { Duplex } from 'node:stream';
import { MAX_BULK_FRAME, MAX_BULK_HEADER_FRAME, MAX_FRAME } from '../shared/protocol';
import { FrameTally } from '../shared/frameTally';

/**
 * 4-byte big-endian length, then payload — the framing every ConnectSuite channel uses.
 *
 * Reassembly lives here so no channel has to think about TCP giving it half a header; a length
 * prefix beyond the cap closes the socket instead of buffering whatever a peer asks for.
 *
 * The cap is a parameter, never a constant read inside a feature. A second check written into the
 * file-transfer code would be a second answer to the same question, free to drift from this one.
 */
export class FrameReader {
  constructor(
    private readonly onFrame: (frame: Buffer) => void,
    private readonly onProtocolError: (message: string) => void,
    private maxLength: number = MAX_FRAME,
    private readonly tally: FrameTally | null = null,
    private kind: string = 'Frame',
  ) {}

  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Changes the cap applied to the frames that follow.
   *
   * The bulk channel needs this because it carries two frame shapes under two caps on one socket:
   * a small JSON header, then chunks. Which one comes next is transfer state, which the reader
   * cannot know and the caller does.
   */
  setMaxLength(maxLength: number, kind: string): void {
    this.maxLength = maxLength;
    this.kind = kind;
  }

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    for (;;) {
      if (this.buffer.length < 4) return;
      const length = this.buffer.readUInt32BE(0);
      if (length > this.maxLength) {
        this.onProtocolError(this.refusal(length));
        return;
      }
      if (this.buffer.length < 4 + length) return;
      const frame = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      this.tally?.accept(length);
      this.onFrame(frame);
    }
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  private refusal(length: number): string {
    return (
      this.tally?.reject(this.kind, length, this.maxLength) ??
      `${this.kind} length ${length} exceeds ${this.maxLength}`
    );
  }
}

/** Thrown when we would have put a frame past its cap on the wire. */
export class FrameTooLargeError extends Error {}

/**
 * Writes one frame, refusing to emit a payload past `maxLength`.
 *
 * The write side matters as much as the read side and catches a different bug: the read side
 * catches a peer that has lost sync, the write side catches *us* — an adaptive chunk size that ran
 * away, a header that grew a field nobody sized. VideoChannel.writeFrame on the phone has refused
 * over-size frames since Phase 2 for exactly this reason.
 */
export function writeFrame(
  socket: Duplex,
  payload: Buffer,
  maxLength: number = MAX_FRAME,
  tally: FrameTally | null = null,
  kind = 'Frame',
): void {
  if (payload.length > maxLength) {
    throw new FrameTooLargeError(
      tally?.reject(kind, payload.length, maxLength) ??
        `${kind} length ${payload.length} exceeds ${maxLength}`,
    );
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  socket.write(header);
  socket.write(payload);
  tally?.accept(payload.length);
}

const BULK_HEADER = 'Bulk header';
const BULK_CHUNK = 'Bulk chunk';

/**
 * The bulk channel's two caps, at the call site, over one shared tally.
 *
 * It holds no comparison of its own — every length is judged inside FrameReader and writeFrame.
 * All this decides is *which* cap applies to the frame being read or written, which is the thing a
 * feature legitimately knows and the framing layer cannot.
 *
 * `onViolation` is how a refusal reaches the socket: the transfer code wires it to log the line and
 * destroy the socket. A length prefix is either right or the stream is lost, and there is no third
 * case worth resyncing to — the same reasoning video.ts already carries.
 *
 * Twin of BulkFraming in core/.../link/Framing.kt.
 */
export class BulkFraming {
  readonly tally = new FrameTally('bulk');
  readonly reader: FrameReader;

  constructor(
    onFrame: (frame: Buffer) => void,
    private readonly onViolation: (message: string) => void,
  ) {
    this.reader = new FrameReader(
      onFrame,
      onViolation,
      MAX_BULK_HEADER_FRAME,
      this.tally,
      BULK_HEADER,
    );
  }

  /** The next frame off the wire is a transfer header. */
  expectHeader(): void {
    this.reader.setMaxLength(MAX_BULK_HEADER_FRAME, BULK_HEADER);
  }

  /** The next frames off the wire are payload chunks. */
  expectChunk(): void {
    this.reader.setMaxLength(MAX_BULK_FRAME, BULK_CHUNK);
  }

  writeHeader(socket: Duplex, payload: Buffer): void {
    this.guarded(() => writeFrame(socket, payload, MAX_BULK_HEADER_FRAME, this.tally, BULK_HEADER));
  }

  writeChunk(socket: Duplex, payload: Buffer): void {
    this.guarded(() => writeFrame(socket, payload, MAX_BULK_FRAME, this.tally, BULK_CHUNK));
  }

  private guarded(body: () => void): void {
    try {
      body();
    } catch (error) {
      if (error instanceof FrameTooLargeError) this.onViolation(error.message);
      throw error;
    }
  }
}
