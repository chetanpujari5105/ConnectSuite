package com.chetan.connectsuite.camera

import androidx.camera.core.CameraState

/**
 * The two translations between the platform and Camera v1, kept pure so a JVM test calls them.
 */
object CameraMappings {

    /**
     * An `OrientationEventListener` reading (degrees, clockwise from natural) as the analysis target
     * rotation — `Surface.ROTATION_0..270`, whose values are 0..3.
     *
     * Physical orientation rather than the display's, so the Mac sees the scene upright even when the
     * phone's rotation lock holds its UI in portrait. This is CameraX's documented mapping: a device
     * turned 90° clockwise wants `ROTATION_270`.
     */
    fun targetRotationFor(orientationDegrees: Int): Int = when (((orientationDegrees % 360) + 360) % 360) {
        in 45 until 135 -> 3 // ROTATION_270
        in 135 until 225 -> 2 // ROTATION_180
        in 225 until 315 -> 1 // ROTATION_90
        else -> 0 // ROTATION_0
    }

    /**
     * A CameraX `CameraState.StateError` code as the reason the stream ends, or null for an error
     * CameraX recovers from itself — which [CameraSessionMachine.START_TIMEOUT_MS] still bounds, so a
     * recovery that never comes ends as `camera-unavailable` rather than a stream that never starts.
     */
    fun stopReasonFor(errorCode: Int): CameraStopReason? = when (errorCode) {
        CameraState.ERROR_CAMERA_IN_USE,
        CameraState.ERROR_MAX_CAMERAS_IN_USE,
        CameraState.ERROR_CAMERA_DISABLED,
        -> CameraStopReason.CAMERA_IN_USE
        CameraState.ERROR_OTHER_RECOVERABLE_ERROR -> null
        else -> CameraStopReason.CAMERA_UNAVAILABLE
    }
}
