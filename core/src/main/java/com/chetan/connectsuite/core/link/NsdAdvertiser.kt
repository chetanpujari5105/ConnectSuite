package com.chetan.connectsuite.core.link

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import com.chetan.connectsuite.core.protocol.Link

/**
 * Advertises `_connectsuite._tcp` so a Mac on the same router can find the phone without being
 * told an address.
 *
 * This is the third discovery path on purpose: Samsung's hotspot AP drops multicast, so mDNS is
 * usually dead exactly when the user is relying on the hotspot. The gateway probe on the Mac
 * covers that case; this covers the ordinary home-router case.
 */
class NsdAdvertiser(context: Context, private val deviceName: String, private val deviceId: String) {

    private val appContext = context.applicationContext
    private val nsd = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = appContext.applicationContext
        .getSystemService(Context.WIFI_SERVICE) as WifiManager

    private var multicastLock: WifiManager.MulticastLock? = null
    private var listener: NsdManager.RegistrationListener? = null

    /**
     * The `pair` TXT attribute — F6, and the only thing that lets a Mac tell *nobody scanned* from
     * *somebody scanned and I have not connected yet*.
     *
     * The phone is the listener, so before it accepts a connection there is nothing for the Mac to
     * observe; a QR on screen looks identical whether or not it has been scanned. This publishes the
     * one fact the Mac cannot otherwise learn.
     *
     * **A positive is trustworthy and a negative is not**, which `docs/protocol.md` states and the
     * Mac's copy has to respect: mDNS is the least reliable of the three discovery paths — Samsung's
     * hotspot drops multicast, routers filter it, and a phone on another network is invisible by
     * construction. So absence must never be rendered as "nobody scanned".
     */
    private var pairIntent: String? = null

    fun start() {
        if (listener != null) return

        // Without the lock the radio filters the multicast our own responder needs to answer.
        // If the platform refuses it, mDNS discovery is degraded but the link still works over
        // the gateway and last-known paths — so this must never take the service down with it.
        multicastLock = runCatching {
            wifi.createMulticastLock("connectsuite-nsd").apply {
                setReferenceCounted(false)
                acquire()
            }
        }.onFailure {
            LinkLog.w("nsd", "No multicast lock; mDNS discovery may not answer", it)
        }.getOrNull()

        val info = NsdServiceInfo().apply {
            serviceName = "ConnectSuite $deviceName".take(63)
            serviceType = Link.SERVICE_TYPE
            port = Link.PORT_CONTROL
            setAttribute("name", deviceName)
            setAttribute("model", Build.MODEL)
            setAttribute("proto", Link.PROTOCOL_MAJOR.toString())
            setAttribute("id", deviceId.take(32))
            pairIntent?.let { setAttribute("pair", it) }
        }

        val registration = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                LinkLog.i("nsd", "Registered as ${info.serviceName}")
            }

            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                LinkLog.w("nsd", "Registration failed with code $errorCode")
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {
                LinkLog.i("nsd", "Unregistered")
            }

            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                LinkLog.w("nsd", "Unregistration failed with code $errorCode")
            }
        }
        listener = registration
        runCatching { nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration) }
            .onFailure { LinkLog.w("nsd", "registerService threw", it) }
    }

    /**
     * Announce that this phone has scanned [macFingerprint]'s code and is expecting it, or clear
     * the announcement when [macFingerprint] is null.
     *
     * Re-registers, because `NsdManager` has no API for amending a live registration's TXT records:
     * the service must be unregistered and registered again. That is why this is a separate call
     * rather than something folded into [start] — it happens at most twice per pairing.
     */
    fun setPairIntent(macFingerprint: String?) {
        val next = macFingerprint
            ?.replace(":", "")
            ?.lowercase()
            ?.take(16)
        if (next == pairIntent) return
        pairIntent = next
        if (listener == null) return
        LinkLog.i("nsd", if (next == null) "Pairing intent cleared" else "Advertising pairing intent $next")
        // A failure here degrades discovery to the other two paths and must not take the link with
        // it — the same reasoning as the multicast lock above.
        runCatching {
            listener?.let { nsd.unregisterService(it) }
            listener = null
            start()
        }.onFailure { LinkLog.w("nsd", "Could not republish with the pairing intent", it) }
    }

    fun stop() {
        listener?.let { runCatching { nsd.unregisterService(it) } }
        listener = null
        multicastLock?.let { if (it.isHeld) it.release() }
        multicastLock = null
    }
}
