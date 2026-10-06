package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The half of `clip.*` with no Android in it: the payload shapes, the size cap and the history. The
 * echo rule is [ClipEcho]'s and is not restated here.
 *
 * Separate for the reason `CLAUDE.md` gives by name — a JVM test that merely *references* an object
 * holding an Android static in a field initializer dies with `ExceptionInInitializerError`, and the
 * answer is never `returnDefaultValues = true`. [ClipFeature] is the half that touches
 * `ClipboardManager`, and it is the only file in this namespace that names one.
 *
 * ### What the measurement changed here
 *
 * Nothing about these shapes, and that is worth saying. The wall reading (`docs/testing.md` →
 * Slice 11) decided *when* the phone may read, not *what* it sends. The one thing it added is
 * [KIND_SENSITIVE] having a sibling that is not an error: three answers — text, empty, sensitive —
 * because collapsing any two of them tells a person something untrue about their own clipboard.
 */
object ClipboardPayloads {

    const val KIND_TEXT = "text"
    const val KIND_EMPTY = "empty"
    const val KIND_SENSITIVE = "sensitive"

    const val SOURCE_PHONE = "phone"
    const val SOURCE_MAC = "mac"

    /**
     * `clip.push` → `origin` (S7, defect 185): how the text reached this phone's sender code. The Mac
     * applies only [ORIGIN_CLIPBOARD] on arrival and **offers** everything else, including an absent
     * field. Set by [ClipRoute], never read from an intent.
     */
    const val ORIGIN_CLIPBOARD = "clipboard"
    const val ORIGIN_SELECTION = "selection"

    /**
     * The two code paths that build a `clip.push`, and the `origin` each one stamps. An enum rather than
     * a string so the origin is a property of the **route**, not a value a caller passes — the exported
     * selection activity cannot reach [FOCUS] by supplying anything.
     */
    enum class ClipRoute(val logName: String, val origin: String) {
        /** `MainActivity` gained focus and this phone read its own clipboard — the documented sync. */
        FOCUS("focus", ORIGIN_CLIPBOARD),

        /** Another app handed text to `SendSelectionActivity` (`PROCESS_TEXT`, or `SEND` of a text type). */
        SELECTION("selection", ORIGIN_SELECTION),
    }

    /**
     * 64 KB of UTF-8, and an entry over it is **refused, never truncated**.
     *
     * A silently truncated clipboard entry is a corrupt paste — the same *looks complete and is
     * half there* symptom as defect 56's truncated push, on a surface where the person will not
     * find out until they paste it somewhere that matters. The refusal names the cap.
     *
     * Measured against UTF-8 bytes rather than `String.length` because the wire carries bytes: a
     * 40,000-character string of emoji is 160 KB on the socket and would sail past a length check.
     */
    const val MAX_TEXT_BYTES = 64 * 1024

    /** 20 entries per side. Small on purpose: see [History]. */
    const val HISTORY_MAX = 20

    fun byteLength(text: String): Int = text.toByteArray(Charsets.UTF_8).size

    fun tooLarge(text: String): Boolean = byteLength(text) > MAX_TEXT_BYTES

    /**
     * One entry, in either direction.
     *
     * `package` never appears without `appName`: a package id may be a machine handle and never the
     * only thing a person reads (defects 28 and 33). Both are optional — a clipboard does not always
     * name an owner — and an unknown owner means the fields are **absent**, never `"unknown"`.
     *
     * `text` is present only for [KIND_TEXT]. A `sensitive` entry carries no text by construction
     * rather than by a caller remembering to omit it.
     */
    fun entry(
        kind: String,
        text: String?,
        atMs: Long,
        source: String,
        packageName: String? = null,
        appName: String? = null,
        origin: String? = null,
    ): JsonObject = buildJsonObject {
        put("kind", kind)
        if (kind == KIND_TEXT && text != null) put("text", text)
        put("atMs", atMs)
        put("source", source)
        if (origin != null) put("origin", origin)
        if (packageName != null) {
            put("package", packageName)
            put("appName", appName ?: packageName)
        }
    }

    /*
     * The echo rule used to live here, as `shouldSend`. It moved to [ClipEcho] when auto-apply
     * arrived, and it was *deleted* from here rather than kept as a delegating one-liner.
     *
     * A rule with two homes has one that is tested and one that is real, and nothing says which is
     * which until they disagree. `ClipboardPayloadsTest` covered this function and would have gone
     * on covering it after the shipping path stopped calling it — a green test over dead code reads
     * exactly like a green test over live code. `scripts/check-clip-echo.mjs` is what stops a third
     * home appearing on either side.
     */

    /**
     * A bounded, in-memory clipboard history.
     *
     * **In memory and nowhere else, on both sides.** Not Room, not a file. A clipboard history that
     * survives a reboot is a file full of other people's passwords sitting in app-private storage,
     * and "encrypt it" is not an answer because the key would live beside it. It is cleared on
     * disconnect — the rule the contact and thumbnail caches already follow — and a restart is a
     * clear.
     *
     * Duplicates **collapse to the most recent occurrence** rather than filling the list: copying
     * the same string three times is one thing that happened three times, and a history that shows
     * it three times has spent 15% of itself saying so.
     */
    class History(private val max: Int = HISTORY_MAX) {

        private val entries = ArrayDeque<Item>()

        /** One remembered entry. `text` is null for kinds that carry none. */
        data class Item(
            val kind: String,
            val text: String?,
            val atMs: Long,
            val source: String,
            val packageName: String? = null,
            val appName: String? = null,
        )

        val size: Int get() = synchronized(entries) { entries.size }

        /**
         * Remembers [item], newest first, and returns whether anything was stored.
         *
         * A [KIND_SENSITIVE] item is **never** stored and never was — the highest-value line in the
         * feature is the one that does not keep the password rather than the one that deletes it
         * well.
         */
        fun add(item: Item): Boolean {
            if (item.kind == KIND_SENSITIVE) return false
            synchronized(entries) {
                item.text?.let { text -> entries.removeAll { it.text == text } }
                entries.addFirst(item)
                while (entries.size > max) entries.removeLast()
            }
            return true
        }

        fun newestFirst(limit: Int = max): List<Item> =
            synchronized(entries) { entries.take(limit.coerceIn(1, max)) }

        fun clear(): Int = synchronized(entries) {
            val had = entries.size
            entries.clear()
            had
        }
    }
}
