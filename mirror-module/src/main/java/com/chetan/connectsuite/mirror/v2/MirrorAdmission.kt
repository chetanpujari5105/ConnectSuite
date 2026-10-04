package com.chetan.connectsuite.mirror.v2

import com.chetan.connectsuite.core.app.CaptureAdmission
import java.util.concurrent.atomic.AtomicInteger

/**
 * Whether a new mirror may start — docs/protocol.md → Mirror coexistence (added 2026-10-04).
 *
 * **A mirror start is refused while a webcam request or session is open on this phone**, from the Mac
 * (`mirror.start`) and from the phone's own Mirror tab alike, and the webcam is never stopped to make
 * room. The refusal is the mirror's ordinary `stopped` ack with [MirrorFailure.CaptureBusy]'s sentence,
 * so a Mac that knows nothing of webcams still shows the reason.
 *
 * The check and the start are one decision with the webcam's own admission: [tryBegin] runs under
 * [lock] — `CaptureAdmission.lock` in the app, the lock the webcam's request is admitted under — and a
 * start that passes counts as busy ([isStarting]) until [end], by which time the mirror's phase says so.
 *
 * Camera v1 is not consulted: it never refused the mirror and still does not (its notes record why). This
 * gate exists for the webcam only.
 */
class MirrorAdmissionGate(val lock: Any = Any()) {

    /** A webcam request or session is open. Set by the app, which is the one place that sees both modules. */
    @Volatile
    var webcamOpen: () -> Boolean = { false }

    private val starting = AtomicInteger()

    /** A start passed [tryBegin] and has not reached [end]. */
    val isStarting: Boolean get() = starting.get() > 0

    /** Refused with a failure to report, or admitted (null) — in which case [end] must follow. */
    fun tryBegin(): MirrorFailure? = synchronized(lock) {
        if (webcamOpen()) {
            MirrorFailure.CaptureBusy
        } else {
            starting.incrementAndGet()
            null
        }
    }

    fun end() {
        starting.updateAndGet { maxOf(0, it - 1) }
    }

    /**
     * Whether the mirror holds the phone, as Camera v1 and the webcam ask before admitting a request:
     * running, waiting for consent, coming up, or between [tryBegin] and [end].
     */
    fun busy(running: Boolean, phase: MirrorPhase): Boolean = isStarting || running || phase in BUSY_PHASES

    companion object {
        val BUSY_PHASES: Set<MirrorPhase> = setOf(MirrorPhase.AWAITING_FOREGROUND, MirrorPhase.REQUESTING_CONSENT, MirrorPhase.STARTING)
    }
}

/** The app's one gate, on the shared capture-admission lock. Tests build their own. */
object MirrorAdmission {
    val gate = MirrorAdmissionGate(CaptureAdmission.lock)
}
