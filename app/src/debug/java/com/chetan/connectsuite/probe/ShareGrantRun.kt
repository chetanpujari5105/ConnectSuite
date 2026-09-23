package com.chetan.connectsuite.probe

/**
 * The state and lifetime rules of the URI-grant experiment in `docs/phase-7-share-proposal.md` §4,
 * with nothing Android in it so a JVM test can reach every transition.
 *
 * The question the run answers: after the activity that received an `ACTION_SEND` is destroyed,
 * can this process — held alive by the foreground `LinkService` — still open the shared URI?
 *
 * ### What makes a reading exist
 *
 *  - **The control comes first and gates everything.** A read inside the receiving activity, before
 *    `finish()`, must succeed. If it does not, a later failure says nothing about grant lifetime —
 *    the URI was never readable — so no reading is scheduled and the run reports `no reading`.
 *  - **Readings are timed from destruction, not from receipt.** `onDestroy` is the event the
 *    question is about; timing from `onCreate` would fold the time the control read took into every
 *    interval and could put the first reading before the activity was gone.
 *  - **A reading that never happened is not a failure.** If the process dies between readings, the
 *    missing ones are reported as missing, and the verdict is `no reading` — never `fail`. That is
 *    the sampling rule in `CLAUDE.md`: a window nobody sampled holds no reading in either direction.
 *
 * ### What it will not carry
 *
 * The line format is built from typed fields only — authority, case, elapsed time, outcome,
 * exception **class**, byte count, digest. There is no field a full URI, a path or a provider's
 * display name could travel in, which is the point: a probe that is careful about what it logs is
 * one refactor from logging the URI, and a probe that *cannot* is not.
 */
object ShareGrantRun {

    /** Offsets after the receiving activity's `onDestroy`, in the order §4 names them. */
    val READING_OFFSETS_MS: List<Long> = listOf(1_000L, 30_000L, 120_000L)

    enum class Case { MEDIA, FILE }

    /** `image/…` and `video/…` are the Gallery/MediaStore case; anything else is the file case. */
    fun caseOf(mime: String?): Case =
        if (mime != null && (mime.startsWith("image/") || mime.startsWith("video/"))) Case.MEDIA else Case.FILE

    data class Control(val ok: Boolean, val bytes: Long, val sha256: String?, val exceptionClass: String?)

    data class Reading(
        val offsetMs: Long,
        val elapsedMs: Long,
        val ok: Boolean,
        val bytes: Long,
        val sha256: String?,
        val exceptionClass: String?,
        /** Whether the foreground `LinkService` was running in this process when the read happened. */
        val linkServiceForeground: Boolean,
    )

    enum class Verdict { PASS, FAIL, NO_READING }

    data class State(
        val authority: String,
        val case: Case,
        val control: Control? = null,
        val destroyedAtMs: Long? = null,
        val readings: List<Reading> = emptyList(),
    ) {
        /** Readings are owed only once the control passed and the activity is gone. */
        fun owedOffsets(): List<Long> =
            if (control?.ok == true && destroyedAtMs != null) {
                READING_OFFSETS_MS.filter { offset -> readings.none { it.offsetMs == offset } }
            } else {
                emptyList()
            }

        fun afterControl(result: Control): State {
            check(control == null) { "the control is read once" }
            check(destroyedAtMs == null) { "the control is read before the activity is destroyed" }
            return copy(control = result)
        }

        fun afterDestroyed(nowMs: Long): State {
            check(destroyedAtMs == null) { "an activity is destroyed once" }
            return copy(destroyedAtMs = nowMs)
        }

        fun afterReading(offsetMs: Long, nowMs: Long, result: Reading): State {
            val destroyed = checkNotNull(destroyedAtMs) { "no reading before the activity is destroyed" }
            check(control?.ok == true) { "no reading after a failed control" }
            check(offsetMs in owedOffsets()) { "reading at +${offsetMs}ms is not owed" }
            check(nowMs >= destroyed + offsetMs) { "reading at +${offsetMs}ms taken early" }
            return copy(readings = readings + result.copy(offsetMs = offsetMs, elapsedMs = nowMs - destroyed))
        }

        /**
         * PASS only when the control passed and **every** interval was read and opened, in a process
         * that the foreground `LinkService` was holding — the configuration §4 asks about. A read in a
         * process with no foreground service would be answering a different question.
         */
        fun verdict(): Verdict = when {
            control?.ok != true -> Verdict.NO_READING
            readings.any { !it.ok } -> Verdict.FAIL
            owedOffsets().isNotEmpty() -> Verdict.NO_READING
            readings.any { !it.linkServiceForeground } -> Verdict.NO_READING
            else -> Verdict.PASS
        }
    }

    fun controlLine(state: State): String {
        val c = state.control
        return "control authority=${state.authority} case=${state.case} " +
            if (c == null) {
                "ok=not-read"
            } else if (c.ok) {
                "ok=true bytes=${c.bytes} sha256=${c.sha256}"
            } else {
                "ok=false exception=${c.exceptionClass}"
            }
    }

    fun readingLine(state: State, r: Reading): String =
        "reading authority=${state.authority} case=${state.case} offset=+${r.offsetMs}ms " +
            "elapsed=${r.elapsedMs}ms linkServiceForeground=${r.linkServiceForeground} " +
            if (r.ok) "ok=true bytes=${r.bytes} sha256=${r.sha256}" else "ok=false exception=${r.exceptionClass}"

    fun verdictLine(state: State): String =
        "verdict authority=${state.authority} case=${state.case} verdict=${state.verdict()} " +
            "readings=${state.readings.size} of ${READING_OFFSETS_MS.size} " +
            "missing=${state.owedOffsets().joinToString(",") { "+${it}ms" }.ifEmpty { "none" }}"
}
