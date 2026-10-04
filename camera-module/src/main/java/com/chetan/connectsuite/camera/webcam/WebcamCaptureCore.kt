package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing

/**
 * The platform half of a webcam capture — Camera2 and MediaCodec in [WebcamActivity], a recorder in the
 * tests. Everything runs on the main thread; [open]'s answer arrives later, as a posted callback.
 */
interface WebcamCaptureBackend {
    sealed interface Outcome {
        /** The camera is open, the encoder is running, and [handle] is what [release] takes back. */
        data class Opened(val handle: Any, val width: Int, val height: Int) : Outcome

        data class Failed(val reason: WebcamStopReason, val why: String) : Outcome
    }

    /** Opens camera [facing] and an encoder for [sessionId] at [generation]. Calls [done] once, later. */
    fun open(sessionId: String, facing: CameraFacing, generation: Int, done: (Outcome) -> Unit)

    /** Releases everything [open] produced for [handle]: capture session, camera, encoder, surfaces. */
    fun release(handle: Any)

    /** Asks the encoder behind [handle] for an IDR. */
    fun requestKeyframe(handle: Any)
}

/**
 * Open, switch and close for the webcam, without Android — so the rules that keep a capture from opening
 * for a session that has ended run in a JVM test. Camera v1's defect 169 is the reason for its shape: a
 * camera or codec callback arriving after the session ended must not bind anything.
 *
 * - **A ticket per open.** Every [open] and [close] invalidates the earlier tickets; an `Opened` arriving
 *   for a stale ticket, or for a session/generation the machine no longer wants ([isCurrent], asked under
 *   the machine's lock), is **released at once and never bound** — counted [lateReleases].
 * - **Released once.** [close] releases only what is bound and says so once; a second close releases
 *   nothing. Opens and releases are counted, so `opened == released + bound` is checkable.
 */
class WebcamCaptureCore(
    private val backend: WebcamCaptureBackend,
    private val isCurrent: (sessionId: String, generation: Int) -> Boolean,
    private val failed: (sessionId: String, reason: WebcamStopReason) -> Unit,
    private val log: (String) -> Unit,
) {
    private data class Bound(val sessionId: String, val facing: CameraFacing, val generation: Int, val handle: Any)

    private var ticket = 0L
    private var bound: Bound? = null

    var opened = 0
        private set
    var released = 0
        private set

    /** Captures that came up after they stopped being wanted, released without being used. */
    var lateReleases = 0
        private set

    val isBound: Boolean get() = bound != null

    /** Opens — or, inside a live session, switches to — the capture for [sessionId] at [generation]. */
    fun open(sessionId: String, facing: CameraFacing, generation: Int) {
        val mine = ++ticket
        val label = "${sessionId.take(8)}… ${facing.wire} generation $generation"
        backend.open(sessionId, facing, generation) { outcome ->
            val wanted = mine == ticket && isCurrent(sessionId, generation)
            when {
                outcome is WebcamCaptureBackend.Outcome.Opened && !wanted -> {
                    runCatching { backend.release(outcome.handle) }
                    lateReleases++
                    log("Webcam capture for $label came up after it stopped being wanted; released unused — $lateReleases late of ${opened + lateReleases} opened")
                }
                outcome is WebcamCaptureBackend.Outcome.Failed && !wanted ->
                    log("Webcam capture for $label failed after it stopped being wanted (${outcome.why}); nothing to end")
                outcome is WebcamCaptureBackend.Outcome.Failed -> {
                    log("Webcam capture for $label failed: ${outcome.why}")
                    failed(sessionId, outcome.reason)
                }
                outcome is WebcamCaptureBackend.Outcome.Opened -> {
                    // A switch replaces the bound capture: its one release is here.
                    release("replaced by a switch")
                    bound = Bound(sessionId, facing, generation, outcome.handle)
                    opened++
                    log("Webcam capture opened: ${facing.wire}, ${outcome.width}x${outcome.height}, generation $generation")
                }
            }
        }
    }

    /** Asks the bound encoder for an IDR. Nothing bound, nothing asked. */
    fun requestKeyframe() {
        bound?.let { runCatching { backend.requestKeyframe(it.handle) } }
    }

    /** Invalidates every pending open and releases the bound capture, once. True if this call released one. */
    fun close(): Boolean {
        ticket++
        return release("closed")
    }

    private fun release(why: String): Boolean {
        val was = bound ?: return false
        bound = null
        runCatching { backend.release(was.handle) }
        released++
        log("Webcam capture released ($why): ${was.sessionId.take(8)}… ${was.facing.wire} generation ${was.generation} — $released released of $opened opened")
        return true
    }
}
