package com.chetan.connectsuite.camera

/**
 * The platform half of opening a camera — CameraX in [CameraActivity], a recorder in the tests.
 *
 * Everything here runs on the main thread. [whenReady] is the one asynchronous step: CameraX's
 * provider comes up some time after it is asked for, and the answer arrives as a posted callback.
 */
interface CameraBackend {
    /** Calls [then] on the main thread once the camera provider is up (`true`) or failed to come up (`false`). */
    fun whenReady(then: (ready: Boolean) -> Unit)

    fun hasCamera(facing: CameraFacing): Boolean

    /** Binds the preview and the analyzer for [streamId] at [epoch], replacing whatever was bound. Throws on failure. */
    fun bind(streamId: String, facing: CameraFacing, epoch: Int)

    /** Unbinds every use case. Safe to call with nothing bound. */
    fun unbind()
}

/**
 * The camera screen's open / switch / close, without CameraX — so the rules that keep a camera from
 * opening for a stream that has already ended can run in a JVM test.
 *
 * ### The defect it exists for (169)
 *
 * The first version checked, when the provider finally came up, whether the stream was still live by
 * reading the **published screen state**. That state trails the machine: a Stop clears the machine at
 * once, posts the camera's unbind to the main thread, does its socket work, and only then publishes. A
 * provider callback landing in that gap read a stream that had already ended as live, and **bound the
 * camera after the unbind had run** — the camera open, frames gated off, and nothing left to close it
 * but the screen going away.
 *
 * ### The two checks, and why both
 *
 * - **A generation.** Every [open] takes a ticket; every [open] and [close] invalidates the earlier
 *   ones. Main-thread ordering then makes a stale callback harmless whichever way the race falls: a
 *   close that runs first invalidates the ticket, and a close that runs after releases what was bound.
 * - **The machine, asked under its lock** ([isCurrent]) — the exact stream *and* epoch. The generation
 *   alone cannot see an end whose close has not yet been posted here.
 *
 * ### Released once
 *
 * [close] unbinds only what was bound, and says so once. A second close — the end of the stream, then
 * the screen being destroyed — releases nothing and logs nothing.
 */
class CameraHostCore(
    private val backend: CameraBackend,
    private val isCurrent: (streamId: String, epoch: Int) -> Boolean,
    private val failed: (streamId: String, reason: CameraStopReason) -> Unit,
    private val log: (String) -> Unit,
) {
    private data class Bound(val streamId: String, val facing: CameraFacing, val epoch: Int)

    private var generation = 0L
    private var bound: Bound? = null

    /** Cameras bound, and cameras released — the denominator beside every release line. */
    var binds = 0
        private set
    var releases = 0
        private set

    /** Opens, or switches to, the camera for [streamId] at [epoch]. Main thread. */
    fun open(streamId: String, facing: CameraFacing, epoch: Int) {
        val ticket = ++generation
        backend.whenReady { ready ->
            val label = "${streamId.take(8)}… ${facing.wire} epoch $epoch"
            when {
                ticket != generation ->
                    log("Camera open for $label not bound: superseded before the camera was ready")
                !isCurrent(streamId, epoch) ->
                    log("Camera open for $label not bound: the stream had ended or moved on before the camera was ready")
                !ready -> failed(streamId, CameraStopReason.CAMERA_UNAVAILABLE)
                !backend.hasCamera(facing) -> failed(streamId, CameraStopReason.CAMERA_UNAVAILABLE)
                else -> bindNow(streamId, facing, epoch)
            }
        }
    }

    /** Invalidates every pending open and releases the bound camera, once. True if this call released one. */
    fun close(): Boolean {
        generation++
        return release("closed")
    }

    private fun release(why: String): Boolean {
        val was = bound ?: return false
        bound = null
        runCatching { backend.unbind() }
        releases++
        log("Camera released ($why): ${was.streamId.take(8)}… ${was.facing.wire} epoch ${was.epoch} — $releases released of $binds bound")
        return true
    }

    private fun bindNow(streamId: String, facing: CameraFacing, epoch: Int) {
        // A switch replaces the bound camera: that camera's one release is here, said as a switch.
        release("replaced by a switch")
        try {
            backend.bind(streamId, facing, epoch)
        } catch (e: Exception) {
            // Whatever half-bound before the throw goes too; the stream ends as unavailable.
            runCatching { backend.unbind() }
            bound = null
            log("Camera bind failed (${e.javaClass.simpleName}: ${e.message})")
            failed(streamId, CameraStopReason.CAMERA_UNAVAILABLE)
            return
        }
        bound = Bound(streamId, facing, epoch)
        binds++
        // The driver and the hardware notes read this line by its shape; keep it.
        log("Camera bound: ${facing.wire}, epoch $epoch")
    }
}
