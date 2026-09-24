import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import type { Duplex, Writable } from 'node:stream';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { PublishResult } from './shareDestination';
import { recordCreatedFrom, type ShareLedger } from './shareLedger';
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

  /** A share pull over TLS to the phone's bulk port. See [pullShareWith] for every rule it holds. */
  pullShare(options: Parameters<typeof pullShareWith>[0] & { host: string }): Promise<SharePullResult> {
    return pullShareWith(options, () => {
      const socket = tlsConnect({
        host: options.host,
        port: PORT_BULK,
        cert: this.identity.certPem,
        key: this.identity.keyPem,
        minVersion: 'TLSv1.3',
        // Same as `pull`: pinning is the control channel's; there is no CA in this system.
        rejectUnauthorized: false,
        timeout: CANDIDATE_TIMEOUT_MS,
      });
      socket.setTimeout(CANDIDATE_TIMEOUT_MS, () => socket.destroy(new Error('the phone did not answer on the file port')));
      socket.once('secureConnect', () => {
        socket.setTimeout(0);
        socket.setNoDelay(true);
      });
      return { socket, readyEvent: 'secureConnect' };
    });
  }

  private transfers = 0;
  private bytesMoved = 0;
  private failures = 0;

  /** Successes beside failures, per CLAUDE.md — a failure count with no denominator is not evidence. */
  private tallyLine(): string {
    return `${this.transfers} transfers / ${this.failures} failed / ${this.bytesMoved} bytes since launch`;
  }

  /**
   * Pushes one local file the phone has already agreed to receive.
   *
   * ### The verdict is not here, and that is deliberate
   *
   * This resolves when the bytes are written and the socket closes. **Whether they were right is the
   * phone's to say**, on `fs.transfer.done` over the control channel, because the phone is the
   * receiver and the receiver is the side that hashes what actually landed. A Mac that decided
   * success here would be reporting that it finished sending, dressed as the file being on the
   * phone — the same collapse `verified` exists to prevent on a pull.
   *
   * ### The digest covers the whole file even when only part of it is sent
   *
   * On a resume the phone starts hashing from byte 0 by reading its own partial back, so the digest
   * agreed on the control channel is over the whole file. This side must send exactly the bytes from
   * `offset` onward and must **not** re-derive a digest over the sent range — the number was agreed
   * before the socket opened and comparing anything else against it is the failure that reports
   * corruption on a byte-perfect file.
   */
  async push(options: {
    host: string;
    token: string;
    transferId: string;
    source: string;
    /** Where the phone said to start. Bytes before this are already on the phone. */
    offset: number;
    /** Total size of the local file, as agreed on the control channel. */
    totalBytes: number;
    chunkMax: number;
    /**
     * Cuts the socket once this many bytes have been sent. **A probe hook, and it ships disabled.**
     *
     * Resume cannot be exercised without an interruption, and an interruption cannot be arranged
     * from outside a socket this class owns. The same reasoning as `pull`'s hook: a standalone
     * script that spoke the protocol itself would be a second client, differing from the shipping
     * one somewhere, verifying a mechanism the product does not use. The *stimulus* is injected and
     * the *mechanism* under test stays the product's.
     */
    interruptAfterBytes?: number;
  }): Promise<BulkResult> {
    const { host, token, transferId, source, offset, totalBytes } = options;
    const startedAt = Date.now();
    const chunk = Math.max(1, Math.min(options.chunkMax || 262144, MAX_BULK_FRAME));

    return new Promise<BulkResult>((resolve) => {
      let settled = false;
      let sent = 0;
      const tally = new FrameTally('bulk');
      let socket: TLSSocket | null = null;

      const fail = (reason: string): void => {
        if (settled) return;
        settled = true;
        socket?.destroy();
        this.failures += 1;
        // Nothing is cleaned up here. The **phone** holds the partial and the record, and it keeps
        // both on an interruption so the next attempt resumes — deleting or resetting anything from
        // this side would be the sender deciding what the receiver already decided.
        log.warn(
          'bulk',
          `${transferId} push interrupted after ${offset + sent} of ${totalBytes} bytes: ` +
            `${reason}; the phone keeps its partial and the next attempt resumes; ` +
            `${tally.summary()}; ${this.tallyLine()}`,
        );
        resolve({
          ok: false,
          bytes: offset + sent,
          elapsedMs: Date.now() - startedAt,
          reason,
          verified: false,
          ...(offset > 0 ? { resumedFrom: offset } : {}),
        });
      };

      socket = tlsConnect({
        host,
        port: PORT_BULK,
        cert: this.identity.certPem,
        key: this.identity.keyPem,
        minVersion: 'TLSv1.3',
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
        writeFrame(socket!, Buffer.from(token, 'utf8'));
        writeFrame(
          socket!,
          Buffer.from(JSON.stringify({ transferId, offset }), 'utf8'),
          MAX_BULK_HEADER_FRAME,
          tally,
          'Bulk header',
        );

        const reading = createReadStream(source, { start: offset, highWaterMark: chunk });
        reading.on('error', (error: Error) => fail(`could not read ${source}: ${error.message}`));
        reading.on('data', (piece: string | Buffer) => {
          const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
          // Every frame goes through the same writer as a pull's header, so the write-side cap is
          // enforced here rather than trusted — a peer that has lost sync must be refused by the
          // side that framed the bytes, not only by the side reading them.
          writeFrame(socket!, buffer, MAX_BULK_FRAME, tally, 'Bulk chunk');
          sent += buffer.length;
          if (options.interruptAfterBytes !== undefined && sent >= options.interruptAfterBytes) {
            // **Half-close, not destroy — and the first version got this wrong in a way the probe
            // itself hid.** `socket.destroy()` discards whatever is still in the send buffer, so a
            // run that reported 12,058,624 bytes "sent" delivered **zero**: the phone logged
            // `stopped after 0 bytes` and had nothing to resume from. The count was bytes handed to
            // `writeFrame`, which is not a fact about the transfer.
            //
            // `end()` flushes what is buffered and then closes, so the phone receives a real prefix
            // and sees the stream end short of the agreed size — which it now treats as an
            // interruption rather than a completion. That is the honest stimulus: the receiver
            // takes its ordinary path, keeps the partial, and records what it actually holds.
            log.warn('bulk', `${transferId} push interrupted deliberately at ${sent} bytes (probe)`);
            reading.destroy();
            socket!.end();
            // Resolved from the close, not from here, so `bytes` is what the socket accepted rather
            // than what was queued.
            socket!.once('close', () => fail(`interrupted by the resume probe at ${sent} bytes`));
            return;
          }
        });
        reading.on('end', () => {
          if (settled) return;
          settled = true;
          const elapsedMs = Date.now() - startedAt;
          const total = offset + sent;
          this.transfers += 1;
          this.bytesMoved += sent;
          // Half-close: the phone's read loop ends when the stream does, and it then hashes what it
          // holds and sends `fs.transfer.done`. Destroying the socket here would cut that decision
          // off mid-answer.
          socket!.end();
          log.info(
            'bulk',
            `${transferId} pushed ${sent} bytes of ${totalBytes} in ${elapsedMs}ms ` +
              `(${rateOf(sent, elapsedMs)})${offset > 0 ? ` from offset ${offset}` : ''}; ` +
              'the phone reports the verdict on fs.transfer.done; ' +
              `${tally.summary()}; ${this.tallyLine()}`,
          );
          resolve({
            ok: true,
            bytes: total,
            elapsedMs,
            // Never true from this side. The receiver hashes what landed, and this is the sender.
            verified: false,
            ...(offset > 0 ? { resumedFrom: offset } : {}),
          });
        });
      });
    });
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

/** How a share pull ended. `reason` values are docs/protocol.md → `share.saved` reasons, plus `cancelled`. */
export type SharePullResult =
  | { ok: true; savedAs: string; path: string; bytes: number; sha256: string }
  | {
      ok: false;
      reason: 'truncated' | 'checksum' | 'interrupted' | 'write-failed' | 'unsupported-destination' | 'cancelled';
      detail: string;
      bytes: number;
    };

/** A connected stream to the phone's bulk port. Injectable so tests can serve it from a local socket. */
export interface ShareConnection {
  socket: Duplex & { destroy(error?: Error): void };
  /** The event after which the socket may be written: `secureConnect` for TLS, `connect` for TCP. */
  readyEvent: string;
}

/**
 * **The share pull (docs/protocol.md → Share → Version 2), separate from [BulkClient.pull] so Files
 * and Photos keep exactly their behaviour** — resume, the kept `.part`, the `.failed` sidecar and
 * `rename` (defects 150, 151 are theirs and are not touched here).
 *
 * What differs, and why each is a rule of the share contract:
 * - the partial is [part], carrying a fresh per-attempt nonce, recorded in the ownership ledger
 *   before it exists and created exclusively. **Anything already at that path refuses the pull and is
 *   left untouched** — a matching name is not proof of ownership, so nothing here deletes a file it
 *   did not create in this attempt;
 * - offset is always 0 — there is no resume;
 * - an **idle timer** ([idleTimeoutMs], reset on every chunk) ends a stalled pull as `interrupted`;
 * - the length must equal the offer's size and the SHA-256 must equal the offer's digest;
 * - it is saved **only** through [publish] (the exclusive hard-link publication) and never renamed;
 * - on **every** failure — length, digest, stall, socket error, cancel, publish — its own partial is
 *   deleted, and no sidecar is written.
 */
async function pullShareWith(
  options: {
    token: string;
    transferId: string;
    /** A fresh `sharePartPath(folder, offerId, newPartNonce())` for this attempt. */
    part: string;
    expectedBytes: number;
    expectedSha256: string;
    idleTimeoutMs: number;
    publish: (part: string) => Promise<PublishResult>;
    signal?: AbortSignal;
    /** The private ownership record. Null only in tests that do not exercise the sweep. */
    ledger?: ShareLedger | null;
    /** Test seam: how the partial is opened. Default: `createWriteStream(part, { flags: 'wx' })`. */
    openPart?: (path: string) => Writable;
  },
  open: () => ShareConnection,
): Promise<SharePullResult> {
  const { token, transferId, part, expectedBytes, expectedSha256, idleTimeoutMs } = options;
  const ledger = options.ledger ?? null;
  // **A name is not ownership.** Anything already at this path — a regular file included — is not
  // ours: refuse, and never delete it. (The name carries a fresh 128-bit nonce, so this is a lookalike
  // or an attack, never an earlier attempt of ours.)
  const existing = await fs.lstat(part).catch(() => null);
  if (existing) {
    return { ok: false, reason: 'write-failed', detail: 'something already exists at the partial path; it was left untouched', bytes: 0 };
  }

  return new Promise<SharePullResult>((resolve) => {
    let settled = false;
    let received = 0;
    let created = false;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const digest = createHash('sha256');
    const tally = new FrameTally('bulk');
    let file: Writable | null = null;
    let socket: ShareConnection['socket'] | null = null;

    const stopIdle = (): void => {
      if (idle) clearTimeout(idle);
      idle = null;
    };
    const armIdle = (): void => {
      stopIdle();
      idle = setTimeout(() => fail('interrupted', `no bytes for ${idleTimeoutMs} ms`), idleTimeoutMs);
    };
    /** Resolves when every byte is flushed; rejects on a write error — never resolves early. */
    const closeFile = (): Promise<void> =>
      new Promise<void>((done, reject) => {
        const f = file;
        if (!f || f.writableFinished || f.destroyed) return done();
        f.once('error', reject);
        f.end(() => done());
      });
    /** Deletes the partial only if THIS attempt created it, and drops it from the ledger. */
    const discardOwn = async (): Promise<void> => {
      if (created) await fs.unlink(part).catch(() => undefined);
      await ledger?.forget(part).catch(() => undefined);
    };

    const fail = (reason: Exclude<SharePullResult, { ok: true }>['reason'], detail: string): void => {
      if (settled) return;
      settled = true;
      stopIdle();
      socket?.destroy();
      options.signal?.removeEventListener('abort', onAbort);
      void closeFile()
        .catch(() => undefined)
        .then(() => discardOwn())
        .then(() => {
          log.warn('bulk', `share ${transferId} failed (${reason}: ${detail}) after ${received} of ${expectedBytes} bytes; its own partial was deleted`);
          resolve({ ok: false, reason, detail, bytes: received });
        });
    };
    const onAbort = (): void => fail('cancelled', 'cancelled');

    const complete = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      stopIdle();
      socket?.destroy();
      const settle = async (reason: Exclude<SharePullResult, { ok: true }>['reason'], detail: string): Promise<void> => {
        options.signal?.removeEventListener('abort', onAbort);
        await discardOwn();
        log.warn('bulk', `share ${transferId} ${reason}: ${detail}; its own partial was deleted, no sidecar`);
        resolve({ ok: false, reason, detail, bytes: received });
      };
      // 1. Every byte flushed to disk — a write error here is a failed save, not a saved file.
      try {
        await closeFile();
      } catch (error) {
        return settle('write-failed', `writing the partial failed: ${(error as Error).message}`);
      }
      // 2. What is on disk is what arrived.
      const onDisk = await fs.stat(part).then((st) => st.size, () => -1);
      if (onDisk !== received) return settle('write-failed', `${onDisk} bytes on disk for ${received} received`);
      // 3. What arrived is what was offered.
      if (received !== expectedBytes) return settle('truncated', `received ${received} of ${expectedBytes}`);
      const sha256 = digest.digest('hex');
      if (sha256 !== expectedSha256) return settle('checksum', `expected ${expectedSha256.slice(0, 12)}… got ${sha256.slice(0, 12)}…`);
      // 4. Cancelled while flushing or verifying: nothing is published.
      if (options.signal?.aborted) return settle('cancelled', 'cancelled before publication');
      options.signal?.removeEventListener('abort', onAbort);
      // 5. Exclusive publication — the only way a partial becomes a file.
      const published = await options.publish(part).catch((error: Error) => ({ ok: false as const, reason: 'write-failed' as const, detail: error.message }));
      if (!published.ok) return settle(published.reason, published.detail);
      // Published: the partial name was unlinked by the publisher; if it could not be, the ledger keeps
      // it (identity-matched) for the startup sweep rather than deleting a published file's second name.
      const leftover = await fs.lstat(part).then(() => true, () => false);
      if (!leftover) await ledger?.forget(part).catch(() => undefined);
      log.info('bulk', `share ${transferId} received ${received} bytes, flushed, verified, published exclusively as ${published.savedAs}`);
      resolve({ ok: true, savedAs: published.savedAs, path: published.path, bytes: received, sha256 });
    };

    const begin = async (): Promise<void> => {
      // Recorded before it exists, created exclusively, identified after — see shareLedger.ts.
      try {
        await ledger?.recordIntent(part);
      } catch (error) {
        return fail('write-failed', `the ownership record could not be written: ${(error as Error).message}`);
      }
      const out = options.openPart ? options.openPart(part) : createWriteStream(part, { flags: 'wx' });
      file = out;
      out.on('error', (error: Error) => fail('write-failed', `the partial could not be written: ${error.message}`));
      const opened = await new Promise<boolean>((ok) => {
        if (options.openPart) return ok(true);
        out.once('open', () => ok(true));
        out.once('error', () => ok(false));
      });
      if (!opened || settled) return;
      created = true;
      if (ledger) {
        try {
          await recordCreatedFrom(ledger, part, expectedBytes);
        } catch (error) {
          return fail('write-failed', `the partial's identity could not be recorded: ${(error as Error).message}`);
        }
      }
      if (options.signal?.aborted) return fail('cancelled', 'cancelled before it began');
      options.signal?.addEventListener('abort', onAbort);

      const conn = open();
      socket = conn.socket;
      const reader = new FrameReader(
        (frame) => {
          if (settled) return;
          armIdle();
          received += frame.length;
          if (received > expectedBytes) {
            fail('truncated', `the phone sent more than the ${expectedBytes} bytes offered`);
            return;
          }
          digest.update(frame);
          if (!out.write(frame)) {
            // Backpressure: stop reading until the disk catches up, and do not count our own pause
            // as the phone going quiet.
            conn.socket.pause();
            stopIdle();
            out.once('drain', () => {
              if (settled) return;
              conn.socket.resume();
              armIdle();
            });
          }
          if (received === expectedBytes && expectedBytes > 0) void complete();
        },
        (message) => {
          log.error('bulk', `share ${transferId}: ${message}`);
          fail('interrupted', 'the transfer desynchronised and was stopped');
        },
        MAX_BULK_HEADER_FRAME,
        tally,
        'Bulk header',
      );
      conn.socket.once('error', (error: Error) => fail('interrupted', error.message));
      conn.socket.once(conn.readyEvent, () => {
        writeFrame(conn.socket, Buffer.from(token, 'utf8'));
        writeFrame(conn.socket, Buffer.from(JSON.stringify({ transferId, offset: 0 }), 'utf8'), MAX_BULK_HEADER_FRAME, tally, 'Bulk header');
        reader.setMaxLength(MAX_BULK_FRAME, 'Bulk chunk');
        armIdle();
        log.info('bulk', `share ${transferId} claimed, offset 0, expecting ${expectedBytes} bytes`);
      });
      conn.socket.on('data', (chunk: Buffer) => reader.push(chunk));
      conn.socket.on('close', () => {
        if (settled) return;
        // The close only completes a transfer that already has every byte (a zero-byte file, or the
        // last frame racing the close); otherwise it is a truncation. `complete` claims `settled`
        // before any await, so the last frame and the close cannot both complete it.
        if (received === expectedBytes) void complete();
        else fail('truncated', `the phone closed after ${received} of ${expectedBytes} bytes`);
      });
    };
    void begin();
  });
}

export { pullShareWith };

function rateOf(bytes: number, elapsedMs: number): string {
  if (elapsedMs <= 0) return 'instant';
  return `${((bytes * 8) / elapsedMs / 1000).toFixed(1)} Mbit/s`;
}
