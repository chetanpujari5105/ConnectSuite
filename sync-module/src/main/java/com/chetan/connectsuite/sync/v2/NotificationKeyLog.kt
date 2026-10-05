package com.chetan.connectsuite.sync.v2

import kotlin.random.Random

/**
 * A notification key as it may appear in a [com.chetan.connectsuite.link.LinkLog] line.
 *
 * `StatusBarNotification.getKey()` is `user|package|id|tag|uid`, and the **tag is chosen by the app
 * that posted the notification**: WhatsApp's tag for a one-to-one chat is the contact's JID, which is
 * their phone number. The log is a rotating file on disk and must never hold a number, so a key
 * reaches a log line only through here.
 *
 * Package, id and uid are kept — they are what makes a line debuggable. The tag becomes
 * `tag#<hash>`, salted once per process, so two lines about one notification still match within a
 * run and the file alone cannot be reversed by hashing candidate numbers. A key that is not the
 * five-part shape is replaced whole. The Mac's twin is `desktop/src/shared/notifKeyLog.ts`.
 */
object NotificationKeyLog {
    private val salt = Random.nextInt()

    private fun hash(text: String): String {
        // FNV-1a, 32-bit, seeded with the per-process salt. Correlation within a run, nothing more.
        var h = 0x811c9dc5.toInt() xor salt
        for (ch in text) {
            h = h xor ch.code
            h *= 0x01000193
        }
        return "%08x".format(h)
    }

    fun of(key: String): String {
        val parts = key.split('|')
        if (parts.size != 5) return "key#${hash(key)}"
        val (user, pkg, id, tag, uid) = parts
        val shownTag = if (tag == "null" || tag.isEmpty()) tag else "tag#${hash(tag)}"
        return "$user|$pkg|$id|$shownTag|$uid"
    }
}
