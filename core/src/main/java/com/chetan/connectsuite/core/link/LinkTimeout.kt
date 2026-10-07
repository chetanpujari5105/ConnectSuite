package com.chetan.connectsuite.core.link

import android.content.pm.ServiceInfo

/**
 * What `LinkService` does when Android says one of its foreground-service types has used up its time.
 * Defect 199.
 *
 * ### What happened, and what is measured versus inferred
 *
 * On 2026-10-07 at 07:14:00 the process died with
 * `ForegroundServiceDidNotStopInTimeException: A foreground service of type dataSync did not stop
 * within its timeout: …/LinkService` (the platform's exit record says `APP CRASH(EXCEPTION)`).
 * `START_STICKY` brought it back 1.5 s later, claiming `connectedDevice` only, and the Mac
 * reconnected on pairing v2 five seconds after the drop. Those are readings. **When the six-hour
 * `dataSync` budget started is not** — the platform resets it whenever the app comes to the
 * foreground, and nothing this app logs says when that last happened.
 *
 * ### Why the fix is mostly elsewhere
 *
 * `dataSync` has a six-hour budget per rolling 24 hours on Android 15+; `connectedDevice` has none.
 * The link was claiming `dataSync` on every start the user drove, for a service that runs all day.
 * So the main fix is that **no start route claims `dataSync` any more** ([LinkAutoStart.foregroundTypesFor])
 * and the manifest no longer declares it, which makes it impossible to claim by accident: a type
 * outside the manifest throws instead of quietly starting a six-hour clock.
 *
 * This file is the other half, for the case that should now be unreachable: if the platform ever
 * times out a type this service holds, stop **promptly** (the platform allows a few seconds), close
 * the link with a sentence that says why, and do not let an automatic route start it straight back.
 * Catching the crash or relying on `START_STICKY` would be neither — the first hides it and the
 * second is the loop.
 */
object LinkTimeout {

    /** A name for a foreground-service type, for the log and the sentence. */
    fun typeName(fgsType: Int): String = when (fgsType) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC -> "dataSync"
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING -> "mediaProcessing"
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE -> "shortService"
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE -> "connectedDevice"
        else -> "type 0x${fgsType.toString(16)}"
    }

    /**
     * What the phone says about the interruption — on the link's state, in the notification, and in
     * the session close. It names the platform as the actor (defect 104: a stop Android caused is not
     * worded as one the owner caused) and the one thing that brings the link back.
     */
    fun interruptedSentence(fgsType: Int): String =
        "Android stopped the connection to your Mac: its time limit for ${typeName(fgsType)} " +
            "background work ran out. Open Sidekick to reconnect."
}

/**
 * Whether a timeout has happened in this process, so that the automatic start routes do not restart
 * the link behind it.
 *
 * Process-lifetime and in memory only: no new stored state. That is enough for the loop it exists to
 * stop — the routes that could restart the service without a person (the notification-listener and
 * accessibility rebinds) run in this same process — and a new process starts with no record, which is
 * correct because the routes into a new process are a reboot, an update or a crash, none of them a
 * timer firing again.
 *
 * Cleared only when the app is visible: that is the moment the platform documents as resetting the
 * budget, and it is a person asking for the link.
 */
class LinkTimeoutLatch {

    data class TimedOut(val fgsType: Int, val atMillis: Long)

    @Volatile
    private var timedOut: TimedOut? = null

    /** Records a timeout. Returns whether this is the first since the last clear. */
    @Synchronized
    fun record(fgsType: Int, atMillis: Long): Boolean {
        if (timedOut != null) return false
        timedOut = TimedOut(fgsType, atMillis)
        return true
    }

    fun current(): TimedOut? = timedOut

    /** Clears it; returns what was cleared, or null if there was nothing to clear. */
    @Synchronized
    fun clear(): TimedOut? = timedOut.also { timedOut = null }

    companion object {
        /** The one this process uses. Tests construct their own. */
        val process = LinkTimeoutLatch()

        /**
         * Whether a start command means a person is asking for the link: a start the user drove, or any
         * start while one of our Activities is visible (`MainActivity.onResume` re-enters the service
         * through a capabilities refresh, which carries no reason).
         */
        fun clearsOn(reason: LinkStartReason, appVisible: Boolean): Boolean =
            reason == LinkStartReason.USER || appVisible
    }
}

/**
 * The service's reaction to `Service.onTimeout(startId, fgsType)`, with every effect injected so a
 * JVM test runs this exact sequence rather than a copy of it. `LinkService` supplies the real effects.
 *
 * Order is the point: **stop first**, then clean up. The platform's deadline is a few seconds and
 * nothing in the cleanup is allowed to stand between the callback and `stopSelf`, so a cleanup step
 * that throws is logged and the next one still runs.
 */
class LinkTimeoutStop(
    private val latch: LinkTimeoutLatch,
    /** Demotes and stops the service: `stopForeground(REMOVE)` then `stopSelf()`. */
    private val stopService: () -> Unit,
    /** Closes every live session and the listeners, recording [String] as the link's reason. */
    private val closeLink: (String) -> Unit,
    /** Releases the wake and Wi-Fi locks. */
    private val releaseLocks: () -> Unit,
    /** Tells the person, in a notification that outlives the service. */
    private val showInterrupted: (String) -> Unit,
    private val log: (String) -> Unit,
    private val now: () -> Long,
) {
    private var cleanedUp = false
    private var callbacks = 0

    /** Returns whether this call did the cleanup (false on a repeat: the stop is still re-requested). */
    fun onTimeout(startId: Int, fgsType: Int): Boolean {
        callbacks++
        val first = latch.record(fgsType, now())
        runStep("stop the service") { stopService() }
        if (cleanedUp) {
            log(
                "Foreground-service timeout for ${LinkTimeout.typeName(fgsType)} again (startId=$startId, " +
                    "$callbacks callback(s)) — stop re-requested, cleanup already done",
            )
            return false
        }
        cleanedUp = true
        val sentence = LinkTimeout.interruptedSentence(fgsType)
        runStep("close the link") { closeLink(sentence) }
        runStep("release the locks") { releaseLocks() }
        runStep("show the interruption") { showInterrupted(sentence) }
        log(
            "Foreground-service timeout for ${LinkTimeout.typeName(fgsType)} (startId=$startId): service " +
                "stopped, sessions closed, automatic restarts held until Sidekick is opened" +
                if (first) "" else " (the latch was already set)",
        )
        return true
    }

    private fun runStep(what: String, step: () -> Unit) {
        try {
            step()
        } catch (e: Exception) {
            log("Timeout handling could not $what: ${e.javaClass.simpleName} — continuing with the rest")
        }
    }
}
