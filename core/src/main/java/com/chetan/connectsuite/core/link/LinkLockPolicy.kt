package com.chetan.connectsuite.core.link

/**
 * The two numbers that decide whether `LinkService`'s wake lock survives a long connection.
 *
 * They live together, in their own file, for one reason: **they are only correct relative to each
 * other**, and the thing that went wrong in defect 61 was a relationship, not a value. A twelve-hour
 * timeout was perfectly safe on its own; it was fatal in combination with a re-arm that never
 * happened. A future tuning edit that halves one and not the other reintroduces exactly that, and it
 * would do so silently — nothing crashes, nothing logs, the lock simply stops being held some hours
 * into a healthy connection.
 *
 * So the relationship is asserted by a test rather than explained by a comment, because a comment is
 * what failed the first time: the field this replaces carried the words *"re-armed on every state
 * change"* directly above code that did not re-arm.
 *
 * **Why an hour rather than twelve.** The timeout is a backstop against a release path that is
 * missed, and its cost is how long a leaked lock survives. Twelve hours of a stray
 * `PARTIAL_WAKE_LOCK` is an overnight battery complaint; one hour is a rounding error. Nothing is
 * lost by shortening it once the re-arm actually works, and this project has already shipped a
 * capture session that outlived its consumer, so the backstop is not hypothetical.
 */
object LinkLockPolicy {

    /** How long a single `acquire()` is good for before the platform drops it. */
    const val TIMEOUT_MS = 60L * 60 * 1000

    /** How often the service checks the lock is still held, while a client is connected. */
    const val REARM_INTERVAL_MS = 20L * 60 * 1000

    /**
     * The margin the re-arm must beat the timeout by.
     *
     * Not `REARM < TIMEOUT`, which is satisfied by 59 minutes against 60 and would leave the lock
     * lapsed for whatever a slow tick, a doze deferral or a dispatch delay costs. Three re-arm
     * opportunities inside one timeout means two of them can be missed entirely.
     */
    const val MIN_REARMS_PER_TIMEOUT = 3
}
