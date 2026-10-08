import type { PairingQrPayload } from '../shared/protocol';

/** The three calls the pairing screen makes on the link — nothing that could end a session. */
export interface ArmableLink {
  armPairing(localAddress: string, rotate?: boolean): PairingQrPayload;
  codeWouldBeAsked(): boolean;
  start(): void;
  retryNow(reason: string): void;
}

/**
 * What opening the pairing screen does to the link, in one home so the `pairing-qr` handler and
 * `pairingArm.test.ts` run the same sequence.
 *
 * Arming a code is the user saying "pair now", and the Mac is the only side that dials out:
 * `forget-device` leaves the client stopped, so without `start()` the phone scans a code nothing is
 * dialling for. **None of the three may disturb a phone that is already connected**, and each is
 * safe for its own reason: `start()` returns when the client is running, `retryNow()` returns when
 * connected, and `armPairing(…, false)` keeps the token and only pushes the expiry out. There is
 * deliberately no `stop()` here — the screen can be opened with ⌘K mid-session.
 */
export function armPairingCode(link: ArmableLink, localAddress: string, rotate: boolean): PairingQrPayload | null {
  const payload = armIfAsked(link, localAddress, rotate);
  link.start();
  link.retryNow('pairing QR armed');
  return payload;
}

/**
 * A code, only when this Mac would really ask the phone for it — otherwise null (defect 207).
 *
 * While a phone is stored the hello carries no `pair`, so a code on screen would be answered
 * `TOKEN_MISSING` whichever phone scans it, and calling it armed is a sentence about a handshake that
 * cannot happen. Both places that draw a code — the pairing screen and the fresh code after a refusal —
 * come through here, so neither can draw one the other would not.
 */
export function armIfAsked(link: Pick<ArmableLink, 'armPairing' | 'codeWouldBeAsked'>, localAddress: string, rotate: boolean): PairingQrPayload | null {
  if (!link.codeWouldBeAsked()) return null;
  return link.armPairing(localAddress, rotate);
}
