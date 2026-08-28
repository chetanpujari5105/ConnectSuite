import type { Duplex } from 'node:stream';
import { MAX_FRAME } from '../shared/protocol';

/**
 * 4-byte big-endian length, then payload — the framing every ConnectSuite channel uses.
 *
 * Reassembly lives here so no channel has to think about TCP giving it half a header; a length
 * prefix beyond the cap closes the socket instead of buffering whatever a peer asks for.
 */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    private readonly onFrame: (frame: Buffer) => void,
    private readonly onProtocolError: (message: string) => void,
    private readonly maxLength: number = MAX_FRAME,
  ) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    for (;;) {
      if (this.buffer.length < 4) return;
      const length = this.buffer.readUInt32BE(0);
      if (length > this.maxLength) {
        this.onProtocolError(`Frame length ${length} exceeds ${this.maxLength}`);
        return;
      }
      if (this.buffer.length < 4 + length) return;
      const frame = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      this.onFrame(frame);
    }
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

export function writeFrame(socket: Duplex, payload: Buffer): void {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  socket.write(header);
  socket.write(payload);
}
