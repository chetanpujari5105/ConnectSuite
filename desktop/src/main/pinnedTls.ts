import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { fingerprintOfDer, type Identity } from './identity';
import { normalizeFingerprint } from '../shared/protocol';

/**
 * TLS to one of the phone's side-channel ports (video 42502, bulk 42503), **pinned to the phone that
 * holds the control session** — security audit S2 (`docs/release-audit-2026-10-06.md`).
 *
 * Until this file the control socket (`link.ts`) and the camera socket (`camera.ts`) compared the
 * phone's certificate with the paired fingerprint, and the mirror's video socket and every bulk socket
 * did not: they wrote the session token, then a header, then file bytes, to whatever answered on the
 * address. The phone's own side was never exposed (it demands a trusted client certificate on every
 * port); the Mac's was.
 *
 * ### The rule
 *
 * Nothing is written until the socket emits [PINNED_EVENT], and it emits it only after `secureConnect`
 * **and** a certificate whose SHA-256 equals the session's peer. Callers wait on that event, never on
 * `secureConnect` — `secureConnect` means "a TLS handshake finished with somebody".
 *
 * ### It fails closed, in four ways
 *
 * - **No session peer when asked to connect** → the socket is destroyed before anything can be
 *   written, with [NO_SESSION_PEER].
 * - **No certificate** → destroyed. (TLS 1.3 cannot complete without a server certificate, so this is
 *   reachable only through a broken stack; it is checked anyway because "absent" must never be read as
 *   "nothing to compare".)
 * - **A different certificate** → destroyed.
 * - **The session changed during the handshake** — the peer read at connect time is not the peer
 *   now (a disconnect, a forget, a re-pair) → destroyed. The token the caller holds belongs to the
 *   session that was live when it was handed out, and is written only while that session still is.
 */

/** The event after which a pinned side-channel socket may be written. */
export const PINNED_EVENT = 'pinned';

export const NO_SESSION_PEER = 'there is no paired phone session to check this connection against — nothing was sent';

export type PinVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether a side-channel peer is the session's phone. Pure, so a test reaches every branch without a
 * socket. `expectedAtConnect` is the peer read when the connection was started, `expectedNow` the
 * peer read when the handshake finished; both must be present and equal to the certificate's.
 */
export function pinVerdict(
  der: Buffer | null | undefined,
  expectedAtConnect: string | null,
  expectedNow: string | null,
): PinVerdict {
  if (!expectedAtConnect) return { ok: false, reason: NO_SESSION_PEER };
  if (!expectedNow || normalizeFingerprint(expectedNow) !== normalizeFingerprint(expectedAtConnect)) {
    return { ok: false, reason: 'the phone session ended or changed before this connection was verified — nothing was sent' };
  }
  if (!der || der.length === 0) {
    return { ok: false, reason: 'the phone presented no certificate on this connection — nothing was sent' };
  }
  if (normalizeFingerprint(fingerprintOfDer(der)) !== normalizeFingerprint(expectedAtConnect)) {
    return { ok: false, reason: 'this connection presented a different certificate from the paired phone — nothing was sent' };
  }
  return { ok: true };
}

export interface PinnedConnectOptions {
  host: string;
  port: number;
  identity: Identity;
  /** The control session's peer fingerprint, or null with no session. Read at connect and at handshake. */
  expectedPeer: () => string | null;
  timeoutMs: number;
}

/**
 * Opens a TLS 1.3 connection that becomes writable only on [PINNED_EVENT]. On any failed check the
 * socket is destroyed with an `Error` carrying the reason, which reaches the caller's `error` listener
 * on a later tick — so a caller that attaches its listeners immediately after this returns sees it.
 */
export function pinnedTlsConnect(options: PinnedConnectOptions): TLSSocket {
  const expectedAtConnect = options.expectedPeer();
  const socket = tlsConnect({
    host: options.host,
    port: options.port,
    cert: options.identity.certPem,
    key: options.identity.keyPem,
    minVersion: 'TLSv1.3',
    // There is no CA in this system: the check is the fingerprint comparison below, and nothing is
    // written to this socket before it passes.
    rejectUnauthorized: false,
    timeout: options.timeoutMs,
  });
  if (!expectedAtConnect) {
    socket.destroy(new Error(NO_SESSION_PEER));
    return socket;
  }
  // Registered here, before the caller can register anything, so it runs first on `secureConnect`.
  socket.once('secureConnect', () => {
    const verdict = pinVerdict(socket.getPeerX509Certificate?.()?.raw, expectedAtConnect, options.expectedPeer());
    if (!verdict.ok) {
      socket.destroy(new Error(verdict.reason));
      return;
    }
    socket.emit(PINNED_EVENT);
  });
  return socket;
}
