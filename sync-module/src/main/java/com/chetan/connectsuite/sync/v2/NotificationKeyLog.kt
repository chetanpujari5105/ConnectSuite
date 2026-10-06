package com.chetan.connectsuite.sync.v2

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * A notification key as it may appear in a [com.chetan.connectsuite.link.LinkLog] line.
 *
 * `StatusBarNotification.getKey()` is `user|package|id|tag|uid`, and the **tag is chosen by the app
 * that posted the notification**: WhatsApp's tag for a one-to-one chat is the contact's JID, which is
 * their phone number. The log is a rotating file on disk and must never hold a number, so a key
 * reaches a log line only through here. The Mac's twin is `desktop/src/shared/notifKeyLog.ts`.
 *
 * Package, id and uid are kept — they are what makes a line debuggable. The tag becomes `tag#<n>`, the
 * order in which **this process** first saw it; a key that is not the five-part shape becomes
 * `key#<n>`. Correlation within one process, nothing more: it is not anonymity, and the ordinals
 * restart at 1 with the process.
 *
 * **This replaces a salted 32-bit FNV-1a whose "cannot be reversed" claim was wrong** (audit S6,
 * `docs/release-audit-2026-10-06.md`): the salt only set FNV's starting state, every step is
 * invertible, so one known tag gave the salt and a dictionary gave the rest. [NotificationKeyOrdinals]
 * holds the details.
 */
object NotificationKeyLog {
    private val process = NotificationKeyOrdinals()

    fun of(key: String): String = process.of(key)
}

/**
 * The table behind [NotificationKeyLog]: HMAC-SHA256(per-instance random 32-byte key, tag) → ordinal,
 * **never the raw tag**, capped at [maxTracked] with the least recently seen evicted first. An evicted
 * tag seen again gets a new ordinal — correlation lost for very old tags, never wrongly merged. Neither
 * the key nor the table is persisted or logged. A class so a test can make a fresh "process".
 */
class NotificationKeyOrdinals(private val maxTracked: Int = MAX_TRACKED) {
    private val mac: Mac = Mac.getInstance("HmacSHA256").apply {
        init(SecretKeySpec(ByteArray(32).also(SecureRandom()::nextBytes), "HmacSHA256"))
    }
    private val ordinals = object : LinkedHashMap<String, Int>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Int>?): Boolean = size > maxTracked
    }
    private var next = 1

    @Synchronized
    private fun ordinalOf(text: String): Int {
        val id = Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(text.toByteArray(Charsets.UTF_8)))
        return ordinals[id] ?: next++.also { ordinals[id] = it }
    }

    fun of(key: String): String {
        val parts = key.split('|')
        if (parts.size != 5) return "key#${ordinalOf("key\u0000$key")}"
        val (user, pkg, id, tag, uid) = parts
        val shownTag = if (tag == "null" || tag.isEmpty()) tag else "tag#${ordinalOf("tag\u0000$tag")}"
        return "$user|$pkg|$id|$shownTag|$uid"
    }

    @Synchronized
    fun tracked(): Int = ordinals.size

    /** Tests only: what the table actually holds (keyed digests, never tags). */
    @Synchronized
    fun heldKeysForTest(): List<String> = ordinals.keys.toList()

    companion object {
        const val MAX_TRACKED = 1024
    }
}
