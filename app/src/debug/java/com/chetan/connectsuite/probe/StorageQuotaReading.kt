package com.chetan.connectsuite.probe

import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption

/**
 * The pure half of [StorageQuotaProbeActivity] — **debug-only**, and pure so a JVM test reaches every
 * rule the probe's log line depends on (docs/feature-a-multi-offer-proposal.md §4, the cache quota
 * that no system view on the SM-S938B exposes: `dumpsys storagestats` prints nothing, `cmd
 * storagestats` has no shell implementation, and `/data/system/cachequota.xml` is readable by
 * `system` only).
 *
 * ### What may appear in the line, and what may not
 *
 * Fixed keys; values are **byte counts, a timestamp, `true`/`false`, a staging-folder state, or
 * `FAILED:` plus an exception class name**. Never an exception *message* (a message can carry a path),
 * never a path, a file name, file contents or anything about the person.
 */
object StorageQuotaReading {

    /** One reading: a number, or the class of what it threw. */
    sealed interface Value {
        data class Bytes(val n: Long) : Value
        data class Failed(val exceptionClass: String) : Value
    }

    /** Every failure keeps its exception class — never discarded, never its message. */
    inline fun read(block: () -> Long): Value =
        try { Value.Bytes(block()) } catch (e: Exception) { Value.Failed(e.javaClass.name) }

    enum class Staging { ABSENT, PRESENT, REFUSED }

    data class Staged(val state: Staging, val bytes: Long, val files: Int)

    /**
     * The staging folder **as it already is**: never created, never followed through a link, never
     * written. `ABSENT` when nothing is there; `REFUSED` when something is there that is not a plain
     * directory (a link included) — then nothing inside it is read. Top level only, regular files only,
     * which is where `ShareStaging` keeps its `.part`/`.bin`/`.json` entries.
     */
    fun staged(dir: File): Staged {
        val path = dir.toPath()
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return Staged(Staging.ABSENT, 0, 0)
        if (Files.isSymbolicLink(path) || !Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) return Staged(Staging.REFUSED, 0, 0)
        val regular = (dir.listFiles() ?: emptyArray()).filter { Files.isRegularFile(it.toPath(), LinkOption.NOFOLLOW_LINKS) }
        return Staged(Staging.PRESENT, regular.sumOf { it.length() }, regular.size)
    }

    /**
     * The one log line. `allocatableBytesNotFreeSpace` is named so nobody reads it as free space: it
     * counts cache belonging to **other** apps that the system could clear, so it is larger than
     * `usableBytes` whenever any app holds cache.
     */
    fun line(
        readAtMs: Long,
        volumeIsDefault: Value,
        quotaBytes: Value,
        usableBytes: Value,
        totalBytes: Value,
        allocatableBytesNotFreeSpace: Value,
        ownCacheBytes: Value,
        staged: Staged,
    ): String = listOf(
        "readAtMs" to readAtMs.toString(),
        "volumeIsDefault" to when (volumeIsDefault) {
            is Value.Bytes -> (volumeIsDefault.n == 1L).toString()
            is Value.Failed -> "FAILED:${volumeIsDefault.exceptionClass}"
        },
        "quotaBytes" to show(quotaBytes),
        "usableBytes" to show(usableBytes),
        "totalBytes" to show(totalBytes),
        "allocatableBytesNotFreeSpace" to show(allocatableBytesNotFreeSpace),
        "ownCacheBytes" to show(ownCacheBytes),
        "stagingDir" to staged.state.name,
        "stagedBytes" to staged.bytes.toString(),
        "stagedFiles" to staged.files.toString(),
    ).joinToString(" ") { (k, v) -> "$k=$v" }

    private fun show(v: Value): String = when (v) {
        is Value.Bytes -> v.n.toString()
        is Value.Failed -> "FAILED:${v.exceptionClass}"
    }
}
