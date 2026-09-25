import { lstat } from 'node:fs/promises';
import { MessageType } from '../shared/protocol';
import { SHARE_FILE } from '../shared/extensions';
import { ShareOfferBook, type DeclineReason, type ShareOfferPayload } from '../shared/shareOffer';
import { sanitizeShareName } from '../shared/shareNames';
import type { SharePullResult } from './bulk';
import type { DestinationVerdict, PublishResult } from './shareDestination';
import { newPartNonce, sharePartPath } from './shareDestination';
import type { ShareLedger } from './shareLedger';
import { log } from './logger';

/** What the receiver needs from the link, so it is testable without a socket. */
export interface ShareLink {
  /** Resolves with the ack envelope; rejects on an `error` reply or a timeout. */
  request(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** The negotiated extensions for the current session (docs/protocol.md → Extensions). */
  negotiated(): Readonly<Record<string, number>>;
  /** The current session's token, the key offers are held against. */
  token(): string | null;
}

/** Everything else, injected: the folder, the checks, the pull, the save, the clock and the switches. */
export interface ShareDeps {
  link: ShareLink;
  /** The receive folder, ready to write into, or why not. Called at the offer and again at Accept. */
  receiveFolder(): Promise<{ ok: true; folder: string } | { ok: false; reason: string }>;
  checkDestination(folder: string, size: number): Promise<DestinationVerdict>;
  pull(options: {
    token: string;
    transferId: string;
    part: string;
    expectedBytes: number;
    expectedSha256: string;
    idleTimeoutMs: number;
    publish: (part: string) => Promise<PublishResult>;
    signal: AbortSignal;
    ledger: ShareLedger | null;
    onProgress?: (received: number) => void;
  }): Promise<SharePullResult>;
  publish(part: string, folder: string, name: string): Promise<PublishResult>;
  now?: () => number;
  /** The private ownership record for temporary files (partials). */
  ledger?: ShareLedger | null;
  /**
   * `silent`: debug `shareSilent` — validate a version-1 offer, never answer it.
   * `acceptProbeDigests`: debug `shareAcceptProbe` — accept an offer only if it is a synthetic probe
   * **and its SHA-256 is on this list**, which the tester supplies. Empty (the default) accepts
   * nothing. `main.ts` forces both off in a packaged build.
   */
  switches?: { silent?: boolean; acceptProbeDigests?: ReadonlySet<string> };
  /**
   * Whether this run may act on a negotiated version 2 at all (`shareActivation.ts`). **Absent means
   * no**: a session that somehow negotiated 2 without it is answered as version 1. `syntheticOnly`
   * declines every offer that is not an allow-listed probe, rather than holding it for a person.
   */
  version2?: { allowed: boolean; syntheticOnly: boolean };
  idleTimeoutMs?: number;
}

export const IDLE_TIMEOUT_MS = 30_000;
export const RETRY_WINDOW_MS = 5 * 60 * 1000;
export const TRANSFER_VERSION = 2;
const SHARE_TRANSFER = /^ts-[A-Za-z0-9_-]{22}$/;
const PROBE_NAME = /^sidekick-offer-probe-\d+\.bin$/;

/**
 * Whether the development accept switch may accept this offer. **A name and a MIME type are chosen by
 * the sender, so they prove nothing on their own**: any phone can share a file called
 * `sidekick-offer-probe-100000.bin`. The gate is the offer's **SHA-256 being on an allowlist the
 * tester supplied** for the synthetic bytes the probe generates (it is seeded, so the digest is known
 * in advance and the probe logs it). An ordinary file can pass only by being byte-identical to a
 * known synthetic probe — and then all that is saved is those known synthetic bytes. The name and
 * MIME checks stay, as a second condition. An empty list accepts nothing.
 */
export function isAcceptableProbe(offer: ShareOfferPayload, allowedDigests: ReadonlySet<string>): boolean {
  return allowedDigests.size > 0 && allowedDigests.has(offer.item.sha256) &&
    PROBE_NAME.test(offer.item.name) && offer.item.mime === 'application/octet-stream';
}

export const RECEIVE_STATES = [
  'awaiting-decision',
  'accepting',
  'receiving',
  'saved',
  'saved-unacknowledged',
  'failed',
  /**
   * **Not saved, and a different file now has the name.** Publication linked a name, and that name
   * was then found to hold a file that is not this offer's verified bytes (it was swapped in around
   * the link). Terminal: no Retry — a second attempt would save beside it under a new name, with no
   * way to tell the two apart — and the name is left untouched, never opened, never deleted. The
   * phone is told `write-failed`, the protocol's existing reason.
   */
  'unexpected-file',
  'declined',
  'expired',
  'cancelled',
  'ended',
  /** The destination checks refused it, at the offer or at Accept — not a person's Decline. */
  'refused',
] as const;
export type ReceiveState = (typeof RECEIVE_STATES)[number];

interface Entry {
  offer: ShareOfferPayload;
  sessionKey: string;
  folder: string;
  state: ReceiveState;
  macExpiresAtMs: number;
  retryUntilMs: number | null;
  abort: AbortController | null;
  savedAs: string | null;
  lastReason: string | null;
  /** In `unexpected-file`: the name that now holds a different file, in [folder]. Null otherwise. */
  unexpectedName: string | null;
  /**
   * An earlier file **this run** published from the same SHA-256, if any — so a re-share after an
   * unconfirmed save is shown as a possible second copy, never as the first.
   */
  priorCopy: PriorCopy | null;
  /** Bytes this Mac received in the current (or last) attempt; null before any pull began. */
  receivedBytes: number | null;
  /**
   * What was published, identified at the moment of publication. Main-process only — never in a
   * snapshot — and the only thing Open and Reveal may act on, after [publishedFile] re-checks it.
   */
  publication: Publication | null;
}

/** A published file as it was the moment it was saved: where, and which file that was. */
interface Publication {
  path: string;
  dev: number;
  ino: number;
  size: number;
}

/** How often, at most, a byte count alone republishes the snapshot. Display only. */
const PROGRESS_NOTIFY_MS = 120;

/** One offer as the card draws it. Display data only — see [ShareReceiver.snapshots]. */
export interface ShareCardSnapshot {
  offerId: string;
  from: string;
  name: string;
  mime: string;
  bytes: number;
  folder: string;
  state: ReceiveState;
  expiresAtMs: number;
  savedAs: string | null;
  reason: string | null;
  priorCopy: PriorCopy | null;
  /** Receiver-measured bytes of the current or last attempt; null before a pull began. */
  receivedBytes: number | null;
  /** A failed attempt that a person may retry now (inside the window, never after publication). */
  canRetry: boolean;
  /** In `unexpected-file`: the name in [folder] that holds a different file. Display only. */
  unexpectedName: string | null;
}

/** A verified, published earlier copy of the same bytes, and whether the phone ever acknowledged it. */
export interface PriorCopy {
  savedAs: string;
  acknowledged: boolean;
}

function payloadOf(ack: unknown): Record<string, unknown> {
  const p = (ack as { payload?: unknown })?.payload;
  return p !== null && typeof p === 'object' ? (p as Record<string, unknown>) : {};
}

/**
 * The Mac's side of share offers — docs/protocol.md → Share.
 *
 * **Version 1** (negotiated `share.file` 1, which is every live pairing today): validate, then
 * decline `not-available` — a protocol stub, not a person's decision. Unchanged from slice 2.
 *
 * **Version 2** (negotiated 2; built in slice 3d, unreachable live because both ends still
 * advertise 1): the destination is checked at the offer, and the offer is then **held for a
 * person's decision** — Ask by default. Nothing here accepts an ordinary offer: [decide] is the
 * entry point the slice-4 card will call, and the only non-human accept is the development switch
 * `shareAcceptProbe`, which accepts only a synthetic probe whose SHA-256 the tester allow-listed
 * ([isAcceptableProbe]). At Accept the destination is checked again; any
 * inconclusive check fails closed. Then one pull of item `"0"` from byte 0, verified against the
 * offer and published exclusively; then `share.saved`. A `share.saved {ok:true}` is sent only after a
 * verified, published file — and if the phone does not acknowledge it, the Mac records
 * `saved-unacknowledged` rather than claiming the phone knows.
 */
export class ShareReceiver {
  private readonly book = new ShareOfferBook();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly entries = new Map<string, Entry>();
  /** Every file this run published, by digest. Memory only, like the offers themselves. */
  private readonly published = new Map<string, PriorCopy>();
  private readonly now: () => number;
  private declined = 0;
  private refused = 0;
  private expired = 0;
  private saved = 0;
  private failedAttempts = 0;

  constructor(private readonly deps: ShareDeps) {
    this.now = deps.now ?? Date.now;
  }

  private tally(): string {
    return `${this.saved} saved / ${this.failedAttempts} failed attempts / ${this.declined} declined not-available / ` +
      `${this.refused} refused / ${this.expired} expired`;
  }

  private readonly listeners = new Set<() => void>();
  private notifyQueued = false;

  /**
   * Called (coalesced, after the current turn) whenever any held offer changes — for the card.
   * Returns the unsubscribe.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(entry: Entry, state: ReceiveState): void {
    entry.state = state;
    this.changed();
  }

  private changed(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      for (const l of this.listeners) {
        try {
          l();
        } catch (error) {
          log.warn('share', `a share change listener threw: ${(error as Error).message}`);
        }
      }
    });
  }

  /**
   * Every version-2 offer this run has held, newest first, as **data for display only**. Every
   * string in it is either the Mac's own (the folder, the state) or re-sanitised here (the name);
   * nothing in it authorises anything — a decision names an `offerId`, and [decide] looks the rest
   * up itself.
   */
  snapshots(): ShareCardSnapshot[] {
    return [...this.entries.values()].reverse().map((e) => ({
      offerId: e.offer.offerId,
      from: e.offer.from,
      name: sanitizeShareName(e.offer.item.name),
      mime: e.offer.item.mime,
      bytes: e.offer.item.size,
      folder: e.folder,
      state: e.state,
      expiresAtMs: e.macExpiresAtMs,
      savedAs: e.savedAs,
      reason: e.lastReason,
      priorCopy: e.priorCopy ? { ...e.priorCopy } : null,
      receivedBytes: e.receivedBytes,
      canRetry: e.state === 'failed' && e.savedAs === null && e.retryUntilMs !== null && this.now() < e.retryUntilMs,
      unexpectedName: e.unexpectedName,
    }));
  }

  /**
   * The saved file for [offerId] — **only** if it is still the very file this Mac published: a
   * regular file (not a link) at the recorded path with the recorded device, inode and size.
   * Anything else (moved, replaced, renamed over, grown, a symlink planted at the name) is null, and
   * Open / Reveal do nothing. The path never leaves the main process.
   */
  async publishedFile(offerId: string): Promise<{ ok: true; path: string } | { ok: false; why: string }> {
    const e = this.entries.get(offerId);
    const pub = e?.publication ?? null;
    if (!e || !pub || (e.state !== 'saved' && e.state !== 'saved-unacknowledged')) return { ok: false, why: 'nothing was saved for that offer' };
    const st = await lstat(pub.path).catch(() => null);
    if (!st) return { ok: false, why: 'the saved file is no longer where it was saved' };
    if (st.isSymbolicLink() || !st.isFile() || st.dev !== pub.dev || st.ino !== pub.ino || st.size !== pub.size) {
      return { ok: false, why: 'the file at that name has changed since it was saved' };
    }
    return { ok: true, path: pub.path };
  }

  /** For tests and the future card: an offer's receive state, or undefined if never held. */
  state(offerId: string): ReceiveState | undefined {
    return this.entries.get(offerId)?.state;
  }

  savedAs(offerId: string): string | null {
    return this.entries.get(offerId)?.savedAs ?? null;
  }

  priorCopy(offerId: string): PriorCopy | null {
    return this.entries.get(offerId)?.priorCopy ?? null;
  }

  counts(): { declined: number; refused: number; expired: number; saved: number; failed: number } {
    return { declined: this.declined, refused: this.refused, expired: this.expired, saved: this.saved, failed: this.failedAttempts };
  }

  private version(): number {
    return this.deps.link.negotiated()[SHARE_FILE] ?? 0;
  }

  /** Version 2 negotiated **and** activated on this Mac. Either missing is version 1. */
  private transferAllowed(): boolean {
    return this.version() >= TRANSFER_VERSION && this.deps.version2?.allowed === true;
  }

  // ---- the offer --------------------------------------------------------------------------------

  /** Returns when the offer has been answered, held, or refused (awaitable for tests). */
  async onOffer(payload: unknown): Promise<void> {
    const sessionKey = this.deps.link.token() ?? '';
    const verdict = this.book.receive(payload, {
      negotiated: this.version() > 0,
      sessionKey,
      nowMs: this.now(),
    });
    switch (verdict.kind) {
      case 'unanswerable':
        log.warn('share', `share.offer not answerable (${verdict.why}) — nothing sent`);
        return;
      case 'replay':
        log.warn('share', `share.offer ${verdict.offerId} is a replay — already answered once, not answered again`);
        return;
      case 'decline':
        this.refused += 1;
        log.info('share', `share.offer ${verdict.offerId} refused: ${verdict.reason} (${verdict.why}) — ${this.tally()}`);
        await this.respondDecline(verdict.offerId, verdict.reason);
        return;
      case 'valid':
        break;
    }
    const { offer, macExpiresAtMs } = verdict;
    log.info('share', `share.offer ${offer.offerId} valid: ${offer.item.size} bytes, ${offer.item.mime.split('/')[0]}/*, ` +
      `negotiated share.file ${this.version()}`);

    if (this.version() >= TRANSFER_VERSION && !this.deps.version2?.allowed) {
      // Cannot happen while this Mac advertises 1 — and if it ever does, it fails closed to version 1.
      log.error('share', `share.offer ${offer.offerId}: share.file ${this.version()} negotiated but version 2 is not activated on this Mac — answering as version 1`);
    }
    if (!this.transferAllowed()) {
      // Version 1: offer and decline only. No accept and no pull may happen with a v1 peer.
      if (this.deps.switches?.silent) {
        this.hold(offer.offerId, sessionKey, macExpiresAtMs, null, offer);
        log.warn('share', `share.offer ${offer.offerId} held WITHOUT an answer (debug shareSilent)`);
        return;
      }
      this.declined += 1;
      log.info('share', `share.offer ${offer.offerId} → decline not-available (version 1: no transfer) — ${this.tally()}`);
      await this.respondDecline(offer.offerId, 'not-available');
      return;
    }

    // Synthetic-only (the development activation): nothing but an allow-listed probe is ever held.
    const allowed = this.deps.switches?.acceptProbeDigests ?? new Set<string>();
    if (this.deps.version2?.syntheticOnly && !isAcceptableProbe(offer, allowed)) {
      this.declined += 1;
      log.warn('share', `share.offer ${offer.offerId} is not an allow-listed synthetic probe; declined not-available (synthetic-only mode) — ${this.tally()}`);
      await this.respondDecline(offer.offerId, 'not-available');
      return;
    }

    // Version 2. The destination first, before anything is held or asked.
    const dest = await this.destination(offer.item.size);
    if (!dest.ok) {
      this.refused += 1;
      log.info('share', `share.offer ${offer.offerId} refused at the offer: ${dest.reason} (${dest.detail}) — ${this.tally()}`);
      // Recorded, not held: the phone is told at once, and the Mac's own screen says why rather than
      // leaving a person to wonder why their phone reported a refusal nobody on this Mac saw.
      this.recordRefusal(offer, sessionKey, macExpiresAtMs, dest.reason);
      await this.respondDecline(offer.offerId, dest.reason);
      return;
    }
    this.hold(offer.offerId, sessionKey, macExpiresAtMs, dest.folder, offer);
    log.info('share', `share.offer ${offer.offerId} held for a decision (Ask). Nothing is accepted without one.`);
    if (isAcceptableProbe(offer, allowed)) {
      log.warn('share', `share.offer ${offer.offerId} is an allow-listed synthetic probe; accepting it (debug shareAcceptProbe)`);
      await this.decide(offer.offerId, 'accept');
    }
  }

  /**
   * A person's decision (the slice-4 card), or the development probe switch. Accept re-checks the
   * destination and fails closed; decline answers `user`.
   */
  async decide(offerId: string, decision: 'accept' | 'decline'): Promise<void> {
    const entry = this.entries.get(offerId);
    if (!entry || entry.state !== 'awaiting-decision') return;
    if (this.now() >= entry.macExpiresAtMs) {
      this.endAs(entry, 'expired');
      return;
    }
    if (decision === 'decline') {
      this.endAs(entry, 'declined');
      await this.respondDecline(offerId, 'user');
      return;
    }
    if (!this.transferAllowed() || this.deps.link.token() !== entry.sessionKey) {
      log.warn('share', `share ${offerId}: accept refused on the Mac — no version-2 session, or the session changed`);
      this.endAs(entry, 'ended');
      return;
    }
    const dest = await this.destination(entry.offer.item.size);
    if (!dest.ok || dest.folder !== entry.folder) {
      const reason: DeclineReason = dest.ok ? 'folder-unavailable' : dest.reason;
      log.info('share', `share ${offerId}: the destination failed its re-check at Accept (${dest.ok ? 'the folder changed' : dest.detail}) — declining ${reason}`);
      // `refused`, never `declined`: the person clicked Accept, and the Mac's check said no.
      entry.lastReason = reason;
      this.endAs(entry, 'refused');
      await this.respondDecline(offerId, reason);
      return;
    }
    this.setState(entry, 'accepting');
    try {
      const ack = payloadOf(await this.deps.link.request(MessageType.SHARE_RESPOND, { offerId, decision: 'accept' }));
      if (ack.state !== 'accepted') throw new Error(`the phone answered ${JSON.stringify(ack)}`);
    } catch (error) {
      log.warn('share', `share ${offerId}: accept was not acknowledged (${(error as Error).message}) — nothing will be pulled`);
      if (now(entry) === 'accepting') this.endAs(entry, 'ended');
      return;
    }
    // Cancelled (by the person, or the phone) while the accept was in flight: nothing is pulled.
    if (now(entry) !== 'accepting') return;
    await this.attempt(entry);
  }

  /** A Retry (the slice-4 card, or tests): a fresh pull from byte 0, only inside the window. */
  async retry(offerId: string): Promise<void> {
    const entry = this.entries.get(offerId);
    if (!entry || entry.state !== 'failed' || entry.retryUntilMs === null) return;
    if (entry.savedAs !== null) {
      // Unreachable by the state machine (a published offer is saved or saved-unacknowledged, never
      // failed) and refused here as well: a retry after publication would write a second copy.
      log.error('share', `share ${offerId}: Retry refused — this offer was already published as ${entry.savedAs}`);
      return;
    }
    if (this.now() >= entry.retryUntilMs) {
      this.endAs(entry, 'expired');
      return;
    }
    await this.attempt(entry);
  }

  // ---- the pull ---------------------------------------------------------------------------------

  private async attempt(entry: Entry): Promise<void> {
    const offerId = entry.offer.offerId;
    if (!this.transferAllowed() || this.deps.link.token() !== entry.sessionKey) {
      log.warn('share', `share ${offerId}: the session changed (or version 2 is not active) before the pull — nothing pulled`);
      this.endAs(entry, 'ended');
      return;
    }
    entry.receivedBytes = 0;
    this.setState(entry, 'receiving');
    let begin: Record<string, unknown>;
    try {
      begin = payloadOf(await this.deps.link.request(MessageType.FS_TRANSFER_BEGIN, {
        direction: 'pull', rootId: `share:${offerId}`, id: '0',
      }));
    } catch (error) {
      if (now(entry) !== 'receiving') return; // cancelled while the begin was in flight
      log.warn('share', `share ${offerId}: the phone refused the pull (${(error as Error).message})`);
      this.fail(entry, 'interrupted', 'the pull was refused', false);
      return;
    }
    if (now(entry) !== 'receiving') return; // cancelled while the begin was in flight: no bytes pulled
    // The ack must agree with the offer, or the bytes would be judged against the wrong thing.
    const transferId = begin.transferId;
    if (typeof transferId !== 'string' || !SHARE_TRANSFER.test(transferId) || begin.offset !== 0 ||
        begin.size !== entry.offer.item.size || begin.sha256 !== entry.offer.item.sha256) {
      log.error('share', `share ${offerId}: the pull ack disagrees with the offer (${JSON.stringify({ ...begin, name: undefined })}) — cancelling`);
      await this.deps.link.request(MessageType.SHARE_CANCEL, { offerId, reason: 'user' }).catch(() => undefined);
      this.endAs(entry, 'cancelled');
      return;
    }
    if (this.deps.link.token() !== entry.sessionKey) {
      this.endAs(entry, 'ended');
      return;
    }
    entry.abort = new AbortController();
    const folder = entry.folder;
    let lastNotify = 0;
    const name = sanitizeShareName(entry.offer.item.name);
    const result = await this.deps.pull({
      token: entry.sessionKey,
      transferId,
      part: sharePartPath(folder, offerId, newPartNonce()),
      expectedBytes: entry.offer.item.size,
      expectedSha256: entry.offer.item.sha256,
      idleTimeoutMs: this.deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
      publish: (part) => this.deps.publish(part, folder, name),
      signal: entry.abort.signal,
      ledger: this.deps.ledger ?? null,
      // Receiver-measured: what arrived here. Coalesced on the wall clock, because it is display only
      // and a 1 GB file would otherwise republish the snapshot tens of thousands of times.
      onProgress: (received) => {
        entry.receivedBytes = received;
        const t = Date.now();
        if (t - lastNotify >= PROGRESS_NOTIFY_MS || received === entry.offer.item.size) {
          lastNotify = t;
          this.changed();
        }
      },
    });
    entry.abort = null;
    // The file this Mac created, confirmed at the saved name by the pull — not a second lookup here.
    if (result.ok) entry.publication = { path: result.path, ...result.identity };
    if (!result.ok && result.unexpectedFile) {
      this.unexpectedFile(entry, result.unexpectedFile.savedAs, result.detail);
      return;
    }
    if (result.ok && entry.state !== 'receiving') {
      // The phone cancelled (or the session ended) while the file was being published, and the
      // publication won the race. The file is on this Mac, verified; the phone has already ended the
      // offer, so no share.saved is sent, and the Mac does not claim the phone confirmed it.
      entry.savedAs = result.savedAs;
      this.setState(entry, 'saved-unacknowledged');
      this.published.set(entry.offer.item.sha256, { savedAs: result.savedAs, acknowledged: false });
      this.book.cancelled(offerId);
      log.warn('share', `share ${offerId} was published as ${result.savedAs} while its cancel arrived; recorded saved-unacknowledged, no verdict sent`);
      return;
    }
    if (result.ok) {
      entry.savedAs = result.savedAs;
      this.saved += 1;
      const copy: PriorCopy = { savedAs: result.savedAs, acknowledged: false };
      this.published.set(entry.offer.item.sha256, copy);
      try {
        const ack = payloadOf(await this.deps.link.request(MessageType.SHARE_SAVED, {
          offerId, ok: true, bytes: result.bytes, verified: true, savedAs: result.savedAs,
        }));
        if (ack.state !== 'saved') throw new Error(`the phone answered ${JSON.stringify(ack)}`);
        this.setState(entry, 'saved');
        copy.acknowledged = true;
        log.info('share', `share ${offerId} saved as ${result.savedAs}; the phone acknowledged — ${this.tally()}`);
      } catch (error) {
        // The file IS on this Mac (verified, published). What is unknown is whether the phone heard.
        // It is kept: a lost acknowledgement is never a reason to delete a verified file, and this
        // offer is never retried — a Retry would write a second copy.
        this.setState(entry, 'saved-unacknowledged');
        log.warn('share', `share ${offerId} saved as ${result.savedAs}, but the phone did not acknowledge (${(error as Error).message}) — ${this.tally()}`);
      }
      // The offer is over on this side either way: release it, or the session would read as busy.
      this.book.cancelled(offerId);
      this.clearTimer(offerId);
      return;
    }
    if (result.reason === 'cancelled') {
      if (entry.state === 'receiving') this.endAs(entry, 'cancelled');
      return;
    }
    this.fail(entry, result.reason, result.detail, true);
  }

  /**
   * The pull linked a name and found a different file there: `unexpected-file`. It is an end, not a
   * failed attempt waiting for Retry — so no retry window, the offer is released, and the phone is
   * told once, with the protocol's existing `write-failed`.
   */
  private unexpectedFile(entry: Entry, savedAs: string, detail: string): void {
    const offerId = entry.offer.offerId;
    this.failedAttempts += 1;
    entry.unexpectedName = savedAs;
    entry.lastReason = 'write-failed';
    entry.retryUntilMs = null;
    this.endAs(entry, 'unexpected-file');
    log.error('share', `share ${offerId} not saved: a different file now has the name ${savedAs} in the receive folder; it was left untouched and not opened; no Retry (${detail}) — ${this.tally()}`);
    void this.deps.link
      .request(MessageType.SHARE_SAVED, { offerId, ok: false, reason: 'write-failed' })
      .then((ack) => log.info('share', `share.saved ${offerId} ok:false write-failed (unexpected file) → ${JSON.stringify(payloadOf(ack))}`))
      .catch((error: Error) => log.warn('share', `share.saved ${offerId} ok:false write-failed (unexpected file) failed: ${error.message}`));
  }

  private fail(entry: Entry, reason: string, detail: string, tellPhone: boolean): void {
    this.failedAttempts += 1;
    this.setState(entry, 'failed');
    entry.lastReason = reason;
    entry.retryUntilMs = Math.min(this.now() + RETRY_WINDOW_MS, entry.macExpiresAtMs);
    log.warn('share', `share ${entry.offer.offerId} attempt failed: ${reason} (${detail}); Retry until ${entry.retryUntilMs} — ${this.tally()}`);
    if (tellPhone) {
      void this.deps.link
        .request(MessageType.SHARE_SAVED, { offerId: entry.offer.offerId, ok: false, reason })
        .then((ack) => log.info('share', `share.saved ${entry.offer.offerId} ok:false ${reason} → ${JSON.stringify(payloadOf(ack))}`))
        .catch((error: Error) => log.warn('share', `share.saved ${entry.offer.offerId} ok:false ${reason} failed: ${error.message}`));
    }
  }

  // ---- ends -------------------------------------------------------------------------------------

  /**
   * A person's Cancel on the receive window: stop a starting or running transfer, or give up a failed
   * one that is waiting for a Retry. The phone is told (`share.cancel {user}`, which it handles in every
   * live state and which stops its stream); the pull's own partial is deleted by the pull. **A
   * published offer cannot be cancelled** — there is nothing to stop, and a verified file is kept.
   */
  async cancel(offerId: string): Promise<boolean> {
    const entry = this.entries.get(offerId);
    if (!entry || !['accepting', 'receiving', 'failed'].includes(entry.state)) return false;
    const was = entry.state;
    this.endAs(entry, 'cancelled');
    log.info('share', `share ${offerId} cancelled on this Mac while ${was} (${entry.receivedBytes ?? 0} of ${entry.offer.item.size} bytes received)`);
    try {
      const ack = await this.deps.link.request(MessageType.SHARE_CANCEL, { offerId, reason: 'user' });
      log.info('share', `share.cancel ${offerId} user → ${JSON.stringify(payloadOf(ack))}`);
    } catch (error) {
      log.warn('share', `share.cancel ${offerId} user was not acknowledged: ${(error as Error).message}`);
    }
    return true;
  }

  /** `share.cancel` from the phone: `user`, `expired` or `staging-lost`. A live pull is stopped. */
  onCancel(payload: unknown): void {
    const p = (payload ?? {}) as { offerId?: unknown; reason?: unknown };
    const offerId = typeof p.offerId === 'string' ? p.offerId : '(no id)';
    const reason = typeof p.reason === 'string' ? p.reason : '(no reason)';
    const wasHeld = typeof p.offerId === 'string' && this.book.cancelled(p.offerId);
    const entry = this.entries.get(offerId);
    if (entry) {
      entry.abort?.abort();
      // An end the phone cannot rewrite: a saved file, or a different file found at the saved name.
      if (!['saved', 'saved-unacknowledged', 'unexpected-file'].includes(entry.state)) this.endAs(entry, reason === 'expired' ? 'expired' : 'cancelled', false);
    }
    this.clearTimer(offerId);
    // Counted only if this Mac was still holding it: its own expiry and the phone's cancel are one end.
    if (reason === 'expired' && wasHeld) this.expired += 1;
    log.info('share', `share.cancel ${offerId} from the phone: ${reason}${wasHeld ? '' : ' (not held here)'} — ${this.tally()}`);
  }

  onSessionEnded(sessionKey: string | null): void {
    if (!sessionKey) return;
    for (const id of this.book.sessionEnded(sessionKey)) {
      this.clearTimer(id);
      log.info('share', `share offer ${id} ended with the session — no message`);
    }
    for (const entry of this.entries.values()) {
      if (entry.sessionKey !== sessionKey) continue;
      entry.abort?.abort();
      if (['awaiting-decision', 'accepting', 'receiving', 'failed'].includes(entry.state)) this.setState(entry, 'ended');
    }
  }

  private hold(offerId: string, sessionKey: string, macExpiresAtMs: number, folder: string | null, offer: ShareOfferPayload): void {
    this.book.hold(offerId, sessionKey, macExpiresAtMs);
    if (folder !== null) {
      this.entries.set(offerId, {
        offer, sessionKey, folder, state: 'awaiting-decision', macExpiresAtMs,
        retryUntilMs: null, abort: null, savedAs: null, lastReason: null, unexpectedName: null,
        priorCopy: this.published.get(offer.item.sha256) ?? null,
        receivedBytes: null, publication: null,
      });
      this.changed();
      const prior = this.published.get(offer.item.sha256);
      if (prior) {
        log.warn('share', `share.offer ${offerId} carries the same bytes as ${prior.savedAs}, saved earlier this run ` +
          `(${prior.acknowledged ? 'confirmed' : 'confirmation unknown'}); accepting would save a second copy under a new name`);
      }
    }
    const wait = Math.max(0, macExpiresAtMs - this.now());
    // Unref'd: an offer's expiry never needs to keep a process alive on its own.
    const timer = setTimeout(() => this.onMacExpiry(offerId), wait);
    timer.unref?.();
    this.timers.set(offerId, timer);
  }

  private recordRefusal(offer: ShareOfferPayload, sessionKey: string, macExpiresAtMs: number, reason: DeclineReason): void {
    this.entries.set(offer.offerId, {
      offer, sessionKey, folder: '', state: 'refused', macExpiresAtMs,
      retryUntilMs: null, abort: null, savedAs: null, lastReason: reason, unexpectedName: null, priorCopy: null,
      receivedBytes: null, publication: null,
    });
    this.changed();
  }

  private onMacExpiry(offerId: string): void {
    this.timers.delete(offerId);
    const gone = this.book.expire(this.now()).includes(offerId);
    const entry = this.entries.get(offerId);
    if (entry && ['awaiting-decision', 'failed'].includes(entry.state)) this.endAs(entry, 'expired', false);
    if (gone) {
      this.expired += 1;
      log.info('share', `share offer ${offerId} expired on the Mac without an answer — expired, not declined — ${this.tally()}`);
    }
  }

  private endAs(entry: Entry, state: ReceiveState, release = true): void {
    this.setState(entry, state);
    entry.abort?.abort();
    if (release) this.book.cancelled(entry.offer.offerId);
    this.clearTimer(entry.offer.offerId);
  }

  private clearTimer(offerId: string): void {
    const t = this.timers.get(offerId);
    if (t) clearTimeout(t);
    this.timers.delete(offerId);
  }

  private async destination(size: number): Promise<
    { ok: true; folder: string } | { ok: false; reason: 'folder-unavailable' | 'insufficient-space' | 'unsupported-destination'; detail: string }
  > {
    const ready = await this.deps.receiveFolder().catch((error: Error) => ({ ok: false as const, reason: error.message }));
    if (!ready.ok) return { ok: false, reason: 'folder-unavailable', detail: ready.reason };
    const verdict = await this.deps.checkDestination(ready.folder, size).catch((error: Error) => ({
      ok: false as const, reason: 'folder-unavailable' as const, detail: `the check itself failed: ${error.message}`,
    }));
    return verdict.ok ? { ok: true, folder: ready.folder } : verdict;
  }

  private async respondDecline(offerId: string, reason: DeclineReason): Promise<void> {
    try {
      const ack = await this.deps.link.request(MessageType.SHARE_RESPOND, { offerId, decision: 'decline', reason });
      log.info('share', `share.respond ${offerId} ${reason} → ${JSON.stringify(payloadOf(ack))}`);
    } catch (error) {
      log.warn('share', `share.respond ${offerId} ${reason} failed: ${(error as Error).message}`);
    }
  }
}

/**
 * An entry's state **as it is now**, read through a call so the compiler does not carry a narrowing
 * across an `await` — during which a cancel from the phone or the person may have moved it.
 */
function now(entry: Entry): ReceiveState {
  return entry.state;
}
