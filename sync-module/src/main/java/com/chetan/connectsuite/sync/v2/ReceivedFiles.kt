package com.chetan.connectsuite.sync.v2

/**
 * What the phone says when the Mac has sent it files — the words and the running count, with no
 * Android in them, so a JVM test runs the sentences the notification draws.
 *
 * ### One notification for a batch, not one per file
 *
 * The Mac sends a batch serially, one `fs.transfer.begin` per file. Posting per file would stack
 * fifty notifications for a folder's worth, so arrivals within [WINDOW_MS] of the previous one fold
 * into a single running count — *"3 files arrived from Chetan's MacBook Pro"* — with the latest name
 * beside it. A gap longer than the window starts a new count, because an unrelated send ten minutes
 * later is a different event and "7 files" would be a total nobody sent.
 *
 * ### Only what arrived
 *
 * This is told about a file **after** its arrival verdict — `FsPartials.Arrival.Complete` — and at
 * no other point. A push that failed its checksum, overran, or was stopped is not "received"; the
 * Mac shows that outcome, and the phone's Transfers screen lists it with its reason.
 */
class ReceivedFiles(private val now: () -> Long = System::currentTimeMillis) {

    data class Summary(val title: String, val text: String, val count: Int)

    private var count = 0
    private var lastAt = Long.MIN_VALUE

    /** Records one arrival and returns what the single notification should now say. */
    @Synchronized
    fun arrived(name: String, sizeBytes: Long, folderLabel: String, peerName: String, verified: Boolean): Summary {
        val at = now()
        count = if (lastAt != Long.MIN_VALUE && at - lastAt <= WINDOW_MS) count + 1 else 1
        lastAt = at
        val from = peerName.ifBlank { "your Mac" }
        val title = if (count == 1) "$name arrived from $from" else "$count files arrived from $from"
        val checked = if (verified) "checksum matched" else "not checksummed"
        val text = if (count == 1) {
            "In $folderLabel · ${humanBytes(sizeBytes)} · $checked"
        } else {
            "Latest: $name, in $folderLabel"
        }
        return Summary(title, text, count)
    }

    companion object {
        /** Two arrivals closer than this belong to one batch. A serial LAN batch is well inside it. */
        const val WINDOW_MS = 60_000L

        fun humanBytes(bytes: Long): String {
            if (bytes < 1024) return "$bytes B"
            val units = listOf("KB", "MB", "GB")
            var value = bytes / 1024.0
            var unit = 0
            while (value >= 1024 && unit < units.lastIndex) {
                value /= 1024
                unit++
            }
            return if (value < 10) "%.1f %s".format(java.util.Locale.US, value, units[unit])
            else "%d %s".format(java.util.Locale.US, value.toLong(), units[unit])
        }
    }
}
