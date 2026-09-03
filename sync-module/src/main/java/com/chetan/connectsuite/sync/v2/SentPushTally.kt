package com.chetan.connectsuite.sync.v2

import java.util.concurrent.atomic.AtomicLong

/**
 * What happened to an outgoing SMS the Mac is waiting to see, counted honestly.
 *
 * ### Defect 51: the retry reported a loss it did not suffer
 *
 * `pushNewestSent` looks three times at 150 ms for the row the provider is writing asynchronously.
 * When those three looks follow **our own send** and none finds it, the old code wrote an `E` line
 * saying *"the Mac's thread will be missing the message it just sent"* and incremented a counter
 * called `dropped`.
 *
 * **Both were wrong, and the evidence was in the same log.** The content observer fires afterwards
 * for the very row the looks were early for, `pushNewestSent` runs again with a different `why`, and
 * the message is delivered. Measured on 2026-08-31 during step 71: **2 of 2 Mac-origin sends** took
 * that path — an `E` and a `dropped` each, and both arrived on the Mac.
 *
 * So the miss is a **deferral, not a loss**. The look was early; the mechanism that covers it is the
 * observer, and it is part of the design rather than a lucky accident.
 *
 * ### Why this is a class and not two `AtomicLong`s at the call site
 *
 * Because the honest question spans two calls. *Was that miss ever made good?* cannot be answered
 * where the miss happens — only where the next push succeeds — and a counter that is incremented in
 * one place and never reconciled in another is exactly how `dropped` came to mean something nobody
 * intended.
 *
 * It is also the testable seam. `SmsFeature` needs a `Context`, a `ControlSession` and a live
 * `Telephony` provider; this needs nothing, so the *decision* is reachable by a JVM test even though
 * the *call site* is not. That limit is stated in `SentPushTallyTest` rather than implied.
 */
class SentPushTally {

    private val pushed = AtomicLong(0)
    private val deferred = AtomicLong(0)
    private val recovered = AtomicLong(0)

    /** Deferrals that have not yet been made good by a later push. */
    private val outstanding = AtomicLong(0)

    /** What a caller should say about this event. */
    enum class Outcome {
        /** An ordinary push. Nothing was owed. */
        DELIVERED,

        /**
         * A push that made good an earlier after-send miss.
         *
         * This is the event the old code could not represent, and it is the one that proves the
         * deferral was a deferral.
         */
        RECOVERED,

        /**
         * The looks after our own send found nothing **yet**.
         *
         * Not a loss: the observer has not fired. It becomes a loss only if nothing ever makes it
         * good, which is [outstanding] and is reported on every line so it cannot hide.
         */
        DEFERRED,
    }

    /** Three looks after our own send found nothing. */
    fun missedAfterSend(): Outcome {
        deferred.incrementAndGet()
        outstanding.incrementAndGet()
        return Outcome.DEFERRED
    }

    /**
     * A push succeeded.
     *
     * Any outstanding deferral is made good by it. They are not matched by row id on purpose: the
     * provider hands back the newest outgoing row, the deferral was for the newest outgoing row, and
     * a scheme that tried to pair them by id would be inventing a precision the provider's ordering
     * does not offer. Over-crediting is visible — `recovered` would exceed `deferred`, which is
     * asserted against — and under-crediting would leave a permanent phantom `outstanding`.
     */
    fun pushedNow(): Outcome {
        pushed.incrementAndGet()
        return if (outstanding.get() > 0 && outstanding.decrementAndGet() >= 0) {
            recovered.incrementAndGet()
            Outcome.RECOVERED
        } else {
            Outcome.DELIVERED
        }
    }

    /**
     * The line's tail, with every number that gives the others meaning.
     *
     * `outstanding` is the only one of these that is a genuine problem, and it is last because it is
     * the one somebody should read. A count of deferrals on its own reads as breakage; beside
     * `recovered` it reads as the retry doing its job.
     */
    fun summary(): String =
        "${pushed.get()} pushed / ${deferred.get()} deferred / ${recovered.get()} recovered / " +
            "${outstanding.get()} still owed"

    fun outstandingNow(): Long = outstanding.get()
    fun pushedCount(): Long = pushed.get()
    fun deferredCount(): Long = deferred.get()
    fun recoveredCount(): Long = recovered.get()
}
