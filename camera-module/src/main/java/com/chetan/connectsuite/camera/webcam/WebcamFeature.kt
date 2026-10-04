package com.chetan.connectsuite.camera.webcam

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import com.chetan.connectsuite.camera.CameraActivity
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.MessageType

/**
 * Whether Camera v2 may be installed in this build — **the release gate**. A debuggable build, or a
 * release build once [Extensions.WEBCAM_RELEASE] is flipped (it is `false`). A fact about the build, not a
 * switch anything can flip at runtime. `WebcamReleaseGateTest` holds the rule and its call site.
 */
object WebcamReleaseGate {
    fun allows(debuggable: Boolean, release: Boolean = Extensions.WEBCAM_RELEASE): Boolean = debuggable || release
}

/**
 * Wires Camera v2 into the link, and by doing so turns the `webcam` capability on and makes the
 * handshake advertise `ext.webcam` 1 (it reads `LinkServer.webcamChannelSink`).
 *
 * **Nothing calls this yet.** The app's wiring — `ConnectSuiteApp` calling it with a `mirrorBusy` lambda,
 * as it does for Camera v1 — is a separate, approved step; until then the running app neither advertises
 * nor serves `webcam`. The sink goes first, for `MirrorFeature`'s reason: the last `register` then sees
 * both halves of the contract in place.
 */
object WebcamFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.WEBCAM_REQUEST,
        MessageType.WEBCAM_STOP,
        MessageType.WEBCAM_SWITCH,
    )

    @Volatile
    private var installed = false

    /**
     * @param mirrorBusy true while a mirror session is running or waiting for consent; a webcam request
     *   then answers CAMERA_BUSY and the mirror is never interrupted.
     * @return whether the feature was installed — false in a release build.
     */
    fun install(context: Context, server: LinkServer, mirrorBusy: () -> Boolean): Boolean {
        if (!WebcamReleaseGate.allows(server.debuggable)) {
            LinkLog.i("webcam", "Camera v2 (webcam) is development-only and this build is not debuggable — not installed")
            return false
        }
        if (installed) return true
        installed = true
        val appContext = context.applicationContext
        WebcamEngine.install(appContext, mirrorBusy)

        server.webcamChannelSink = { channel, claim -> WebcamEngine.onChannel(channel, claim) }
        server.addSessionEndedListener { session -> WebcamEngine.onSessionEnded(session) }
        handledTypes.forEach { type -> server.register(type, handlerFor(type)) }
        server.refreshCapabilities()

        (appContext as? Application)?.registerActivityLifecycleCallbacks(RequestScreenOnResume)

        LinkLog.i("webcam", "Webcam feature installed; capabilities now: ${server.capabilities.current().sorted()}")
        return true
    }

    private fun handlerFor(type: String): MessageHandler = when (type) {
        MessageType.WEBCAM_REQUEST -> MessageHandler { session, request -> WebcamEngine.onRequest(session, request) }
        MessageType.WEBCAM_STOP -> MessageHandler { session, request -> WebcamEngine.onStop(session, request) }
        MessageType.WEBCAM_SWITCH -> MessageHandler { session, request -> WebcamEngine.onSwitch(session, request) }
        else -> error("WebcamFeature.handledTypes lists $type with no handler")
    }

    /**
     * A request is waiting and the owner brought Sidekick to the front some other way than the
     * notification. The request screen opens over it — a screen asking, never the camera. Asked of the
     * machine on its clock, so a request past its deadline is not put back in front of anyone.
     */
    private object RequestScreenOnResume : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) {
            if (activity is WebcamActivity || activity is CameraActivity) return
            if (activity.javaClass.name in AppForeground.transparentHelpers) return
            if (!WebcamEngine.requestAwaiting()) return
            runCatching { WebcamEngine.openRequestScreen(activity) }
                .onFailure { LinkLog.w("webcam", "Could not open the webcam request screen: ${it.message}") }
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }
}
