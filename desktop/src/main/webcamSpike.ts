/**
 * The Camera v2 **encoder spike**, Electron main's half — `docs/camera-v2-encoder-spike.md` is the
 * runbook, and that document, not this file, is what was approved to run.
 *
 * One question: can the phone's real Camera2 → MediaCodec output be received here and decoded by
 * VideoToolbox, before Sidekick Camera exists? The production {@link WebcamController} cannot answer it
 * and **is not changed to**: it refuses every request while Sidekick Camera is not installed and the build
 * has no Team ID, and both gates stay exactly as they are. This is a separate, development-only runner
 * that sends the phone one request and sends the decoded frames nowhere.
 *
 * ### What it reuses, unchanged
 *
 * - **The pairing and the control session** — the live `LinkClient`. The session token never leaves this
 *   process: it goes into the claim and nowhere else, and is never logged or reported.
 * - **The pinned stream socket** — Camera v1's `openCameraSocket`, pinned to the phone holding the control
 *   session, exactly as the production webcam wiring passes it.
 * - **The exact-session claim** — `webcamClaim(token, sessionId)`, the contract's 104-byte frame, written
 *   once for the one session the phone acked.
 * - **The phone's consent** — `trigger: "person"`, so the phone says this Mac asked; the camera opens only
 *   on its owner's Start camera tap, on the request's own 30-second clock. Nothing here can tap.
 * - **The bridge's pipeline** — `BridgeProcess` driving `sidekick-camera-decode-probe`, which is the real
 *   `BridgeCore` (gate, VideoToolbox decode, compose) ending in a sink that counts and discards.
 *
 * ### What it adds, and its bounds
 *
 * - **Armed only** in an unpackaged build with `webcamDev` **and** `webcamSpike`, the production plan
 *   advertising `ext.webcam` (so the bridge is built at its one path), and the probe built at its own one
 *   path. Otherwise nothing is registered and the IPC channels do not exist.
 * - **One run per app launch.** A second `run()` is refused, whatever the first one's outcome.
 * - **Timers from `starting`** (the owner's tap): a planned Stop at 15 s, and an independent hard cap at
 *   20 s on its own timer. Then a 60-second observation in which it sends nothing.
 * - **No retention.** No access unit, frame, pixel or screenshot is kept or written; the report is
 *   integers, the session id's first 8 characters, and the phone's own closed-set reason.
 * - **No listener.** The probe is a child on pipes; the socket connects out, as every Mac socket does.
 */

import { accessSync, constants as fsConstants, lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, sep } from 'node:path';
import type { CameraLog, CameraSocket, CameraSocketFactory, CameraTimers } from './camera';
import { log } from './logger';
import { KEYFRAME_MIN_VERSION, KeyframeRecovery, keyframeSender, type KeyframeRecoveryCounts } from '../shared/webcamRecovery';
import type { PhoneRequestError } from '../shared/protocol';
import type { WebcamLinkPort } from './webcam';
import { BridgeProcess, type BridgeExit, type BridgeHooks, type BridgePort, type BridgeProcessOptions } from './webcamBridge';
import type { BridgeStatus } from '../shared/webcamBridgeRecords';
import {
  KeyframeQueue,
  WEBCAM,
  WebcamMessage,
  WebcamStreamError,
  WebcamStreamReader,
  isSessionId,
  webcamClaim,
  type WebcamFrame,
  type WebcamWireStop,
} from '../shared/webcamWire';

export const DECODE_PROBE_NAME = 'sidekick-camera-decode-probe';

/** Pre-registered in the runbook. Every one is reported beside the readings it bounded. */
export interface SpikeBounds {
  /** The planned Stop, measured from `starting`. */
  plannedStopMs: number;
  /** The independent hard cap, measured from `starting`, on its own timer. */
  hardCapMs: number;
  /** After the stop: how long to watch, sending nothing. */
  observeMs: number;
  /** How long after the stop is written the phone's `stopped` is waited for before observing anyway. */
  stoppedWithinMs: number;
  /** Past the ack's `expiresInMs` before the request is withdrawn as unanswered. */
  expirySlackMs: number;
  /** The probe's own lifetime bound, passed to it — it exits by itself after this. */
  probeLifetimeS: number;
}

export const SPIKE_BOUNDS: Readonly<SpikeBounds> = Object.freeze({
  plannedStopMs: 15_000,
  hardCapMs: 20_000,
  observeMs: 60_000,
  stoppedWithinMs: 5_000,
  expirySlackMs: 5_000,
  probeLifetimeS: 150,
});

const REQUEST_TIMEOUT_MS = 5_000;
const PRELIVE_BOUND = 4;

export type SpikePhase = 'idle' | 'starting-probe' | 'requesting' | 'awaiting-approval' | 'capturing' | 'stopping' | 'observing' | 'done';

/** Why there is no reading — each is a named outcome, never folded into a failure. */
export type SpikeNoReading =
  | 'not-connected'
  | 'phone-has-no-webcam'
  | 'webcam-not-negotiated'
  | 'webcam-busy-on-this-mac'
  | 'probe-unavailable'
  | 'refused-by-phone'
  | 'request-failed'
  | 'not-approved'
  | 'ended-before-capture'
  | 'link-lost'
  | 'lifecycle';

export type StopTrigger = 'planned' | 'hard-cap' | 'phone' | 'stream-malformed' | 'probe' | 'socket' | 'lifecycle' | 'link';

export interface SpikeReport {
  outcome: 'completed' | 'no-reading';
  noReading: SpikeNoReading | null;
  /** The phone's code or a sentence for `refused-by-phone` / `request-failed`; never a token. */
  detail: string | null;
  facing: 'front' | 'back';
  bounds: SpikeBounds;
  /** First 8 hex characters only. */
  session: string | null;
  /**
   * The route the stream actually took: the phone address the pinned socket was opened to (the control
   * session's). The driver resolves the Mac interface for it; nothing here assumes Wi-Fi, USB or a hotspot.
   */
  route: { address: string | null };
  /** Milliseconds; each measured from the instant named in the key. */
  timeline: {
    ackFromRequestMs: number | null;
    startingFromRequestMs: number | null;
    runningFromStartingMs: number | null;
    firstAuFromStartingMs: number | null;
    stopFromStartingMs: number | null;
    stoppedFromStopMs: number | null;
  };
  stop: {
    trigger: StopTrigger | null;
    /** What was written: the cause (and detail for `failure`), or null when the phone ended it first. */
    wire: WebcamWireStop | null;
    ackStopped: boolean | null;
  };
  /** Every `running` for this session, as the phone sent it. */
  running: Array<{ generation: number; facing: string | null; width: number | null; height: number | null; targetWidth: number | null; targetHeight: number | null; frameRate: number | null; codec: string | null }>;
  /** The phone's own `stopped`, if it came. */
  phoneStopped: { reason: string; framesSent: number | null; framesDropped: number | null } | null;
  /** What main framed off the claimed socket — before the probe. */
  mac: {
    framed: number;
    keyframes: number;
    bytes: number;
    maxAuBytes: number;
    arrivalSpanMs: number | null;
    forwarded: number;
    heldBeforeRunning: number;
    droppedBeforeRunning: number;
    droppedAtBridgeBound: number;
    socketClose: string | null;
    malformed: string | null;
  };
  probe: {
    /** The probe's `ready` — the same honest reading the bridge takes. Logged, never a gate here. */
    ready: { deviceInstalled: boolean; producerIdentityConfigured: boolean } | null;
    /** The last `counts` record — the probe writes one after its final drain. */
    counts: Record<string, number> | null;
    streamRejected: string | null;
    errors: string[];
    exit: BridgeExit | null;
  };
  /**
   * `webcam.keyframe` recovery (version 2), as main ran it for this session: counters, each beside its
   * denominator. Reported, never judged by the pre-registered criteria. Null if the run ended first.
   */
  recovery: KeyframeRecoveryCounts | null;
  observation: {
    ms: number;
    /** `webcam.state` for this session after its `stopped`. Must be 0. */
    statesAfterStopped: number;
    /** `webcam.state` for any other session during the whole run. Must be 0. */
    foreignStates: number;
    /** AUs offered after the stop was written. The socket is destroyed; must be 0. */
    ausAfterStop: number;
    linkEnded: boolean;
  };
}

export interface SpikeStatus {
  armed: boolean;
  /** Why not, when not armed. */
  reason: string | null;
  phase: SpikePhase;
  spent: boolean;
  report: SpikeReport | null;
}

export interface SpikeDeps {
  link: WebcamLinkPort;
  openSocket: CameraSocketFactory;
  startProbe(hooks: BridgeHooks): BridgePort;
  /** The production controller has a request or session open. The spike never competes with it. */
  webcamBusy(): boolean;
  emit(status: SpikeStatus): void;
  bounds?: Partial<SpikeBounds>;
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
  info: (message) => log.info('webcam-spike', message),
  warn: (message) => log.warn('webcam-spike', message),
};

function emptyReport(facing: 'front' | 'back', bounds: SpikeBounds): SpikeReport {
  return {
    outcome: 'no-reading',
    noReading: null,
    detail: null,
    facing,
    bounds,
    session: null,
    route: { address: null },
    timeline: { ackFromRequestMs: null, startingFromRequestMs: null, runningFromStartingMs: null, firstAuFromStartingMs: null, stopFromStartingMs: null, stoppedFromStopMs: null },
    stop: { trigger: null, wire: null, ackStopped: null },
    running: [],
    phoneStopped: null,
    mac: { framed: 0, keyframes: 0, bytes: 0, maxAuBytes: 0, arrivalSpanMs: null, forwarded: 0, heldBeforeRunning: 0, droppedBeforeRunning: 0, droppedAtBridgeBound: 0, socketClose: null, malformed: null },
    probe: { ready: null, counts: null, streamRejected: null, errors: [], exit: null },
    recovery: null,
    observation: { ms: 0, statesAfterStopped: 0, foreignStates: 0, ausAfterStop: 0, linkEnded: false },
  };
}

/**
 * The runner. Electron-free: `webcamSpike.test.ts` drives it with a labelled stand-in phone and socket and
 * the **built** decode probe; `main.ts` hands it the real link, the pinned opener and `BridgeProcess`.
 */
export class EncoderSpike {
  private readonly bounds: SpikeBounds;
  private readonly timers: CameraTimers;
  private readonly log: CameraLog;
  private phase: SpikePhase = 'idle';
  private spent = false;
  private report: SpikeReport | null = null;

  // The one run's state.
  private token: string | null = null;
  private sessionId: string | null = null;
  private probe: BridgePort | null = null;
  private socket: CameraSocket | null = null;
  private reader: WebcamStreamReader | null = null;
  private preLive = new KeyframeQueue<WebcamFrame>(PRELIVE_BOUND);
  private live = false;
  /** The highest generation seen live for this run's session. */
  private generation = 0;
  private readonly recovery: KeyframeRecovery;
  private stopWritten = false;
  private phoneStoppedSeen = false;
  private t = { request: 0, starting: 0, stop: 0, observe: 0, firstAu: 0, lastAu: 0 };
  private timerHandles: unknown[] = [];
  private finished: Promise<SpikeReport> | null = null;
  private resolveFinished: ((r: SpikeReport) => void) | null = null;
  private stoppedWaiter: (() => void) | null = null;
  private readyWaiter: ((ok: boolean) => void) | null = null;
  private probeExited: Promise<BridgeExit> | null = null;

  constructor(private readonly deps: SpikeDeps) {
    this.bounds = { ...SPIKE_BOUNDS, ...(deps.bounds ?? {}) };
    this.timers = deps.timers ?? realTimers;
    this.log = deps.log ?? realLog;
    this.recovery = new KeyframeRecovery({
      timers: this.timers,
      supported: () => (deps.link.negotiated()[WEBCAM] ?? 0) >= KEYFRAME_MIN_VERSION,
      send: keyframeSender((type, payload, ms) => deps.link.request(type, payload, ms), WebcamMessage.KEYFRAME),
      log: this.log,
    });
  }

  current(): SpikeStatus {
    return { armed: true, reason: null, phase: this.phase, spent: this.spent, report: this.report };
  }

  /** Resolves when a run has finished its observation (or ended with no reading). */
  done(): Promise<SpikeReport> | null {
    return this.finished;
  }

  /**
   * The one run. Resolves once the request has been answered either way (`ok` true means the phone is
   * now showing it); the rest — the tap, capture, Stop, observation — arrives as status.
   */
  async run(facing: 'front' | 'back' = 'back'): Promise<{ ok: boolean; reason?: string }> {
    if (this.spent) return { ok: false, reason: 'The encoder spike has already run in this launch of Sidekick. It does not run twice.' };
    const r = (this.report = emptyReport(facing, this.bounds));
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve));

    // Preconditions, read before anything is spawned or sent. A failure here is a named no-reading.
    const pre = this.precondition();
    if (pre) {
      this.spent = true;
      this.finish(pre.kind, pre.detail);
      return { ok: false, reason: pre.detail };
    }
    this.spent = true;
    this.token = this.deps.link.token();

    // The probe first: no request is sent unless something is ready to decode what it would start.
    this.setPhase('starting-probe');
    const ready = await this.startProbe();
    if (!ready) {
      this.finish('probe-unavailable', 'the decode probe did not report ready');
      return { ok: false, reason: 'The decode probe did not start.' };
    }

    this.setPhase('requesting');
    this.t.request = this.timers.now();
    this.log.info(`webcam.request sent (person, ${facing}) — the encoder spike's one request`);
    let ack: { payload?: unknown };
    try {
      ack = await this.deps.link.request(WebcamMessage.REQUEST, { facing, trigger: 'person' }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      const failure = error as PhoneRequestError;
      if (failure.code) {
        this.log.info(`webcam.request refused: ${failure.code}`);
        this.finish('refused-by-phone', failure.code);
      } else {
        this.log.warn(`webcam.request failed: ${failure.message}`);
        this.finish('request-failed', failure.message);
      }
      return { ok: false, reason: failure.phoneMessage ?? failure.message };
    }
    const payload = (ack.payload ?? {}) as Record<string, unknown>;
    if (!isSessionId(payload.sessionId)) {
      this.finish('request-failed', 'acknowledged without a session id');
      return { ok: false, reason: 'The phone answered without a session id.' };
    }
    this.sessionId = payload.sessionId;
    r.session = payload.sessionId.slice(0, 8);
    r.timeline.ackFromRequestMs = this.timers.now() - this.t.request;
    const expiresInMs = typeof payload.expiresInMs === 'number' && payload.expiresInMs > 0 ? Math.min(payload.expiresInMs, 60_000) : 30_000;
    this.arm(() => {
      if (this.phase === 'awaiting-approval') {
        this.log.warn(`spike session ${r.session}… outlived its expiry unanswered; withdrawing it`);
        this.writeStop({ cause: 'failure', detail: 'no-answer' }, 'phone');
        this.finish('not-approved', 'no answer within the request expiry');
      }
    }, expiresInMs + this.bounds.expirySlackMs);
    this.setPhase('awaiting-approval');
    this.log.info(`spike session ${r.session}… awaiting the owner's tap on the phone`);
    return { ok: true };
  }

  private precondition(): { kind: SpikeNoReading; detail: string } | null {
    const link = this.deps.link;
    if (!link.isConnected() || !link.token()) return { kind: 'not-connected', detail: 'Not connected to the phone.' };
    if (!link.capabilities().includes(WEBCAM)) {
      return { kind: 'phone-has-no-webcam', detail: link.unavailableReason(WEBCAM) ?? 'The phone does not offer the webcam.' };
    }
    if ((link.negotiated()[WEBCAM] ?? 0) < 1) return { kind: 'webcam-not-negotiated', detail: 'ext.webcam is not negotiated at 1.' };
    if (this.deps.webcamBusy()) return { kind: 'webcam-busy-on-this-mac', detail: 'The Use as webcam section has a request or session open.' };
    return null;
  }

  private startProbe(): Promise<boolean> {
    return new Promise((resolve) => {
      this.readyWaiter = resolve;
      try {
        this.probe = this.deps.startProbe({
          onStatus: (status) => this.onProbeStatus(status),
          onExit: (exit) => this.onProbeExit(exit),
        });
      } catch (error) {
        this.report!.probe.errors.push(`spawn: ${(error as Error).message}`);
        this.readyWaiter = null;
        resolve(false);
      }
    });
  }

  // ---- the phone ---------------------------------------------------------------------------------

  /** `webcam.state` from the phone — any session. Only this run's session moves anything. */
  onState(payload: unknown): void {
    const r = this.report;
    if (!r || this.phase === 'idle') return;
    const p = (payload ?? {}) as Record<string, unknown>;
    if (!isSessionId(p.sessionId) || p.sessionId !== this.sessionId || this.deps.link.token() !== this.token) {
      r.observation.foreignStates += 1;
      return;
    }
    if (this.phoneStoppedSeen) {
      r.observation.statesAfterStopped += 1;
      return;
    }
    const now = this.timers.now();
    if (p.state === 'starting' && this.phase === 'awaiting-approval') {
      this.clearTimers();
      this.t.starting = now;
      r.timeline.startingFromRequestMs = now - this.t.request;
      this.setPhase('capturing');
      this.log.info(`spike session ${r.session}… allowed on the phone; opening the stream socket; Stop in ${this.bounds.plannedStopMs} ms, hard cap ${this.bounds.hardCapMs} ms`);
      // Two timers, both from the tap. The cap does not depend on the planned one having been armed.
      this.arm(() => this.stopNow('planned'), this.bounds.plannedStopMs);
      this.arm(() => this.stopNow('hard-cap'), this.bounds.hardCapMs);
      this.openStream();
      return;
    }
    if (p.state === 'running' && this.phase === 'capturing') {
      const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const generation = num(p.generation);
      r.running.push({
        generation: generation ?? 0,
        facing: typeof p.facing === 'string' ? p.facing : null,
        width: num(p.width),
        height: num(p.height),
        targetWidth: num(p.targetWidth),
        targetHeight: num(p.targetHeight),
        frameRate: num(p.frameRate),
        codec: typeof p.codec === 'string' ? p.codec : null,
      });
      if (r.timeline.runningFromStartingMs === null) r.timeline.runningFromStartingMs = now - this.t.starting;
      if (generation === null || !Number.isInteger(generation) || generation < 1) return;
      this.live = true;
      this.probe?.sessionLive(this.sessionId!, generation);
      if (generation > this.generation) {
        this.generation = generation;
        this.recovery.setLive(this.sessionId!, generation);
      }
      for (let f = this.preLive.shift(); f; f = this.preLive.shift()) this.forward(f);
      return;
    }
    if (p.state === 'stopped') {
      this.phoneStoppedSeen = true;
      r.phoneStopped = {
        reason: typeof p.reason === 'string' ? p.reason : 'unknown',
        framesSent: typeof p.framesSent === 'number' ? p.framesSent : null,
        framesDropped: typeof p.framesDropped === 'number' ? p.framesDropped : null,
      };
      if (this.stopWritten) {
        r.timeline.stoppedFromStopMs = now - this.t.stop;
        this.stoppedWaiter?.();
        return;
      }
      // The phone ended it first: a decline, an expiry, Home, Stop there, a failure.
      const before = this.phase === 'awaiting-approval';
      this.log.info(`spike session ${r.session}… ended by the phone: ${r.phoneStopped.reason}`);
      if (before) {
        this.finish(r.phoneStopped.reason === 'expired' ? 'not-approved' : 'ended-before-capture', r.phoneStopped.reason);
        return;
      }
      void this.endCapture('phone', null);
    }
  }

  /** The control session ended (`SESSION_ENDED_EVENT`). The phone stops by itself; nothing is sent. */
  onSessionEnded(token: string | null): void {
    if (!this.report || token !== this.token) return;
    this.report.observation.linkEnded = true;
    if (this.phase === 'awaiting-approval' || this.phase === 'requesting' || this.phase === 'starting-probe') {
      this.finish('link-lost', 'the control session ended before capture');
    } else if (this.phase === 'capturing') {
      void this.endCapture('link', null);
    }
  }

  /** Sleep, screen lock, a user switch or quit: stop at once, cause `shutdown`. */
  async lifecycle(what: string): Promise<void> {
    if (this.phase === 'awaiting-approval') {
      this.writeStop({ cause: 'shutdown' }, 'lifecycle');
      this.finish('lifecycle', what);
    } else if (this.phase === 'capturing') {
      await this.endCapture('lifecycle', { cause: 'shutdown' });
    } else if (this.phase === 'starting-probe' || this.phase === 'requesting') {
      this.finish('lifecycle', what);
    } else if (this.phase === 'observing' && this.report) {
      // Quit or sleep cuts the observation short; the report says how long it actually ran.
      this.report.observation.ms = this.timers.now() - this.t.observe;
      this.finish(null, `observation cut short by ${what}`);
    }
    await this.reapProbe();
  }

  // ---- the stream --------------------------------------------------------------------------------

  private openStream(): void {
    const address = this.deps.link.address();
    this.report!.route.address = address;
    if (!address || !this.token || !this.sessionId) {
      void this.endCapture('socket', { cause: 'failure', detail: 'stream-unavailable' });
      return;
    }
    let socket: CameraSocket;
    try {
      socket = this.deps.openSocket(address, webcamClaim(this.token, this.sessionId));
    } catch (error) {
      this.report!.mac.socketClose = `open failed: ${(error as Error).message}`;
      void this.endCapture('socket', { cause: 'failure', detail: 'stream-unavailable' });
      return;
    }
    this.socket = socket;
    this.reader = new WebcamStreamReader();
    socket.onData((chunk) => this.onData(socket, chunk));
    socket.onClose((reason) => {
      if (this.socket !== socket) return;
      this.report!.mac.socketClose = reason;
      if (this.phase === 'capturing') void this.endCapture('socket', null);
    });
  }

  private onData(socket: CameraSocket, chunk: Buffer): void {
    const r = this.report!;
    if (this.socket !== socket || this.phase !== 'capturing') {
      if (this.stopWritten) r.observation.ausAfterStop += 1;
      return;
    }
    let frames: WebcamFrame[];
    try {
      frames = this.reader!.push(chunk);
    } catch (error) {
      r.mac.malformed = error instanceof WebcamStreamError ? error.reason : String(error);
      void this.endCapture('stream-malformed', { cause: 'failure', detail: 'stream-malformed' });
      return;
    }
    const now = this.timers.now();
    for (const f of frames) {
      if (r.mac.framed === 0) {
        this.t.firstAu = now;
        r.timeline.firstAuFromStartingMs = now - this.t.starting;
      }
      this.t.lastAu = now;
      r.mac.framed += 1;
      r.mac.bytes += f.bytes.length;
      r.mac.maxAuBytes = Math.max(r.mac.maxAuBytes, f.bytes.length);
      if (f.keyframe) r.mac.keyframes += 1;
      if (this.live) {
        if (f.generation > this.generation) {
          this.generation = f.generation;
          this.recovery.setLive(this.sessionId!, f.generation);
        }
        if (f.keyframe) this.recovery.idrReceived(this.sessionId!, f.generation);
        this.forward(f);
      } else {
        const before = this.preLive.dropped;
        if (this.preLive.offer(f, f.keyframe)) r.mac.heldBeforeRunning += 1;
        r.mac.droppedBeforeRunning += this.preLive.dropped - before;
      }
    }
    if (r.mac.framed > 0) r.mac.arrivalSpanMs = this.t.lastAu - this.t.firstAu;
  }

  private forward(f: WebcamFrame): void {
    const r = this.report!;
    if (!this.probe || !this.sessionId) return;
    if (this.probe.sendAccessUnit(this.sessionId, f.bytes, f.keyframe)) r.mac.forwarded += 1;
  }

  // ---- endings ----------------------------------------------------------------------------------

  /** The planned Stop or the hard cap. Whichever fires first ends it; the other finds nothing to do. */
  private stopNow(trigger: 'planned' | 'hard-cap'): void {
    if (this.phase !== 'capturing') return;
    if (trigger === 'hard-cap') this.log.warn(`spike session ${this.report!.session}… reached the ${this.bounds.hardCapMs} ms hard cap`);
    void this.endCapture(trigger, { cause: 'person' });
  }

  /** The one capture ending: stop written first, then the socket, then the probe told — same tick. */
  private async endCapture(trigger: StopTrigger, wire: WebcamWireStop | null): Promise<void> {
    if (this.phase !== 'capturing') return;
    const r = this.report!;
    this.setPhase('stopping');
    this.clearTimers();
    this.t.stop = this.timers.now();
    r.stop.trigger = trigger;
    r.timeline.stopFromStartingMs = this.t.stop - this.t.starting;
    if (wire && !this.phoneStoppedSeen) this.writeStop(wire, trigger);
    this.stopWritten = true;
    this.recovery.setLive(null);
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    this.preLive.clear();
    if (this.sessionId) this.probe?.sessionEnded(this.sessionId, wire ? 'stopped-by-mac' : 'phone-ended');
    this.log.info(`spike session ${r.session}… stopped (${trigger}) at ${r.timeline.stopFromStartingMs} ms from the tap — ${r.mac.framed} AUs framed, ${r.mac.forwarded} forwarded to the probe`);

    // The phone's account, bounded; then the probe's final counts; then the observation.
    if (!this.phoneStoppedSeen && trigger !== 'link') {
      await new Promise<void>((resolve) => {
        this.stoppedWaiter = resolve;
        this.arm(resolve, this.bounds.stoppedWithinMs);
      });
      this.stoppedWaiter = null;
      this.clearTimers();
    }
    await this.reapProbe();
    this.setPhase('observing');
    this.log.info(`spike observing for ${this.bounds.observeMs} ms; nothing will be sent`);
    this.t.observe = this.timers.now();
    await new Promise<void>((resolve) => this.arm(resolve, this.bounds.observeMs));
    if ((this.phase as SpikePhase) !== 'observing') return; // a lifecycle stop already finished it
    r.observation.ms = this.timers.now() - this.t.observe;
    this.finish(null, null);
  }

  private writeStop(wire: WebcamWireStop, trigger: StopTrigger): void {
    const r = this.report!;
    if (!this.sessionId || r.stop.wire) return;
    r.stop.wire = wire;
    if (r.stop.trigger === null) r.stop.trigger = trigger;
    // Written, never awaited: the stop does not wait for its ack (docs/protocol.md → webcam.stop).
    void this.deps.link
      .request(WebcamMessage.STOP, { sessionId: this.sessionId, ...wire }, REQUEST_TIMEOUT_MS)
      .then((ack) => (r.stop.ackStopped = (ack.payload as Record<string, unknown> | undefined)?.stopped === true))
      .catch(() => (r.stop.ackStopped = null));
  }

  private onProbeStatus(status: BridgeStatus): void {
    const r = this.report;
    if (!r) return;
    switch (status.op) {
      case 'ready':
        r.probe.ready = { deviceInstalled: status.deviceInstalled, producerIdentityConfigured: status.producerIdentityConfigured };
        this.readyWaiter?.(true);
        this.readyWaiter = null;
        return;
      case 'counts':
        r.probe.counts = { ...status.counts };
        return;
      case 'stream-rejected':
        if (status.sessionId !== this.sessionId) return;
        r.probe.streamRejected = status.violation;
        void this.endCapture('stream-malformed', { cause: 'failure', detail: 'stream-malformed' });
        return;
      case 'error':
        if (r.probe.errors.length < 8) r.probe.errors.push(status.error);
        return;
      case 'chain-broken':
      case 'chain-recovered':
        // This run's one probe; bound here to this run's session while it is live and capturing.
        if (status.sessionId !== this.sessionId || !this.live || this.phase !== 'capturing') return;
        if (status.op === 'chain-broken') this.recovery.chainBroken(status.sessionId, status.generation, status.cause);
        else this.recovery.chainRecovered(status.sessionId, status.generation);
        return;
      default:
        return;
    }
  }

  private onProbeExit(exit: BridgeExit): void {
    const r = this.report;
    if (r) r.probe.exit = exit;
    this.readyWaiter?.(false);
    this.readyWaiter = null;
    if (this.phase === 'capturing' && !exit.requested) void this.endCapture('probe', { cause: 'failure', detail: 'bridge-failed' });
  }

  private reapProbe(): Promise<BridgeExit | null> {
    const probe = this.probe;
    if (!probe) return Promise.resolve(null);
    this.probeExited ??= probe.stop();
    return this.probeExited;
  }

  private finish(noReading: SpikeNoReading | null, detail: string | null): void {
    const r = this.report;
    if (!r || this.phase === 'done') return;
    this.clearTimers();
    r.outcome = noReading ? 'no-reading' : 'completed';
    r.recovery = this.recovery.counts();
    r.noReading = noReading;
    r.detail = detail;
    this.setPhase('done');
    this.log.info(`spike ${r.outcome}${noReading ? ` (${noReading}${detail ? `: ${detail}` : ''})` : ''}`);
    const resolve = this.resolveFinished;
    this.resolveFinished = null;
    void this.reapProbe().then(() => {
      this.emit();
      resolve?.(r);
    });
  }

  private arm(fn: () => void, ms: number): void {
    this.timerHandles.push(this.timers.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const h of this.timerHandles) this.timers.clearTimeout(h);
    this.timerHandles = [];
  }

  private setPhase(phase: SpikePhase): void {
    this.phase = phase;
    this.emit();
  }

  private emit(): void {
    this.deps.emit(this.current());
  }
}

// ---- wiring -------------------------------------------------------------------------------------

/**
 * The probe's one path: `<app>/native/SidekickCamera/.build/release/sidekick-camera-decode-probe`, in an
 * unpackaged build only. A packaged build has no probe and never looks for one. Same checks as the
 * bridge's resolver: absolute, a regular executable file, not a symbolic link, real path inside the
 * expected directory, exactly this name.
 */
export function resolveDecodeProbe(opts: { packaged: boolean; appPath: string }): { path: string } | { path: null; reason: string } {
  if (opts.packaged) return { path: null, reason: 'a packaged build has no decode probe' };
  const root = join(opts.appPath, 'native', 'SidekickCamera', '.build');
  const candidate = join(root, 'release', DECODE_PROBE_NAME);
  if (!isAbsolute(candidate)) return { path: null, reason: 'the decode probe path is not absolute' };
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch {
    return { path: null, reason: `the decode probe is not built (${candidate} is missing)` };
  }
  if (stat.isSymbolicLink()) return { path: null, reason: 'the decode probe path is a symbolic link' };
  if (!stat.isFile()) return { path: null, reason: 'the decode probe path is not a file' };
  try {
    accessSync(candidate, fsConstants.X_OK);
  } catch {
    return { path: null, reason: 'the decode probe is not executable' };
  }
  try {
    const real = realpathSync(candidate);
    if (!real.startsWith(realpathSync(root) + sep) || basename(real) !== DECODE_PROBE_NAME) {
      return { path: null, reason: 'the decode probe resolves outside its directory' };
    }
  } catch {
    return { path: null, reason: 'the decode probe path could not be resolved' };
  }
  return { path: candidate };
}

/** The IPC channels, only registered when armed. */
export const SPIKE_IPC = Object.freeze({
  CURRENT: 'webcam-spike-current',
  RUN: 'webcam-spike-run',
  STATE: 'webcam-spike-state',
} as const);

export interface SpikeWiringDeps {
  packaged: boolean;
  /** Both switches as read at startup; a packaged build passes false for both. */
  devSwitch: boolean;
  spikeSwitch: boolean;
  /** The production plan's advertisement: the spike needs `ext.webcam` 1 on the wire, and adds none. */
  webcamAdvertised: boolean;
  appPath: string;
  link: WebcamLinkPort & { on(event: string, listener: (...args: any[]) => void): unknown };
  sessionEndedEvent: string;
  openSocket: CameraSocketFactory;
  webcamBusy(): boolean;
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  send(channel: string, payload: unknown): void;
  power: { on(event: string, listener: () => void): unknown };
  probeOptions?: Partial<Pick<BridgeProcessOptions, 'readyTimeoutMs' | 'gracefulMs' | 'termMs'>>;
  bounds?: Partial<SpikeBounds>;
  timers?: CameraTimers;
  log?: CameraLog;
}

export interface SpikeWiring {
  /** Null when not armed; `reason` says why. */
  readonly spike: EncoderSpike | null;
  readonly reason: string | null;
  dispose(): Promise<void>;
}

export function wireWebcamSpike(deps: SpikeWiringDeps): SpikeWiring {
  const why =
    deps.packaged ? 'a packaged build never runs the encoder spike'
    : !deps.spikeSwitch ? null
    : !deps.devSwitch ? 'the webcamSpike switch needs webcamDev too'
    : !deps.webcamAdvertised ? 'ext.webcam is not advertised (the bridge is not built at its one path)'
    : null;
  if (!deps.spikeSwitch || why) return { spike: null, reason: why ?? 'the webcamSpike switch is off', dispose: async () => undefined };
  const probe = resolveDecodeProbe({ packaged: deps.packaged, appPath: deps.appPath });
  if (probe.path === null) return { spike: null, reason: probe.reason, dispose: async () => undefined };
  const executable = probe.path;

  const spike = new EncoderSpike({
    link: deps.link,
    openSocket: deps.openSocket,
    startProbe: (hooks) =>
      new BridgeProcess({
        executable,
        args: ['--max-seconds', String((deps.bounds?.probeLifetimeS ?? SPIKE_BOUNDS.probeLifetimeS))],
        // Its lines say "camera bridge" (BridgeProcess's wording); the tag says whose they are.
        log: { info: (m) => log.info('webcam-spike', `decode probe: ${m}`), warn: (m) => log.warn('webcam-spike', `decode probe: ${m}`) },
        ...hooks,
        ...(deps.probeOptions ?? {}),
      }),
    webcamBusy: deps.webcamBusy,
    emit: (status) => deps.send(SPIKE_IPC.STATE, status),
    bounds: deps.bounds,
    timers: deps.timers,
    log: deps.log,
  });
  deps.link.on('message', (envelope: { type?: string; payload?: unknown }) => {
    if (envelope?.type === WebcamMessage.STATE) spike.onState(envelope.payload);
  });
  deps.link.on(deps.sessionEndedEvent, (ended: { token: string | null }) => spike.onSessionEnded(ended?.token ?? null));
  for (const event of ['suspend', 'lock-screen', 'user-did-resign-active']) deps.power.on(event, () => void spike.lifecycle(event));
  deps.handle(SPIKE_IPC.CURRENT, () => spike.current());
  deps.handle(SPIKE_IPC.RUN, () => spike.run('back'));
  return { spike, reason: null, dispose: () => spike.lifecycle('quit') };
}
