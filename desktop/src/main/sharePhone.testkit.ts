import { createHash, randomBytes } from 'node:crypto';
import { createServer, connect, type AddressInfo, type Server, type Socket } from 'node:net';
import { FrameReader, writeFrame } from './framing';
import { MAX_BULK_FRAME, MAX_BULK_HEADER_FRAME } from '../shared/protocol';
import type { ShareConnection } from './bulk';

/**
 * A fake phone bulk port for the share tests: a **real local TCP socket** speaking the same framing
 * as the phone's `BulkTransfers.streamTo` — the Mac writes a token frame and a header frame, the
 * phone answers with chunk frames and closes. Plain TCP stands in for TLS; everything after the
 * handshake is the product's own code (`pullShareWith`, `FrameReader`, the digest, the publish).
 *
 * The behaviours are the failures the contract names: truncate, corrupt one byte, stall, over-send.
 */
export interface PhoneBehaviour {
  bytes: Buffer;
  chunkSize?: number;
  /** Send only this many bytes, then close. */
  truncateTo?: number;
  /** Flip this byte on the wire (the phone's digest in the offer still covers the true bytes). */
  corruptAt?: number;
  /** Send this many bytes, then go silent without closing. */
  stallAfter?: number;
  /** Append this many extra bytes. */
  extra?: number;
}

export interface FakePhone {
  port: number;
  /** Token and header frames exactly as the Mac sent them. */
  seen: { token: string | null; header: Record<string, unknown> | null }[];
  open(): ShareConnection;
  close(): Promise<void>;
}

/** Random synthetic bytes and their SHA-256 — never a real file. */
export function synthetic(size: number): { bytes: Buffer; sha256: string } {
  const bytes = size === 0 ? Buffer.alloc(0) : randomBytes(size);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function startFakePhone(behaviour: PhoneBehaviour): Promise<FakePhone> {
  const seen: FakePhone['seen'] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    const record: FakePhone['seen'][number] = { token: null, header: null };
    seen.push(record);
    let frames = 0;
    const reader = new FrameReader(
      (frame) => {
        frames += 1;
        if (frames === 1) {
          record.token = frame.toString('utf8');
          return;
        }
        if (frames === 2) {
          record.header = JSON.parse(frame.toString('utf8')) as Record<string, unknown>;
          void serve(socket, behaviour);
        }
      },
      () => socket.destroy(),
      MAX_BULK_HEADER_FRAME,
    );
    socket.on('data', (d: Buffer) => reader.push(d));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    seen,
    open: () => ({ socket: connect(port, '127.0.0.1'), readyEvent: 'connect' }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

async function serve(socket: Socket, b: PhoneBehaviour): Promise<void> {
  let data = Buffer.from(b.bytes);
  if (b.corruptAt !== undefined && b.corruptAt < data.length) {
    data.writeUInt8(data.readUInt8(b.corruptAt) ^ 0xff, b.corruptAt);
  }
  if (b.extra) data = Buffer.concat([data, randomBytes(b.extra)]);
  const limit = b.truncateTo ?? b.stallAfter ?? data.length;
  const chunk = b.chunkSize ?? 256 * 1024;
  for (let at = 0; at < limit; at += chunk) {
    if (socket.destroyed) return;
    writeFrame(socket, data.subarray(at, Math.min(at + chunk, limit)), MAX_BULK_FRAME);
    await new Promise((r) => setImmediate(r));
  }
  if (b.stallAfter !== undefined) return; // silent, socket left open
  socket.end();
}
