package com.chetan.connectsuite.camera.webcam

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import com.chetan.connectsuite.camera.CameraActivity
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.AuthenticatedChannel
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.link.SideChannelClaim
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
 * The slice of `LinkServer` the webcam's wiring touches — so a JVM test drives the production [WebcamFeature.wire]
 * against a recorder and reads back exactly what the link would advertise.
 */
interface WebcamLinkTarget {
    val debuggable: Boolean
    fun setWebcamSink(sink: (AuthenticatedChannel, SideChannelClaim.Webcam) -> Unit)
    fun addSessionEndedListener(listener: (ControlSession) -> Unit)
    fun register(type: String, handler: MessageHandler)
    fun refreshCapabilities()
}

/**
 * Wires Camera v2 into the link, and by doing so turns the `webcam` capability on and makes the
 * handshake advertise `ext.webcam` 1 (it reads `LinkServer.webcamChannelSink`).
 *
 * Called by `ConnectSuiteApp` in every build; it installs only where [WebcamReleaseGate] allows — a
 * debuggable build, since `WEBCAM_RELEASE` is false. The sink goes first, for `MirrorFeature`'s reason:
 * the last `register` then sees both halves of the contract in place.
 */
object WebcamFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.WEBCAM_REQUEST,
        MessageType.WEBCAM_STOP,
        MessageType.WEBCAM_SWITCH,
        // Version 2: registered with the rest, so a phone advertising ext.webcam 2 always answers it.
        MessageType.WEBCAM_KEYFRAME,
    )

    @Volatile
    private var installed = false

    /**
     * @param mirrorBusy true while a mirror session is running, waiting for consent or being started; a
     *   webcam request then answers CAMERA_BUSY and the mirror is never interrupted.
     * @return whether the feature was installed — false in a release build.
     */
    fun install(context: Context, server: LinkServer, mirrorBusy: () -> Boolean): Boolean {
        if (installed) return true
        val appContext = context.applicationContext
        val done = wire(
            target = object : WebcamLinkTarget {
                override val debuggable: Boolean get() = server.debuggable
                override fun setWebcamSink(sink: (AuthenticatedChannel, SideChannelClaim.Webcam) -> Unit) {
                    server.webcamChannelSink = sink
                }
                override fun addSessionEndedListener(listener: (ControlSession) -> Unit) = server.addSessionEndedListener(listener)
                override fun register(type: String, handler: MessageHandler) = server.register(type, handler)
                override fun refreshCapabilities() = server.refreshCapabilities()
            },
            installEngine = { WebcamEngine.install(appContext, mirrorBusy) },
        )
        if (!done) {
            LinkLog.i("webcam", "Camera v2 (webcam) is development-only and this build is not debuggable — not installed")
            return false
        }
        installed = true
        (appContext as? Application)?.registerActivityLifecycleCallbacks(RequestScreenOnResume)
        LinkLog.i("webcam", "Webcam feature installed; capabilities now: ${server.capabilities.current().sorted()}")
        return true
    }

    /**
     * The gate, then the engine, then the claim, then the handlers. Nothing is touched when the gate
     * refuses. The production install and the tests both come through here.
     */
    fun wire(target: WebcamLinkTarget, release: Boolean = Extensions.WEBCAM_RELEASE, installEngine: () -> Unit): Boolean {
        if (!WebcamReleaseGate.allows(target.debuggable, release)) return false
        installEngine()
        target.setWebcamSink { channel, claim -> WebcamEngine.onChannel(channel, claim) }
        target.addSessionEndedListener { session -> WebcamEngine.onSessionEnded(session) }
        handledTypes.forEach { type -> target.register(type, handlerFor(type)) }
        target.refreshCapabilities()
        return true
    }

    private fun handlerFor(type: String): MessageHandler = when (type) {
        MessageType.WEBCAM_REQUEST -> MessageHandler { session, request -> WebcamEngine.onRequest(session, request) }
        MessageType.WEBCAM_STOP -> MessageHandler { session, request -> WebcamEngine.onStop(session, request) }
        MessageType.WEBCAM_SWITCH -> MessageHandler { session, request -> WebcamEngine.onSwitch(session, request) }
        MessageType.WEBCAM_KEYFRAME -> MessageHandler { session, request -> WebcamEngine.onKeyframe(session, request) }
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
