/**
 * Which address a phone would connect back to, and whether there is one at all (`34:12152`).
 *
 * ### The defect this exists for
 *
 * `localAddress()` walked the interfaces and, finding nothing, returned the string `0.0.0.0`. That
 * value went straight into the pairing payload, was encoded into a real QR code, and was drawn
 * under *"Scan this with your phone"* beside a line reading `Chetan's Mac at 0.0.0.0 — valid while
 * this code is on screen.` Every layer was telling the truth about a different thing: the QR
 * genuinely encoded the payload, the payload genuinely carried the address `localAddress()`
 * returned, and the address was the one the platform has for *no address at all*.
 *
 * `0.0.0.0` is the unspecified address. Nothing can connect to it. So the screen was instructing a
 * person to photograph a code that could not work, with no way for them to learn that from the
 * screen — the silent-no-op shape this project rules out everywhere.
 *
 * The handoff already had the answer drawn: *"No network replaces the code with an explanation,
 * because a code carries an address and there is none to put in one."*
 *
 * ### Why the sentinel is here rather than compared for in the renderer
 *
 * A renderer that tested `host === '0.0.0.0'` would be **inferring** the fact from a string, and
 * the string and the test would be two homes for one rule, in two files, free to drift. The
 * process that enumerated the interfaces is the one that knows; it says so in a field. Same
 * discipline as *measure from the end that can tell the difference* — the renderer cannot tell a
 * Mac with no network from a Mac whose address happens to be written that way, and does not have
 * to.
 *
 * ### What is deliberately NOT claimed
 *
 * A link-local `169.254.x.x` address (an interface that is up with no DHCP lease) is reported
 * **reachable**, because it can be: a phone on the same link self-assigns from the same range and
 * the two can reach each other. Calling it unreachable would be a guess dressed as a reading, and
 * the failure would be the worse direction — refusing to draw a code that would have worked.
 */

/** The address the platform uses for *no address*. Nothing can connect to it. */
export const NO_LOCAL_ADDRESS = '0.0.0.0';

export interface LocalPairAddress {
  /** What goes in the payload. `NO_LOCAL_ADDRESS` when there is nothing to put there. */
  address: string;
  /** Whether a code built on this address could be scanned and acted on. */
  reachable: boolean;
}

/** The shape `os.networkInterfaces()` returns, narrowed to what this rule reads. */
export interface InterfaceAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

/**
 * The first non-internal IPv4 address, in the order the platform lists them.
 *
 * `family` is compared against both `'IPv4'` and `4` because Node changed it from a string to a
 * number and back across versions, and a comparison that is right on one runtime and silently
 * empty on another is exactly this defect again one layer down.
 */
export function localPairAddress(
  interfaces: Record<string, InterfaceAddress[] | undefined>,
): LocalPairAddress {
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      const isV4 = address.family === 'IPv4' || address.family === 4;
      if (isV4 && !address.internal) return { address: address.address, reachable: true };
    }
  }
  return { address: NO_LOCAL_ADDRESS, reachable: false };
}
