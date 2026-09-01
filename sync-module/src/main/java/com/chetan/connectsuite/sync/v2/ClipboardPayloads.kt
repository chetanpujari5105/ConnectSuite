package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The half of `clip.*` with no Android in it: the payload shapes, the size cap, the echo rule and
 * the history.
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
    ): JsonObject = buildJsonObject {
        put("kind", kind)
        if (kind == KIND_TEXT && text != null) put("text", text)
        put("atMs", atMs)
        put("source", source)
        if (packageName != null) {
            put("package", packageName)
            put("appName", appName ?: packageName)
        }
    }

    /**
     * Whether this side may send [text], given the last text it *received*.
     *
     * **A rule about what to send, not a filter on what arrives.** One slot plus two writers is an
     * echo waiting to happen: a side applies what the other sent, notices its own clipboard changed,
     * and sends it straight back. The receiving end cannot tell that from somebody genuinely copying
     * the same string twice — only the sender knows — so the decision is made where the knowledge
     * is.
     *
     * The value it reads is written by the receive path and read by the send path, which are two
     * callers. Its concurrency is stated in [ClipFeature], not merely its type: a tagged union
     * prevents an ambiguous state and does nothing about two callers racing to set an unambiguous
     * one.
     */
    fun shouldSend(text: String, lastReceived: String?): Boolean = text != lastReceived

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
