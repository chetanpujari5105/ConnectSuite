package com.chetan.connectsuite.camera

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.MessageType

/**
 * Whether Camera v1 may be installed in this build — **the release gate**, and one line on purpose.
 *
 * Camera v1 is development-only (docs/camera-v1.md). A release build is never debuggable, so it never
 * installs the feature, never registers a handler, never takes the camera claim — and `camera` stays in
 * `unavailable`. The gate is a fact about the build rather than a switch anything can flip at runtime,
 * and lifting it is a later, deliberate change to this function and to the contract together.
 * `CameraReleaseGateTest` holds both the rule and the call site.
 */
object CameraReleaseGate {
    fun allows(debuggable: Boolean): Boolean = debuggable
}

/**
 * Wires Camera v1 into the link, and by doing so turns the `camera` capability on.
 *
 * Both halves of `CapabilityContract`'s `camera` entry are satisfied here and nowhere else: the
 * three requests in [handledTypes] are registered, and `cameraChannelSink` is assigned. The sink goes
 * first for the reason `MirrorFeature` gives — the last `register` then sees both halves in place.
 */
object CameraFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.CAMERA_REQUEST,
        MessageType.CAMERA_STOP,
        MessageType.CAMERA_SWITCH,
    )

    @Volatile
    private var installed = false

    /**
     * @param mirrorBusy true while a mirror session is running or waiting for consent. Supplied by the
     *   app because it is the one place that can see both modules; a camera request then answers
     *   CAMERA_BUSY and the mirror is never interrupted.
     * @return whether the feature was installed — false in a release build.
     */
    fun install(context: Context, server: LinkServer, mirrorBusy: () -> Boolean): Boolean {
        if (!CameraReleaseGate.allows(server.debuggable)) {
            LinkLog.i("camera", "Camera v1 is development-only and this build is not debuggable — not installed")
            return false
        }
        if (installed) return true
        installed = true
        val appContext = context.applicationContext
        CameraEngine.install(appContext, mirrorBusy)

        server.cameraChannelSink = { channel, claim -> CameraEngine.onChannel(channel, claim) }
        server.addSessionEndedListener { session -> CameraEngine.onSessionEnded(session) }
        handledTypes.forEach { type -> server.register(type, handlerFor(type)) }
        server.refreshCapabilities()

        (appContext as? Application)?.registerActivityLifecycleCallbacks(RequestScreenOnResume)

        LinkLog.i("camera", "Camera feature installed; capabilities now: ${server.capabilities.current().sorted()}")
        return true
    }

    private fun handlerFor(type: String): MessageHandler = when (type) {
        MessageType.CAMERA_REQUEST -> MessageHandler { session, request -> CameraEngine.onRequest(session, request) }
        MessageType.CAMERA_STOP -> MessageHandler { session, request -> CameraEngine.onStop(session, request) }
        MessageType.CAMERA_SWITCH -> MessageHandler { session, request -> CameraEngine.onSwitch(session, request) }
        else -> error("CameraFeature.handledTypes lists $type with no handler")
    }

    /**
     * A request is waiting and the owner has just brought Sidekick to the front some other way than
     * the notification — from the launcher, say, or with notifications turned off. The request screen
     * opens over it, from that visible Activity, which is a start Android allows. It is a screen asking;
     * the camera still opens only on Start camera.
     */
    private object RequestScreenOnResume : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) {
            if (activity is CameraActivity) return
            if (activity.javaClass.name in AppForeground.transparentHelpers) return
            if (CameraEngine.ui.value.phase != CameraPhase.AWAITING) return
            runCatching { CameraEngine.openRequestScreen(activity) }
                .onFailure { LinkLog.w("camera", "Could not open the camera request screen: ${it.message}") }
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }
}
