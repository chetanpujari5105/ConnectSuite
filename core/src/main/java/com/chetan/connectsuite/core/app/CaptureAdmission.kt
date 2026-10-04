package com.chetan.connectsuite.core.app

/**
 * The one lock every capture feature's **admission** runs under — the mirror's start, Camera v1's
 * request and the webcam's request (docs/protocol.md → `webcam.request`, and the mirror's coexistence
 * row). Each reads whether the others hold the phone and records its own request **inside** this lock, so
 * two requests arriving together on two connections cannot each see the other idle.
 *
 * It holds no state of any feature. In `core` because the mirror and the camera module cannot see each
 * other, and both can see this.
 */
object CaptureAdmission {
    val lock: Any = Any()

    fun <T> admit(decision: () -> T): T = synchronized(lock) { decision() }
}
