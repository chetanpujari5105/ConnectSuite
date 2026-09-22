package com.chetan.connectsuite.core.link

/**
 * Which of this phone's IPv4 addresses a Mac could actually dial — the decision half, with no
 * Android in it.
 *
 * ### The reading that produced this
 *
 * Measured on the SM-S938B, 2026-09-22, with a Mac connected. The phone had **two** qualifying
 * addresses at once:
 *
 * | interface | address | what it is |
 * |---|---|---|
 * | `rmnet_data0` (ifindex 103) | `100.64.25.19` | cellular, CGNAT. **No Mac can route to it.** |
 * | `swlan0` (ifindex 124) | `10.36.14.60` | the network the Mac was actually connected over |
 *
 * [PhoneAddress] took *the first* non-loopback IPv4 that `NetworkInterface` handed back, and that
 * enumeration follows interface index — so the cellular address won, and the pairing screen would
 * have offered a Mac an address that cannot reach this phone. The ground truth was in the log the
 * whole time: `Handshake complete with Chetans-MacBook-Pro at 10.36.14.246`, on `swlan0`'s subnet.
 *
 * **The function's own KDoc already said this must not happen** — *"a phone on cellular has an
 * active, validated network and no route a Mac can take"* — and the implementation did it anyway.
 * A comment describing the trap is not a guard against it.
 *
 * ### Why transport rather than interface name
 *
 * `rmnet*` is Qualcomm's modem naming, `swlan0` is Samsung's, and neither is a contract. A name
 * blocklist is a single-device reading dressed as a platform fact — `docs/single-device-audit.md`
 * §4 — and it fails silently on the first handset that spells its modem differently. The platform
 * already answers the real question through `ConnectivityManager`: *what transport is this
 * interface's network?* That is the signal, and [reachOf] is the only thing that interprets it.
 *
 * ### It excludes only on positive evidence
 *
 * An interface no network claims is [Reach.UNCLAIMED], **not** wide-area, and stays eligible behind
 * every local one. That is this repo's absence rule applied to a product decision: not knowing what
 * an interface is has never been the same as knowing it is unroutable, and a classifier that
 * excluded on silence would answer *"no network"* on the first OEM that models a tether differently.
 * Only a network the platform positively calls cellular or VPN is dropped.
 */
object PhoneAddressRules {

    /**
     * What the platform says about the network behind one interface, reduced to what this decision
     * needs.
     *
     * Booleans rather than the framework's `int` transports on purpose: this type is the seam, and
     * a seam that speaks `NetworkCapabilities.TRANSPORT_*` would drag Android into the one file
     * that exists to keep it out.
     */
    data class Transport(
        val wifi: Boolean = false,
        val ethernet: Boolean = false,
        val cellular: Boolean = false,
        val vpn: Boolean = false,
        /** `NET_CAPABILITY_LOCAL_NETWORK` — the platform saying outright that this is a LAN. */
        val localNetwork: Boolean = false,
    )

    /** How likely a Mac on the same network is to be able to reach an address on this interface. */
    enum class Reach {
        /** Wi-Fi, Ethernet, or a network the platform marks as local. A Mac can dial this. */
        LOCAL,

        /** No network claims the interface. Unknown, not disqualified — see the class comment. */
        UNCLAIMED,

        /** Cellular or VPN. Routable *for the phone*, and not a route into it. Never offered. */
        WIDE_AREA,
    }

    /** One address, with the interface it sits on and what that interface is. */
    data class Candidate(
        val interfaceName: String,
        val address: String,
        val reach: Reach,
    )

    /**
     * Classifies one interface. A `null` [transport] means no network claimed it.
     *
     * **VPN is tested before Wi-Fi and that order is load-bearing.** A VPN network's capabilities
     * carry `TRANSPORT_VPN` *and* frequently the underlying transport too, so a `wifi` check placed
     * first would call `tun0` a local address and hand a Mac the inside of a tunnel.
     */
    fun reachOf(transport: Transport?): Reach {
        if (transport == null) return Reach.UNCLAIMED
        if (transport.vpn) return Reach.WIDE_AREA
        if (transport.localNetwork || transport.wifi || transport.ethernet) return Reach.LOCAL
        if (transport.cellular) return Reach.WIDE_AREA
        return Reach.UNCLAIMED
    }

    /**
     * The address to offer, or null when nothing on this phone is worth offering.
     *
     * **Order within a tier is the caller's**, and that is deliberate: `NetworkInterface` hands
     * interfaces back in index order, which is a reasonable tiebreak between two equally local
     * addresses and is exactly the wrong thing to decide *between tiers*. The bug this fixes was a
     * tiebreak doing a classifier's job.
     *
     * Returning null for a cellular-only phone is the honest answer rather than a cautious one. A
     * Mac cannot reach that address, so offering it produces a person typing a number into their
     * Mac and watching it time out with nothing to explain why; the caller renders `NoNetwork`,
     * which says get on a Wi-Fi network — the thing that would actually work.
     */
    fun choose(candidates: List<Candidate>): Candidate? =
        candidates.firstOrNull { it.reach == Reach.LOCAL }
            ?: candidates.firstOrNull { it.reach == Reach.UNCLAIMED }
}
