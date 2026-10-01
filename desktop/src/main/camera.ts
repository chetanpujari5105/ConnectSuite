/**
 * Camera v1, the Mac's half — docs/protocol.md → Camera.
 *
 * The main process owns the control requests and the stream socket; the renderer only draws what
 * {@link CameraController} tells it and decodes the JPEGs it is handed. This file is Electron-free:
 * the link, the socket and the clock are injected, so `camera.test.ts` drives the real controller
 * against fakes rather than a copy of its rules.
 *
 * ### What it refuses to do
 *
 * - **Open a socket before approval.** The stream socket opens on `camera.state: starting`, which the
 *   phone sends only after its owner tapped Start camera. Never on the request's ack.
 * - **Act on another stream's news.** Every event, frame and close is checked against the stream id
 *   and the session token this request was made under. A late event from a stream that has ended, or
 *   from a session that has been replaced, changes nothing.
 * - **Hold more than two frames.** One frame is with the renderer and at most one waits; a newer
 *   frame replaces the waiting one. A slow renderer costs frames, never memory.
 * - **Show an old frame as live.** Two seconds without a frame marks the stream `stalled` and the
 *   pane hides the picture; any end clears it.
 */

import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { writeFrame } from './framing';
import { fingerprintOfDer } from './identity';
import type { Identity } from './identity';
import { log } from './logger';
import { MessageType, PORT_VIDEO, normalizeFingerprint, type PhoneRequestError } from '../shared/protocol';
import { CameraFrameError, CameraFrameReader, cameraClaim, type CameraFacing, type CameraFrame } from '../shared/cameraFrame';

/** No frame for this long while `live` and the picture is hidden as stalled. */
export const CAMERA_STALL_MS = 2_000;

/** A request the phone has not ended by itself this long after its own expiry is ended here. */
export const CAMERA_EXPIRY_SLACK_MS = 5_000;

const REQUEST_TIMEOUT_MS = 5_000;
const STREAM_ID = /^[0-9a-f]{32}$/;

/** Why a stream ended: the phone's closed set, plus the endings only this side can see. */
export type CameraEndReason =
  | 'declined'
  | 'expired'
  | 'permission-denied'
  | 'camera-unavailable'
  | 'camera-in-use'
  | 'stopped-by-mac'
  | 'stopped-on-phone'
  | 'left-screen'
  | 'stream-closed'
  | 'capture-failed'
  /** The control session ended — a disconnect, or the phone going away. */
  | 'disconnected'
  /** The stream socket closed and the phone has not yet said why. A phone `stopped` replaces it. */
  | 'stream-lost';

const WIRE_REASONS = new Set<string>([
  'declined', 'expired', 'permission-denied', 'camera-unavailable', 'camera-in-use',
  'stopped-by-mac', 'stopped-on-phone', 'left-screen', 'stream-closed', 'capture-failed',
]);

/** Everything the pane draws, and nothing it has to infer. */
export type CameraPaneState =
  | { kind: 'idle' }
  | {
      kind: 'requesting';
      facing: CameraFacing;
      /** Null until the phone's ack arrives. */
      streamId: string | null;
      expiresAtMs: number | null;
      message: string | null;
      fixHint: string | null;
    }
  | { kind: 'connecting'; streamId: string; facing: CameraFacing }
  | {
      kind: 'live';
      streamId: string;
      facing: CameraFacing;
      width: number;
      height: number;
      /** The phone's cap, never a measurement. */
      frameRate: number | null;
      stalled: boolean;
      framesReceived: number;
      /** A switch the phone refused, said once beside a picture that is still live. */
      notice: string | null;
    }
  | {
      kind: 'ended';
      streamId: string | null;
      reason: CameraEndReason;
      message: string;
      fixHint: string | null;
      framesSent: number | null;
      framesDropped: number | null;
      framesReceived: number;
    }
  | { kind: 'refused'; code: string; message: string; fixHint: string | null }
  | { kind: 'error'; code: string; message: string };

/** One decoded frame's description and bytes, as the renderer receives it. */
export interface CameraFrameMessage {
  streamId: string;
  sequence: number;
  facing: CameraFacing;
  rotation: number;
  mirrored: boolean;
  width: number;
  height: number;
  jpeg: Uint8Array;
}

/** The slice of the link the camera needs. `LinkClient` satisfies it; the test fakes it. */
export interface CameraLinkPort {
  isConnected(): boolean;
  token(): string | null;
  address(): string | null;
  request(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<{ payload?: unknown }>;
}

/** A stream socket, already sent its claim. */
export interface CameraSocket {
  onData(listener: (chunk: Buffer) => void): void;
  onClose(listener: (reason: string) => void): void;
  destroy(): void;
}

export type CameraSocketFactory = (host: string, claim: string) => CameraSocket;

export interface CameraTimers {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: CameraTimers = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export interface CameraControllerDeps {
  link: CameraLinkPort;
  openSocket: CameraSocketFactory;
  emitState(state: CameraPaneState): void;
  emitFrame(frame: CameraFrameMessage): void;
  timers?: CameraTimers;
}

/** What an IPC call answers. Never thrown across the bridge — defect 22. */
export interface CameraResult {
  ok: boolean;
  reason?: string;
}

/** The Mac's own sentence for each ending, keyed on the reason; the phone's is the fallback. */
export function endedCopy(reason: CameraEndReason): { message: string; fixHint: string | null } {
  switch (reason) {
    case 'declined':
      return { message: 'The request was declined on your phone.', fixHint: null };
    case 'expired':
      return { message: 'Nobody allowed the camera on your phone within 30 seconds.', fixHint: 'Ask again, then tap Start camera on your phone.' };
    case 'permission-denied':
      return { message: "Your phone's camera permission is off for Sidekick.", fixHint: "Allow Camera for Sidekick when the phone asks, or in the phone's Settings." };
    case 'camera-unavailable':
      return { message: "Your phone's camera could not be opened.", fixHint: 'Try the other camera, or check the camera works in another app on the phone.' };
    case 'camera-in-use':
      return { message: 'Another app on your phone is using the camera, or a setting has turned it off.', fixHint: 'Close the other camera app on the phone, then ask again.' };
    case 'stopped-by-mac':
      return { message: 'You stopped the camera from this Mac.', fixHint: null };
    case 'stopped-on-phone':
      return { message: 'The camera was stopped on your phone.', fixHint: null };
    case 'left-screen':
      return { message: "The camera stopped because Sidekick's camera screen left your phone's display.", fixHint: 'The camera only runs while that screen stays open on the phone.' };
    case 'stream-closed':
      return { message: 'The connection carrying the picture closed.', fixHint: 'Ask again. If it keeps happening, check the Mac and phone are on the same network.' };
    case 'capture-failed':
      return { message: 'Your phone could not produce camera frames.', fixHint: 'Ask again. If it keeps happening, restart the phone.' };
    case 'disconnected':
      return { message: 'Your phone disconnected, so the camera stopped.', fixHint: null };
    case 'stream-lost':
      return { message: 'The connection carrying the picture closed.', fixHint: null };
  }
}

export class CameraController {
  private state: CameraPaneState = { kind: 'idle' };
  private streamId: string | null = null;
  private sessionToken: string | null = null;
  private socket: CameraSocket | null = null;
  private lastFrameAt = 0;
  private framesReceived = 0;
  private stallTimer: unknown = null;
  private expiryTimer: unknown = null;
  /** Bumped by stop and by a session ending, so a request still in flight knows it was overtaken. */
  private requestSeq = 0;
  private frameWithRenderer = false;
  private waitingFrame: CameraFrameMessage | null = null;
  private readonly timers: CameraTimers;

  constructor(private readonly deps: CameraControllerDeps) {
    this.timers = deps.timers ?? realTimers;
  }

  current(): CameraPaneState {
    return this.state;
  }

  // ---- the renderer's intents ------------------------------------------------------------------

  /** Asks the phone. Opens nothing: the camera opens only after the phone's owner allows it there. */
  async request(facing: unknown): Promise<CameraResult> {
    if (facing !== 'back' && facing !== 'front') return { ok: false, reason: 'facing must be back or front' };
    if (this.isActive()) return { ok: false, reason: 'A camera request or stream is already open' };
    const token = this.deps.link.token();
    if (!this.deps.link.isConnected() || !token) return { ok: false, reason: 'Not connected to the phone' };

    const seq = ++this.requestSeq;
    // Bound to its session from the moment it is sent: an end of *this* session ends it, a
    // replacement session's events and ends do not.
    this.sessionToken = token;
    this.framesReceived = 0;
    this.setState({ kind: 'requesting', facing, streamId: null, expiresAtMs: null, message: null, fixHint: null });

    let ack: { payload?: unknown };
    try {
      ack = await this.deps.link.request(MessageType.CAMERA_REQUEST, { facing }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      if (seq !== this.requestSeq) return { ok: false, reason: 'superseded' };
      const failure = error as PhoneRequestError;
      if (failure.code) {
        log.info('camera', `camera.request refused: ${failure.code}`);
        this.setState({ kind: 'refused', code: failure.code, message: failure.phoneMessage ?? failure.message, fixHint: failure.fixHint ?? null });
      } else {
        log.warn('camera', `camera.request failed: ${failure.message}`);
        this.setState({ kind: 'error', code: 'REQUEST_FAILED', message: failure.message });
      }
      return { ok: false, reason: failure.message };
    }

    const payload = (ack.payload ?? {}) as Record<string, unknown>;
    const streamId = typeof payload.streamId === 'string' && STREAM_ID.test(payload.streamId) ? payload.streamId : null;
    if (seq !== this.requestSeq || this.deps.link.token() !== token) {
      // Stopped, or the session ended, while the request was in flight. The phone has a request up
      // that nobody here wants: withdraw it rather than leave it on the owner's screen.
      if (streamId) void this.sendStop(streamId);
      return { ok: false, reason: 'superseded' };
    }
    if (!streamId) {
      this.setState({ kind: 'error', code: 'BAD_ACK', message: 'The phone answered the camera request without a stream id.' });
      return { ok: false, reason: 'bad ack' };
    }

    this.streamId = streamId;
    const expiresInMs = typeof payload.expiresInMs === 'number' ? payload.expiresInMs : 30_000;
    this.setState({
      kind: 'requesting',
      facing,
      streamId,
      expiresAtMs: this.timers.now() + expiresInMs,
      message: typeof payload.message === 'string' ? payload.message : null,
      fixHint: typeof payload.fixHint === 'string' ? payload.fixHint : null,
    });
    // The phone ends its own request at expiry and says so. This is the backstop for an `expired`
    // that never arrives, so a pane cannot sit on "waiting" for a request that no longer exists.
    this.expiryTimer = this.timers.setTimeout(() => {
      if (this.state.kind === 'requesting' && this.streamId === streamId) {
        log.warn('camera', 'camera request outlived its expiry with no word from the phone; ending it here');
        void this.sendStop(streamId);
        this.end('expired', streamId);
      }
    }, expiresInMs + CAMERA_EXPIRY_SLACK_MS);
    log.info('camera', `camera.request acknowledged: stream ${streamId.slice(0, 8)}… awaiting approval on the phone`);
    return { ok: true };
  }

  /** Stops whatever this Mac has open. Idempotent: a stop with nothing open is an answer. */
  async stop(): Promise<CameraResult> {
    const streamId = this.streamId;
    const active = this.isActive();
    this.requestSeq += 1;
    if (!active) return { ok: true };
    this.end('stopped-by-mac', streamId);
    if (streamId) await this.sendStop(streamId);
    return { ok: true };
  }

  /** Switches the camera inside the live stream. A refusal is said beside the picture, which stays. */
  async switchCamera(facing: unknown): Promise<CameraResult> {
    if (facing !== 'back' && facing !== 'front') return { ok: false, reason: 'facing must be back or front' };
    const streamId = this.streamId;
    if (!streamId || (this.state.kind !== 'live' && this.state.kind !== 'connecting')) {
      return { ok: false, reason: 'No live camera stream' };
    }
    try {
      await this.deps.link.request(MessageType.CAMERA_SWITCH, { streamId, facing }, REQUEST_TIMEOUT_MS);
      return { ok: true };
    } catch (error) {
      const failure = error as PhoneRequestError;
      const notice = failure.phoneMessage ?? failure.message;
      if (this.state.kind === 'live' && this.streamId === streamId) this.setState({ ...this.state, notice });
      return { ok: false, reason: notice };
    }
  }

  /** The renderer has drawn the frame it was given; hand it the newest one waiting, if any. */
  frameAck(): void {
    this.frameWithRenderer = false;
    const next = this.waitingFrame;
    this.waitingFrame = null;
    if (next && this.state.kind === 'live' && next.streamId === this.streamId) this.toRenderer(next);
  }

  // ---- the phone and the link -------------------------------------------------------------------

  /** `camera.state` from the phone. Anything not about this session's current stream is ignored. */
  onState(payload: unknown): void {
    const p = (payload ?? {}) as Record<string, unknown>;
    const streamId = typeof p.streamId === 'string' ? p.streamId : null;
    const state = p.state;
    if (!streamId || this.deps.link.token() !== this.sessionToken) return;

    if (state === 'stopped') {
      // The phone's own reason replaces a reason this side guessed — a socket closing before the
      // phone's `stopped` arrived reads `stream-lost` until the phone says what really happened.
      const ownsCurrent = streamId === this.streamId;
      const refinesEnded = this.state.kind === 'ended' && this.state.streamId === streamId;
      if (!ownsCurrent && !refinesEnded) return;
      const reason = typeof p.reason === 'string' && WIRE_REASONS.has(p.reason) ? (p.reason as CameraEndReason) : 'stream-closed';
      this.end(reason, streamId, {
        framesSent: typeof p.framesSent === 'number' ? p.framesSent : null,
        framesDropped: typeof p.framesDropped === 'number' ? p.framesDropped : null,
      });
      return;
    }
    if (streamId !== this.streamId) return;

    if (state === 'starting' && this.state.kind === 'requesting') {
      this.clearExpiry();
      const facing = p.facing === 'front' ? 'front' : 'back';
      this.setState({ kind: 'connecting', streamId, facing });
      this.openStream(streamId);
      return;
    }
    if (state === 'running' && (this.state.kind === 'connecting' || this.state.kind === 'live')) {
      const facing = p.facing === 'front' ? 'front' : 'back';
      const width = typeof p.width === 'number' ? p.width : this.state.kind === 'live' ? this.state.width : 0;
      const height = typeof p.height === 'number' ? p.height : this.state.kind === 'live' ? this.state.height : 0;
      this.setState({
        kind: 'live',
        streamId,
        facing,
        width,
        height,
        frameRate: typeof p.frameRate === 'number' ? p.frameRate : null,
        stalled: this.state.kind === 'live' ? this.state.stalled : true,
        framesReceived: this.framesReceived,
        notice: null,
      });
      this.ensureStallWatch();
    }
  }

  /** The control session with [token] ended. Its stream ends with it; a replacement's is untouched. */
  onSessionEnded(token: string | null): void {
    if (!this.isActive() || token !== this.sessionToken) return;
    this.requestSeq += 1;
    this.end('disconnected', this.streamId);
  }

  // ---- the stream ------------------------------------------------------------------------------

  private openStream(streamId: string): void {
    const host = this.deps.link.address();
    const token = this.sessionToken;
    if (!host || !token) {
      this.end('disconnected', streamId);
      return;
    }
    const reader = new CameraFrameReader();
    let socket: CameraSocket;
    try {
      socket = this.deps.openSocket(host, cameraClaim(token, streamId));
    } catch (error) {
      log.warn('camera', `camera stream socket could not open: ${String(error)}`);
      void this.sendStop(streamId);
      this.end('stream-lost', streamId);
      return;
    }
    this.socket = socket;
    this.lastFrameAt = 0;
    socket.onData((chunk) => {
      if (this.socket !== socket) return;
      let frames: CameraFrame[];
      try {
        frames = reader.push(chunk);
      } catch (error) {
        const reason = error instanceof CameraFrameError ? error.reason : String(error);
        log.warn('camera', `camera stream closed on a malformed frame: ${reason}`);
        this.teardownStream();
        this.streamId = null;
        void this.sendStop(streamId);
        this.setState({
          kind: 'error',
          code: 'MALFORMED_FRAME',
          message: 'The phone sent a camera frame this Mac could not read, so the camera was stopped.',
        });
        return;
      }
      for (const frame of frames) this.onFrame(streamId, frame);
    });
    socket.onClose((reason) => {
      if (this.socket !== socket) return;
      log.info('camera', `camera stream socket closed: ${reason}`);
      this.end('stream-lost', streamId);
    });
  }

  private onFrame(streamId: string, frame: CameraFrame): void {
    if (streamId !== this.streamId) return;
    this.lastFrameAt = this.timers.now();
    this.framesReceived += 1;
    if (this.state.kind === 'connecting') {
      // Frames and `running` travel on two channels; the phone sends a frame only once it is running,
      // so the first frame is as good a signal as the event, and waiting for the event would hold a
      // real picture back for no reason.
      this.setState({
        kind: 'live',
        streamId,
        facing: frame.facing === 'front' ? 'front' : 'back',
        width: frame.width,
        height: frame.height,
        frameRate: null,
        stalled: false,
        framesReceived: this.framesReceived,
        notice: null,
      });
      this.ensureStallWatch();
    } else if (this.state.kind === 'live') {
      if (this.state.stalled || this.state.facing !== frame.facing) {
        this.setState({
          ...this.state,
          stalled: false,
          facing: frame.facing === 'front' ? 'front' : 'back',
          framesReceived: this.framesReceived,
        });
      }
    } else {
      return;
    }
    this.toRenderer({
      streamId,
      sequence: frame.sequence,
      facing: frame.facing,
      rotation: frame.rotation,
      mirrored: frame.mirrored,
      width: frame.width,
      height: frame.height,
      jpeg: new Uint8Array(frame.jpeg),
    });
  }

  private toRenderer(frame: CameraFrameMessage): void {
    if (this.frameWithRenderer) {
      this.waitingFrame = frame; // the newest replaces whatever was waiting
      return;
    }
    this.frameWithRenderer = true;
    this.deps.emitFrame(frame);
  }

  private ensureStallWatch(): void {
    if (this.stallTimer !== null) return;
    this.stallTimer = this.timers.setInterval(() => {
      if (this.state.kind !== 'live') return;
      const stalled = this.lastFrameAt === 0 || this.timers.now() - this.lastFrameAt > CAMERA_STALL_MS;
      if (stalled !== this.state.stalled) {
        this.setState({ ...this.state, stalled, framesReceived: this.framesReceived });
      }
    }, 500);
  }

  // ---- the single exit -------------------------------------------------------------------------

  /** Every ending: socket, timers and frames released first, then the pane told. */
  private end(
    reason: CameraEndReason,
    streamId: string | null,
    counts: { framesSent: number | null; framesDropped: number | null } = { framesSent: null, framesDropped: null },
  ): void {
    this.teardownStream();
    this.clearExpiry();
    this.streamId = null;
    const copy = endedCopy(reason);
    this.setState({
      kind: 'ended',
      streamId,
      reason,
      message: copy.message,
      fixHint: copy.fixHint,
      framesSent: counts.framesSent,
      framesDropped: counts.framesDropped,
      framesReceived: this.framesReceived,
    });
  }

  private teardownStream(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    if (this.stallTimer !== null) this.timers.clearInterval(this.stallTimer);
    this.stallTimer = null;
    this.waitingFrame = null;
    this.frameWithRenderer = false;
  }

  private clearExpiry(): void {
    if (this.expiryTimer !== null) this.timers.clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private async sendStop(streamId: string): Promise<void> {
    if (!this.deps.link.isConnected()) return;
    try {
      await this.deps.link.request(MessageType.CAMERA_STOP, { streamId }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      log.warn('camera', `camera.stop for ${streamId.slice(0, 8)}… failed: ${String(error)}`);
    }
  }

  private isActive(): boolean {
    return this.state.kind === 'requesting' || this.state.kind === 'connecting' || this.state.kind === 'live';
  }

  private setState(next: CameraPaneState): void {
    this.state = next;
    this.deps.emitState(next);
  }
}

/**
 * The real stream socket: TLS 1.3 to the video port, **pinned to the control session's phone**, then
 * the camera claim as the one framed write. The pin is stricter than the mirror's video socket, which
 * relies on the token alone — a camera picture is worth the one extra comparison.
 */
export function openCameraSocket(identity: Identity, host: string, claim: string, expectedFingerprint: string | null): CameraSocket {
  const dataListeners: Array<(chunk: Buffer) => void> = [];
  const closeListeners: Array<(reason: string) => void> = [];
  let closed = false;
  const close = (reason: string) => {
    if (closed) return;
    closed = true;
    socket.destroy();
    for (const listener of closeListeners) listener(reason);
  };
  const socket: TLSSocket = tlsConnect({
    host,
    port: PORT_VIDEO,
    cert: identity.certPem,
    key: identity.keyPem,
    minVersion: 'TLSv1.3',
    // Pinning is ours, as on every socket in this app; the comparison is below.
    rejectUnauthorized: false,
    timeout: 10_000,
  });
  socket.setTimeout(10_000, () => close('the phone did not answer on the video port'));
  socket.once('error', (error) => close(error.message));
  socket.once('secureConnect', () => {
    socket.setTimeout(0);
    socket.setNoDelay(true);
    const der = socket.getPeerX509Certificate?.()?.raw ?? Buffer.alloc(0);
    if (!expectedFingerprint || der.length === 0 || normalizeFingerprint(fingerprintOfDer(der)) !== normalizeFingerprint(expectedFingerprint)) {
      log.warn('camera', 'camera stream refused: the video port presented a different certificate from the control session');
      close('certificate mismatch');
      return;
    }
    writeFrame(socket, Buffer.from(claim, 'utf8'));
  });
  socket.on('data', (chunk: Buffer) => {
    if (!closed) for (const listener of dataListeners) listener(chunk);
  });
  socket.on('close', () => close('the phone closed the camera stream'));
  return {
    onData: (listener) => dataListeners.push(listener),
    onClose: (listener) => closeListeners.push(listener),
    destroy: () => {
      closed = true;
      socket.destroy();
    },
  };
}
