package com.chetan.connectsuite.probe

/**
 * The rules of the **`SEND_MULTIPLE` URI-grant measurement** owed by docs/feature-a-multi-offer-proposal.md
 * rev 4 §11 — the several-files sibling of [ShareGrantRun], with nothing Android in it so a JVM test reaches
 * every transition. **Debug source set only; the activity that uses it is registered `enabled="false"`.**
 *
 * ### The questions, each its own phase
 *
 * | Phase | When | §11 asks |
 * |---|---|---|
 * | [Phase.CONTROL] | every item, read inside the live activity, before anything else | can this item be read at all? |
 * | [Phase.STOPPED] | +1 s, +30 s after the **first** `onStop` that is neither a finish nor a configuration change | does a grant outlive a stopped, **unfinished** screen? |
 * | [Phase.RECREATED] | once, in the instance a configuration change creates | does it survive a recreation? |
 * | [Phase.FINISHED] | +1 s, +30 s, +120 s after `onDestroy` of the finishing activity | does it outlive the finished screen? |
 *
 * Plus the **intake facts** (§11 *unknown 1*): how many `EXTRA_STREAM` and `ClipData` items arrived, whether
 * every stream is also in the `ClipData` (the grant covers the `ClipData`'s URIs), and whether the intent
 * carried `FLAG_GRANT_READ_URI_PERMISSION`.
 *
 * ### What makes a reading exist — the same rules as [ShareGrantRun], and three more
 *
 * - **The control gates everything, per item.** An item whose control failed has no later reading.
 * - **Readings are timed from the event they are about** — the stop, or the destroy — never from receipt.
 * - **A reading that never happened is missing, never a refusal.** A stopped reading whose screen came
 *   back first is **not taken** (the question was about a stopped screen); the verdict is `NO_READING`.
 * - **A read that hit the probe's own cap ([READ_CAP_BYTES]) is not a reading**, and its line says so.
 * - **A MediaStore item read while Sidekick holds a media permission is [Verdict.CONFOUNDED]:** the read
 *   may succeed on the permission, not the grant (§11, Samsung Gallery row). Its readings are still logged.
 * - **After finish, a reading counts only with the foreground `LinkService` running in this process**, as
 *   for [ShareGrantRun]: without it the process may not be the one production reads from.
 *
 * ### What it can prove, and what it cannot
 *
 * - It says what **one sending app, on one device, on that day's build of that app** did with **the items
 *   actually shared**, at the sampled instants only. A grant that lapses between two samples is seen at
 *   the second; *readable at +120 s* says nothing about +121 s.
 * - **It cannot supply its own stimulus.** A URI from this app's own provider is readable by this uid with
 *   no grant at all — a round trip, not a grant reading — so every reading needs another app to share into
 *   it: on the SM-S938B that is Samsung Gallery or My Files, the owner's taps. **Nothing here proves any
 *   Samsung behaviour until it has been run there**, and an emulator run is emulator evidence only.
 * - It does not test [com.chetan.connectsuite.sync.v2.ShareManyQueue]: that the several-files screen opens
 *   nothing after it closes is the queue's open gate, tested there. This measures whether a read *would*
 *   have worked, which decides only whether lifecycle option B could ever be considered (§11).
 *
 * ### What it will not carry
 *
 * Lines are built from typed fields only: an index, an authority, a phase, offsets, `ok`, an exception
 * **class**, a byte count, a digest. There is no field a URI, a path or a display name could travel in.
 */
object ShareManyGrantRun {

    /** The probe's own bound on items, printed in every intake line. Over it the share is refused whole. */
    const val MAX_ITEMS = 10

    /** The probe's own bound on one read. A capped read is not a reading. Synthetic stimuli are < 1 MiB. */
    const val READ_CAP_BYTES = 16L * 1024 * 1024

    val STOPPED_OFFSETS_MS: List<Long> = listOf(1_000L, 30_000L)
    val RECREATED_OFFSETS_MS: List<Long> = listOf(0L)
    val FINISHED_OFFSETS_MS: List<Long> = listOf(1_000L, 30_000L, 120_000L)

    const val SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE"

    enum class Phase { CONTROL, STOPPED, RECREATED, FINISHED }

    fun offsets(phase: Phase): List<Long> = when (phase) {
        Phase.CONTROL -> listOf(0L)
        Phase.STOPPED -> STOPPED_OFFSETS_MS
        Phase.RECREATED -> RECREATED_OFFSETS_MS
        Phase.FINISHED -> FINISHED_OFFSETS_MS
    }

    /** What the intent itself said — counts and flags only. */
    data class Intake(
        val action: String?,
        val type: String?,
        val extraStreams: Int,
        val clipItems: Int,
        /** `ClipData` items that carry a URI (the others carry text or an intent). */
        val clipUris: Int,
        /** Every `EXTRA_STREAM` URI is also a `ClipData` URI — the grant is over the `ClipData`'s. Null with no streams. */
        val streamsAllInClip: Boolean?,
        val grantReadFlag: Boolean,
        val mediaPermissionHeld: Boolean,
    )

    /** One shared item: where it answered from and whether its reads can be about the grant. */
    data class Item(val index: Int, val scheme: String?, val authority: String, val inClipData: Boolean)

    sealed interface Admit {
        data class Go(val items: List<Item>) : Admit
        data class Refuse(val why: String) : Admit
    }

    /**
     * Taken or refused as a whole, before any read: only a `SEND_MULTIPLE` of 1…[MAX_ITEMS] `content:` URIs.
     * Streams come from `EXTRA_STREAM` when it has any, else from the `ClipData`, as the screen reads them.
     */
    fun admit(intake: Intake, items: List<Item>): Admit = when {
        intake.action != SEND_MULTIPLE -> Admit.Refuse("not a SEND_MULTIPLE")
        items.isEmpty() -> Admit.Refuse("no streams")
        items.size > MAX_ITEMS -> Admit.Refuse("${items.size} items, over the probe's bound of $MAX_ITEMS — nothing read")
        items.any { !"content".equals(it.scheme, ignoreCase = true) } ->
            Admit.Refuse("item ${items.first { !"content".equals(it.scheme, ignoreCase = true) }.index + 1} is not a content: URI — nothing read")
        else -> Admit.Go(items)
    }

    /** MediaStore answers as `media`; only it can be opened by a media permission instead of the grant. */
    fun confounded(item: Item, intake: Intake): Boolean = intake.mediaPermissionHeld && item.authority == "media"

    data class Read(val ok: Boolean, val bytes: Long, val sha256: String?, val exceptionClass: String?, val capped: Boolean = false)

    data class Reading(
        val phase: Phase,
        val offsetMs: Long,
        val elapsedMs: Long,
        val item: Int,
        val read: Read,
        val linkServiceForeground: Boolean,
    )

    enum class Verdict { READABLE, REFUSED, CHANGED, NO_READING, CONFOUNDED }

    data class State(
        val intake: Intake,
        val items: List<Item>,
        val controls: Map<Int, Read> = emptyMap(),
        /** The first qualifying stop; null before it. Only that stop is measured. */
        val stoppedAtMs: Long? = null,
        /** The screen came back after that stop: owed stopped readings from then on are not taken. */
        val restartedAtMs: Long? = null,
        val recreated: Boolean = false,
        val destroyedAtMs: Long? = null,
        val readings: List<Reading> = emptyList(),
    ) {
        val controlsDone: Boolean get() = controls.size == items.size

        private fun passed(i: Int) = controls[i]?.let { it.ok && !it.capped } == true

        fun afterControl(item: Int, read: Read): State {
            check(item in items.indices) { "no item $item" }
            check(item !in controls) { "item $item's control is read once" }
            check(stoppedAtMs == null && destroyedAtMs == null) { "the control is read while the screen is alive" }
            return copy(controls = controls + (item to read))
        }

        /**
         * The first stop that is neither a finish nor a configuration change. Measured only after every
         * control is done — a stop before then is not the stopped state §11 asks about.
         */
        fun afterStopped(nowMs: Long): State =
            if (stoppedAtMs != null || destroyedAtMs != null || !controlsDone) this else copy(stoppedAtMs = nowMs)

        fun afterRestarted(nowMs: Long): State =
            if (stoppedAtMs == null || restartedAtMs != null || destroyedAtMs != null) this else copy(restartedAtMs = nowMs)

        fun afterRecreated(): State = if (!controlsDone || destroyedAtMs != null) this else copy(recreated = true)

        fun afterDestroyed(nowMs: Long): State {
            check(destroyedAtMs == null) { "an activity is finished once" }
            return copy(destroyedAtMs = nowMs)
        }

        /** The event a phase's offsets are timed from, or null when the phase has not begun. */
        fun originOf(phase: Phase): Long? = when (phase) {
            Phase.CONTROL -> null
            Phase.STOPPED -> stoppedAtMs
            Phase.RECREATED -> if (recreated) 0L else null
            Phase.FINISHED -> destroyedAtMs
        }

        /** (phase, offset, item) still owed. A stopped reading after the screen came back is not owed. */
        fun owed(phase: Phase): List<Pair<Long, Int>> {
            if (phase == Phase.CONTROL || originOf(phase) == null) return emptyList()
            return offsets(phase).flatMap { off -> items.indices.filter { passed(it) }.map { off to it } }
                .filter { (off, i) -> readings.none { it.phase == phase && it.offsetMs == off && it.item == i } }
                .filter { (off, _) -> phase != Phase.STOPPED || restartedAtMs == null || stoppedAtMs!! + off < restartedAtMs }
        }

        /** Whether a stopped reading due at [offsetMs] can still be taken — the screen has not come back. */
        fun stoppedStillHolds(offsetMs: Long): Boolean =
            stoppedAtMs != null && destroyedAtMs == null && (restartedAtMs == null || stoppedAtMs + offsetMs < restartedAtMs)

        fun afterReading(phase: Phase, offsetMs: Long, nowMs: Long, item: Int, read: Read, linkServiceForeground: Boolean): State {
            check(phase != Phase.CONTROL) { "the control is afterControl's" }
            check((offsetMs to item) in owed(phase)) { "$phase +${offsetMs}ms item $item is not owed" }
            val origin = checkNotNull(originOf(phase))
            val elapsed = if (phase == Phase.RECREATED) 0L else nowMs - origin
            check(phase == Phase.RECREATED || elapsed >= offsetMs) { "$phase +${offsetMs}ms taken early" }
            return copy(readings = readings + Reading(phase, offsetMs, elapsed, item, read, linkServiceForeground))
        }

        /**
         * One item's verdict for one phase. `CHANGED`: readable at an earlier offset and refused at a later
         * one — a lapse between two samples. Missing, capped, or (after finish) no foreground `LinkService`:
         * `NO_READING`, never `REFUSED`.
         */
        fun verdict(phase: Phase, item: Int): Verdict {
            val control = controls[item] ?: return Verdict.NO_READING
            if (!control.ok || control.capped) return Verdict.NO_READING
            if (confounded(items[item], intake)) return Verdict.CONFOUNDED
            if (phase == Phase.CONTROL) return Verdict.READABLE
            if (originOf(phase) == null) return Verdict.NO_READING
            val rs = readings.filter { it.phase == phase && it.item == item }.sortedBy { it.offsetMs }
            if (rs.size < offsets(phase).size) return Verdict.NO_READING
            if (rs.any { it.read.capped }) return Verdict.NO_READING
            if (phase == Phase.FINISHED && rs.any { !it.linkServiceForeground }) return Verdict.NO_READING
            return when {
                rs.all { it.read.ok } -> Verdict.READABLE
                rs.none { it.read.ok } -> Verdict.REFUSED
                rs.dropWhile { it.read.ok }.none { it.read.ok } -> Verdict.CHANGED
                // Refused, then readable again: not a lapse; the samples disagree with each other.
                else -> Verdict.NO_READING
            }
        }
    }

    // ---- lines: typed fields only -----------------------------------------------------------------

    fun intakeLine(i: Intake, items: List<Item>): String =
        "intake action=${if (i.action == SEND_MULTIPLE) "SEND_MULTIPLE" else "other"} type=${i.type ?: "none"} " +
            "extraStreams=${i.extraStreams} clipItems=${i.clipItems} clipUris=${i.clipUris} " +
            "streamsAllInClip=${i.streamsAllInClip ?: "n/a"} grantReadFlag=${i.grantReadFlag} " +
            "mediaPermissionHeld=${i.mediaPermissionHeld} items=${items.size} (probe bound $MAX_ITEMS items, " +
            "${READ_CAP_BYTES / (1024 * 1024)} MiB per read) authorities=${items.map { it.authority }.distinct().joinToString(",")}"

    fun readLine(state: State, phase: Phase, offsetMs: Long, elapsedMs: Long, item: Int, r: Read, foreground: Boolean?): String {
        val it = state.items[item]
        return "reading phase=$phase item=${item + 1}/${state.items.size} authority=${it.authority} inClipData=${it.inClipData} " +
            "offset=+${offsetMs}ms elapsed=${elapsedMs}ms" + (foreground?.let { " linkServiceForeground=$it" } ?: "") + " " +
            when {
                r.capped -> "ok=capped bytes>=${r.bytes} (the probe's ${READ_CAP_BYTES / (1024 * 1024)} MiB bound — not a reading)"
                r.ok -> "ok=true bytes=${r.bytes} sha256=${r.sha256}"
                else -> "ok=false exception=${r.exceptionClass}"
            }
    }

    /** A stopped reading that was due after the screen came back. It is missing, and says why. */
    fun notTakenLine(state: State, offsetMs: Long, item: Int): String =
        "not taken phase=STOPPED item=${item + 1}/${state.items.size} offset=+${offsetMs}ms — the screen came back " +
            "before it was due; missing, not a refusal"

    fun verdictLine(state: State, phase: Phase): String =
        "verdict phase=$phase " + state.items.indices.joinToString(" ") { i ->
            "item${i + 1}=${state.verdict(phase, i)}" + if (phase != Phase.CONTROL) {
                val n = state.readings.count { r -> r.phase == phase && r.item == i }
                "(${n}/${offsets(phase).size})"
            } else ""
        }
}
