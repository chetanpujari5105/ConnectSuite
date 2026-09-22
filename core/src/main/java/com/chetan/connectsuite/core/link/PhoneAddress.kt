package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.protocol.Link
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * The address a Mac would have to dial to reach this phone.
 *
 * ### Why this is the network reading and `ConnectivityManager` is not
 *
 * The question the pairing flow actually asks is *"can a Mac reach this phone?"*, and the answer is
 * **"does a socket bound here have an address on a local network"** — not "is there connectivity".
 * Those come apart in both directions: a phone on cellular has an active, validated network and no
 * route a Mac can take; a phone on a laptop's hotspot with no internet is perfectly reachable.
 *
 * It is also one reading rather than two. `CLAUDE.md`'s *two readings, one fact* family is what
 * happens when a `ConnectivityManager` answer and an interface answer disagree and somebody has to
 * decide which is "right" — the honest move is to ask the thing the product actually depends on.
 * `LinkServer` binds a `ServerSocket`; these are the interfaces it binds across.
 *
 * `ACCESS_NETWORK_STATE` is already declared and is not needed by this: enumerating interfaces
 * requires no permission.
 */
object PhoneAddress {

    /**
     * The first non-loopback IPv4 address, or null when there is none.
     *
     * IPv4 only, deliberately: this string is read aloud or typed by a person into the Mac's manual
     * entry field, and a link-local IPv6 address with a `%wlan0` scope suffix is not something
     * anybody types correctly. If the phone has only IPv6 the honest answer is "no address to give
     * you", which the caller renders as the no-network state.
     */
    fun localIpv4(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .filterIsInstance<Inet4Address>()
            .firstOrNull { !it.isLoopbackAddress && !it.isLinkLocalAddress }
            ?.hostAddress
    }.getOrNull()

    /** `192.168.1.24:42501`, or null when there is no address to offer. */
    fun controlEndpoint(): String? = localIpv4()?.let { "$it:${Link.PORT_CONTROL}" }
}
