package com.chetan.connectsuite.camera

import com.chetan.connectsuite.camera.webcam.OtherCapture

/**
 * One physical camera, two features that may ask for it — Camera v1 (`camera.*`) and Camera v2
 * (`webcam.*`). docs/protocol.md → `webcam.request`: each refuses `CAMERA_BUSY` while the other has a
 * request or session open, and **neither ever stops the other to make room**.
 *
 * Each feature's busy check and its own request must be **one decision**, or two requests arriving
 * together — on two control connections, two threads — could each see the other idle and both be put
 * up. So both run their check-and-request inside [admit], which holds one lock across both. The lock
 * order is always this lock, then a session machine's; no machine calls back here while holding its
 * own, so the two cannot deadlock.
 *
 * It holds no session state of either feature — only a predicate each feature registers about itself.
 * With the webcam not installed, [webcamOpen] stays `{ false }` and Camera v1 behaves exactly as before.
 */
class CameraUseArbiter {
    private val lock = Any()

    /** A webcam request or session is open. Registered by the webcam engine when it is installed. */
    @Volatile
    var webcamOpen: () -> Boolean = { false }

    /** A Camera v1 request or stream is open. Registered by Camera v1's engine when it is installed. */
    @Volatile
    var cameraV1Open: () -> Boolean = { false }

    /** Runs one feature's busy check and its request as a single decision. */
    fun <T> admit(decision: () -> T): T = synchronized(lock) { decision() }

    /**
     * Camera v1's request, as `CameraEngine.onRequest` makes it: [request] is told whether a webcam holds
     * the camera, read inside the lock. The engine and the tests call this one function, so the rule has
     * one home.
     */
    fun <T> admitCamera(request: (webcamBusy: Boolean) -> T): T = admit { request(webcamOpen()) }

    /**
     * The webcam's request, as `WebcamEngine.onRequest` makes it: [request] is told which other capture
     * holds the phone — Camera v1 first, then the mirror — read inside the lock.
     */
    fun <T> admitWebcam(mirrorBusy: () -> Boolean, request: (other: OtherCapture?) -> T): T = admit {
        request(
            when {
                cameraV1Open() -> OtherCapture.CAMERA_V1
                mirrorBusy() -> OtherCapture.MIRROR
                else -> null
            },
        )
    }
}

/** The app's one arbiter. Tests build their own. */
object CameraUse {
    val arbiter = CameraUseArbiter()
}
