package com.chetan.connectsuite.core.link

/**
 * Frames and bytes a channel has accepted, carried so that a refusal can be read against them.
 *
 * This exists because of the counter rule in CLAUDE.md: a refusal count with no denominator is not
 * evidence. "Closed the bulk socket, 1 frame rejected" is the same line whether it was the first
 * frame of a broken channel or the ten-thousandth frame of a transfer that had moved 2 GB, and
 * those need opposite responses. So the refusal message is built *here*, where the successes are,
 * and cannot be written without them.
 *
 * Deliberately free of Android and of [LinkLog]: it is on the framing path, which is unit tested
 * on the JVM, and a single `android.util.Log` reference anywhere on that path takes the tests with
 * it.
 */
class FrameTally(private val channel: String) {

    var accepted: Long = 0L
        private set
    var bytesAccepted: Long = 0L
        private set
    var rejected: Long = 0L
        private set

    @Synchronized
    fun accept(bytes: Int) {
        accepted++
        bytesAccepted += bytes
    }

    /**
     * Counts a refusal and returns the line describing it — which cap, what length, and the
     * accepted totals it has to be read against.
     */
    @Synchronized
    fun reject(kind: String, length: Long, cap: Int): String {
        rejected++
        val why =
            if (length < 0) "is negative (cap $cap bytes)"
            else "exceeds the $cap-byte cap"
        return "$kind frame length $length $why on the $channel channel — closing the socket; " +
            summaryLocked()
    }

    @Synchronized
    fun summary(): String = summaryLocked()

    private fun summaryLocked(): String =
        "$accepted frames / $bytesAccepted bytes accepted, $rejected rejected"
}
