/**
 * Camera v2 (Sidekick Camera), Electron main's half — docs/protocol.md → Webcam. Phase W3.
 *
 * Electron-free: the link, the stream socket, the bridge and the clock are injected, so
 * `webcam.test.ts` drives this production controller against labelled stand-ins and
 * `webcamBridge.test.ts` drives it against the built Swift bridge. The running app builds it through
 * `webcamWiring.ts` (`main.ts`), which `webcamWiring.test.ts` drives end to end.
 *
 * ### The rules it exists to keep
 *
 * - **Asking is not capturing.** A consumer episode beginning (0 → ≥ 1) may send **one**
 *   `webcam.request`; nothing here opens a camera. The stream socket opens on `starting`, which the
 *   phone sends only after its owner's tap, and access units reach the bridge only after `running`.
 * - **Nothing is asked for that could not be shown.** No request — automatic or the person's — while
 *   the bridge is absent or not ready, Sidekick Camera is not installed, the build has no producer
 *   identity, the extension refused this producer, the link is down, or the phone does not offer
 *   `webcam` at a negotiated version ≥ 1. Each of those is a sentence in the status, not a silence.
 * - **One automatic request per episode, and none after a spent one.** A session that ends any way
 *   but `no-consumers` spends its episode: no retry, no re-ask after a reconnect.
 * - **The last consumer leaving stops at once.** `webcam.stop` `no-consumers` is written, the socket
 *   closed and the bridge told in the same tick. No linger, no waiting for an ack.
 * - **Every ending is one exit** ({@link WebcamController.end}): the wire stop first, then the socket,
 *   the timers, the held AUs and the bridge — and then the status.
 * - **Ownership is checked on everything.** Events carry the control session's token and the
 *   `sessionId`; data carries the socket it came from; `running` and AUs carry a generation. Anything
 *   from an ended session, another connection, a closed socket or an older generation changes nothing.
 */

import type { CameraSocket, CameraSocketFactory, CameraTimers, CameraLog } from './camera';
import { log } from './logger';
import type { PhoneRequestError } from '../shared/protocol';
import {
  KeyframeQueue,
  WEBCAM,
  WEBCAM_STOPPED_REASONS,
  WebcamMessage,
  WebcamStreamError,
  WebcamStreamReader,
  isSessionId,
  webcamClaim,
  type WebcamFailureDetail,
  type WebcamFrame,
  type WebcamWireStop,
} from '../shared/webcamWire';
import type { BridgeExit, BridgeHooks, BridgePort } from './webcamBridge';
import type { BridgeStatus } from '../shared/webcamBridgeRecords';

const REQUEST_TIMEOUT_MS = 5_000;
/** A request the phone has not ended by itself this long after its own expiry is ended here. */
export const WEBCAM_EXPIRY_SLACK_MS = 5_000;
/** AUs held between `starting` and `running` — the main → bridge bound, before the bridge is told. */
export const WEBCAM_PRELIVE_BOUND = 4;

export type WebcamFacing = 'front' | 'back';
export type WebcamTrigger = 'consumer' | 'person';
export type { WebcamStopCause } from '../shared/webcamWire';

/** The phone's closed set (docs/protocol.md → `webcam.state`), held to the shared vocabulary fixture. */
const WIRE_REASONS = new Set<string>(WEBCAM_STOPPED_REASONS);

/** Why a session ended: the phone's set, plus the endings only this side sees. */
export type WebcamEndReason =
  | (typeof WEBCAM_STOPPED_REASONS)[number]
  /** The phone refused the request (`error`), so no session existed. */
  | 'refused'
  /** The request could not be sent or was not answered. */
  | 'request-failed'
  /** The control session ended and this Mac did not end it. */
  | 'disconnected'
  /** This Mac's Disconnect ended the control session. */
  | 'disconnected-here'
  /** Sleep, screen lock, a user switch, quitting, or the development switch turned off. */
  | 'mac-shutdown'
  /** The stream socket closed with no word from the phone yet. A phone `stopped` replaces it. */
  | 'stream-lost'
  /** The stream could not be framed. */
  | 'malformed-stream'
  /** The bridge exited, crashed, or broke its output contract. */
  | 'bridge-failed'
  /** The extension refused this bridge as its producer. */
  | 'producer-refused'
  /** Sidekick Camera disappeared from CoreMediaIO. */
  | 'device-not-installed';

const GUESSED = new Set<WebcamEndReason>(['stream-lost']);

type Phase = 'requesting' | 'awaiting-approval' | 'starting' | 'running';

/** Everything a pane would draw. Nothing in it needs inferring, and it carries no token. */
export interface WebcamStatus {
  bridge: 'absent' | 'stopped' | 'starting' | 'running' | 'failed';
  /** Why the bridge is absent or failed, for a person. */
  bridgeDetail: string | null;
  device: 'unknown' | 'installed' | 'not-installed';
  producer: 'unknown' | 'configured' | 'unconfigured' | 'refused';
  /** The extension's consumer count as the bridge last reported it. Reliable at 0 versus ≥ 1 only. */
  consumers: number;
  phone:
    | { kind: 'not-connected' }
    | { kind: 'older-phone' }
    | { kind: 'unavailable'; reason: string }
    | { kind: 'ready' };
  /** The first reason nothing may be asked for, or null when Ask phone would be sent. */
  blocker: string | null;
  session: null | {
    phase: Phase;
    sessionId: string | null;
    trigger: WebcamTrigger;
    facing: WebcamFacing;
    generation: number;
    /** What the phone's `running` said it actually selected, beside its target — null until `running`. */
    size: null | { width: number; height: number; targetWidth: number | null; targetHeight: number | null };
  };
  lastEnded: null | {
    sessionId: string | null;
    reason: WebcamEndReason;
    code: string | null;
    framesSent: number | null;
    framesDropped: number | null;
    received: number;
    forwarded: number;
  };
  /** The bridge's last `counts` record, verbatim. Every counter beside its denominator. */
  bridgeCounts: Record<string, number> | null;
}

export interface WebcamResult {
  ok: boolean;
  reason?: string;
}

/** The slice of the link the webcam needs. `LinkClient` would satisfy it; the tests fake it. */
export interface WebcamLinkPort {
  isConnected(): boolean;
  token(): string | null;
  address(): string | null;
  capabilities(): readonly string[];
  /** The phone's reason when it lists `webcam` in `unavailable`; null otherwise. */
  unavailableReason(name: string): string | null;
  negotiated(): Readonly<Record<string, number>>;
  request(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<{ payload?: unknown }>;
}

export interface WebcamControllerDeps {
  link: WebcamLinkPort;
  openSocket: CameraSocketFactory;
  /**
   * Starts a bridge. `null` when the helper is not present beside the app (`resolveBridgeExecutable`
   * said so); `bridgeAbsentReason` then says why.
   */
  startBridge: ((hooks: BridgeHooks) => BridgePort) | null;
  bridgeAbsentReason?: string;
  emitState(status: WebcamStatus): void;
  timers?: CameraTimers;
  log?: CameraLog;
}

const realTimers: CameraTimers = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

const realLog: CameraLog = {
  info: (message) => log.info('webcam', message),
  warn: (message) => log.warn('webcam', message),
};

interface Session {
  seq: number;
  token: string;
  trigger: WebcamTrigger;
  facing: WebcamFacing;
  sessionId: string | null;
  phase: Phase;
  socket: CameraSocket | null;
  /** Highest generation from `running` or an AU; anything below it is stale. */
  generation: number;
  size: NonNullable<WebcamStatus['session']>['size'];
  /** The bridge has been told `session-live` for this session. AUs flow only after it. */
  liveAnnounced: boolean;
  preLive: KeyframeQueue<WebcamFrame>;
  expiryTimer: unknown;
  received: number;
  forwarded: number;
  droppedStale: number;
  droppedBridge: number;
  /** Set when the session is abandoned before its ack named it: how to withdraw it once it does. */
  abandonCause: WebcamWireStop | null;
}

/** What the log line calls a session: its id's first 8 characters. Never the whole id, never a token. */
function label(sessionId: string | null): string {
  return sessionId ? `webcam session ${sessionId.slice(0, 8)}…` : 'webcam request (no session id yet)';
}

/** A stop the Mac sends because it could not continue — never worded on the phone as a person's Stop. */
function failure(detail: WebcamFailureDetail): WebcamWireStop {
  return { cause: 'failure', detail };
}

function describeStop(stop: WebcamWireStop): string {
  return stop.cause === 'failure' ? `failure (${stop.detail})` : stop.cause;
}

export class WebcamController {
  private bridge: BridgePort | null = null;
  /** Which start the hooks belong to: a late report from a bridge since replaced changes nothing. */
  private bridgeHandle: object | null = null;
  private bridgeState: WebcamStatus['bridge'];
  private bridgeDetail: string | null;
  private device: WebcamStatus['device'] = 'unknown';
  private producer: WebcamStatus['producer'] = 'unknown';
  private bridgeCounts: Record<string, number> | null = null;

  private consumers = 0;
  /** The current consumer episode, or null between episodes. */
  private episode: { id: number; asked: boolean; spent: boolean; deferred: boolean } | null = null;
  private episodes = 0;

  private session: Session | null = null;
  private seq = 0;
  /** Requests whose ack is still in flight after they were abandoned, and their withdrawals. */
  private settling = new Set<Promise<void>>();
  private lastEnded: WebcamStatus['lastEnded'] = null;
  private readonly tally = { requested: 0, automatic: 0, live: 0, ended: 0 };
  private readonly timers: CameraTimers;
  private readonly log: CameraLog;

  constructor(private readonly deps: WebcamControllerDeps) {
    this.timers = deps.timers ?? realTimers;
    this.log = deps.log ?? realLog;
    this.bridgeState = deps.startBridge ? 'stopped' : 'absent';
    this.bridgeDetail = deps.startBridge ? null : (deps.bridgeAbsentReason ?? 'The camera bridge is not present beside the app.');
  }

  // ---- the bridge's life -------------------------------------------------------------------------

  /** Starts the bridge if it is not running. Sends nothing to the phone. */
  start(): WebcamResult {
    if (!this.deps.startBridge) return { ok: false, reason: this.bridgeDetail ?? 'no bridge' };
    if (this.bridge) return { ok: true };
    this.device = 'unknown';
    this.producer = 'unknown';
    this.bridgeState = 'starting';
    this.bridgeDetail = null;
    const handle = {};
    this.bridgeHandle = handle;
    const hooks: BridgeHooks = {
      onStatus: (status) => {
        if (this.bridgeHandle === handle) this.onBridgeStatus(status);
      },
      onExit: (exit) => {
        if (this.bridgeHandle === handle) this.onBridgeExit(exit);
      },
    };
    let started: BridgePort;
    try {
      started = this.deps.startBridge(hooks);
    } catch (error) {
      this.bridgeHandle = null;
      this.bridgeState = 'failed';
      this.bridgeDetail = `The camera bridge could not start: ${String(error)}`;
      this.log.warn(this.bridgeDetail);
      this.emit();
      return { ok: false, reason: this.bridgeDetail };
    }
    this.bridge = started;
    this.emit();
    return { ok: true };
  }

  // ---- the person's intents ----------------------------------------------------------------------

  /** Ask phone. Works with or without a consumer; with none, a session is stopped as it goes live. */
  async askPhone(facing: unknown = 'front'): Promise<WebcamResult> {
    if (facing !== 'front' && facing !== 'back') return { ok: false, reason: 'facing must be front or back' };
    const blocker = this.blocker();
    if (blocker) return { ok: false, reason: blocker };
    if (this.session) return { ok: false, reason: 'A webcam request or session is already open' };
    if (this.settling.size > 0) {
      this.log.info('webcam Ask phone waiting for an abandoned request to be withdrawn on the phone');
      await Promise.all([...this.settling]);
      const after = this.blocker();
      if (after) return { ok: false, reason: after };
      if (this.session) return { ok: false, reason: 'A webcam request or session is already open' };
    }
    return this.request('person', facing);
  }

  /** Stop, from the pane, the tray or the menu-bar item. Idempotent. */
  async stop(): Promise<WebcamResult> {
    const s = this.session;
    if (!s) return { ok: true };
    const told = this.end('stopped-by-mac', { wire: { cause: 'person' } });
    if (told) await told;
    return { ok: true };
  }

  /** Changes the camera inside the approved session: no new session, no new approval. */
  async switchCamera(facing: unknown): Promise<WebcamResult> {
    if (facing !== 'front' && facing !== 'back') return { ok: false, reason: 'facing must be front or back' };
    const s = this.session;
    if (!s || !s.sessionId || (s.phase !== 'running' && s.phase !== 'starting')) return { ok: false, reason: 'No live webcam session' };
    this.log.info(`webcam.switch to ${facing} requested for ${label(s.sessionId)}`);
    try {
      await this.deps.link.request(WebcamMessage.SWITCH, { sessionId: s.sessionId, facing }, REQUEST_TIMEOUT_MS);
      return { ok: true };
    } catch (error) {
      const failure = error as PhoneRequestError;
      this.log.warn(`webcam.switch refused for ${label(s.sessionId)}: ${failure.code ?? failure.message}`);
      return { ok: false, reason: failure.phoneMessage ?? failure.message };
    }
  }

  /**
   * A privacy or lifecycle event on this Mac. Stops any session at once (`webcam.stop` `shutdown`).
   * `quit` and `dev-switch-off` also stop the bridge, and resolve once it has been reaped.
   */
  async lifecycle(event: 'suspend' | 'lock-screen' | 'user-switch' | 'quit' | 'dev-switch-off'): Promise<void> {
    if (this.session) {
      this.log.info(`webcam stopping for ${event}`);
      const told = this.end('mac-shutdown', { wire: { cause: 'shutdown' } });
      if (told) await told;
    }
    if (event === 'quit' || event === 'dev-switch-off') await this.stopBridge();
  }

  /** Stops and reaps the bridge. Any session ends first. */
  async stopBridge(): Promise<BridgeExit | null> {
    if (this.session) this.end('mac-shutdown', { wire: { cause: 'shutdown' } });
    const bridge = this.bridge;
    if (!bridge) return null;
    const exit = await bridge.stop();
    return exit;
  }

  // ---- the phone and the link --------------------------------------------------------------------

  /** `webcam.state` from the phone. Anything not about this connection's current session changes nothing. */
  onState(payload: unknown): void {
    const p = (payload ?? {}) as Record<string, unknown>;
    const sessionId = isSessionId(p.sessionId) ? p.sessionId : null;
    if (!sessionId) return;
    const token = this.deps.link.token();

    if (p.state === 'stopped') {
      const reason = typeof p.reason === 'string' && WIRE_REASONS.has(p.reason) ? (p.reason as WebcamEndReason) : 'stream-closed';
      const counts = {
        framesSent: typeof p.framesSent === 'number' ? p.framesSent : null,
        framesDropped: typeof p.framesDropped === 'number' ? p.framesDropped : null,
      };
      const s = this.session;
      if (s && s.sessionId === sessionId && s.token === token) {
        this.end(reason, { counts });
        return;
      }
      // The phone's account of a session this side already ended: its counts are taken, and its reason
      // replaces only a reason this side guessed.
      const last = this.lastEnded;
      if (!last || last.sessionId !== sessionId) return;
      this.lastEnded = {
        ...last,
        reason: GUESSED.has(last.reason) ? reason : last.reason,
        framesSent: last.framesSent ?? counts.framesSent,
        framesDropped: last.framesDropped ?? counts.framesDropped,
      };
      this.log.info(`${label(sessionId)} phone's account: ${reason}, ${counts.framesSent ?? '?'} sent / ${counts.framesDropped ?? '?'} dropped there`);
      this.emit();
      return;
    }

    const s = this.session;
    if (!s || s.sessionId !== sessionId || s.token !== token) return;

    if (p.state === 'starting' && s.phase === 'awaiting-approval') {
      this.clearExpiry(s);
      s.phase = 'starting';
      this.log.info(`${label(sessionId)} allowed on the phone; opening the stream socket`);
      this.openStream(s);
      this.emit();
      return;
    }
    if (p.state === 'running' && (s.phase === 'starting' || s.phase === 'running')) {
      const generation = p.generation;
      if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 1 || generation > 0xffff) {
        this.log.warn(`${label(sessionId)} running without a valid generation; ignored`);
        return;
      }
      if (generation < s.generation) {
        this.log.info(`${label(sessionId)} running for generation ${generation}, older than ${s.generation}; ignored`);
        return;
      }
      if (typeof p.facing === 'string' && (p.facing === 'front' || p.facing === 'back')) s.facing = p.facing;
      s.generation = generation;
      const dim = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 16 && v <= 3840 ? v : null);
      const width = dim(p.width);
      const height = dim(p.height);
      s.size = width !== null && height !== null ? { width, height, targetWidth: dim(p.targetWidth), targetHeight: dim(p.targetHeight) } : null;
      if (this.consumers === 0) {
        // Nobody is watching: the session ends as it goes live (rule 6), and nothing is fed.
        this.log.info(`${label(sessionId)} went live with no consumer; stopping it`);
        this.end('no-consumers', { wire: { cause: 'no-consumers' } });
        return;
      }
      const first = s.phase === 'starting';
      s.phase = 'running';
      s.liveAnnounced = true;
      this.bridge?.sessionLive(sessionId, generation);
      if (first) {
        this.tally.live += 1;
        this.log.info(`${label(sessionId)} running, generation ${generation} — ${this.tally.live} live of ${this.tally.requested} requested since launch`);
      } else {
        this.log.info(`${label(sessionId)} generation ${generation}`);
      }
      // What arrived between the tap and `running`, in order, now that the bridge knows the session.
      for (let f = s.preLive.shift(); f; f = s.preLive.shift()) {
        if (f.generation < s.generation) s.droppedStale += 1;
        else this.forward(s, f);
      }
      this.emit();
    }
  }

  /** The control session with [token] ended. Its webcam session ends with it; a replacement's is untouched. */
  onSessionEnded(token: string | null, byThisMac = false): void {
    const s = this.session;
    if (!s || token !== s.token) return;
    // No wire stop: the connection it would travel on is gone, and the phone stops on its own.
    this.end(byThisMac ? 'disconnected-here' : 'disconnected', {});
  }

  /** The phone's capabilities or `ext` changed. Nothing is asked for because of it. */
  onCapabilitiesChanged(): void {
    this.emit();
  }

  current(): WebcamStatus {
    return this.status();
  }

  // ---- the bridge's news -------------------------------------------------------------------------

  private onBridgeStatus(status: BridgeStatus): void {
    switch (status.op) {
      case 'ready':
        this.bridgeState = 'running';
        this.device = status.deviceInstalled ? 'installed' : 'not-installed';
        if (this.producer !== 'refused') this.producer = status.producerIdentityConfigured ? 'configured' : 'unconfigured';
        this.log.info(
          `camera bridge ready: Sidekick Camera ${status.deviceInstalled ? 'installed' : 'not installed'}, ` +
            `producer identity ${status.producerIdentityConfigured ? 'configured' : 'unconfigured'}`,
        );
        this.emit();
        return;
      case 'consumers':
        this.onConsumers(status.count);
        return;
      case 'session-ended': {
        const s = this.session;
        if (s && s.sessionId === status.sessionId && status.reason === 'no-consumers') {
          this.end('no-consumers', { wire: { cause: 'no-consumers' } });
        }
        return;
      }
      case 'stream-rejected': {
        // Bound to the exact session: a verdict about an ended or unknown session — a late one, or
        // one about a session this side already replaced — changes nothing.
        const s = this.session;
        if (!s || s.sessionId !== status.sessionId) {
          this.log.info(`camera bridge rejected the stream of ${label(status.sessionId)}, not the current session; ignored`);
          return;
        }
        this.log.warn(`camera bridge rejected the stream of ${label(status.sessionId)}: ${status.violation} (generation ${status.generation})`);
        this.end('malformed-stream', { wire: failure('stream-malformed') });
        return;
      }
      case 'sink':
        if (status.state === 'refused') {
          this.producer = 'refused';
          this.log.warn('Sidekick Camera refused this bridge as its producer');
          if (this.session) this.end('producer-refused', { wire: failure('producer-refused') });
        } else if (status.state === 'device-not-installed') {
          this.device = 'not-installed';
          if (this.session) this.end('device-not-installed', { wire: failure('device-unavailable') });
        }
        this.emit();
        return;
      case 'counts':
        this.bridgeCounts = status.counts;
        return;
      case 'error':
        this.log.warn(`camera bridge reported: ${status.error.slice(0, 200)}`);
        return;
    }
  }

  private onBridgeExit(exit: BridgeExit): void {
    this.bridge = null;
    this.bridgeHandle = null;
    this.bridgeState = exit.requested && exit.cause === 'stopped' ? 'stopped' : 'failed';
    this.bridgeDetail = this.bridgeState === 'failed' ? `The camera bridge ended unexpectedly (${exit.cause}).` : null;
    // The consumer count and the episode are kept: a bridge started again that reads the same consumers
    // continues this episode rather than beginning one, so a crash cannot mint an automatic request.
    if (this.session) this.end('bridge-failed', { wire: failure('bridge-failed') });
    this.emit();
  }

  /** The heart of the consent policy: episodes, and the one automatic request each may make. */
  private onConsumers(count: number): void {
    const before = this.consumers;
    this.consumers = count;
    if (before === 0 && count >= 1 && this.episode === null) {
      this.episodes += 1;
      this.episode = { id: this.episodes, asked: false, spent: false, deferred: false };
      this.log.info(`webcam consumer episode ${this.episode.id} began (${count} consumer${count === 1 ? '' : 's'})`);
      this.maybeAskForEpisode();
    } else if (count === 0 && this.episode !== null) {
      this.log.info(`webcam consumer episode ${this.episode.id} ended`);
      this.episode = null;
      if (this.session) this.end('no-consumers', { wire: { cause: 'no-consumers' } });
    }
    this.emit();
  }

  /** At most one automatic request per episode, and only when nothing is open or being withdrawn. */
  private maybeAskForEpisode(): void {
    const ep = this.episode;
    if (!ep || ep.asked || ep.spent) return;
    if (this.blocker() !== null) {
      this.log.info(`webcam episode ${ep.id}: not asking — ${this.blocker()}`);
      return;
    }
    if (this.session) return;
    if (this.settling.size > 0) {
      // An abandoned request is still on the phone's screen. Asking now would be refused as busy, so
      // this episode's one request waits for the withdrawal, and is sent only if the episode is still on.
      if (!ep.deferred) {
        ep.deferred = true;
        this.log.info(`webcam episode ${ep.id}: request waits for an abandoned one to be withdrawn`);
        void Promise.all([...this.settling]).then(() => {
          if (this.episode === ep) this.maybeAskForEpisode();
        });
      }
      return;
    }
    ep.asked = true;
    this.tally.automatic += 1;
    void this.request('consumer', 'front');
  }

  // ---- the request -------------------------------------------------------------------------------

  private async request(trigger: WebcamTrigger, facing: WebcamFacing): Promise<WebcamResult> {
    const token = this.deps.link.token();
    if (!token) return { ok: false, reason: 'Not connected to the phone' };
    const s: Session = {
      seq: ++this.seq,
      token,
      trigger,
      facing,
      sessionId: null,
      phase: 'requesting',
      socket: null,
      generation: 0,
      size: null,
      liveAnnounced: false,
      preLive: new KeyframeQueue<WebcamFrame>(WEBCAM_PRELIVE_BOUND),
      expiryTimer: null,
      received: 0,
      forwarded: 0,
      droppedStale: 0,
      droppedBridge: 0,
      abandonCause: null,
    };
    this.session = s;
    this.tally.requested += 1;
    this.log.info(`webcam.request sent (${trigger}, ${facing}) — ${this.tally.requested} requested since launch, ${this.tally.automatic} automatic`);
    this.emit();

    let ack: { payload?: unknown };
    let settle: (() => void) | null = null;
    const settling = new Promise<void>((resolve) => (settle = resolve));
    this.settling.add(settling);
    const done = () => {
      this.settling.delete(settling);
      settle?.();
    };
    try {
      ack = await this.deps.link.request(WebcamMessage.REQUEST, { facing, trigger }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      done();
      if (this.session !== s) return { ok: false, reason: 'superseded' };
      const failure = error as PhoneRequestError;
      if (failure.code) {
        this.log.info(`webcam.request refused: ${failure.code}`);
        this.end('refused', { code: failure.code });
      } else {
        this.log.warn(`webcam.request failed: ${failure.message}`);
        this.end('request-failed', {});
      }
      return { ok: false, reason: failure.phoneMessage ?? failure.message };
    }

    const payload = (ack.payload ?? {}) as Record<string, unknown>;
    const sessionId = isSessionId(payload.sessionId) ? payload.sessionId : null;
    if (this.session !== s) {
      // Abandoned while the ack was in flight — a Stop, the episode ending, a lifecycle stop. The phone
      // has a request up that nobody here wants: withdraw it, on the same connection only, and finish
      // before the abandonment settles so the next request is not refused as busy.
      const cause = s.abandonCause;
      if (sessionId && cause && this.deps.link.isConnected() && this.deps.link.token() === s.token) {
        this.log.info(`${label(sessionId)} acknowledged after it was abandoned; withdrawing (${describeStop(cause)})`);
        await this.sendStop(sessionId, cause);
      }
      done();
      return { ok: false, reason: 'superseded' };
    }
    done();
    if (!sessionId) {
      this.log.warn('webcam.request acknowledged without a valid sessionId');
      this.end('request-failed', {});
      return { ok: false, reason: 'The phone answered the webcam request without a session id.' };
    }
    s.sessionId = sessionId;
    s.phase = 'awaiting-approval';
    const expiresInMs = typeof payload.expiresInMs === 'number' && payload.expiresInMs > 0 ? Math.min(payload.expiresInMs, 60_000) : 30_000;
    s.expiryTimer = this.timers.setTimeout(() => {
      s.expiryTimer = null;
      if (this.session === s && s.phase === 'awaiting-approval') {
        this.log.warn(`${label(sessionId)} outlived its expiry with no word from the phone; ending it here`);
        this.end('expired', { wire: failure('no-answer') });
      }
    }, expiresInMs + WEBCAM_EXPIRY_SLACK_MS);
    this.log.info(`${label(sessionId)} awaiting approval on the phone`);
    this.emit();
    return { ok: true };
  }

  // ---- the stream --------------------------------------------------------------------------------

  private openStream(s: Session): void {
    const host = this.deps.link.address();
    const sessionId = s.sessionId!;
    if (!host || !this.deps.link.isConnected() || this.deps.link.token() !== s.token) {
      this.end('disconnected', {});
      return;
    }
    let socket: CameraSocket;
    try {
      socket = this.deps.openSocket(host, webcamClaim(s.token, sessionId));
    } catch (error) {
      this.log.warn(`${label(sessionId)} stream socket could not open: ${error instanceof Error ? error.message : 'error'}`);
      this.end('stream-lost', { wire: failure('stream-unavailable') });
      return;
    }
    s.socket = socket;
    const reader = new WebcamStreamReader();
    socket.onData((chunk) => {
      // A socket that is not this session's current one is a closed one: its bytes change nothing.
      if (this.session !== s || s.socket !== socket) return;
      let frames: WebcamFrame[];
      try {
        frames = reader.push(chunk);
      } catch (error) {
        const reason = error instanceof WebcamStreamError ? error.reason : 'unreadable';
        this.log.warn(`${label(sessionId)} stream closed: ${reason}`);
        this.end('malformed-stream', { wire: failure('stream-malformed') });
        return;
      }
      for (const frame of frames) {
        if (this.session !== s) return;
        this.onFrame(s, frame);
      }
    });
    socket.onClose((reason) => {
      if (this.session !== s || s.socket !== socket) return;
      this.log.info(`${label(sessionId)} stream socket closed: ${reason.slice(0, 120)}`);
      this.end('stream-lost', {});
    });
  }

  private onFrame(s: Session, frame: WebcamFrame): void {
    s.received += 1;
    if (s.phase === 'running' && s.liveAnnounced) {
      if (frame.generation < s.generation) {
        s.droppedStale += 1;
        return;
      }
      // A higher generation can outrun the `running` that announces it (two connections); adopt it.
      s.generation = frame.generation;
      this.forward(s, frame);
    } else if (s.phase === 'starting') {
      // Consent is given (the tap), but the bridge has not been told the session is live. Held, bounded,
      // and sorted against `running`'s generation when it comes — never used to set it.
      s.preLive.offer(frame, frame.keyframe);
    }
  }

  private forward(s: Session, frame: WebcamFrame): void {
    if (!this.bridge || !s.sessionId) {
      s.droppedBridge += 1;
      return;
    }
    if (this.bridge.sendAccessUnit(s.sessionId, frame.bytes, frame.keyframe)) s.forwarded += 1;
    else s.droppedBridge += 1;
  }

  // ---- the single exit ---------------------------------------------------------------------------

  /**
   * Every ending. The wire stop is **written first** (the request is issued synchronously; its ack is
   * not awaited), then the socket is closed, the timers cleared, the held AUs dropped and the bridge
   * told — all in this tick. Returns the stop's ack promise for callers that want to await it.
   */
  private end(
    reason: WebcamEndReason,
    opts: {
      /** The `webcam.stop` to write; absent when there is nobody to tell or the phone ended it. */
      wire?: WebcamWireStop;
      counts?: { framesSent: number | null; framesDropped: number | null };
      code?: string;
    },
  ): Promise<void> | null {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    let told: Promise<void> | null = null;
    if (opts.wire) {
      if (s.sessionId) {
        if (this.deps.link.isConnected() && this.deps.link.token() === s.token) told = this.sendStop(s.sessionId, opts.wire);
      } else {
        // Still waiting for the ack: the withdrawal happens when it names the session.
        s.abandonCause = opts.wire;
      }
    }
    const socket = s.socket;
    s.socket = null;
    socket?.destroy();
    this.clearExpiry(s);
    const heldAtEnd = s.preLive.clear();
    if (s.sessionId && this.bridge) {
      // Told even if never announced live: the bridge remembers the id, so nothing of it can start later.
      this.bridge.sessionEnded(s.sessionId, reason);
    }
    if (reason !== 'no-consumers' && this.episode) this.episode.spent = true;
    this.tally.ended += 1;
    this.lastEnded = {
      sessionId: s.sessionId,
      reason,
      code: opts.code ?? null,
      framesSent: opts.counts?.framesSent ?? null,
      framesDropped: opts.counts?.framesDropped ?? null,
      received: s.received,
      forwarded: s.forwarded,
    };
    const b = this.bridgeCounts;
    this.log.info(
      `${label(s.sessionId)} ended: ${reason}${opts.code ? ` (${opts.code})` : ''}${opts.wire ? `, webcam.stop ${describeStop(opts.wire)}` : ''} — ` +
        `${s.received} AUs received here, ${s.forwarded} forwarded to the bridge, ${s.droppedStale} stale, ` +
        `${s.droppedBridge} not forwarded, ${s.preLive.dropped} dropped before running, ${heldAtEnd} held at the end; ` +
        `phone: ${opts.counts?.framesSent ?? '?'} sent / ${opts.counts?.framesDropped ?? '?'} dropped; ` +
        `bridge last reported ${b ? `${b.received ?? 0} received / ${b.sinkEnqueued ?? 0} to the sink` : 'nothing'} — ` +
        `${this.tally.ended} ended of ${this.tally.requested} requested since launch`,
    );
    this.emit();
    return told;
  }

  private clearExpiry(s: Session): void {
    if (s.expiryTimer !== null) this.timers.clearTimeout(s.expiryTimer);
    s.expiryTimer = null;
  }

  private async sendStop(sessionId: string, stop: WebcamWireStop): Promise<void> {
    try {
      await this.deps.link.request(WebcamMessage.STOP, { sessionId, ...stop }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      this.log.warn(`webcam.stop for ${label(sessionId)} failed: ${(error as Error).message?.slice(0, 120) ?? 'error'}`);
    }
  }

  // ---- what may be asked, and what is shown ------------------------------------------------------

  private phoneSupport(): WebcamStatus['phone'] {
    const link = this.deps.link;
    if (!link.isConnected() || !link.token()) return { kind: 'not-connected' };
    const unavailable = link.unavailableReason(WEBCAM);
    if (unavailable) return { kind: 'unavailable', reason: unavailable };
    if (!link.capabilities().includes(WEBCAM) || (link.negotiated()[WEBCAM] ?? 0) < 1) return { kind: 'older-phone' };
    return { kind: 'ready' };
  }

  /** The first reason no request may be sent, as a sentence for the Mac's owner; null when one may. */
  private blocker(): string | null {
    if (this.bridgeState === 'absent') return this.bridgeDetail ?? 'The camera bridge is not present.';
    if (this.bridgeState === 'failed') return this.bridgeDetail ?? 'The camera bridge failed.';
    if (this.bridgeState !== 'running') return 'The camera bridge is not running yet.';
    if (this.device !== 'installed') return 'Sidekick Camera is not installed on this Mac, so nothing could show the picture.';
    if (this.producer === 'unconfigured') {
      return 'This build of Sidekick has no signing identity for Sidekick Camera, so the camera would refuse its pictures.';
    }
    if (this.producer === 'refused') return 'Sidekick Camera refused this copy of Sidekick as its picture source.';
    if (this.producer !== 'configured') return 'The camera bridge has not reported its signing identity yet.';
    const phone = this.phoneSupport();
    if (phone.kind === 'not-connected') return 'Not connected to the phone.';
    if (phone.kind === 'older-phone') return "The phone's Sidekick needs an update to be used as a webcam.";
    if (phone.kind === 'unavailable') return phone.reason;
    return null;
  }

  private status(): WebcamStatus {
    const s = this.session;
    return {
      bridge: this.bridgeState,
      bridgeDetail: this.bridgeDetail,
      device: this.device,
      producer: this.producer,
      consumers: this.consumers,
      phone: this.phoneSupport(),
      blocker: this.blocker(),
      session: s ? { phase: s.phase, sessionId: s.sessionId, trigger: s.trigger, facing: s.facing, generation: s.generation, size: s.size } : null,
      lastEnded: this.lastEnded,
      bridgeCounts: this.bridgeCounts,
    };
  }

  private emit(): void {
    this.deps.emitState(this.status());
  }
}
