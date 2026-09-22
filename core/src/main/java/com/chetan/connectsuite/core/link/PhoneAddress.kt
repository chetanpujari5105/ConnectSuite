package com.chetan.connectsuite.core.link

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.chetan.connectsuite.core.protocol.Link
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * The address a Mac would have to dial to reach this phone.
 *
 * ### Why this is the network reading and `ConnectivityManager` alone is not
 *
 * The question the pairing flow actually asks is *"can a Mac reach this phone?"*, and the answer is
 * **"does a socket bound here have an address on a local network"** — not "is there connectivity".
 * Those come apart in both directions: a phone on cellular has an active, validated network and no
 * route a Mac can take; a phone on a laptop's hotspot with no internet is perfectly reachable.
 *
 * So the *addresses* still come from `NetworkInterface`, because `LinkServer` binds a `ServerSocket`
 * and those are the interfaces it binds across. What changed on 2026-09-22 is that enumerating them
 * is not the same as ranking them, and this used to do only the first.
 *
 * **It shipped taking whichever non-loopback IPv4 came back first**, which follows interface index.
 * On the SM-S938B, with a Mac connected over `swlan0`, that was the **cellular CGNAT address** on
 * `rmnet_data0` — an address no Mac can route to, offered as the one to type in. `PhoneAddressRules`
 * carries the full reading and the reasoning; this file is now just the two halves of getting the
 * data to it.
 *
 * `ACCESS_NETWORK_STATE` is declared in `core/src/main/AndroidManifest.xml` and is what the
 * transport lookup needs. Enumerating interfaces still requires no permission, which is why the
 * address list survives a [Context] that cannot answer.
 */
object PhoneAddress {

    /**
     * The IPv4 address a Mac could dial, or null when there is none worth offering.
     *
     * IPv4 only, deliberately: this string is read aloud or typed by a person into the Mac's manual
     * entry field, and a link-local IPv6 address with a `%wlan0` scope suffix is not something
     * anybody types correctly. If the phone has only IPv6 the honest answer is "no address to give
     * you", which the caller renders as the no-network state.
     */
    fun localIpv4(context: Context?): String? =
        PhoneAddressRules.choose(candidates(context))?.address

    /**
     * Every IPv4 address this phone has, each tagged with what its interface is.
     *
     * Public because the decision has to be auditable on a device: `ConnectMacScreen` renders only
     * while nothing is paired, so on a working phone there is **no surface at all** that shows what
     * [localIpv4] picked — which is exactly why the wrong answer survived. `PhoneAddressProbe`
     * prints this table, and it prints the candidates that *lost* as well as the one that won,
     * because a reading that cannot show its alternatives is not evidence.
     *
     * One gathering path, shared with [localIpv4]: a probe that assembled its own view of the
     * interfaces would be a second expression of this, and the two would eventually disagree with
     * the probe being the one everybody believed.
     */
    fun candidates(context: Context?): List<PhoneAddressRules.Candidate> = runCatching {
        val transports = transportsByInterface(context)
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { nif ->
                nif.inetAddresses.asSequence()
                    .filterIsInstance<Inet4Address>()
                    .filter { !it.isLoopbackAddress && !it.isLinkLocalAddress }
                    .mapNotNull { it.hostAddress }
                    .map { address ->
                        PhoneAddressRules.Candidate(
                            interfaceName = nif.name,
                            address = address,
                            reach = PhoneAddressRules.reachOf(transports[nif.name]),
                        )
                    }
            }
            .toList()
    }.getOrDefault(emptyList())

    /** `192.168.1.24:42501`, or null when there is no address to offer. */
    fun controlEndpoint(context: Context?): String? =
        localIpv4(context)?.let { "$it:${Link.PORT_CONTROL}" }

    /**
     * What the platform says about each interface that has a network behind it.
     *
     * **An interface missing from this map is not a failure**, it is the ordinary case for a
     * tethering or Wi-Fi Direct interface the framework does not model — `PhoneAddressRules` reads
     * the absence as [PhoneAddressRules.Reach.UNCLAIMED] rather than as a disqualification.
     *
     * An empty map is therefore the honest degraded state: with nothing known, every candidate is
     * unclaimed, the tiers collapse, and the choice falls back to interface order. That is the old
     * behaviour, and it is the right fallback precisely because it excludes nothing — a classifier
     * that dropped addresses on a `ConnectivityManager` that failed to answer would turn a
     * transient into "your phone has no network".
     */
    private fun transportsByInterface(context: Context?): Map<String, PhoneAddressRules.Transport> {
        val manager = context?.applicationContext
            ?.getSystemService(ConnectivityManager::class.java)
            ?: return emptyMap()
        return runCatching {
            buildMap {
                @Suppress("DEPRECATION")
                manager.allNetworks.forEach { network ->
                    val name = manager.getLinkProperties(network)?.interfaceName ?: return@forEach
                    val caps = manager.getNetworkCapabilities(network) ?: return@forEach
                    put(
                        name,
                        PhoneAddressRules.Transport(
                            wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
                            ethernet = caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET),
                            cellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR),
                            vpn = caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN),
                            localNetwork = hasLocalNetworkCapability(caps),
                        ),
                    )
                }
            }
        }.getOrDefault(emptyMap())
    }

    /**
     * `NET_CAPABILITY_LOCAL_NETWORK`, read by its numeric value.
     *
     * It arrived in API 35 and this build's `compileSdk` has it, but a constant that new is one an
     * older runtime will not recognise — and `hasCapability` with an unknown bit simply answers
     * false rather than throwing, which is the degradation we want. It is read defensively anyway
     * because it is a *bonus* signal: `swlan0` on the measured handset already reports
     * `TRANSPORT_WIFI`, so the fix does not depend on this being available.
     */
    private fun hasLocalNetworkCapability(caps: NetworkCapabilities): Boolean =
        runCatching { caps.hasCapability(NET_CAPABILITY_LOCAL_NETWORK) }.getOrDefault(false)

    /** `NetworkCapabilities.NET_CAPABILITY_LOCAL_NETWORK`, inlined so older runtimes still link. */
    private const val NET_CAPABILITY_LOCAL_NETWORK = 38
}
