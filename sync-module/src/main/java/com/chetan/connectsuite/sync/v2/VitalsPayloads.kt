package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The `battery.state` and `storage.state` payloads, built without touching Android.
 *
 * Pure on purpose, and it is the rule this module already carries: a JVM test that merely
 * *references* an object holding an Android static in a field initializer dies with
 * `ExceptionInInitializerError` — `SmsStore` does. So the shaping lives here and the reading lives
 * in `VitalsFeature`, the same split `SmsPayloads` and `CallWatcher.dispositionOf` came out of.
 */
object VitalsPayloads {

    /**
     * Battery, as the contract defines it.
     *
     * `capacityUnknown` is carried **as its own field** rather than left for the Mac to infer from a
     * null `level`. Two readers inferring the same thing from an absence is how "no folders" and
     * "could not read folders" became one picture, and this is the same shape one message earlier:
     * an unknown battery and a flat battery must not draw the same ring.
     */
    fun battery(level: Int?, charging: Boolean): JsonObject = buildJsonObject {
        // Clamped rather than trusted. A platform that answers 105 or -1 exists, and a ring drawn
        // from an unclamped value silently overflows its own arc.
        val clamped = level?.coerceIn(0, 100)
        if (clamped == null) put("level", JsonNull) else put("level", clamped)
        put("charging", charging)
        put("capacityUnknown", level == null)
    }

    /**
     * Storage of the **shared** volume, never this app's private directory.
     *
     * A person reading "12 GB free" means their phone. Reporting the sandbox would be a true number
     * answering a question nobody asked — the units rule, one level up: both sides have to be
     * measuring the same thing before the number means anything.
     *
     * Either value may be null, and **null is not zero**: a refused `StatFs` and a genuinely full
     * disk are different sentences.
     */
    fun storage(freeBytes: Long?, totalBytes: Long?): JsonObject = buildJsonObject {
        val free = freeBytes?.takeIf { it >= 0 }
        val total = totalBytes?.takeIf { it > 0 }
        if (free == null) put("freeBytes", JsonNull) else put("freeBytes", free)
        if (total == null) put("totalBytes", JsonNull) else put("totalBytes", total)
    }

    /**
     * Is this battery reading worth sending?
     *
     * The level ticks constantly and a push per percent is 100 messages an hour for a ring nobody is
     * watching that closely. A change of **charging** is always worth it — it is the one the user
     * causes and expects to see — and a level change only at a whole percent.
     *
     * Separated out so the *decision* is testable without a `BroadcastReceiver`: defect 67's lesson
     * is that a rule can be correct while the write that feeds it is wrong, and a rule nobody can
     * call from a test is the wrong half to leave in an Android class.
     */
    fun batteryChanged(previous: Pair<Int?, Boolean>?, level: Int?, charging: Boolean): Boolean {
        if (previous == null) return true
        val (heldLevel, heldCharging) = previous
        return heldLevel != level || heldCharging != charging
    }
}
