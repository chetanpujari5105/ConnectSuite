import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { CANDIDATE_TIMEOUT_MS } from './discovery';
import { FrameReader, writeFrame } from './framing';
import type { Identity } from './identity';
import { log } from './logger';
import { MAX_BULK_FRAME, MAX_BULK_HEADER_FRAME, PORT_BULK } from '../shared/protocol';
import { FrameTally } from '../shared/frameTally';

/**
 * The Mac's half of the bulk channel — the first thing on this side to open port 42503.
 *
 * Slice 1 built the frame caps on both ends and could only unit-test them, because nothing served
 * the socket. `docs/testing.md` records that debt in as many words: *"the caps are proven by unit
 * tests only… the first `fs.*` transfer owes the on-socket evidence"*. This is what pays it, and
 * the tally it prints on every transfer is that evidence — frames and bytes accepted, beside any
 * refusal, which is the denominator a refusal count needs.
 *
 * ### Pull only, one file per socket
 *
 * A transfer is agreed on the control channel, which hands back a `transferId`; this opens a socket,
 * presents the session token, sends a one-line header naming that id, and reads chunks until the
 * phone closes. Push, resume from a partial on disk, and the `.part`/`.failed` convention belong to
 * `fs.*` and are not here.
 *
 * ### The two caps live on one socket and the reader is told which applies
 *
 * The header is capped at 64 KB and chunks at 1 MB. Nothing here compares a length: `FrameReader`
 * judges every one, and `setMaxLength` says which cap is in force for the frames that follow —
 * which is transfer state the reader cannot know and this caller does. A second comparison written
 * here would be a second answer to the same question, free to drift from the framing layer's.
 */
export interface BulkResult {
  ok: boolean;
  path?: string;
  bytes: number;
  elapsedMs: number;
  sha256?: string;
  reason?: string;
}

export class BulkClient {
  constructor(private readonly identity: Identity) {}

  private transfers = 0;
  private bytesMoved = 0;
  private failures = 0;

  /** Successes beside failures, per CLAUDE.md — a failure count with no denominator is not evidence. */
  private tallyLine(): string {
    return `${this.transfers} transfers / ${this.failures} failed / ${this.bytesMoved} bytes since launch`;
  }

  /**
   * Pulls one file the phone has already agreed to send, writing it to [destination].
   *
   * Writes through a stream rather than accumulating in memory: the whole point of a side channel is
   * that a 2 GB video does not have to fit anywhere, and a `Buffer.concat` per chunk would make this
   * quadratic in the file size on top of that.
   *
   * The digest is computed over everything written. With `offset` at 0 — which is every call today —
   * that is the whole file, so it can be compared against whatever the phone reports on
   * `fs.transfer.done`. When resume arrives, the receiver's digest must still start at byte 0 and
   * read its own partial back through the hash first; that is the failure the payload proposal
   * spends its longest section on, and it is called out here because this is the function that will
   * have to grow it.
   */
  pull(options: {
    host: string;
    token: string;
    transferId: string;
    destination: string;
    expectedBytes: number;
    offset?: number;
  }): Promise<BulkResult> {
    const { host, token, transferId, destination, expectedBytes } = options;
    const offset = options.offset ?? 0;
    const startedAt = Date.now();

    return new Promise<BulkResult>((resolve) => {
      let settled = false;
      let received = 0;
      const digest = createHash('sha256');
      const tally = new FrameTally('bulk');
      const file = createWriteStream(destination);
      let socket: TLSSocket | null = null;

      // One resolution path each way, and `settled` guards both: a socket error arriving after the
      // last chunk must not resolve a promise the completion already resolved.
      const fail = (reason: string): void => {
        if (settled) return;
        settled = true;
        socket?.destroy();
        file.end();
        this.failures += 1;
        log.warn(
          'bulk',
          `${transferId} failed after ${received} bytes: ${reason}; ${tally.summary()}; ` +
            this.tallyLine(),
        );
        // A partial file at the final name is the one thing the on-disk convention forbids
        // outright — a corrupt file is worse than a missing one. Resume belongs to `fs.*` and will
        // keep a `.part`; until then a failed pull leaves nothing behind to be mistaken for whole.
        void fs.rm(destination, { force: true }).catch(() => undefined);
        resolve({ ok: false, bytes: received, elapsedMs: Date.now() - startedAt, reason });
      };

      const reader = new FrameReader(
        (frame) => {
          received += frame.length;
          digest.update(frame);
          file.write(frame);
          if (received >= expectedBytes - offset) {
            // The phone closes after the last chunk, but waiting for the close costs a round trip
            // on every transfer and makes a small file feel slow. The expected length is the
            // agreement made on the control channel, so reaching it is the completion signal —
            // and a phone that sends *more* than it agreed is caught by the check below.
            void complete();
          }
        },
        (message) => {
          // The cap refusal, on a real socket rather than in a unit test. It names which cap, the
          // offending length, and what the channel had already accepted.
          log.error('bulk', `${transferId}: ${message}`);
          fail('the transfer desynchronised and was stopped');
        },
        MAX_BULK_HEADER_FRAME,
        tally,
        'Bulk header',
      );

      const complete = async (): Promise<void> => {
        if (settled) return;
        const elapsedMs = Date.now() - startedAt;
        if (received !== expectedBytes - offset) {
          fail(`the phone sent ${received} bytes where ${expectedBytes - offset} were agreed`);
          return;
        }
        // Claimed **before** the await, not after it. Two callers race to finish a transfer — the
        // reader when the agreed length arrives, and `close` when the phone hangs up — and with the
        // flag set after `file.end` both could pass the guard and both would count. The tally is
        // what caught it: two transfers reported as three. Same shape as the renderer's duplicate
        // page fetch, and the same fix — claim the state before yielding, never after.
        settled = true;
        await new Promise<void>((done) => file.end(() => done()));
        socket?.destroy();
        this.transfers += 1;
        this.bytesMoved += received;
        const sha256 = digest.digest('hex');
        log.info(
          'bulk',
          `${transferId} pulled ${received} bytes in ${elapsedMs}ms ` +
            `(${rateOf(received, elapsedMs)}) → ${destination}; ${tally.summary()}; ${this.tallyLine()}`,
        );
        resolve({ ok: true, path: destination, bytes: received, elapsedMs, sha256 });
      };

      socket = tlsConnect({
        host,
        port: PORT_BULK,
        cert: this.identity.certPem,
        key: this.identity.keyPem,
        minVersion: 'TLSv1.3',
        // Same as the control and video channels: pinning is ours, there is no CA in this system.
        rejectUnauthorized: false,
        timeout: CANDIDATE_TIMEOUT_MS,
      });

      socket.setTimeout(CANDIDATE_TIMEOUT_MS, () =>
        fail('the phone did not answer on the file port'),
      );
      socket.once('error', (error) => fail(error.message));

      socket.once('secureConnect', () => {
        socket!.setTimeout(0);
        socket!.setNoDelay(true);
        // The token proves this socket belongs to a live control session; the phone drops it after
        // TOKEN_GRACE_MS if it does not arrive. Then the header naming which transfer this is.
        writeFrame(socket!, Buffer.from(token, 'utf8'));
        writeFrame(
          socket!,
          Buffer.from(JSON.stringify({ transferId, offset }), 'utf8'),
          MAX_BULK_HEADER_FRAME,
          tally,
          'Bulk header',
        );
        // Everything after the header is a chunk, under the chunk cap.
        reader.setMaxLength(MAX_BULK_FRAME, 'Bulk chunk');
        log.info('bulk', `${transferId} claimed on ${host}:${PORT_BULK}, offset ${offset}`);
      });

      socket.on('data', (chunk: Buffer) => reader.push(chunk));
      socket.on('close', () => {
        if (settled) return;
        if (received === expectedBytes - offset) void complete();
        else fail(`the phone closed after ${received} of ${expectedBytes - offset} bytes`);
      });
    });
  }
}

function rateOf(bytes: number, elapsedMs: number): string {
  if (elapsedMs <= 0) return 'instant';
  return `${((bytes * 8) / elapsedMs / 1000).toFixed(1)} Mbit/s`;
}
