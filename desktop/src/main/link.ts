import { EventEmitter } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import {
  MAX_CONTROL_FRAME,
  MISSED_PONGS_BEFORE_DEAD,
  PING_INTERVAL_MS,
  PROTOCOL_MAJOR,
  MessageType,
  normalizeFingerprint,
  type ConnectionStatus,
  type Envelope,
  type ErrorPayload,
  type HelloAckPayload,
  type PairingQrPayload,
  type PhoneRequestError,
  type UnavailableCapability,
  type PairRejected,
} from '../shared/protocol';
import { classifyLinkError, pairingHealth, type LinkFailure } from '../shared/linkHealth';
import { clearedSession, type SessionScoped } from '../shared/session';
import { CANDIDATE_TIMEOUT_MS, discoverCandidates, type Candidate } from './discovery';
import { fingerprintOfDer, type Identity } from './identity';
import { log } from './logger';
import { FrameReader, writeFrame } from './framing';
import { store } from './store';

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** A QR code is only worth scanning for this long; matches Link.PAIR_TOKEN_TTL_MS on the phone. */
const PAIR_TOKEN_TTL_MS = 5 * 60 * 1000;

interface Pending {
  resolve: (envelope: Envelope) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * The Mac's half of the link: find the phone, connect, stay connected.
 *
 * The phone is the server, so all the reconnect logic lives here. Everything is driven off one
 * state machine rather than per-socket callbacks, because the failure that matters — "we think we
 * are connected and we are not" — is exactly what ad-hoc socket handling gets wrong.
 */
export class LinkClient extends EventEmitter {
  private socket: TLSSocket | null = null;
  private reader: FrameReader | null = null;
  private pending = new Map<string, Pending>();

  private phase: ConnectionStatus['phase'] = 'idle';
  private via: ConnectionStatus['via'] | undefined;
  private address: string | undefined;
  private deviceName: string | undefined;
  /**
   * Everything that is only true while a session is up. Cleared as a unit in `teardown()` — see
   * SessionScoped for why it is one object and not three fields.
   */
  private session: SessionScoped = clearedSession();
  private rttMs: number | undefined;
  /**
   * The last failure, classified — **one field, and the only one.**
   *
   * `LinkFailure` already carries `raw` beside `message` and `kind`, so this holds everything the
   * three status fields are built from: the sentence for a person, the original text for the log
   * and the debug HUD, and the kind for surfaces with no room for a sentence.
   *
   * ### Why it is one field now, which is the fix rather than a tidy-up
   *
   * It used to be two — `lastError` for the raw text and this for the classified form — and
   * `status()` returned `lastFailure?.message ?? lastError`. A successful handshake cleared the
   * raw one and **not this one**, so it cleared nothing any user-facing surface reads: `lastFailure`
   * was assigned in four places and cleared in none, and after a single failure every subsequent
   * status carried that sentence forever, `phase: 'connected'` included. The status island narrated
   * it beside a live latency, which is what sent me looking; `pairingHealth` reads it too, so one
   * certificate refusal also left `pairing` at `repudiated` **through a successful re-pair**, and
   * the shell's `mustPair` then pinned the user to the pairing screen while connected.
   *
   * Adding the missing `this.lastFailure = null` would have fixed the instance. Two fields that
   * must be cleared together, in a class with six assignment sites, is the *defect*, and the second
   * time somebody forgets one there is no symptom to notice — so there is one field, and [failed]
   * and [succeeded] are the only two things that write it.
   *
   * Three of those six sites set only the raw field, so they produced a status whose `lastError`
   * was an unclassified fragment (`no pong in 15s`) with no `kind` beside it. They go through
   * [failed] now and are classified like everything else.
   */
  private lastFailure: LinkFailure | null = null;

  /** Record a failure. The one way this state is entered — see [lastFailure]. */
  private failed(raw: string): void {
    this.lastFailure = classifyLinkError(raw, { rePairPending: this.rePairPending() });
  }

  /**
   * Retire the failure. The one way this state is left.
   *
   * Called from exactly one place — a completed handshake — because that is the only event that
   * *proves* the failure is over. Clearing on a retry would be the same bug pointed the other way:
   * an optimistic clear over a link that is still broken.
   */
  private succeeded(): void {
    this.lastFailure = null;
  }

  /**
   * How far the phone's monotonic clock is behind this Mac's `Date.now()`, in milliseconds.
   *
   * Video frames are stamped with a PTS from the phone's clock. Without this offset that PTS is
   * unusable for latency — it is a reading of a different machine's clock with an arbitrary
   * origin. Estimated from each pong the usual NTP way, assuming the two legs of the round trip
   * are symmetric; on a LAN they are close enough that the error is under a millisecond or two.
   */
  private clockOffsetMs: number | undefined;

  private pingTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private missedPongs = 0;
  private backoffMs = BACKOFF_START_MS;
  private running = false;
  private connecting = false;

  /** Non-null while a pairing QR is on screen; consumed by the next successful handshake. */
  private armedPairing: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly identity: Identity,
    /**
     * Read at the moment of each failure, not once: the rename re-pair clears while the app runs,
     * and a refusal after that must get the ordinary sentence.
     */
    private readonly rePairPending: () => boolean = () => false,
  ) {
    super();
  }

  // ---- public API ---------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.backoffMs = BACKOFF_START_MS;
    void this.attempt();
  }

  stop(reason = 'stopped by user'): void {
    this.running = false;
    this.clearTimers();
    this.teardown(reason);
    this.setPhase('idle');
  }

  /** Called on wake from sleep and on network changes: retry now instead of waiting out backoff. */
  retryNow(reason: string): void {
    if (!this.running || this.isConnected()) return;
    log.info('link', `Immediate retry: ${reason}`);
    this.clearTimers();
    this.backoffMs = BACKOFF_START_MS;
    void this.attempt();
  }

  isConnected(): boolean {
    return this.phase === 'connected';
  }

  /** Add to a phone monotonic reading (ms) to get this Mac's `Date.now()`. */
  clockOffset(): number | undefined {
    return this.clockOffsetMs;
  }

  status(): ConnectionStatus {
    return {
      phase: this.phase,
      via: this.via,
      address: this.address,
      deviceName: this.deviceName,
      capabilities: this.session.capabilities,
      unavailable: this.session.unavailable,
      rttMs: this.rttMs,
      // The classified sentence, never the raw text. `lastErrorRaw` carries the original for the
      // debug HUD and the log, which are the only places it belongs.
      lastError: this.lastFailure?.message,
      lastErrorRaw: this.lastFailure?.raw,
      // The kind, for surfaces with no room for the sentence. The status island reads this and
      // never the message — see `ConnectionStatus.lastFailureKind` for why prose cannot go there.
      lastFailureKind: this.lastFailure?.kind,
      pairing: pairingHealth(store.get('paired') !== null, this.lastFailure, Date.now()),
      paired: store.get('paired') !== null,
      /*
       * P5. When the token behind the QR currently on screen stops being accepted.
       *
       * `armedPairing` has held this since pairing was written and the renderer was simply never
       * told — `docs/design-departures.md` P5, *"Mac-side only… Expose it on the status payload. No
       * wire change"*.
       *
       * It is the **absolute** instant, not a remaining duration, and that is load-bearing: a
       * duration computed here is a fact about the moment `status()` ran, and the renderer ticks
       * once a second against it. Sending `remainingMs` would leave the screen counting down from a
       * number that stopped being true the moment it crossed the IPC boundary — and the case this
       * whole feature exists for is a Mac that slept, where exactly that gap is hours wide.
       */
      pairingExpiresAt: this.armedPairing?.expiresAt,
    };
  }

  /**
   * Builds the payload for the pairing QR and arms the one-time token.
   *
   * The token is what stops a QR photographed off someone's screen being replayed from a third
   * machine: the phone will only accept it once, from the fingerprint that was in the code.
   *
   * Re-arming keeps the *same* token unless [rotate] is set, and only pushes the expiry out. A
   * user who takes six minutes to pick up their phone would otherwise scan a code whose token
   * this side had already thrown away, and the handshake would die with nothing on screen to
   * explain it. Rotating is the explicit "show a fresh code" action, which invalidates any code
   * already photographed.
   */
  armPairing(localAddress: string, rotate = false): PairingQrPayload {
    const existing = this.armedPairing;
    const token = !rotate && existing ? existing.token : randomBytes(16).toString('hex');
    this.armedPairing = { token, expiresAt: Date.now() + PAIR_TOKEN_TTL_MS };
    return {
      host: localAddress,
      fp: this.identity.fingerprint,
      token,
      name: this.identity.deviceName,
    };
  }

  isPairingArmed(): boolean {
    const armed = this.armedPairing;
    return armed !== null && Date.now() < armed.expiresAt;
  }

  send(type: string, payload: Record<string, unknown> = {}): void {
    this.write({ v: PROTOCOL_MAJOR, id: randomUUID(), type, ts: Date.now(), payload });
  }

  /** Sends a request and resolves on the matching ack, or rejects on error/timeout. */
  request(
    type: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ): Promise<Envelope> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected()) {
        reject(new Error('Not connected to the phone'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ v: PROTOCOL_MAJOR, id, type, ts: Date.now(), payload });
    });
  }

  /** The session token the video and bulk sockets must present as their first frame. */
  token(): string | null {
    return this.session.sessionToken;
  }

  // ---- connection ---------------------------------------------------------------------

  private async attempt(): Promise<void> {
    if (!this.running || this.connecting || this.isConnected()) return;
    this.connecting = true;
    this.setPhase(this.lastFailure ? 'reconnecting' : 'searching');

    try {
      for await (const candidate of discoverCandidates()) {
        if (!this.running) return;
        log.info('link', `Trying ${candidate.host}:${candidate.port} (${candidate.via})`);
        const connected = await this.tryCandidate(candidate);
        if (connected) {
          this.connecting = false;
          return;
        }
      }
      this.failed('No phone answered on any known address');
    } catch (error) {
      this.failed(String(error));
      log.error('link', 'Discovery failed', error);
    } finally {
      this.connecting = false;
    }

    if (this.running && !this.isConnected()) this.scheduleRetry();
  }

  private tryCandidate(candidate: Candidate): Promise<boolean> {
    return new Promise((resolve) => {
      this.setPhase('connecting');
      const paired = store.get('paired');
      let settled = false;
      const finish = (ok: boolean, reason?: string) => {
        if (settled) return;
        settled = true;
        if (!ok) {
          // Every failed candidate says why. Without this a refused handshake looks identical to
          // a phone that is simply not there, which is exactly the case that wastes an evening.
          if (reason) {
            this.failed(reason);
          }
          log.warn('link', `${candidate.host} failed: ${reason ?? 'unknown reason'}`);
          socket.destroy();
        }
        resolve(ok);
      };

      const socket = tlsConnect({
        host: candidate.host,
        port: candidate.port,
        cert: this.identity.certPem,
        key: this.identity.keyPem,
        minVersion: 'TLSv1.3',
        // There is no CA in this system. Verification is our own fingerprint pinning below —
        // handing this to the public CA set would reject every legitimate peer we have.
        rejectUnauthorized: false,
        timeout: CANDIDATE_TIMEOUT_MS,
      });

      socket.setTimeout(CANDIDATE_TIMEOUT_MS, () => finish(false, `${candidate.host} timed out`));

      socket.once('error', (error) => finish(false, `${candidate.host}: ${error.message}`));

      socket.once('secureConnect', () => {
        socket.setTimeout(0);
        const peer = socket.getPeerX509Certificate?.();
        const der = peer?.raw ?? Buffer.alloc(0);
        if (der.length === 0) {
          finish(false, 'Phone presented no certificate');
          return;
        }
        const fingerprint = fingerprintOfDer(der);

        if (paired) {
          if (normalizeFingerprint(paired.fingerprint) !== normalizeFingerprint(fingerprint)) {
            // Either a different phone answered on this address, or something is intercepting.
            // Neither is a case to retry through: say so and stop.
            finish(
              false,
              `${candidate.host} is not the paired phone (certificate mismatch) — forget the device and re-pair if you reinstalled the app`,
            );
            return;
          }
        } else if (!this.isPairingArmed()) {
          finish(false, 'Not paired yet — show the pairing QR code and scan it with the phone');
          return;
        }

        this.adopt(socket, candidate, fingerprint, () => finish(true), (reason) => finish(false, reason));
      });
    });
  }

  /** Wires up an authenticated socket and runs the hello handshake. */
  private adopt(
    socket: TLSSocket,
    candidate: Candidate,
    peerFingerprint: string,
    onReady: () => void,
    onFail: (reason: string) => void,
  ): void {
    this.socket = socket;
    this.address = candidate.host;
    this.via = candidate.via;
    this.setPhase('handshaking');

    const reader = new FrameReader(
      (frame) => this.onFrame(frame, peerFingerprint, onReady),
      (message) => {
        log.error('link', `Protocol error: ${message}`);
        this.teardown(`protocol error: ${message}`);
      },
      MAX_CONTROL_FRAME,
    );
    this.reader = reader;

    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => reader.push(chunk));
    socket.on('close', () => {
      if (this.socket === socket) {
        this.teardown(this.lastFailure?.raw ?? 'phone closed the connection');
        if (this.running) this.scheduleRetry();
      }
    });
    socket.on('error', (error) => {
      this.failed(error.message);
      log.warn('link', `Socket error: ${error.message}`);
    });

    const hello: Record<string, unknown> = {
      protocolVersion: PROTOCOL_MAJOR,
      appVersion: process.env.npm_package_version ?? '2.0.0',
      deviceName: this.identity.deviceName,
      fingerprint: this.identity.fingerprint,
    };
    if (this.isPairingArmed()) hello.pairToken = this.armedPairing?.token;

    const helloId = randomUUID();
    const timer = setTimeout(() => {
      this.pending.delete(helloId);
      onFail('Handshake timed out');
    }, 10_000);
    this.pending.set(helloId, {
      resolve: () => clearTimeout(timer),
      reject: (error) => {
        clearTimeout(timer);
        onFail(error.message);
      },
      timer,
    });
    this.write({ v: PROTOCOL_MAJOR, id: helloId, type: MessageType.HELLO, ts: Date.now(), payload: hello });
  }

  private onFrame(frame: Buffer, peerFingerprint: string, onReady: () => void): void {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(frame.toString('utf8')) as Envelope;
    } catch (error) {
      log.error('link', `Undecodable frame: ${String(error)}`);
      this.teardown('undecodable frame');
      return;
    }

    switch (envelope.type) {
      case MessageType.PAIR_REJECTED: {
        /*
         * F7. The phone refused the pair token and is about to close.
         *
         * Reachable only once TLS succeeded, which means the certificate was already pinned — a Mac
         * that is not paired at all fails in the handshake with no channel to be told anything on,
         * and the phone shows that case on its own screen. The two are different failures and this
         * one must not be made to stand for both.
         *
         * **Not a reason to stop retrying**, per docs/protocol.md: the user's next action is to scan
         * the fresh code, and the discovery loop has to be running when they do. So this emits and
         * falls through to the ordinary close — it does not touch the backoff.
         */
        const rejection = envelope.payload as unknown as PairRejected;
        log.warn(
          'pairing',
          `The phone refused this pairing: ${rejection.reason} — ${rejection.message ?? 'no sentence sent'}`,
        );
        this.emit('pair-rejected', rejection);
        return;
      }
      case MessageType.HELLO_ACK:
        this.onHelloAck(envelope as unknown as Envelope<HelloAckPayload>, peerFingerprint, onReady);
        return;
      case MessageType.PONG: {
        this.missedPongs = 0;
        const pending = this.pending.get(envelope.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(envelope.id);
          pending.resolve(envelope);
        }
        return;
      }
      case MessageType.CAPABILITIES_CHANGED:
        {
          const payload = envelope.payload as {
            capabilities?: string[];
            unavailable?: UnavailableCapability[];
          };
          this.session.capabilities = payload.capabilities ?? [];
          this.session.unavailable = payload.unavailable ?? [];
        }
        // Both halves, on one line. A list of what is on says nothing about the size of what is
        // off, and the reasons are the whole point of sending them — see the log rule in
        // CLAUDE.md.
        log.info(
          'link',
          `Capabilities changed: ${this.session.capabilities.join(', ') || 'none'} ` +
            `(${this.session.unavailable.length} unavailable` +
            `${this.session.unavailable.length > 0 ? ': ' + this.session.unavailable.map((u) => `${u.name} — ${u.reason}`).join('; ') : ''})`,
        );
        this.emitStatus();
        return;
      case MessageType.ACK:
      case MessageType.ERROR: {
        const pending = this.pending.get(envelope.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(envelope.id);
          if (envelope.type === MessageType.ERROR) {
            const payload = envelope.payload as unknown as ErrorPayload;
            // The message keeps its `CODE: sentence` shape because that is what the logs read.
            // The phone's own words are attached separately, for whatever is going to put them
            // in front of a person — see PhoneRequestError.
            const failure: PhoneRequestError = new Error(`${payload.code}: ${payload.message}`);
            failure.code = payload.code;
            failure.phoneMessage = payload.message;
            failure.fixHint = payload.fixHint;
            pending.reject(failure);
          } else {
            pending.resolve(envelope);
          }
          return;
        }
        // An error with no request waiting on it is still worth surfacing — it is how the phone
        // reports SECURE_SURFACE and permission revocations mid-session.
        if (envelope.type === MessageType.ERROR) this.emit('phone-error', envelope.payload);
        return;
      }
      default:
        this.emit('message', envelope);
    }
  }

  private onHelloAck(
    envelope: Envelope<HelloAckPayload>,
    peerFingerprint: string,
    onReady: () => void,
  ): void {
    const pending = this.pending.get(envelope.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(envelope.id);
    }

    const payload = envelope.payload;
    if (payload.protocolVersion !== PROTOCOL_MAJOR) {
      const message = `Phone speaks protocol v${payload.protocolVersion}, this Mac speaks v${PROTOCOL_MAJOR}. Update the older app.`;
      this.failed(message);
      log.error('link', message);
      this.teardown(message);
      return;
    }

    this.session.sessionToken = payload.sessionToken;
    this.deviceName = payload.deviceName;
    this.session.capabilities = payload.capabilities ?? [];
    this.session.unavailable = payload.unavailable ?? [];
    this.missedPongs = 0;
    this.backoffMs = BACKOFF_START_MS;
    // The handshake completed, so whatever failed before it is over. See [lastFailure] for what
    // this line's absence cost — it is the reason there is one field here instead of two.
    this.succeeded();

    // First successful handshake after a scan is what completes pairing on this side: the phone
    // already proved it trusts us by accepting the TLS connection at all.
    if (!store.get('paired')) {
      store.set('paired', {
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
        fingerprint: peerFingerprint,
        pairedAt: Date.now(),
      });
      log.info('link', `Paired with ${payload.deviceName} (${peerFingerprint.slice(0, 23)}…)`);
    }
    this.armedPairing = null;

    if (this.address) store.set('lastAddress', this.address);
    if (this.via) store.set('lastDiscoveryVia', this.via);

    this.setPhase('connected');
    this.startHeartbeat();
    onReady();
    log.info('link', `Connected to ${payload.deviceName} at ${this.address} via ${this.via}`);
    // What the phone actually promised. Without this the only way to answer "why is that pane
    // still grey" is to read the phone's log over adb, which is exactly the question the
    // capability contract makes worth asking.
    log.info(
      'link',
      `Phone advertises: ${this.session.capabilities.length > 0 ? this.session.capabilities.join(', ') : 'nothing'}`,
    );
  }

  // ---- heartbeat and retries ----------------------------------------------------------

  private startHeartbeat(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      if (!this.isConnected()) return;
      if (this.missedPongs >= MISSED_PONGS_BEFORE_DEAD) {
        const reason = `no pong in ${(PING_INTERVAL_MS * MISSED_PONGS_BEFORE_DEAD) / 1000}s`;
        log.warn('link', `Heartbeat lost: ${reason}`);
        this.failed(reason);
        this.teardown(reason);
        if (this.running) this.scheduleRetry();
        return;
      }
      this.missedPongs += 1;
      const sentAt = Date.now();
      this.request(MessageType.PING, {}, PING_INTERVAL_MS * MISSED_PONGS_BEFORE_DEAD)
        .then((pong) => {
          const receivedAt = Date.now();
          this.rttMs = receivedAt - sentAt;
          this.updateClockOffset(pong, receivedAt, this.rttMs);
          this.emitStatus();
        })
        .catch(() => {
          /* counted by missedPongs above */
        });
    }, PING_INTERVAL_MS);
  }

  /**
   * One NTP-style offset sample per pong, smoothed.
   *
   * The phone stamped `monoUs` somewhere inside the round trip; the best estimate of when is half
   * an RTT before the pong landed. Smoothing matters because a single sample inherits whatever
   * scheduling delay that one packet met, and a jittery offset would show up as latency that
   * swings by tens of milliseconds while nothing about the link has changed. A fast-moving
   * average over the 5-second heartbeat settles within about three samples.
   */
  private updateClockOffset(pong: Envelope, receivedAt: number, rttMs: number): void {
    const monoUs = (pong.payload as { monoUs?: number } | undefined)?.monoUs;
    if (typeof monoUs !== 'number' || monoUs <= 0) return;
    const sample = receivedAt - rttMs / 2 - monoUs / 1000;
    this.clockOffsetMs =
      this.clockOffsetMs === undefined ? sample : this.clockOffsetMs * 0.7 + sample * 0.3;
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.setPhase('reconnecting', delay);
    log.info('link', `Retrying in ${delay}ms`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attempt();
    }, delay);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private teardown(reason: string): void {
    this.clearPing();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    // One assignment, so a session-scoped fact added later cannot be left behind the way the
    // capability list was (defect 25) — the claim must not outlive the connection that made it.
    this.session = clearedSession();
    this.reader?.reset();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners('close');
      socket.destroy();
    }
    if (this.phase === 'connected' || this.phase === 'handshaking') {
      log.info('link', `Disconnected: ${reason}`);
      this.failed(reason);
      this.setPhase(this.running ? 'reconnecting' : 'idle');
    }
  }

  private write(envelope: Envelope): void {
    const socket = this.socket;
    if (!socket || socket.destroyed) return;
    // The cap is named rather than defaulted: this channel reads at MAX_CONTROL_FRAME, and a
    // write side silently defaulting to MAX_FRAME would refuse frames the phone would happily
    // have accepted. A write cap that disagrees with its own read cap is the bug the write side
    // is there to catch.
    writeFrame(socket, Buffer.from(JSON.stringify(envelope), 'utf8'), MAX_CONTROL_FRAME);
  }

  private setPhase(phase: ConnectionStatus['phase'], nextRetryInMs?: number): void {
    this.phase = phase;
    this.emitStatus(nextRetryInMs);
  }

  private emitStatus(nextRetryInMs?: number): void {
    this.emit('status', { ...this.status(), nextRetryInMs });
  }
}
