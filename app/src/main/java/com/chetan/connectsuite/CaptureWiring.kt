package com.chetan.connectsuite

import com.chetan.connectsuite.camera.CameraUseArbiter
import com.chetan.connectsuite.mirror.v2.MirrorAdmissionGate
import com.chetan.connectsuite.mirror.v2.MirrorPhase

/**
 * Where the three capture features' admission meets — the app is the one module that can see both the
 * mirror and the camera module. docs/protocol.md → Mirror coexistence and `webcam.request`.
 *
 * - the mirror's start gate asks the camera arbiter whether a **webcam** request or session is open
 *   (Camera v1 deliberately not: it never refused the mirror, and its behaviour is unchanged);
 * - Camera v1 and the webcam ask [mirrorBusy] whether the mirror holds the phone.
 *
 * `ConnectSuiteApp` calls these with the app's singletons; `CaptureCoexistenceTest` calls the same two
 * functions with fresh instances on one shared lock, so the wiring the app runs is the wiring tested.
 */
object CaptureWiring {

    fun connect(camera: CameraUseArbiter, mirror: MirrorAdmissionGate) {
        check(camera.lock === mirror.lock) { "the camera and the mirror must admit under one lock" }
        mirror.webcamOpen = { camera.webcamOpen() }
    }

    /** The mirror holds the phone: running, awaiting consent, coming up, or being admitted. */
    fun mirrorBusy(mirror: MirrorAdmissionGate, running: () -> Boolean, phase: () -> MirrorPhase): () -> Boolean =
        { mirror.busy(running(), phase()) }
}
