/**
 * `webcam.keyframe` recovery — docs/protocol.md → Webcam → `webcam.keyframe` (version 2). Electron-free,
 * so `webcamRecovery.test.ts` drives the policy on a manual clock, and both the production controller
 * (`src/main/webcam.ts`) and the encoder spike's runner (`src/main/webcamSpike.ts`) use this one copy.
 *
 * ### The rules it keeps
 *
 * - **Only the bridge's `chain-broken` asks**, and only for the session and generation it serves
 *   ({@link KeyframeRecovery.setLive}); the caller has already discarded reports from a replaced bridge.
 * - **Never without version 2.** A break on a session where `ext.webcam` < 2 is counted `unsupported`
 *   and nothing is sent: recovery waits for the periodic IDR, exactly as in version 1.
 * - **One outstanding request per session and generation**; a break while one is outstanding is
 *   coalesced into it. **At most one request per second**: a break inside the second waits as **one**
 *   deferred request, dropped if the chain recovers, the session ends or the generation changes first.
 * - **Bounded, no retry.** The ack has {@link KEYFRAME_ACK_TIMEOUT_MS}; after `accepted`, an IDR has
 *   {@link KEYFRAME_IDR_WAIT_MS} to arrive. Whatever ends a request ends it for that break.
 * - **The ack is not the recovery.** Three readings are kept apart: the request sent, an IDR of that
 *   session and generation received by main, and the bridge's `chain-recovered`.
 */

/** docs/protocol.md → `webcam.keyframe`: the phone's `ignored` reasons. Held to the vocabulary fixture. */
export const KEYFRAME_IGNORED_REASONS = Object.freeze(['not-running', 'stale-generation', 'unknown-generation', 'rate-limited'] as const);
export type KeyframeIgnoredReason = (typeof KEYFRAME_IGNORED_REASONS)[number];
const IGNORED: ReadonlySet<string> = new Set(KEYFRAME_IGNORED_REASONS);

export const KEYFRAME_ACK_TIMEOUT_MS = 2_000;
export const KEYFRAME_IDR_WAIT_MS = 3_000;
export const KEYFRAME_MIN_INTERVAL_MS = 1_000;
/** The `ext.webcam` version that carries `webcam.keyframe`. */
export const KEYFRAME_MIN_VERSION = 2;

/** What came back for one request. `lost` is a timeout, a dropped link, or an ack that said nothing usable. */
export type KeyframeAnswer =
  | { kind: 'accepted'; generation: number }
  | { kind: 'ignored'; reason: KeyframeIgnoredReason | 'unrecognised'; generation: number | null }
  | { kind: 'refused'; code: string }
  | { kind: 'lost'; why: string };

/** Reads the phone's ack payload. Anything outside the contract is `lost`, never a guessed `accepted`. */
export function readKeyframeAck(payload: unknown): KeyframeAnswer {
  const p = (payload ?? {}) as Record<string, unknown>;
  const g = p.generation;
  const generation = typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 0xffff ? g : null;
  if (p.result === 'accepted') {
    return generation === null ? { kind: 'lost', why: 'an accepted ack without a generation' } : { kind: 'accepted', generation };
  }
  if (p.result === 'ignored') {
    const reason = typeof p.reason === 'string' && IGNORED.has(p.reason) ? (p.reason as KeyframeIgnoredReason) : 'unrecognised';
    return { kind: 'ignored', reason, generation };
  }
  return { kind: 'lost', why: 'an ack with no recognised result' };
}

export interface RecoveryTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface KeyframeRecoveryDeps {
  timers: RecoveryTimers;
  /** Whether `ext.webcam` is negotiated at ≥ 2 on the link the session lives on, now. */
  supported(): boolean;
  /** Sends `webcam.keyframe` and resolves with the answer. Must never reject. */
  send(sessionId: string, generation: number): Promise<KeyframeAnswer>;
  log: { info(message: string): void; warn(message: string): void };
}

/** Every counter, each readable beside its denominator: `breaks` and `requested` are the two bases. */
export interface KeyframeRecoveryCounts {
  breaks: number;
  requested: number;
  accepted: number;
  ignored: number;
  refused: number;
  timedOut: number;
  coalesced: number;
  deferred: number;
  deferredDropped: number;
  unsupported: number;
  stale: number;
  idrReceived: number;
  idrTimeouts: number;
  recoveries: number;
  recoveredAfterRequest: number;
  recoveredWithoutRequest: number;
  abandoned: number;
  lateAnswers: number;
  requestToIdrLastMs: number | null;
  requestToIdrMaxMs: number | null;
  requestToRecoveredLastMs: number | null;
  requestToRecoveredMaxMs: number | null;
}

interface Request {
  sessionId: string;
  generation: number;
  sentAt: number;
  answered: boolean;
  idrTimer: unknown;
}

function label(sessionId: string): string {
  return `webcam session ${sessionId.slice(0, 8)}…`;
}

export class KeyframeRecovery {
  private live: { sessionId: string; generation: number } | null = null;
  /** The unrecovered break, if any: when it happened, and whether a request was sent for it. */
  private broken: { at: number; requestedAt: number | null } | null = null;
  private outstanding: Request | null = null;
  private deferredTimer: unknown = null;
  private lastSentAt: number | null = null;
  private readonly c: KeyframeRecoveryCounts = {
    breaks: 0, requested: 0, accepted: 0, ignored: 0, refused: 0, timedOut: 0, coalesced: 0, deferred: 0,
    deferredDropped: 0, unsupported: 0, stale: 0, idrReceived: 0, idrTimeouts: 0, recoveries: 0,
    recoveredAfterRequest: 0, recoveredWithoutRequest: 0, abandoned: 0, lateAnswers: 0,
    requestToIdrLastMs: null, requestToIdrMaxMs: null, requestToRecoveredLastMs: null, requestToRecoveredMaxMs: null,
  };

  constructor(private readonly deps: KeyframeRecoveryDeps) {}

  counts(): KeyframeRecoveryCounts {
    return { ...this.c };
  }

  /**
   * The session and generation this serves — on `running`, on an adopted higher generation, and with
   * `null` when the session ends. A different session, or a new generation, ends whatever was pending:
   * a new generation begins with its own IDR, so its predecessor's break no longer needs asking for.
   */
  setLive(sessionId: string | null, generation = 0): void {
    const was = this.live;
    if (was && sessionId === was.sessionId && generation === was.generation) return;
    if (was) this.dropPending(sessionId === was.sessionId ? 'a new generation' : 'the session ended');
    this.broken = null;
    if (sessionId !== was?.sessionId) this.lastSentAt = null;
    this.live = sessionId ? { sessionId, generation } : null;
  }

  /** The bridge's `chain-broken`, from the current bridge, already checked to be the current session. */
  chainBroken(sessionId: string, generation: number, cause: string): void {
    const live = this.live;
    if (!live || live.sessionId !== sessionId || live.generation !== generation) {
      this.c.stale += 1;
      this.deps.log.info(`chain-broken for ${label(sessionId)} generation ${generation} is not the live one; nothing asked — ${this.c.stale} stale`);
      return;
    }
    this.c.breaks += 1;
    const now = this.deps.timers.now();
    if (!this.broken) this.broken = { at: now, requestedAt: null };
    if (!this.deps.supported()) {
      this.c.unsupported += 1;
      this.deps.log.info(
        `${label(sessionId)} chain broken (${cause}); webcam.keyframe is not negotiated, so recovery waits for the phone's periodic IDR — ` +
          `${this.c.unsupported} of ${this.c.breaks} breaks unasked`,
      );
      return;
    }
    if (this.outstanding || this.deferredTimer !== null) {
      this.c.coalesced += 1;
      this.deps.log.info(`${label(sessionId)} chain broken (${cause}) with a request already pending; coalesced — ${this.c.coalesced} coalesced`);
      return;
    }
    const wait = this.lastSentAt === null ? 0 : this.lastSentAt + KEYFRAME_MIN_INTERVAL_MS - now;
    if (wait > 0) {
      this.c.deferred += 1;
      this.deps.log.info(`${label(sessionId)} chain broken (${cause}) inside the one-per-second limit; one request deferred ${wait} ms`);
      this.deferredTimer = this.deps.timers.setTimeout(() => {
        this.deferredTimer = null;
        const l = this.live;
        if (l && l.sessionId === sessionId && l.generation === generation && this.broken && !this.outstanding && this.deps.supported()) {
          this.send(sessionId, generation);
        }
      }, wait);
      return;
    }
    this.send(sessionId, generation);
  }

  /** An IDR of [sessionId] at [generation] reached main — not proof it will decode. */
  idrReceived(sessionId: string, generation: number): void {
    const o = this.outstanding;
    if (!o || o.sessionId !== sessionId || o.generation !== generation) return;
    const ms = this.deps.timers.now() - o.sentAt;
    this.c.idrReceived += 1;
    this.c.requestToIdrLastMs = ms;
    this.c.requestToIdrMaxMs = Math.max(this.c.requestToIdrMaxMs ?? 0, ms);
    this.clearIdrTimer(o);
    this.outstanding = null;
    this.deps.log.info(`${label(sessionId)} IDR received ${ms} ms after webcam.keyframe — ${this.c.idrReceived} of ${this.c.requested} requests answered by an IDR in time`);
  }

  /** The bridge's `chain-recovered`: the first frame admitted after the break reached the sink. */
  chainRecovered(sessionId: string, generation: number): void {
    const live = this.live;
    if (!live || live.sessionId !== sessionId || live.generation !== generation) return;
    const b = this.broken;
    this.broken = null;
    this.c.recoveries += 1;
    if (this.deferredTimer !== null) {
      this.deps.timers.clearTimeout(this.deferredTimer);
      this.deferredTimer = null;
      this.c.deferredDropped += 1;
    }
    if (b && b.requestedAt !== null) {
      const ms = this.deps.timers.now() - b.requestedAt;
      this.c.recoveredAfterRequest += 1;
      this.c.requestToRecoveredLastMs = ms;
      this.c.requestToRecoveredMaxMs = Math.max(this.c.requestToRecoveredMaxMs ?? 0, ms);
      this.deps.log.info(`${label(sessionId)} picture recovered ${ms} ms after webcam.keyframe — ${this.c.recoveredAfterRequest} of ${this.c.recoveries} recoveries followed a request`);
    } else {
      this.c.recoveredWithoutRequest += 1;
      this.deps.log.info(`${label(sessionId)} picture recovered with no request sent — ${this.c.recoveredWithoutRequest} of ${this.c.recoveries} recoveries`);
    }
    // A request still awaiting its ack or its IDR is finished: the picture is back.
    if (this.outstanding) {
      this.clearIdrTimer(this.outstanding);
      this.outstanding = null;
    }
  }

  // ---- internals --------------------------------------------------------------------------------

  private send(sessionId: string, generation: number): void {
    const now = this.deps.timers.now();
    const o: Request = { sessionId, generation, sentAt: now, answered: false, idrTimer: null };
    this.outstanding = o;
    this.lastSentAt = now;
    if (this.broken) this.broken.requestedAt = now;
    this.c.requested += 1;
    this.deps.log.info(`webcam.keyframe sent for ${label(sessionId)} generation ${generation} — ${this.c.requested} sent for ${this.c.breaks} breaks`);
    void this.deps.send(sessionId, generation).then((answer) => this.onAnswer(o, answer));
  }

  private onAnswer(o: Request, a: KeyframeAnswer): void {
    o.answered = true;
    // Every answer is counted in its own kind, whether or not it still matters.
    if (a.kind === 'accepted') this.c.accepted += 1;
    else if (a.kind === 'ignored') this.c.ignored += 1;
    else if (a.kind === 'refused') this.c.refused += 1;
    else this.c.timedOut += 1;
    const tally = () => `${this.c.accepted} accepted / ${this.c.ignored} ignored / ${this.c.refused} refused / ${this.c.timedOut} lost of ${this.c.requested}`;
    if (this.outstanding !== o) {
      // The request already ended — an IDR came, the picture recovered, or the session or generation
      // moved on. Its answer changes nothing.
      this.c.lateAnswers += 1;
      this.deps.log.info(`webcam.keyframe answer for ${label(o.sessionId)} arrived after the request ended (${a.kind}) — ${this.c.lateAnswers} late; ${tally()}`);
      return;
    }
    switch (a.kind) {
      case 'accepted':
        this.deps.log.info(`webcam.keyframe accepted for ${label(o.sessionId)} generation ${a.generation} (not yet an IDR) — ${tally()}`);
        o.idrTimer = this.deps.timers.setTimeout(() => {
          o.idrTimer = null;
          if (this.outstanding !== o) return;
          this.outstanding = null;
          this.c.idrTimeouts += 1;
          this.deps.log.warn(
            `${label(o.sessionId)} no IDR within ${KEYFRAME_IDR_WAIT_MS} ms of an accepted webcam.keyframe; recovery waits for the periodic IDR — ` +
              `${this.c.idrTimeouts} IDR waits expired of ${this.c.accepted} accepted`,
          );
        }, KEYFRAME_IDR_WAIT_MS);
        return;
      case 'ignored':
        this.outstanding = null;
        this.deps.log.info(`webcam.keyframe ignored for ${label(o.sessionId)}: ${a.reason} (phone's generation ${a.generation ?? '?'}) — ${tally()}`);
        return;
      case 'refused':
        this.outstanding = null;
        this.deps.log.warn(`webcam.keyframe refused for ${label(o.sessionId)}: ${a.code} — ${tally()}`);
        return;
      case 'lost':
        this.outstanding = null;
        this.deps.log.warn(`webcam.keyframe for ${label(o.sessionId)} got no usable answer: ${a.why.slice(0, 120)} — ${tally()}`);
        return;
    }
  }

  private dropPending(why: string): void {
    if (this.deferredTimer !== null) {
      this.deps.timers.clearTimeout(this.deferredTimer);
      this.deferredTimer = null;
      this.c.deferredDropped += 1;
    }
    const o = this.outstanding;
    if (o) {
      this.clearIdrTimer(o);
      this.outstanding = null;
      this.c.abandoned += 1;
      this.deps.log.info(`webcam.keyframe for ${label(o.sessionId)} abandoned: ${why} — ${this.c.abandoned} abandoned of ${this.c.requested}`);
    }
  }

  private clearIdrTimer(o: Request): void {
    if (o.idrTimer !== null) this.deps.timers.clearTimeout(o.idrTimer);
    o.idrTimer = null;
  }
}

/**
 * Sends one `webcam.keyframe` over a link's request function and reads the answer. Never rejects: an
 * `error` with a code is `refused`, anything else that fails is `lost`.
 */
export function keyframeSender(
  request: (type: string, payload: Record<string, unknown>, timeoutMs: number) => Promise<{ payload?: unknown }>,
  type: string,
): (sessionId: string, generation: number) => Promise<KeyframeAnswer> {
  return async (sessionId, generation) => {
    try {
      const ack = await request(type, { sessionId, generation }, KEYFRAME_ACK_TIMEOUT_MS);
      return readKeyframeAck(ack.payload);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && code.length > 0) return { kind: 'refused', code };
      return { kind: 'lost', why: error instanceof Error ? error.message : 'error' };
    }
  };
}
