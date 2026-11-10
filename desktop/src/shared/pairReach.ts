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
 * How likely an interface is to be the one a phone on the same network can see, by its macOS name.
 * Lower is better.
 *
 * - **0 — `en*`**: Wi-Fi, Ethernet, USB and Thunderbolt adapters, an iPhone's USB tether.
 * - **1 — anything unrecognised**: kept in the middle so a name this list has never met is neither
 *   preferred over the LAN nor buried under a tunnel.
 * - **2 — tunnels and bridges**: `utun`/`tun`/`tap`/`ipsec`/`ppp` are VPNs (Tailscale, WireGuard),
 *   `bridge` is Internet Sharing or a VM's NAT, `vmnet`/`vnic`/`vboxnet` are hypervisors, and
 *   `awdl`/`llw`/`ap`/`anpi`/`gif`/`stf` are AirDrop and system plumbing. A phone on the Wi-Fi cannot
 *   reach any of them, so an address from one is offered only when it is all there is.
 */
function interfaceTier(name: string): number {
  if (/^en\d+$/.test(name)) return 0;
  if (/^(utun|tun|tap|ipsec|ppp|bridge|vmnet|vnic|vboxnet|awdl|llw|ap|anpi|gif|stf)\d*$/.test(name)) return 2;
  return 1;
}

/**
 * Within one tier: a private LAN address, then link-local, then anything else. "Anything else" on a
 * Mac is in practice `100.64.0.0/10` — carrier-grade NAT space, which is what Tailscale hands out.
 */
function addressTier(address: string): number {
  const [a = 0, b = 0] = address.split('.').map(Number);
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 0;
  if (a === 169 && b === 254) return 1;
  return 2;
}

/**
 * The non-internal IPv4 address a phone on the same network is most likely to see.
 *
 * It used to be the **first** one in platform order, which is whatever interface the kernel listed
 * first: on a Mac running a VPN, Internet Sharing or a VM that can be a tunnel or a bridge, and the
 * code then named an address no phone on the Wi-Fi could reach (2026-11-10). The order is now by
 * [interfaceTier] and then [addressTier], and platform order only breaks a tie — so a Mac with one
 * interface answers exactly as before.
 *
 * **Not decided here:** which of two `en*` interfaces carries the default route (Wi-Fi and Ethernet
 * both up, on different networks). That needs the routing table, which this pure rule does not read;
 * platform order stands, as it did.
 *
 * Nothing is refused that was offered before: a Mac whose only address is a tunnel's still gets a
 * code, because calling it unreachable would be a guess.
 *
 * `family` is compared against both `'IPv4'` and `4` because Node changed it from a string to a
 * number and back across versions, and a comparison that is right on one runtime and silently
 * empty on another is exactly this defect again one layer down.
 */
export function localPairAddress(
  interfaces: Record<string, InterfaceAddress[] | undefined>,
): LocalPairAddress {
  let best: { address: string; rank: number } | null = null;
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      const isV4 = address.family === 'IPv4' || address.family === 4;
      if (!isV4 || address.internal) continue;
      const rank = interfaceTier(name) * 10 + addressTier(address.address);
      // Strictly better only: an equal rank keeps the earlier one, which is platform order.
      if (best === null || rank < best.rank) best = { address: address.address, rank };
    }
  }
  return best ? { address: best.address, reachable: true } : { address: NO_LOCAL_ADDRESS, reachable: false };
}
