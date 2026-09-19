import type { PairingQrPayload } from '../shared/protocol';

/** The three calls the pairing screen makes on the link — nothing that could end a session. */
export interface ArmableLink {
  armPairing(localAddress: string, rotate?: boolean): PairingQrPayload;
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
export function armPairingCode(link: ArmableLink, localAddress: string, rotate: boolean): PairingQrPayload {
  const payload = link.armPairing(localAddress, rotate);
  link.start();
  link.retryNow('pairing QR armed');
  return payload;
}
