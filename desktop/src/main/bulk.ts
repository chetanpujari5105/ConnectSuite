import { createWriteStream, promises as fs } from 'node:fs';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { CANDIDATE_TIMEOUT_MS } from './discovery';
import { FrameReader, writeFrame } from './framing';
import type { Identity } from './identity';
import { log } from './logger';
import { MAX_BULK_FRAME, MAX_BULK_HEADER_FRAME, PORT_BULK } from '../shared/protocol';
import { FrameTally } from '../shared/frameTally';
import { TransferDigest } from '../shared/transferDigest';
import { failedPathFor, isResumable, partPathFor, sidecarText } from '../shared/transferFiles';

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
  /**
   * Whether a digest agreed in advance was compared against what arrived.
   *
   * Separate from `ok` on purpose, and the same distinction `fs.transfer.done` carries on the wire:
   * a transfer that completed with nothing to compare against is a *success that was not verified*,
   * and collapsing the two means the one case worth knowing about looks identical to the one that
   * was checked. A pass with no denominator is not evidence.
   */
  verified: boolean;
  /** Where a resumed transfer started, so the log can say so and a caller can tell. */
  resumedFrom?: number;
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
  async pull(options: {
    host: string;
    token: string;
    transferId: string;
    destination: string;
    expectedBytes: number;
    /** The digest agreed in advance, when there is one. Null means the result is unverified. */
    expectedSha256?: string | null;
    /** What our own record says this partial should hold. Null means we have no record of it. */
    recordedBytes?: number | null;
    /**
     * Cuts the socket once this many bytes have arrived. **A probe hook, and it ships disabled.**
     *
     * Resume cannot be exercised without an interruption, and an interruption cannot be arranged
     * from outside a socket this class owns. The alternative was a standalone script that opens its
     * own socket and speaks the protocol itself — which is defect 50's shape exactly: a second
     * client, differing from the shipping one somewhere, verifying a mechanism the product does not
     * use. So the *stimulus* is injected here and the *mechanism* under test stays the product's.
     *
     * Nothing in the app passes it. `main.ts` exposes it only through a handler that is registered
     * when the build is not packaged, beside `debugSwitches`.
     */
    interruptAfterBytes?: number;
  }): Promise<BulkResult> {
    const { host, token, transferId, destination, expectedBytes } = options;
    const expectedSha256 = options.expectedSha256 ?? null;
    const startedAt = Date.now();

    // Bytes land in `name.part` and are renamed only after the digest verdict. Without that,
    // "a corrupt file is worse than a missing one" is enforced for the checksum case and quietly
    // broken for every interruption — a truncated file sitting at the final name looks complete to
    // everything that opens it.
    const part = partPathFor(destination);

    // Whether to resume is decided from our **record**, never from the filename. A `.part` we have
    // no record of is another app's file: DCIM and Documents are shared with every downloader on
    // the phone, and appending to a stranger's partial is the failure the convention's third row
    // says nothing can prevent from the outside.
    const partBytes = await fs.stat(part).then((s) => s.size).catch(() => null);
    const verdict = isResumable({
      partBytes,
      recordedBytes: options.recordedBytes ?? null,
      totalBytes: expectedBytes,
    });
    const offset = verdict.resume ? verdict.offset : 0;
    if (partBytes !== null && !verdict.resume) {
      log.info('bulk', `${transferId} starting from zero: ${verdict.reason}`);
      await fs.rm(part, { force: true }).catch(() => undefined);
    }

    // The digest covers the **whole file**, including the part that was never sent this time. Doing
    // this before a byte arrives is the point: a digest started at the offset reports
    // CHECKSUM_MISMATCH on a perfectly correct file and the deletion rule then destroys it.
    const digest = new TransferDigest();
    if (offset > 0) {
      await digest.primeFrom(part, offset);
      log.info(
        'bulk',
        `${transferId} resuming at ${offset} of ${expectedBytes}; the digest was primed over the ` +
          'bytes already on disk',
      );
    }

    return new Promise<BulkResult>((resolve) => {
      let settled = false;
      let received = 0;
      const tally = new FrameTally('bulk');
      const file = createWriteStream(part, offset > 0 ? { flags: 'a' } : {});
      let socket: TLSSocket | null = null;

      // One resolution path each way, and `settled` guards both: a socket error arriving after the
      // last chunk must not resolve a promise the completion already resolved.
      const fail = (reason: string): void => {
        if (settled) return;
        settled = true;
        socket?.destroy();
        this.failures += 1;
        log.warn(
          'bulk',
          `${transferId} interrupted after ${offset + received} of ${expectedBytes} bytes: ` +
            `${reason}; the partial is kept at ${part} and the next attempt resumes from it; ` +
            `${tally.summary()}; ${this.tallyLine()}`,
        );
        // **The partial is kept.** This is the interruption case, not the corruption case, and the
        // two want opposite treatment — one resumes, one retries from zero. The directory says
        // which happened without anyone opening a log: a `.part` here, a `.failed` sidecar there.
        // **The flush is awaited before this resolves, and that is not tidiness.** The probe caught
        // it: an interrupted 1.4 GB pull reported 705,167,360 bytes received while the `.part` on
        // disk held 704,643,072 — two chunks still sitting in the write stream's buffer. A caller
        // that stats the file the moment this resolves therefore reads a length that is about to
        // change, records it, and on the next attempt finds a partial *longer* than its own record.
        //
        // `isResumable` then refuses, correctly, and the transfer restarts from zero — a whole
        // gigabyte re-fetched because the receiver raced its own buffer. The guard turned a
        // corruption into a slow success, which is the right trade and not a reason to leave the
        // race in place.
        void new Promise<void>((done) => file.end(() => done())).then(() => {
          resolve({
            ok: false,
            bytes: offset + received,
            elapsedMs: Date.now() - startedAt,
            reason,
            verified: false,
            ...(offset > 0 ? { resumedFrom: offset } : {}),
          });
        });
      };

      const reader = new FrameReader(
        (frame) => {
          received += frame.length;
          digest.update(frame);
          file.write(frame);
          if (options.interruptAfterBytes !== undefined && received >= options.interruptAfterBytes) {
            // Destroy the socket rather than resolving: the receiver must go through its ordinary
            // interruption path, keeping the `.part`, or this proves nothing about resume.
            log.warn('bulk', `${transferId} interrupted deliberately at ${received} bytes (probe)`);
            fail(`interrupted by the resume probe at ${received} bytes`);
            return;
          }
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
        const sha256 = digest.digest(offset);
        const total = offset + received;

        // The digest verdict decides which of the three on-disk states this transfer leaves.
        if (expectedSha256 !== null && sha256 !== expectedSha256) {
          this.failures += 1;
          // The bytes were wrong, so they go — a corrupt file is worse than a missing one. What is
          // left is a sidecar carrying the *fact* without the bytes, which is why this is not a
          // rename: a `holiday.mov.corrupt` keeps the corruption and can be renamed back by a
          // hopeful user.
          await fs.rm(part, { force: true }).catch(() => undefined);
          await fs
            .writeFile(
              failedPathFor(destination),
              sidecarText({
                name: destination.split('/').pop() ?? destination,
                whenIso: new Date().toISOString(),
                bytes: total,
                expected: expectedSha256,
                actual: sha256,
              }),
            )
            .catch(() => undefined);
          log.error(
            'bulk',
            `${transferId} CHECKSUM_MISMATCH after ${total} bytes: expected ` +
              `${expectedSha256.slice(0, 12)}… got ${sha256.slice(0, 12)}…; the partial was ` +
              `deleted and a .failed sidecar left beside it; ${this.tallyLine()}`,
          );
          resolve({
            ok: false,
            bytes: total,
            elapsedMs,
            sha256,
            verified: false,
            reason: 'The file arrived with a different checksum, so the partial was deleted.',
          });
          return;
        }

        // Verified, or completed with nothing to verify against. Either way the bytes are whole, so
        // the partial becomes the file — and any stale sidecar for this name goes with it, or the
        // folder accumulates gravestones for files that are now fine.
        await fs.rename(part, destination);
        await fs.rm(failedPathFor(destination), { force: true }).catch(() => undefined);
        this.transfers += 1;
        this.bytesMoved += total;
        const verified = expectedSha256 !== null;
        log.info(
          'bulk',
          `${transferId} pulled ${total} bytes in ${elapsedMs}ms (${rateOf(total, elapsedMs)}) → ` +
            `${destination}${offset > 0 ? ` (resumed from ${offset})` : ''}; ` +
            `sha256=${sha256.slice(0, 12)}…, verified=${verified}; ` +
            `${tally.summary()}; ${this.tallyLine()}`,
        );
        resolve({
          ok: true,
          path: destination,
          bytes: total,
          elapsedMs,
          sha256,
          verified,
          ...(offset > 0 ? { resumedFrom: offset } : {}),
        });
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
