package com.chetan.connectsuite.sync.v2

import java.util.concurrent.ConcurrentHashMap

/**
 * Stopping live bulk streams, and what a control session ending does to the transfers it agreed
 * (defect 157).
 *
 * A bulk stream runs on its own socket, so the control session that agreed it can end while bytes are
 * still moving. Every block digest and the final verdict travel on that control session, so once it is
 * gone the Mac can never confirm the file: a stream that keeps sending is spending the link on bytes
 * the Mac will throw away. Found on hardware (L1/L2 T3, 2026-09-30): after the Mac's Disconnect at
 * 40%, this phone sent the remaining 125.8 MB, dropped every digest and the `done`, and counted the
 * transfer as completed.
 *
 * Kept pure so a JVM test runs these rules against the real [BlockPullSender]; `BulkTransfers` holds
 * the maps and the sockets and calls in here.
 */
object BulkStops {

    /** The stop reason when the session that agreed a transfer ended. Never a request from the Mac. */
    const val SESSION_ENDED = "session-ended"

    /** What a session ending does: drop its unclaimed pulls, abandon its unclaimed pushes, stop its live streams. */
    data class SessionEndPlan(val dropPending: Set<String>, val abandonPushes: Set<String>, val stopLive: Set<String>)

    /**
     * The plan for [endedToken] ending. [pendingOwners] and [incomingOwners] are the unclaimed transfers
     * by the session that agreed them; [owners] holds every transfer from registration until its socket is
     * done, so an id that is in [owners] and in neither of the other two is **live**.
     *
     * Ownership is by token, and a token is minted per handshake, so a replacement session's transfers
     * are never in the plan of the session it replaced.
     */
    fun sessionEndPlan(
        pendingOwners: Map<String, String>,
        incomingOwners: Map<String, String>,
        owners: Map<String, String>,
        endedToken: String,
    ): SessionEndPlan = SessionEndPlan(
        dropPending = pendingOwners.filterValues { it == endedToken }.keys,
        abandonPushes = incomingOwners.filterValues { it == endedToken }.keys,
        stopLive = owners.filter { (id, owner) -> owner == endedToken && id !in pendingOwners && id !in incomingOwners }.keys,
    )

    /** How a stop is worded in the log: a session ending is not something the Mac asked for. */
    fun describe(reason: String): String = when (reason) {
        SESSION_ENDED -> "stopped: the session that agreed it ended, so the Mac could no longer confirm it"
        // The Mac's Pause keeps what arrived and resumes from it; calling it a cancel was wrong (B10).
        "pause" -> "paused by the Mac — it can resume from here"
        else -> "cancelled by the Mac (reason=$reason)"
    }

    /**
     * Whether a pull counts as **sent in full**. The phone never learns whether the Mac saved it — the
     * Mac checks and saves — so the most it can claim is that every byte went out and its verdict was
     * handed to a session that could still send it.
     */
    fun sentInFull(allBytesSent: Boolean, verdictQueued: Boolean): Boolean = allBytesSent && verdictQueued

    /**
     * How a pull that ran to an outcome is counted and logged. A stream stopped on request — the Mac's
     * Pause or Cancel (`fs.transfer.cancel`), or its session ending — is **stopped**: not completed, not a
     * fault, and logged at I. Hardware, 2026-10-09 (B10): a Pause was logged at W and counted *failed*.
     * A source that changed, or every byte sent with no session left to confirm it, stays a failure.
     */
    /** The log's word for an outcome: a stream stopped on request is *stopped*, not *Cancelled* (B10). */
    fun outcomeWord(stopped: Boolean, name: String = "Cancelled"): String = if (stopped) "stopped" else name

    enum class End(val warn: Boolean) { COMPLETED(false), STOPPED(false), FAILED(true) }

    fun endOf(sentInFull: Boolean, stoppedByRequest: Boolean): End = when {
        sentInFull -> End.COMPLETED
        stoppedByRequest -> End.STOPPED
        else -> End.FAILED
    }

    /** How a pull that ended in an exception is reported: an expected stop, or a failure. */
    data class Failure(val expected: Boolean, val words: String)

    /**
     * A pull whose socket broke is usually not a fault (release run 2026-10-08, T3): the person pressed
     * Pause or Disconnect, the Mac closed the stream, and the write threw. That was logged at **E** as
     * `block pull failed`. A stop reason already flagged (the session ended, or the Mac cancelled), or an
     * I/O error on the stream, is an expected stop and is worded as one; the phone cannot tell a Pause
     * from a Disconnect from a dropped link, so the sentence names all three. Anything else stays a failure.
     */
    fun classifyFailure(stopReason: String?, error: Throwable): Failure = when {
        stopReason != null -> Failure(true, describe(stopReason))
        error is java.io.IOException -> Failure(
            true,
            "stopped: the Mac closed the stream (a Pause, a Disconnect or a dropped link — this end cannot tell which)",
        )
        else -> Failure(false, "failed: ${error.javaClass.simpleName}")
    }
}

/** The live streams asked to stop, each with its reason. A stream polls [take] between chunks. */
class LiveStops {
    private val reasons = ConcurrentHashMap<String, String>()

    /** A stop asked for by the Mac (`fs.transfer.cancel`). */
    fun flag(transferId: String, reason: String) {
        reasons[transferId] = reason
    }

    /** A stop from a session ending. Does not overwrite a stop the Mac already asked for (its reason is the truer one). */
    fun flagIfAbsent(transferId: String, reason: String) {
        reasons.putIfAbsent(transferId, reason)
    }

    /** The reason [transferId] was asked to stop, consumed; null when nobody asked. */
    fun take(transferId: String): String? = reasons.remove(transferId)

    /** Forgets any stop left for a transfer whose socket is done. */
    fun forget(transferId: String) {
        reasons.remove(transferId)
    }

    fun isFlagged(transferId: String): Boolean = reasons.containsKey(transferId)
}

/**
 * Which session ends have already been acted on (defect 161). `BulkTransfers.forgetSession` has two
 * callers — the Files and the Photos features each hear the same session end — and before this the
 * second call recomputed the plan, re-flagged the live stream the first had already stopped, and logged
 * *"stopping 1 live stream(s)"* a second time for one stop. A token is minted per handshake, so the first
 * end of a token is the only one with anything to do. Bounded, because tokens accumulate for the life of
 * the process; a token old enough to fall out has no transfers left to stop.
 */
class EndedSessions(private val capacity: Int = 64) {
    private val seen = LinkedHashSet<String>()

    /** True the first time [token] ends, false on every repeat. */
    @Synchronized
    fun firstEnd(token: String): Boolean {
        if (!seen.add(token)) return false
        while (seen.size > capacity) seen.remove(seen.first())
        return true
    }
}
