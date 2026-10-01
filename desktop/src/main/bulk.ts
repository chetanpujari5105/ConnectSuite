import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import { Writable, type Duplex } from 'node:stream';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { publishExclusive, realFs, type PublishResult } from './shareDestination';
import { candidateName } from '../shared/shareNames';
import { recordIntentFrom, type ShareLedger } from './shareLedger';
import { CANDIDATE_TIMEOUT_MS } from './discovery';
import { FrameReader, writeFrame } from './framing';
import type { Identity } from './identity';
import { log } from './logger';
import { MAX_BULK_FRAME, MAX_BULK_HEADER_FRAME, PORT_BULK } from '../shared/protocol';
import { FrameTally } from '../shared/frameTally';
import { TransferDigest } from '../shared/transferDigest';
import { BlockPullVerifier, type BlockVerdict } from '../shared/fsBlocks';
import { FAILED_MARKER_HEADER, failedPathFor, isResumable, pullPartPathFor, sidecarText, type FailedMarker } from '../shared/transferFiles';

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
  /**
   * `fs.blocks` pulls only: how the file was verified (`prehash` — a digest agreed before; `blocks` —
   * every block matched what the phone read), how many leading blocks were verified when it stopped
   * (what a resume record may keep), and why it did not finish.
   */
  verifiedBy?: 'prehash' | 'blocks';
  verifiedBlocks?: number;
  /** The phone's file changed (SOURCE_CHANGED): the partial was deleted, like a checksum mismatch. */
  sourceChanged?: boolean;
  /** No verdict from the phone within the wait: the partial is kept, nothing was published. */
  noVerdict?: boolean;
  /** The partial was deleted (corrupt, or the source changed): nothing of this transfer is left to resume. */
  discarded?: boolean;
  /** Stopped by [signal] (Pause / Cancel), partial kept. */
  aborted?: boolean;
  /** Paused because the destination ran low on space, partial kept. */
  noSpace?: boolean;
}

/** How often a pull with a [spaceCheck] re-reads free space. */
export const SPACE_CHECK_EVERY_BYTES = 1024 * 1024 * 1024;

/** How long a block pull waits after its last byte for the phone's `fs.transfer.done` (docs/protocol.md). */
export const BLOCK_DONE_WAIT_MS = 30_000;

/**
 * How long a block pull whose bulk socket closed **short** waits for the phone's verdict before calling
 * it an interruption (defect 158). The verdict travels on the control connection and the close on the
 * bulk one, so neither order is guaranteed; on hardware the two arrived within 2 ms. Bounded, because a
 * link drop has no verdict to wait for — and a verdict later than this is treated as no verdict, which
 * keeps the verified blocks (the safe side): the next Resume asks again and meets the same refusal.
 */
export const LATE_VERDICT_WAIT_MS = 3_000;

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

  /** The same tallies, read-only: lets a test assert a transfer was settled and counted exactly once. */
  counts(): { transfers: number; failures: number; bytesMoved: number } {
    return { transfers: this.transfers, failures: this.failures, bytesMoved: this.bytesMoved };
  }

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
  async push(options: PushOptions & { host: string }): Promise<BulkResult> {
    return pushWith(
      options,
      () => {
        const socket = tlsConnect({
          host: options.host,
          port: PORT_BULK,
          cert: this.identity.certPem,
          key: this.identity.keyPem,
          minVersion: 'TLSv1.3',
          rejectUnauthorized: false,
          timeout: CANDIDATE_TIMEOUT_MS,
        });
        socket.setTimeout(CANDIDATE_TIMEOUT_MS, () => socket.destroy(new Error('the phone did not answer on the file port')));
        socket.once('secureConnect', () => {
          socket.setTimeout(0);
          socket.setNoDelay(true);
        });
        return { socket, readyEvent: 'secureConnect' };
      },
      {
        tallyLine: () => this.tallyLine(),
        onSettled: (ok, sent) => {
          if (ok) {
            this.transfers += 1;
            this.bytesMoved += sent;
          } else {
            this.failures += 1;
          }
        },
      },
    );
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
    /**
     * An `fs.blocks` pull: every chunk is fed to this verifier as it lands, a failed block ends the
     * transfer where it is, and nothing is published until [BlockPullVerifier.conclude] says
     * `verified` — which needs the phone's `fs.transfer.done`, fed to it by the caller.
     */
    blocks?: BlockPullVerifier;
    /** Tests only: how long to wait for that verdict. */
    blockDoneWaitMs?: number;
    /** Tests only: how long a short close waits for a late verdict ([LATE_VERDICT_WAIT_MS]). */
    lateVerdictWaitMs?: number;
    /**
     * An owned partial for an `fs.blocks` pull: the handle to write through (created exclusively, or
     * reopened no-follow and identity-checked), where writing starts, a whole-file digest already
     * primed over the verified prefix, and the only way this transfer may delete its partial.
     */
    /** Pause or Cancel: aborting stops the socket and keeps the partial (the caller decides its fate). */
    signal?: AbortSignal;
    /**
     * Re-read free space every [SPACE_CHECK_EVERY_BYTES] received: a non-null answer pauses the pull with
     * that sentence, keeping the partial, rather than failing at 90 % (docs/protocol.md, S10).
     */
    spaceCheck?: (remainingBytes: number) => Promise<string | null>;
    /** Tests only: re-check free space this often instead of every GiB. */
    spaceCheckEveryBytes?: number;
    owned?: {
      handle: import('node:fs').promises.FileHandle;
      offset: number;
      digest: TransferDigest;
      deleteOwned: () => Promise<unknown>;
    };
    /**
     * Tests only: open the connection another way (plain TCP to a fake phone), as `pushWith` and
     * `pullShareWith` allow. The product always passes nothing and gets TLS.
     */
    connect?: () => { socket: TLSSocket; readyEvent: string };
  }): Promise<BulkResult> {
    const { host, token, transferId, destination, expectedBytes } = options;
    const expectedSha256 = options.expectedSha256 ?? null;
    const startedAt = Date.now();

    // Bytes land in `name.part` and are renamed only after the digest verdict. Without that,
    // "a corrupt file is worse than a missing one" is enforced for the checksum case and quietly
    // broken for every interruption — a truncated file sitting at the final name looks complete to
    // everything that opens it.
    const part = pullPartPathFor(destination);

    // Whether to resume is decided from our **record**, never from the filename. A `.part` we have
    // no record of is another app's file: DCIM and Documents are shared with every downloader on
    // the phone, and appending to a stranger's partial is the failure the convention's third row
    // says nothing can prevent from the outside.
    // `fs.blocks` pulls arrive with their partial already owned: created exclusively, or reopened and
    // identity-checked, read back and trimmed by the caller (pullResume.ts). Nothing here re-decides
    // resume from the filename or deletes by path for them.
    const owned = options.owned;
    let offset = 0;
    if (owned) {
      offset = owned.offset;
    } else {
      const partBytes = await fs.stat(part).then((s) => s.size).catch(() => null);
      const verdict = isResumable({
        partBytes,
        recordedBytes: options.recordedBytes ?? null,
        totalBytes: expectedBytes,
      });
      offset = verdict.resume ? verdict.offset : 0;
      if (partBytes !== null && !verdict.resume) {
        // Only ever a Sidekick partial: [pullPartPathFor]'s suffix is ours alone (defect 151).
        log.info('bulk', `${transferId} starting from zero: ${verdict.reason}`);
        await fs.rm(part, { force: true }).catch(() => undefined);
      }
    }

    // The digest covers the **whole file**, including the part that was never sent this time. Doing
    // this before a byte arrives is the point: a digest started at the offset reports
    // CHECKSUM_MISMATCH on a perfectly correct file and the deletion rule then destroys it.
    const digest = owned ? owned.digest : new TransferDigest();
    if (offset > 0 && !owned) {
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
      const file = owned
        ? createWriteStream(part, { fd: owned.handle, start: offset, autoClose: true })
        : createWriteStream(part, offset > 0 ? { flags: 'a' } : {});
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
            ...(options.blocks ? { verifiedBlocks: options.blocks.verified } : {}),
            ...stopFlag,
          });
        });
      };

      /**
       * The corruption end, shared by a digest mismatch and a failed block: the bytes were wrong or the
       * source changed under the read, so they go — a corrupt file is worse than a missing one — and a
       * sidecar keeps the fact without the bytes.
       */
      const discard = async (reason: string, sha256: string, total: number, elapsedMs: number, extra: Partial<BulkResult>, what: MarkerWhat): Promise<void> => {
        this.failures += 1;
        if (owned) await owned.deleteOwned().catch(() => undefined);
        else await fs.rm(part, { force: true }).catch(() => undefined);
        const written = await writeFailedMarker(destination, { name: basename(destination), whenIso: new Date().toISOString(), bytes: total, ...what });
        const sidecar = markerSentence(written);
        log.error('bulk', `${transferId} not saved after ${total} bytes: ${reason}; the partial was deleted and ${sidecar}; ${this.tallyLine()}`);
        resolve({ ok: false, bytes: total, elapsedMs, sha256, verified: false, reason, discarded: true, ...extra });
      };

      let stopFlag: Partial<BulkResult> = {};
      const stop = (reason: string, flag: Partial<BulkResult>): void => {
        if (settled) return;
        stopFlag = flag;
        fail(reason);
      };
      if (options.signal) {
        if (options.signal.aborted) queueMicrotask(() => stop(String(options.signal!.reason ?? 'stopped'), { aborted: true }));
        else options.signal.addEventListener('abort', () => stop(String(options.signal!.reason ?? 'stopped'), { aborted: true }), { once: true });
      }
      const spaceEvery = options.spaceCheckEveryBytes ?? SPACE_CHECK_EVERY_BYTES;
      let nextSpaceCheckAt = spaceEvery;
      let spaceChecking = false;

      const blockFailed = async (): Promise<void> => {
        const failure = options.blocks?.failure;
        if (settled || !failure) return;
        settled = true;
        socket?.destroy();
        await new Promise<void>((done) => file.end(() => done()));
        const why = failure.kind === 'corrupt' || failure.kind === 'failed' || failure.kind === 'source-changed' ? failure.why : 'failed';
        await discard(
          `The file arrived damaged (${why}), so the partial was deleted.`,
          '', offset + received, Date.now() - startedAt, { verifiedBlocks: options.blocks?.verified ?? 0 }, markerFor(failure),
        );
      };

      const reader = new FrameReader(
        (frame) => {
          // Frames already buffered in the reader keep arriving after the transfer has ended — a failed
          // block closes the file mid-stream, and writing after that is an unhandled stream error.
          if (settled) return;
          received += frame.length;
          digest.update(frame);
          file.write(frame);
          if (options.blocks) {
            options.blocks.onBytes(frame);
            if (options.blocks.failure) {
              void blockFailed();
              return;
            }
          }
          if (options.spaceCheck && !spaceChecking && received >= nextSpaceCheckAt) {
            nextSpaceCheckAt += spaceEvery;
            spaceChecking = true;
            void options.spaceCheck(expectedBytes - offset - received).then((short) => {
              spaceChecking = false;
              if (short) stop(short, { noSpace: true });
            }, () => { spaceChecking = false; });
          }
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

        // `fs.blocks`: nothing is published until the phone's `done` has arrived and every check passed.
        if (options.blocks) {
          const waited = await options.blocks.settled(options.blockDoneWaitMs ?? BLOCK_DONE_WAIT_MS);
          const verdict = options.blocks.conclude(sha256, total);
          const verifiedBlocks = options.blocks.verified;
          if (verdict.kind === 'corrupt') {
            await discard(`The file arrived damaged (${verdict.why}), so the partial was deleted.`, sha256, total, elapsedMs, { verifiedBlocks }, markerFor(verdict));
            return;
          }
          if (verdict.kind === 'source-changed') {
            await discard(verdict.message, sha256, total, elapsedMs, { sourceChanged: true, verifiedBlocks }, markerFor(verdict));
            return;
          }
          if (verdict.kind === 'failed') {
            this.failures += 1;
            const noVerdict = waited === 'timeout';
            log.warn('bulk', `${transferId} not saved: ${verdict.why}${noVerdict ? ` (no fs.transfer.done within ${options.blockDoneWaitMs ?? BLOCK_DONE_WAIT_MS} ms)` : ''}; the partial is kept at ${part}; ${verifiedBlocks} blocks verified; ${this.tallyLine()}`);
            resolve({
              ok: false, bytes: total, elapsedMs, sha256, verified: false, verifiedBlocks,
              reason: noVerdict ? 'The phone did not confirm the file in time, so it was not saved. The part received is kept.' : `The phone ended the transfer: ${verdict.why}`,
              ...(noVerdict ? { noVerdict: true } : {}),
            });
            return;
          }
          // verified: fall through to the exclusive publish below, marked as block-verified.
        }

        // The digest verdict decides which of the three on-disk states this transfer leaves.
        if (expectedSha256 !== null && sha256 !== expectedSha256) {
          this.failures += 1;
          // The bytes were wrong, so they go — a corrupt file is worse than a missing one. What is
          // left is a sidecar carrying the *fact* without the bytes, which is why this is not a
          // rename: a `holiday.mov.corrupt` keeps the corruption and can be renamed back by a
          // hopeful user.
          await fs.rm(part, { force: true }).catch(() => undefined);
          // Exclusive: a file of the user's that happens to carry this name is not ours to replace.
          const written = await writeFailedMarker(destination, {
            kind: 'checksum', name: basename(destination), whenIso: new Date().toISOString(), bytes: total,
            expected: expectedSha256, actual: sha256,
          });
          log.error(
            'bulk',
            `${transferId} CHECKSUM_MISMATCH after ${total} bytes: expected ` +
              `${expectedSha256.slice(0, 12)}… got ${sha256.slice(0, 12)}…; the partial was ` +
              `deleted and ${markerSentence(written)}; ${this.tallyLine()}`,
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
        // **Published exclusively (defect 150).** `rename` replaces whatever appeared at the final
        // name during the transfer — a file the person saved or another app downloaded there after
        // `freeName` looked. A hard link fails with EEXIST instead, and the next free name is taken.
        const published = await publishPulled(part, destination);
        if (!published.ok) {
          this.failures += 1;
          log.error('bulk', `${transferId} could not be saved: ${published.detail}; the partial is kept at ${part}`);
          resolve({ ok: false, bytes: total, elapsedMs, sha256, verified: false, reason: `The file arrived but could not be saved: ${published.detail}.` });
          return;
        }
        if (published.path !== destination) {
          log.info('bulk', `${transferId}: ${basename(destination)} appeared in the folder during the transfer; saved as ${basename(published.path)} instead`);
        }
        const stale = await removeStaleSidecar(published.path);
        if (stale !== 'none') log.info('bulk', `${transferId}: the .failed marker at ${basename(published.path)} ${stale === 'removed' ? 'was an earlier failed attempt\'s and was removed, now that the file is whole' : 'is not one this app wrote, so it was kept'}`);
        this.transfers += 1;
        this.bytesMoved += total;
        const verifiedBy = options.blocks ? 'blocks' : expectedSha256 !== null ? 'prehash' : undefined;
        const verified = verifiedBy !== undefined;
        log.info(
          'bulk',
          `${transferId} pulled ${total} bytes in ${elapsedMs}ms (${rateOf(total, elapsedMs)}) → ` +
            `${published.path}${offset > 0 ? ` (resumed from ${offset})` : ''}; ` +
            `sha256=${sha256.slice(0, 12)}…, verified=${verified}${verifiedBy ? ` (${verifiedBy === 'blocks' ? `every one of ${options.blocks!.blockCount} blocks matched` : 'agreed in advance'})` : ''}; ` +
            `${tally.summary()}; ${this.tallyLine()}`,
        );
        resolve({
          ok: true,
          path: published.path,
          bytes: total,
          elapsedMs,
          sha256,
          verified,
          ...(verifiedBy ? { verifiedBy } : {}),
          ...(options.blocks ? { verifiedBlocks: options.blocks.verified } : {}),
          ...(offset > 0 ? { resumedFrom: offset } : {}),
        });
      };

      const connection = options.connect
        ? options.connect()
        : {
            socket: tlsConnect({
              host,
              port: PORT_BULK,
              cert: this.identity.certPem,
              key: this.identity.keyPem,
              minVersion: 'TLSv1.3',
              // Same as the control and video channels: pinning is ours, there is no CA in this system.
              rejectUnauthorized: false,
              timeout: CANDIDATE_TIMEOUT_MS,
            }),
            readyEvent: 'secureConnect',
          };
      socket = connection.socket;

      // Defect 158: every way a **claimed** block pull's connection ends short — a close or an error, which
      // a reset delivers both of — goes through one bounded wait for the phone's verdict, entered once. A
      // terminal SOURCE_CHANGED (a refused resume sends no byte; a source that changed under the read
      // stops early) takes the established discard; no verdict inside the bound, or any other verdict, is
      // the interruption it always was, keeping the verified blocks. Pause, Cancel and a session ending
      // settle at once through `stop`, which this wait never blocks. Before the claim there is no stream
      // for the phone to rule on, so a connection failure there fails at once, as before.
      let claimed = false;
      let endingShort = false;
      const endedShort = (reason: string): void => {
        if (settled || endingShort) return;
        const blocks = options.blocks;
        if (!blocks || !claimed) { fail(reason); return; }
        endingShort = true;
        void blocks.settled(options.lateVerdictWaitMs ?? LATE_VERDICT_WAIT_MS).then(async () => {
          if (settled) return;
          const changed = blocks.sourceChange();
          if (!changed) { fail(reason); return; }
          settled = true;
          socket?.destroy();
          await new Promise<void>((done) => file.end(() => done()));
          await discard(changed.message, '', offset + received, Date.now() - startedAt, { sourceChanged: true, verifiedBlocks: blocks.verified }, markerFor(changed));
        });
      };

      socket.setTimeout(CANDIDATE_TIMEOUT_MS, () =>
        fail('the phone did not answer on the file port'),
      );
      socket.once('error', (error) => endedShort(error.message));

      socket.once(connection.readyEvent, () => {
        claimed = true;
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
        if (received === expectedBytes - offset) { void complete(); return; }
        endedShort(`the phone closed after ${received} of ${expectedBytes - offset} bytes`);
      });
    });
  }
}

/** How a share pull ended. `reason` values are docs/protocol.md → `share.saved` reasons, plus `cancelled`. */
export type SharePullResult =
  | {
      ok: true;
      savedAs: string;
      path: string;
      bytes: number;
      sha256: string;
      /**
       * The saved file's identity, from the handle this pull created it with and confirmed at [path]
       * after publication — so the receiver records *this* file for Open and Reveal, without looking
       * the name up again.
       */
      identity: { dev: number; ino: number; size: number };
    }
  | {
      ok: false;
      reason: 'truncated' | 'checksum' | 'interrupted' | 'write-failed' | 'unsupported-destination' | 'cancelled';
      detail: string;
      bytes: number;
      /**
       * Set only when publication linked a name and that name was then found to hold **a different
       * file** — not this attempt's verified bytes. The name is left in place (it may be somebody
       * else's file) and nothing was saved. The wire reason stays `write-failed`.
       */
      unexpectedFile?: { savedAs: string; path: string };
    };

/** A connected stream to the phone's bulk port. Injectable so tests can serve it from a local socket. */
export interface ShareConnection {
  socket: Duplex & { destroy(error?: Error): void };
  /** The event after which the socket may be written: `secureConnect` for TLS, `connect` for TCP. */
  readyEvent: string;
}

/** A file's identity on this Mac: device and inode. */
interface FileId {
  dev: number;
  ino: number;
}

/**
 * What [path] refers to now, compared with [own] — by `lstat`, which never follows a link. `ours` is
 * a regular file with our device and inode; `absent` is nothing at all; `other` is anything else (a
 * different file, a link, a folder, or a path that could not be read), with what it is — and `known`
 * false only for the unreadable case, where what is there has not been established.
 */
async function whoIsAt(
  path: string,
  own: FileId,
): Promise<{ at: 'ours'; size: number } | { at: 'absent' } | { at: 'other'; what: string; known: boolean }> {
  let st: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    st = await fs.lstat(path);
  } catch (error) {
    const c = (error as NodeJS.ErrnoException).code;
    return c === 'ENOENT' ? { at: 'absent' } : { at: 'other', what: `a path that could not be read (${c ?? 'unknown'})`, known: false };
  }
  if (st.isSymbolicLink()) return { at: 'other', what: 'a symbolic link', known: true };
  if (!st.isFile()) return { at: 'other', what: 'something that is not a regular file', known: true };
  if (st.dev !== own.dev || st.ino !== own.ino) return { at: 'other', what: 'a different file', known: true };
  return { at: 'ours', size: st.size };
}

/**
 * Writes to [handle] in order and **never closes it** — the pull holds the handle as its reference to
 * the file it created, and closes it itself once cleanup is done. Not a `WriteStream` on the handle's
 * descriptor: measured on Node 24, `FileHandle.createWriteStream({ autoClose: false })` holds a
 * reference that makes `handle.close()` wait forever, and an fd-based `WriteStream` closes the
 * descriptor on `destroy()` even with `autoClose: false` — after which the number can be reused by
 * an unrelated open, and the "reference" would describe somebody else's file.
 */
export function handleWriter(handle: FileHandle): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      void (async () => {
        for (let at = 0; at < chunk.length; ) {
          const { bytesWritten } = await handle.write(chunk, at, chunk.length - at);
          if (bytesWritten <= 0) throw new Error('the partial accepted no bytes');
          at += bytesWritten;
        }
      })().then(() => done(), (error: Error) => done(error));
    },
  });
}

/**
 * Publishes a finished Files or Photos pull **without replacing anything** (defect 150).
 *
 * The share contract's exclusive hard link ([publishExclusive]) — a name that appeared since the
 * caller chose it fails with EEXIST and the next free name is taken. On a filesystem with no hard
 * links (an exFAT or SMB receive folder), where the share path refuses, a pull falls back to an
 * **exclusive copy** (`COPYFILE_EXCL`, which also fails rather than replaces): Files and Photos worked
 * there before, and exclusivity does not need a link, only a create that refuses an existing name.
 * The partial is removed once the final name holds the bytes.
 */
export async function publishPulled(
  part: string,
  destination: string,
  io: { link: (a: string, b: string) => Promise<void>; copyFile: (a: string, b: string, mode: number) => Promise<void> } = fs,
): Promise<{ ok: true; path: string } | { ok: false; detail: string }> {
  const folder = dirname(destination);
  const wanted = basename(destination);
  const linked = await publishExclusive(part, folder, wanted, { ...realFs, link: io.link });
  if (linked.ok) {
    await fs.unlink(part).catch(() => undefined);
    return { ok: true, path: linked.path };
  }
  if (linked.reason !== 'unsupported-destination') return { ok: false, detail: linked.detail };
  for (let n = 1; n <= 20; n += 1) {
    const path = join(folder, candidateName(wanted, n));
    try {
      await io.copyFile(part, path, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      return { ok: false, detail: `copy failed (${(error as NodeJS.ErrnoException).code ?? 'unknown'})` };
    }
    await fs.unlink(part).catch(() => undefined);
    return { ok: true, path };
  }
  return { ok: false, detail: 'no free name after 20 attempts' };
}

/** A `.failed` sidecar left by an earlier attempt at this name — removed only if it is one of ours. */
/**
 * **Retention, stated (defect 159):** a successful publish at a name removes the `.failed` marker an
 * earlier failed attempt left at that same name — the file there is now whole, and the marker would
 * describe a failure that no longer stands. Only a marker **this app wrote** goes: ownership is its
 * first line, [FAILED_MARKER_HEADER], so a file of the person's carrying the suffix is never touched.
 * Nothing else ever deletes a marker. Returns what happened, so the publish line can say so.
 */
async function removeStaleSidecar(published: string): Promise<'none' | 'removed' | 'not ours, kept'> {
  const sidecar = failedPathFor(published);
  const text = await fs.readFile(sidecar, 'utf8').catch(() => null);
  if (text === null) return 'none';
  if (!text.startsWith(FAILED_MARKER_HEADER)) return 'not ours, kept';
  await fs.rm(sidecar, { force: true }).catch(() => undefined);
  return 'removed';
}

/** A marker's fields, minus the three every kind shares. */
type MarkerWhat = DistributiveOmit<FailedMarker, 'name' | 'whenIso' | 'bytes'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Which marker a verifier verdict leaves — only what that verdict established (defect 159). */
function markerFor(v: BlockVerdict): MarkerWhat {
  if (v.kind === 'source-changed') return { kind: 'source-changed', why: v.why, message: v.message };
  if (v.kind === 'corrupt' && v.block !== undefined) {
    return { kind: 'block', block: v.block, ...(v.phoneDigest ? { phoneDigest: v.phoneDigest } : {}), ...(v.macDigest ? { macDigest: v.macDigest } : {}) };
  }
  return { kind: 'unverified', reason: v.kind === 'verified' ? 'verified' : v.why };
}

/**
 * Writes a marker **exclusively** (`wx`): one already at that name — an earlier attempt's, or a file of
 * the person's — is never replaced. The outcome is returned rather than swallowed, so the log line can
 * say which of the three happened instead of always claiming a marker was left.
 */
export async function writeFailedMarker(destination: string, marker: FailedMarker): Promise<{ outcome: 'created' | 'existed' | 'failed'; code?: string }> {
  return fs.writeFile(failedPathFor(destination), sidecarText(marker), { flag: 'wx' }).then(
    () => ({ outcome: 'created' as const }),
    (e: NodeJS.ErrnoException) => (e?.code === 'EEXIST' ? { outcome: 'existed' as const } : { outcome: 'failed' as const, code: String(e?.code ?? e) }),
  );
}

function markerSentence(w: { outcome: 'created' | 'existed' | 'failed'; code?: string }): string {
  if (w.outcome === 'created') return 'a .failed marker was left beside it';
  if (w.outcome === 'existed') return 'a .failed marker already stood at that name and was kept unchanged (no new one written)';
  return `no .failed marker could be written (${w.code})`;
}

/**
 * **The share pull (docs/protocol.md → Share → Version 2), separate from [BulkClient.pull]** —
 * Files and Photos keep resume, the kept partial and the `.failed` sidecar, and since 2026-09-29 they
 * share this path's exclusive publication ([publishPulled], defect 150) and own their partial's name
 * ([pullPartPathFor], defect 151).
 *
 * What differs, and why each is a rule of the share contract:
 * - the partial is [part], carrying a fresh per-attempt nonce, recorded in the ownership ledger
 *   before it exists and created exclusively. **Anything already at that path refuses the pull and is
 *   left untouched** — a matching name is not proof of ownership, so nothing here deletes a file it
 *   did not create in this attempt;
 * - **this attempt's file is identified from its open handle, never by looking the name up again**,
 *   and the handle is held until the pull ends. The name is only ever acted on after `lstat` shows
 *   it still refers to that file: a partial path that now holds something else is never deleted, and
 *   is never published as this attempt's bytes;
 * - offset is always 0 — there is no resume;
 * - an **idle timer** ([idleTimeoutMs], reset on every chunk) ends a stalled pull as `interrupted`;
 * - the length must equal the offer's size and the SHA-256 must equal the offer's digest;
 * - it is saved **only** through [publish] (the exclusive hard link), and reported saved only when
 *   the published name is found to be this attempt's file;
 * - on **every** failure — length, digest, stall, socket error, cancel, publish — its own partial is
 *   deleted if its name still refers to it, and no sidecar is written.
 *
 * **Not race-free, and not claimed to be.** Every check here is a look at a name followed by an
 * action on that name, and POSIX gives no way to make the two one step. Between the last `lstat` and
 * the `link` a swap can still put another file under the published name (caught afterwards: it is
 * not reported saved, and the name is left in place); between the last `lstat` and an `unlink` a
 * swap can still cost the newcomer its name at the partial path. Each window is one syscall wide.
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
    /** Links [part] under a free final name. It must not remove [part]: that is decided here, by identity. */
    publish: (part: string) => Promise<PublishResult>;
    signal?: AbortSignal;
    /** The private ownership record. Null only in tests that do not exercise the sweep. */
    ledger?: ShareLedger | null;
    /**
     * Test seam: how bytes are written to the partial, given the descriptor this pull created it
     * with. It must not close the descriptor — the pull owns it. Default: [handleWriter].
     */
    openPart?: (fd: number) => Writable;
    /**
     * Test seam: how the partial is created. It must create [path] **exclusively** and return the
     * handle; the pull identifies, writes through ([handleWriter]) and closes it. Default:
     * `fs.open(path, 'wx')`. Tests wrap the real handle to delay, hold or fail its writes.
     */
    openHandle?: (path: string) => Promise<FileHandle>;
    /**
     * Receiver-measured progress: the running count of bytes that arrived and were handed to the
     * partial, after each frame. It is **this Mac's** count, never the phone's claim, and it says
     * nothing about verification — a caller must not read `received === size` as saved.
     */
    onProgress?: (received: number) => void;
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
    /** The partial, open since the exclusive create. Closed by [release] on every exit path. */
    let handle: FileHandle | null = null;
    /** This attempt's file, identified from [handle] — never from the name. Null until created. */
    let own: FileId | null = null;
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
    const release = async (): Promise<void> => {
      const h = handle;
      handle = null;
      await h?.close().catch(() => undefined);
    };
    /**
     * Removes the partial's name **only while it still refers to this attempt's file**. Anything else
     * there is left untouched and the ledger entry is kept — it records our identity, so the startup
     * sweep cannot delete the newcomer either. `clean` is false whenever something was left behind;
     * `note` says what, for the log and the result.
     */
    const discardOwn = async (): Promise<{ clean: boolean; note: string }> => {
      if (!own) {
        await ledger?.forget(part).catch(() => undefined);
        return { clean: true, note: 'no partial was created' };
      }
      const now = await whoIsAt(part, own);
      if (now.at === 'absent') {
        await ledger?.forget(part).catch(() => undefined);
        return { clean: true, note: 'nothing was left at the partial path' };
      }
      if (now.at === 'other') {
        return {
          clean: false,
          note: `the partial path now holds ${now.what}, which was left untouched; this attempt's own partial is no longer at that path and was not deleted`,
        };
      }
      // **Accepted residual race — not prevented.** The name can be swapped between the lstat above and
      // this unlink, and macOS has no call that removes a name only if it still refers to a given
      // file. A file swapped in inside that one-syscall window loses its name at this path. The owner
      // accepted this against a deliberate process running as the same user; an accidental one would
      // have to create a file at a fresh 128-bit random name inside that window.
      //
      // What is done instead is **detection**: this attempt's file loses exactly one link when its
      // own name is removed. If the count does not drop by one, the name removed was not ours, and
      // that is reported rather than passed off as a clean delete. A process that also changes this
      // file's links at the same moment can defeat the count; it is a report, not a guard.
      const links = async (): Promise<number | null> => (handle ? handle.stat().then((st) => st.nlink, () => null) : null);
      const linksBefore = await links();
      try {
        await fs.unlink(part);
      } catch (error) {
        return { clean: false, note: `this attempt's own partial could not be deleted (${(error as NodeJS.ErrnoException).code ?? 'unknown'}); the ledger keeps it for the startup sweep` };
      }
      const linksAfter = await links();
      if (linksBefore !== null && linksAfter !== null && linksAfter !== linksBefore - 1) {
        log.error('bulk', `share ${transferId}: a name was removed at the partial path, but this attempt's file went from ${linksBefore} to ${linksAfter} links — the name removed was not this attempt's file`);
        return {
          clean: false,
          note: `a file that replaced the partial between the check and the delete lost its name at the partial path (this attempt's file went from ${linksBefore} to ${linksAfter} links); the ledger keeps the entry`,
        };
      }
      await ledger?.forget(part).catch(() => undefined);
      return { clean: true, note: 'its own partial was deleted' };
    };
    type Failure = Extract<SharePullResult, { ok: false }>;
    const failure = (reason: Failure['reason'], detail: string, cleanup: { clean: boolean; note: string }, unexpectedFile?: Failure['unexpectedFile']): SharePullResult =>
      ({ ok: false, reason, detail: cleanup.clean ? detail : `${detail}; ${cleanup.note}`, bytes: received, ...(unexpectedFile ? { unexpectedFile } : {}) });

    const fail = (reason: Exclude<SharePullResult, { ok: true }>['reason'], detail: string): void => {
      if (settled) return;
      settled = true;
      stopIdle();
      socket?.destroy();
      options.signal?.removeEventListener('abort', onAbort);
      void closeFile()
        .catch(() => undefined)
        .then(() => discardOwn())
        .then(async (cleanup) => {
          await release();
          log.warn('bulk', `share ${transferId} failed (${reason}: ${detail}) after ${received} of ${expectedBytes} bytes; ${cleanup.note}`);
          resolve(failure(reason, detail, cleanup));
        });
    };
    const onAbort = (): void => fail('cancelled', 'cancelled');

    const complete = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      stopIdle();
      socket?.destroy();
      const settle = async (reason: Failure['reason'], detail: string, unexpectedFile?: Failure['unexpectedFile']): Promise<void> => {
        options.signal?.removeEventListener('abort', onAbort);
        const cleanup = await discardOwn();
        await release();
        log.warn('bulk', `share ${transferId} ${reason}: ${detail}; ${cleanup.note}, no sidecar`);
        resolve(failure(reason, detail, cleanup, unexpectedFile));
      };
      // 1. Every byte flushed to disk — a write error here is a failed save, not a saved file.
      try {
        await closeFile();
      } catch (error) {
        return settle('write-failed', `writing the partial failed: ${(error as Error).message}`);
      }
      // 2. What is on disk is what arrived — read through the handle, so it is this attempt's file
      //    whatever its name refers to now.
      const onDisk = handle ? await handle.stat().then((st) => st.size, () => -1) : -1;
      if (onDisk !== received) return settle('write-failed', `${onDisk} bytes on disk for ${received} received`);
      // 3. What arrived is what was offered.
      if (received !== expectedBytes) return settle('truncated', `received ${received} of ${expectedBytes}`);
      const sha256 = digest.digest('hex');
      if (sha256 !== expectedSha256) return settle('checksum', `expected ${expectedSha256.slice(0, 12)}… got ${sha256.slice(0, 12)}…`);
      // 4. Cancelled while flushing or verifying: nothing is published.
      if (options.signal?.aborted) return settle('cancelled', 'cancelled before publication');
      // 5. The last look before publication: the partial's name still refers to this attempt's file,
      //    a regular file of the offered size. The digest above is over the bytes that arrived; this
      //    is what ties that digest to the name about to be linked.
      const before = await whoIsAt(part, own!);
      if (before.at !== 'ours') {
        return settle('write-failed', `the partial path no longer holds this attempt's file (${before.at === 'absent' ? 'nothing is there' : before.what}); nothing was published`);
      }
      if (before.size !== expectedBytes) return settle('write-failed', `the partial holds ${before.size} bytes for ${expectedBytes} offered; nothing was published`);
      options.signal?.removeEventListener('abort', onAbort);
      // 6. Exclusive publication — the only way a partial becomes a file. (Residual race: a swap
      //    between step 5 and the link publishes the newcomer; step 7 catches it.)
      const published = await options.publish(part).catch((error: Error) => ({ ok: false as const, reason: 'write-failed' as const, detail: error.message }));
      if (!published.ok) return settle(published.reason, published.detail);
      // 7. The published name is this attempt's file, or it is not saved. On a mismatch the name is
      //    left in place: this pull created it, but after the link it can be swapped too, so what is
      //    there now may be somebody else's file and is not deleted by name.
      const landed = await whoIsAt(published.path, own!);
      if (landed.at !== 'ours') {
        const what = landed.at === 'absent' ? 'nothing is there now' : `it holds ${landed.what}`;
        log.error('bulk', `share ${transferId}: published as ${published.savedAs}, but ${what} — not reported saved; ${published.savedAs} left in place`);
        // Only a file positively seen to be different is reported as one. An empty or unreadable
        // name is an ordinary write failure: nothing there has been shown to be somebody else's.
        const unexpected = landed.at === 'other' && landed.known ? { savedAs: published.savedAs, path: published.path } : undefined;
        return settle('write-failed', `the published name ${published.savedAs} does not refer to this attempt's verified file (${what}); it was left in place and nothing was saved`, unexpected);
      }
      // 8. The partial's name is now a second name for the published file: removed only while it
      //    still is. If it is not — swapped since the link, or not removable — it is left, and the
      //    ledger keeps it (identity-matched) for the startup sweep.
      const partial = await discardOwn();
      await release();
      if (!partial.clean) log.warn('bulk', `share ${transferId}: published, but ${partial.note}`);
      log.info('bulk', `share ${transferId} received ${received} bytes, flushed, verified, published exclusively as ${published.savedAs}, and the published name confirmed as this attempt's file`);
      resolve({
        ok: true, savedAs: published.savedAs, path: published.path, bytes: received, sha256,
        identity: { dev: own!.dev, ino: own!.ino, size: landed.size },
      });
    };

    const begin = async (): Promise<void> => {
      // Recorded before it exists, created exclusively, identified from the open handle — see shareLedger.ts.
      try {
        if (ledger) await recordIntentFrom(ledger, part);
      } catch (error) {
        return fail('write-failed', `the ownership record could not be written: ${(error as Error).message}`);
      }
      // `wx` is O_CREAT|O_EXCL: it refuses any existing name, a symbolic link included.
      try {
        handle = await (options.openHandle ?? ((p: string) => fs.open(p, 'wx')))(part);
      } catch (error) {
        return fail('write-failed', `the partial could not be created: ${(error as Error).message}`);
      }
      try {
        const st = await handle.stat();
        own = { dev: st.dev, ino: st.ino };
        if (ledger) await ledger.recordCreated(part, { dev: st.dev, ino: st.ino, birthtimeMs: st.birthtimeMs, maxBytes: expectedBytes });
      } catch (error) {
        return fail('write-failed', `the partial's identity could not be recorded: ${(error as Error).message}`);
      }
      if (settled) return;
      const out = options.openPart ? options.openPart(handle.fd) : handleWriter(handle);
      file = out;
      out.on('error', (error: Error) => fail('write-failed', `the partial could not be written: ${error.message}`));
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
          const accepted = out.write(frame);
          try {
            options.onProgress?.(received);
          } catch {
            // A display callback cannot be allowed to break a transfer.
          }
          if (!accepted) {
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

/**
 * What the Mac may hold queued for the phone and not yet taken by the socket, before it stops reading
 * the file. **Backpressure**, and the reason it exists is a measurement: without it a 64 MiB push was
 * entirely in this process's memory 78 ms after the socket opened (SM-S938B, 2026-09-29), the log
 * called that *"pushed … in 78ms (6883.0 Mbit/s)"*, and a file larger than memory could not be sent.
 * 4 MiB keeps the kernel's send buffer full on a hotspot link while bounding memory per transfer.
 */
export const PUSH_HIGH_WATER = 4 * 1024 * 1024;

export interface PushOptions {
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
   * from outside a socket this code owns. The same reasoning as `pull`'s hook: a standalone
   * script that spoke the protocol itself would be a second client, differing from the shipping
   * one somewhere, verifying a mechanism the product does not use. The *stimulus* is injected and
   * the *mechanism* under test stays the product's.
   */
  interruptAfterBytes?: number;
}

/**
 * Pushes one local file the phone has already agreed to receive, over the connection [open] makes.
 *
 * ### The verdict is not here, and that is deliberate
 *
 * This resolves when the bytes are flushed and the socket half-closed. **Whether they were right is
 * the phone's to say**, on `fs.transfer.done` over the control channel, because the phone is the
 * receiver and the receiver is the side that hashes what actually landed. A Mac that decided success
 * here would be reporting that it finished sending, dressed as the file being on the phone — the same
 * collapse `verified` exists to prevent on a pull.
 *
 * ### The digest covers the whole file even when only part of it is sent
 *
 * On a resume the phone starts hashing from byte 0 by reading its own partial back, so the digest
 * agreed on the control channel is over the whole file. This side must send exactly the bytes from
 * `offset` onward and must **not** re-derive a digest over the sent range — the number was agreed
 * before the socket opened and comparing anything else against it is the failure that reports
 * corruption on a byte-perfect file.
 *
 * ### Backpressure, and what "sent" means
 *
 * The file is read only while less than [PUSH_HIGH_WATER] is queued in this process; above it the
 * read pauses until the socket drains. It resolves `ok` only on the socket's `finish` — every byte
 * handed to the operating system — never when the last chunk was merely queued, and a close before
 * that is a failure. So `bytes` and the logged rate are what left this process, not what was queued.
 */
export function pushWith(
  options: PushOptions,
  open: () => ShareConnection,
  hooks: { tallyLine?: () => string; onSettled?: (ok: boolean, sent: number) => void } = {},
): Promise<BulkResult> {
  const { token, transferId, source, offset, totalBytes } = options;
  const startedAt = Date.now();
  const chunk = Math.max(1, Math.min(options.chunkMax || 262144, MAX_BULK_FRAME));
  const tallyLine = hooks.tallyLine ?? (() => '');

  return new Promise<BulkResult>((resolve) => {
    let settled = false;
    let sent = 0;
    const tally = new FrameTally('bulk');
    let socket: ShareConnection['socket'] | null = null;
    let reading: ReturnType<typeof createReadStream> | null = null;

    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      reading?.destroy();
      socket?.destroy();
      hooks.onSettled?.(false, sent);
      // Nothing is cleaned up here. The **phone** holds the partial and the record, and it keeps
      // both on an interruption so the next attempt resumes — deleting or resetting anything from
      // this side would be the sender deciding what the receiver already decided.
      log.warn(
        'bulk',
        `${transferId} push interrupted after ${offset + sent} of ${totalBytes} bytes: ` +
          `${reason}; the phone keeps its partial and the next attempt resumes; ` +
          `${tally.summary()}; ${tallyLine()}`,
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

    const conn = open();
    socket = conn.socket;
    socket.once('error', (error: Error) => fail(error.message));
    // A close before `finish` is the phone (or the network) ending the push early: never a success.
    socket.once('close', () => fail(`the connection closed after ${offset + sent} of ${totalBytes} bytes`));

    socket.once(conn.readyEvent, () => {
      const s = socket!;
      writeFrame(s, Buffer.from(token, 'utf8'));
      writeFrame(s, Buffer.from(JSON.stringify({ transferId, offset }), 'utf8'), MAX_BULK_HEADER_FRAME, tally, 'Bulk header');

      const file = createReadStream(source, { start: offset, highWaterMark: chunk });
      reading = file;
      file.on('error', (error: Error) => fail(`could not read ${source}: ${error.message}`));
      file.on('data', (piece: string | Buffer) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
        // Every frame goes through the same writer as a pull's header, so the write-side cap is
        // enforced here rather than trusted — a peer that has lost sync must be refused by the
        // side that framed the bytes, not only by the side reading them.
        writeFrame(s, buffer, MAX_BULK_FRAME, tally, 'Bulk chunk');
        sent += buffer.length;
        if (options.interruptAfterBytes !== undefined && sent >= options.interruptAfterBytes) {
          // **Half-close, not destroy — and the first version got this wrong in a way the probe
          // itself hid.** `socket.destroy()` discards whatever is still in the send buffer, so a
          // run that reported 12,058,624 bytes "sent" delivered **zero**: the phone logged
          // `stopped after 0 bytes` and had nothing to resume from. `end()` flushes what is buffered
          // and then closes, so the phone receives a real prefix and sees the stream end short of
          // the agreed size — its ordinary interruption path.
          log.warn('bulk', `${transferId} push interrupted deliberately at ${sent} bytes (probe)`);
          file.destroy();
          s.removeAllListeners('close');
          // Resolved from the close, not from here, so `bytes` is what the socket accepted rather
          // than what was queued.
          s.once('close', () => fail(`interrupted by the resume probe at ${sent} bytes`));
          s.end();
          return;
        }
        // Backpressure: stop reading the file while too much is queued, and pick up on `drain`.
        if (s.writableLength > PUSH_HIGH_WATER) {
          file.pause();
          s.once('drain', () => { if (!settled) file.resume(); });
        }
      });
      file.on('end', () => {
        if (settled) return;
        // Half-close: the phone's read loop ends when the stream does, and it then hashes what it
        // holds and sends `fs.transfer.done`. Destroying the socket here would cut that decision
        // off mid-answer. Resolved on `finish` — every byte handed to the operating system.
        s.once('finish', () => {
          if (settled) return;
          settled = true;
          const elapsedMs = Date.now() - startedAt;
          hooks.onSettled?.(true, sent);
          log.info(
            'bulk',
            `${transferId} pushed ${sent} bytes of ${totalBytes} in ${elapsedMs}ms ` +
              `(${rateOf(sent, elapsedMs)}, flushed to the OS with at most ${PUSH_HIGH_WATER} queued at a time)` +
              `${offset > 0 ? ` from offset ${offset}` : ''}; ` +
              'the phone reports the verdict on fs.transfer.done; ' +
              `${tally.summary()}; ${tallyLine()}`,
          );
          resolve({
            ok: true,
            bytes: offset + sent,
            elapsedMs,
            // Never true from this side. The receiver hashes what landed, and this is the sender.
            verified: false,
            ...(offset > 0 ? { resumedFrom: offset } : {}),
          });
        });
        s.end();
      });
    });
  });
}

function rateOf(bytes: number, elapsedMs: number): string {
  if (elapsedMs <= 0) return 'instant';
  return `${((bytes * 8) / elapsedMs / 1000).toFixed(1)} Mbit/s`;
}
