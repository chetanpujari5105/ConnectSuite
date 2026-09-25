package com.chetan.connectsuite.sync.v2

/**
 * **Version 3 — PROPOSED, reachable only at a negotiated `share.file` 3, which neither side
 * advertises.** Whether one more private
 * copy may start while others are already held for live offers: docs/protocol.md → Share → Version 3
 * §4, argued in docs/feature-a-multi-offer-proposal.md rev 3 §4.
 *
 * - A file is admitted when its copy is **about to start**, because the copy is what uses the space.
 * - [held] is `Σ`, the bytes of copies that already exist for live offers. They are **already absent
 *   from [free]**, so they are counted in the margin and never subtracted a second time (rev 3's R2).
 * - The margin is [ShareStaging.margin] over `Σ + s` — the proven version-2 rule, through the same
 *   function, so with nothing held this is exactly [ShareStaging.preflight].
 * - [cap] is `C`, a bound on the **total** of private copies held **at once**. **No value is approved**,
 *   so it is nullable and nothing here supplies one: `null` means *not approved*, and then a second
 *   concurrent copy is refused ([Verdict.CapNotApproved]) — multi-offer admission stays off until a
 *   measured value is approved. A file alone (`Σ = 0`) is never refused by it, approved or not: it
 *   bounds concurrency, never how large one file may be. There is no fixed per-file size.
 *
 * Space is judged first, so the reason reported is the one that actually stops the copy.
 */
object ShareAdmission {

    sealed interface Verdict {
        data object Admit : Verdict
        /** `needed` is `s + M(Σ + s)`; [free] is what the device reported. */
        data class NoSpace(val size: Long, val held: Long, val free: Long, val needed: Long) : Verdict
        /** Copies already held plus this one would exceed the cap. */
        data class OverCap(val size: Long, val held: Long, val cap: Long) : Verdict
        /** Copies are already held and no cap has been approved: no second concurrent copy. */
        data class CapNotApproved(val size: Long, val held: Long) : Verdict
    }

    fun admit(size: Long, held: Long, free: Long, cap: Long?): Verdict {
        require(size >= 0) { "size is ≥ 0" }
        require(held >= 0) { "held is ≥ 0" }
        require(cap == null || cap >= 0) { "cap is ≥ 0" }
        // addExact: a total that overflows is a caller bug and is refused, never wrapped into a small number.
        val total = Math.addExact(held, size)
        val needed = Math.addExact(size, ShareStaging.margin(total))
        if (needed > free) return Verdict.NoSpace(size, held, free, needed)
        if (held > 0 && cap == null) return Verdict.CapNotApproved(size, held)
        if (held > 0 && total > cap!!) return Verdict.OverCap(size, held, cap)
        return Verdict.Admit
    }

    /**
     * **The approved cap `C` on private copies held at once. There is none** — the owner has not
     * approved a measured rule (docs/feature-a-multi-offer-proposal.md rev 3 §4). So at version 3 a
     * second concurrent copy is refused with [Copy.CapNotApproved]: multi-offer admission stays off.
     * Do not put 4 GiB, 8.13 GB or any other figure here without that approval.
     */
    val APPROVED_CAP: Long? = null

    /** What the share sheet does before its copy starts. */
    sealed interface Copy {
        /** Start; the copy is bounded by [limit] bytes. */
        data class Go(val limit: Long) : Copy
        /** Not enough space. [expected] is null when the provider gave no size; [needed] is what would have been required. */
        data class NoSpace(val expected: Long?, val free: Long, val needed: Long) : Copy
        /** Copies are held for live offers and no cap is approved: no second concurrent copy (version 3 only). */
        data class CapNotApproved(val held: Long) : Copy
        /** Copies held plus this one would pass the approved cap (version 3 only). */
        data class OverCap(val held: Long, val cap: Long) : Copy
    }

    /**
     * The admission the sheet runs **immediately before its copy starts** — one function, so the
     * version split has one home a test can call.
     *
     * - **Below version 3, or with nothing held (`Σ = 0`), this is exactly [ShareStaging.preflight]**
     *   — the rule proven on hardware. With nothing held the version-3 rule reduces to it (the margin
     *   over `0 + s` is the margin over `s`, and a file alone is never refused by the cap).
     * - At version 3 with copies held: refused as [Copy.CapNotApproved] while [cap] is null; otherwise
     *   [admit] for a known size, and for an unknown size a bound `s` with `s + M(Σ + s) ≤ free` and
     *   `Σ + s ≤ cap`, enforced by the copy itself.
     *
     * [held] is `Σ`, the bytes of copies that exist for live offers — already absent from [free].
     */
    fun forCopy(negotiatedVersion: Int, expected: Long?, held: Long, free: Long, cap: Long?): Copy {
        require(held >= 0) { "held is ≥ 0" }
        if (negotiatedVersion < ShareOffer.QUEUE_VERSION || held == 0L) {
            return when (val pre = ShareStaging.preflight(expected, free)) {
                is ShareStaging.Preflight.Go -> Copy.Go(pre.limit)
                is ShareStaging.Preflight.NoSpace -> Copy.NoSpace(pre.expected, pre.available, pre.needed)
            }
        }
        if (cap == null) return Copy.CapNotApproved(held)
        if (expected != null) {
            return when (val v = admit(expected, held, free, cap)) {
                Verdict.Admit -> Copy.Go(minOf(limitOver(held, free), cap - held))
                is Verdict.NoSpace -> Copy.NoSpace(expected, free, v.needed)
                is Verdict.OverCap -> Copy.OverCap(held, cap)
                is Verdict.CapNotApproved -> Copy.CapNotApproved(held)
            }
        }
        if (held >= cap) return Copy.OverCap(held, cap)
        val limit = minOf(limitOver(held, free), cap - held)
        return if (limit > 0) Copy.Go(limit) else Copy.NoSpace(null, free, ShareStaging.margin(held) + 1)
    }

    /** The largest `s` with `s + M(Σ + s) ≤ free` — [ShareStaging.limit] with the margin taken over everything held. */
    fun limitOver(held: Long, free: Long): Long {
        if (free <= 0) return 0
        var lo = 0L
        var hi = free
        while (lo < hi) {
            val mid = lo + (hi - lo + 1) / 2
            if (mid + ShareStaging.margin(held + mid) <= free) lo = mid else hi = mid - 1
        }
        return if (lo + ShareStaging.margin(held + lo) <= free) lo else 0
    }
}
