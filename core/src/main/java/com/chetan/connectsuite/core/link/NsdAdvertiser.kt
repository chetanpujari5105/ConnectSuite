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

    fun stop() {
        listener?.let { runCatching { nsd.unregisterService(it) } }
        listener = null
        multicastLock?.let { if (it.isHeld) it.release() }
        multicastLock = null
    }
}
