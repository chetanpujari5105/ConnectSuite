package com.chetan.connectsuite.sync.v2

/**
 * **PROPOSED, and carrying no production value.** The budget for a *concurrent* private copy —
 * a staged file started while other staged copies are already held for live offers (version 3,
 * docs/feature-a-multi-offer-proposal.md §4). **One caller: [ShareAdmission]** (Stage 1), which asks it
 * only at a negotiated `share.file` 3 — reachable only through the debug-only version-3 arm — and only
 * when the caller supplies readings, which the share sheet does in a debuggable build alone. The values
 * it is given are [ShareAdmission.PROVISIONAL_DEV_CANDIDATE], approved for development only.
 *
 * ### The two rules, kept apart
 *
 * - **A file alone (`Σ = 0`) is not governed here.** [admit] answers [Verdict.NotConcurrent] and the
 *   proven version-2 rule ([ShareStaging.preflight]) decides alone, however large the file — whatever
 *   the quota, and even when every reading below is missing. The quota is never a file-size limit.
 * - **A concurrent copy (`Σ > 0`)** must fit two budgets, both read immediately before it starts and
 *   re-checked while it runs ([duringCopy]).
 *
 * ### The inputs, and what the quota is
 *
 * `Q` — `StorageManager.getCacheQuotaBytes`: the size above which the platform clears **this app's**
 * cache first when it needs space. An eviction-priority threshold that the platform recomputes from
 * use; **not** capacity, and **not** a reservation. `K` — this app's whole cache (its own-package
 * `cacheBytes`), which includes every staged copy. `Σ` — bytes of copies already held for other live
 * offers. `A` — usable bytes on the volume. `T` — the volume's total bytes.
 *
 * ```
 * N  = K − Σ − w                  this app's other cache (w: bytes of the copy being judged already written)
 * Bq = ⌊Q·num/den⌋ − N − Σ − w    quota budget: what may still be added, so all of the cache stays inside a fraction of Q
 * H  = ⌈T·perMille/1000⌉ + extra  free-space floor
 * Bs = largest x with x + M(Σ + w + x) ≤ A − H     M = ShareStaging.margin
 * ```
 *
 * Every value is a [Candidate] passed in: `num/den`, `perMille`, `extra` and the staleness bound. None
 * is a production constant, because none is approved.
 *
 * ### How it fails closed
 *
 * Any reading missing, not positive where it must be, older than the candidate's bound, from the
 * future, or inconsistent (`K` smaller than what is known to be in it) refuses the concurrent copy
 * with its own [Refusal]. Every sum and product is checked; an overflow is a refusal, never a wrapped
 * small number.
 */
object ShareConcurrentBudget {

    /** One snapshot of what the phone read. `null` means that reading was unavailable. */
    data class Readings(
        val quotaBytes: Long?,
        val ownCacheBytes: Long?,
        /** Σ: bytes of copies already held for OTHER live offers — never the copy being judged. */
        val heldBytes: Long,
        val usableBytes: Long?,
        val totalBytes: Long?,
        val readAtMs: Long,
    )

    /** Candidate policy values — passed in by the caller; none is approved. */
    data class Candidate(
        /** f = [quotaNumerator] / [quotaDenominator], the share of Q the whole cache may use. */
        val quotaNumerator: Long,
        val quotaDenominator: Long,
        /** The floor's proportional part, in thousandths of T (30 = 3%). */
        val floorPerMille: Long,
        /** The floor's fixed part, in bytes. */
        val floorExtraBytes: Long,
        /** Readings older than this are refused as stale. */
        val maxReadingAgeMs: Long,
    )

    enum class Refusal {
        CANDIDATE_INVALID, SIZE_INVALID, HELD_INVALID,
        READING_STALE, READING_FROM_THE_FUTURE,
        QUOTA_UNREADABLE, QUOTA_NOT_POSITIVE,
        OWN_CACHE_UNREADABLE, OWN_CACHE_BELOW_KNOWN,
        USABLE_UNREADABLE, TOTAL_UNREADABLE,
        OVER_QUOTA_BUDGET, OVER_SPACE_BUDGET,
        ARITHMETIC_OVERFLOW,
    }

    sealed interface Verdict {
        /** `Σ = 0`: not a concurrent copy. The version-2 rule decides alone; nothing here applies. */
        data object NotConcurrent : Verdict
        /** Go (or keep going). [limit] bounds what the copy may write in total: `min(Bq, Bs)`. */
        data class Admit(val limit: Long, val quotaBudget: Long, val spaceBudget: Long) : Verdict
        data class Refuse(val why: Refusal) : Verdict
    }

    /** Before a copy starts: may a file of [size] (null: the provider gave none) be staged now? */
    fun admit(size: Long?, r: Readings, c: Candidate, nowMs: Long): Verdict {
        if (size != null && size < 0) return Verdict.Refuse(Refusal.SIZE_INVALID)
        val budgets = when (val b = budgets(written = 0, r = r, c = c, nowMs = nowMs)) {
            is Budgets.Refused -> return b.verdict
            is Budgets.Ok -> b
        }
        val limit = minOf(budgets.quota, budgets.space)
        if (size == null) {
            // Unknown size: the copy itself enforces the limit. Nothing may be written at all → refuse now.
            if (limit > 0) return Verdict.Admit(limit, budgets.quota, budgets.space)
            return Verdict.Refuse(if (budgets.quota <= 0) Refusal.OVER_QUOTA_BUDGET else Refusal.OVER_SPACE_BUDGET)
        }
        if (size > budgets.quota) return Verdict.Refuse(Refusal.OVER_QUOTA_BUDGET)
        if (size > budgets.space) return Verdict.Refuse(Refusal.OVER_SPACE_BUDGET)
        return Verdict.Admit(limit, budgets.quota, budgets.space)
    }

    /**
     * While a concurrent copy runs, and once more when it finishes, with fresh readings: [written] bytes
     * of it are already in the cache (so already inside `K` and already out of `A`). Keep going only
     * while what is written still fits — a quota that dropped, a reading that vanished or went stale,
     * or free space that fell toward the floor all stop it. Admit's [Verdict.Admit.limit] is then what
     * the whole copy may reach.
     */
    fun duringCopy(written: Long, r: Readings, c: Candidate, nowMs: Long): Verdict {
        if (written < 0) return Verdict.Refuse(Refusal.SIZE_INVALID)
        return when (val b = budgets(written = written, r = r, c = c, nowMs = nowMs)) {
            is Budgets.Refused -> b.verdict
            is Budgets.Ok ->
                if (b.quota < 0) Verdict.Refuse(Refusal.OVER_QUOTA_BUDGET)
                else if (b.space < 0) Verdict.Refuse(Refusal.OVER_SPACE_BUDGET)
                else Verdict.Admit(written + minOf(b.quota, b.space), b.quota, b.space)
        }
    }

    /**
     * The measured `min(Bq, Bs)` for a copy not yet started — what a refusal states as *"this phone can
     * prepare only X more right now"*. At least 0. `null` when no measurement was possible: a missing,
     * stale, future or inconsistent reading, an invalid candidate, an overflow, or nothing held (then
     * this budget does not apply at all).
     */
    fun measuredLimit(r: Readings, c: Candidate, nowMs: Long): Long? =
        when (val b = budgets(written = 0, r = r, c = c, nowMs = nowMs)) {
            is Budgets.Refused -> null
            is Budgets.Ok -> maxOf(0L, minOf(b.quota, b.space))
        }

    /**
     * [measuredLimit] for the moment **after** a stopped copy's [written] bytes are deleted — what a
     * *Try again* would face with these readings. Those bytes are inside `K` and out of `A` when [r] was
     * read, so they come back out of the one and into the other; nothing else moves. `null` exactly when
     * [measuredLimit] would be (a missing, stale, future or inconsistent reading), or when `K` is smaller
     * than what the partial alone holds, or an overflow.
     */
    fun limitAfterDiscarding(written: Long, r: Readings, c: Candidate, nowMs: Long): Long? {
        if (written < 0) return null
        if (written == 0L) return measuredLimit(r, c, nowMs)
        val k = r.ownCacheBytes ?: return null
        val a = r.usableBytes ?: return null
        if (k < written) return null
        val freed = try { Math.addExact(a, written) } catch (_: ArithmeticException) { return null }
        return measuredLimit(r.copy(ownCacheBytes = k - written, usableBytes = freed), c, nowMs)
    }

    // ---- the one place the arithmetic is done ----------------------------------------------------

    private sealed interface Budgets {
        data class Ok(val quota: Long, val space: Long) : Budgets
        data class Refused(val verdict: Verdict) : Budgets
    }

    private fun refused(why: Refusal) = Budgets.Refused(Verdict.Refuse(why))

    private fun budgets(written: Long, r: Readings, c: Candidate, nowMs: Long): Budgets {
        if (c.quotaDenominator <= 0 || c.quotaNumerator <= 0 || c.quotaNumerator > c.quotaDenominator ||
            c.floorPerMille !in 0..1000 || c.floorExtraBytes < 0 || c.maxReadingAgeMs <= 0
        ) return refused(Refusal.CANDIDATE_INVALID)
        if (r.heldBytes < 0) return refused(Refusal.HELD_INVALID)
        // A file alone: the version-2 rule governs — even with every reading missing.
        if (r.heldBytes == 0L) return Budgets.Refused(Verdict.NotConcurrent)
        if (r.readAtMs > nowMs) return refused(Refusal.READING_FROM_THE_FUTURE)
        if (nowMs - r.readAtMs > c.maxReadingAgeMs) return refused(Refusal.READING_STALE)
        val q = r.quotaBytes ?: return refused(Refusal.QUOTA_UNREADABLE)
        if (q <= 0) return refused(Refusal.QUOTA_NOT_POSITIVE)
        val k = r.ownCacheBytes ?: return refused(Refusal.OWN_CACHE_UNREADABLE)
        val a = r.usableBytes?.takeIf { it >= 0 } ?: return refused(Refusal.USABLE_UNREADABLE)
        val t = r.totalBytes?.takeIf { it > 0 } ?: return refused(Refusal.TOTAL_UNREADABLE)
        return try {
            val known = Math.addExact(r.heldBytes, written)
            if (k < known) return refused(Refusal.OWN_CACHE_BELOW_KNOWN)
            val other = k - known                                             // N
            val share = Math.floorDiv(Math.multiplyExact(q, c.quotaNumerator), c.quotaDenominator)
            val quota = Math.subtractExact(Math.subtractExact(share, other), known)   // Bq
            val floor = Math.addExact(ceilDiv(Math.multiplyExact(t, c.floorPerMille), 1000), c.floorExtraBytes)
            val room = Math.subtractExact(a, floor)                           // A − H
            Budgets.Ok(quota, spaceLimit(known, room))
        } catch (_: ArithmeticException) {
            refused(Refusal.ARITHMETIC_OVERFLOW)
        }
    }

    /** The largest x with x + M(known + x) ≤ room; −1 when even x = 0 does not fit. */
    private fun spaceLimit(known: Long, room: Long): Long {
        fun fits(x: Long) = Math.addExact(x, ShareStaging.margin(Math.addExact(known, x))) <= room
        if (room < 0 || !fits(0)) return -1
        var lo = 0L
        var hi = room
        while (lo < hi) {
            val mid = lo + (hi - lo + 1) / 2
            if (fits(mid)) lo = mid else hi = mid - 1
        }
        return lo
    }

    private fun ceilDiv(a: Long, b: Long): Long = -Math.floorDiv(-a, b)
}
