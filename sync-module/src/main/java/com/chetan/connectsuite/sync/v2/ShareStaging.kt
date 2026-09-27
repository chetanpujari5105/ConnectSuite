package com.chetan.connectsuite.sync.v2

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Private staging for one shared file — `docs/phase-7-share-proposal.md` rev 2, §5 "Staging", and
 * slice 1 of `docs/phase-7-share-plan.md`. Nothing Android is in this file, so a JVM test reaches
 * every rule the share sheet relies on. It was proven in the debug source set first (`b3eca15`, on
 * the SM-S938B through Samsung Gallery and Samsung My Files) and moved here unchanged in its rules.
 *
 * ### Why the copy exists at all
 *
 * A share grant dies with the receiving activity. On the emulator, the same process with the
 * foreground `LinkService` in it got `SecurityException` at +1 s, +30 s and +120 s; on the Samsung,
 * My Files' provider refused at +2 s while the staged copy read fine. So the bytes are copied **while
 * the activity still owns the grant**, and nothing afterwards touches the source.
 *
 * ### The rules this file holds, each in one place
 *
 *  - **Preflight is a prediction, the copy is the measurement.** [preflight] uses the provider's
 *    claimed size; [copy] re-reads free space as it writes and trusts only its own byte count.
 *  - **One attempt, one name, never reused.** An attempt id is 128 random bits, and every file is
 *    created with `CREATE_NEW` and renamed without `REPLACE_EXISTING` — so an attempt can fail on a
 *    name collision, and cannot overwrite another attempt's file.
 *  - **A failed attempt leaves nothing.** Every non-success outcome closes both streams and deletes
 *    that attempt's `.part` (and a marker if one was written), and only that attempt's.
 *  - **Cleanup deletes only what it can prove is ours** ([sweep]): regular files, not symlinks,
 *    directly in the staging directory, matching the attempt pattern, and — for a finished copy — a
 *    marker naming this owner.
 *
 * ### What it will not carry
 *
 * No path, URI or display name appears in any value this file returns for logging; the attempt id
 * is the handle. The marker carries no name, no MIME type and no URI.
 */
object ShareStaging {

    const val DIR_NAME = "share-staging"
    const val OWNER = "sidekick-share-staging"
    private const val MIB = 1024L * 1024L

    /** The margin's floor, and the free space below which a running copy stops. */
    const val FLOOR_BYTES = 256L * MIB

    /** How often a running copy re-reads free space, in bytes written. */
    const val RECHECK_EVERY_BYTES = 8L * MIB

    /** A new staging run removes unclaimed entries older than this (the in-process backstop). */
    const val BACKSTOP_AGE_MS = 15L * 60 * 1000

    private val ATTEMPT = Regex("^s-[A-Za-z0-9_-]{22}$")
    private val ENTRY = Regex("^(s-[A-Za-z0-9_-]{22})\\.(part|bin|json)$")

    /**
     * The staging directory under [cacheDir], created if absent — or `null` when it cannot be used as
     * one: a symlink where the directory should be (never followed, never written through), or
     * something that is not a directory. Nothing is ever staged into a `null`.
     */
    fun stagingDir(cacheDir: File): File? {
        val dir = File(cacheDir, DIR_NAME)
        val path = dir.toPath()
        if (Files.isSymbolicLink(path)) return null
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS) && !dir.mkdirs()) return null
        return dir.takeIf { Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) }
    }

    // ---- sizes ---------------------------------------------------------------------------------

    /** `M(S) = max(256 MiB, ⌈S / 10⌉)`. */
    fun margin(size: Long): Long {
        require(size >= 0) { "size is ≥ 0" }
        return maxOf(FLOOR_BYTES, (size + 9) / 10)
    }

    /**
     * The largest `s` with `s + M(s) ≤ A` — the v1 limit, derived from free space rather than
     * declared. `A − 256 MiB` while the margin is at its floor, `⌊A / 1.1⌋` above `A = 2816 MiB`,
     * and 0 (refuse) at or below the floor.
     */
    fun limit(available: Long): Long {
        if (available <= FLOOR_BYTES) return 0
        // s + M(s) rises with s, so the largest fitting s is a binary search, not a formula to get wrong.
        var lo = 0L
        var hi = available
        while (lo < hi) {
            val mid = lo + (hi - lo + 1) / 2
            if (mid + margin(mid) <= available) lo = mid else hi = mid - 1
        }
        return lo
    }

    sealed interface Preflight {
        /** Proceed; the copy is bounded by [limit]. */
        data class Go(val limit: Long) : Preflight
        /** Refused before a byte is read. [needed] is `S + M(S)`, or the floor when `S` is unknown. */
        data class NoSpace(val expected: Long?, val available: Long, val needed: Long, val limit: Long) : Preflight
    }

    fun preflight(expected: Long?, available: Long): Preflight {
        val limit = limit(available)
        return if (expected == null) {
            if (available > FLOOR_BYTES) Preflight.Go(limit) else Preflight.NoSpace(null, available, FLOOR_BYTES + 1, limit)
        } else {
            val needed = expected + margin(expected)
            if (needed <= available) Preflight.Go(limit) else Preflight.NoSpace(expected, available, needed, limit)
        }
    }

    // ---- attempts ------------------------------------------------------------------------------

    private val random = SecureRandom()

    /** `s-` + 22 base64url characters: 128 random bits. */
    fun newAttemptId(): String {
        val bytes = ByteArray(16).also { random.nextBytes(it) }
        return "s-" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    fun isAttemptId(id: String): Boolean = ATTEMPT.matches(id)

    sealed interface Outcome {
        val attemptId: String
        data class Staged(override val attemptId: String, val bytes: Long, val sha256: String) : Outcome
        data class NoSpace(override val attemptId: String, val bytesWritten: Long, val available: Long) : Outcome
        data class OverLimit(override val attemptId: String, val limit: Long) : Outcome
        data class SourceReadFailed(override val attemptId: String, val bytesWritten: Long, val exceptionClass: String) : Outcome
        data class WriteFailed(override val attemptId: String, val bytesWritten: Long, val exceptionClass: String) : Outcome
        data class Cancelled(override val attemptId: String, val bytesWritten: Long) : Outcome
        /**
         * Version 3 only: a concurrent copy's budget (`ShareConcurrentBudget.duringCopy`), re-read while it
         * ran or once when it finished, no longer allowed it. [stop] is that re-check's own answer — its
         * reason, the `Σ` it read and the measured limit — so nothing re-reads them afterwards. The partial
         * is deleted like every other non-success. Never produced when [copy]'s `budgetStop` is left at its
         * default.
         */
        data class BudgetStopped(override val attemptId: String, val bytesWritten: Long, val stop: ShareAdmission.Stop) : Outcome
    }

    /**
     * Copies [source] into `<dir>/<attemptId>.part`, hashing as it writes, then writes the marker and
     * renames the copy to `.bin`. Every outcome other than [Outcome.Staged] leaves no file for this
     * attempt. [source] is always closed.
     *
     * @param available re-read at start and every [recheckEvery] bytes; below [FLOOR_BYTES] the copy stops.
     * @param cancelled polled once per buffer.
     * @param afterBuffer called after each buffer is written — the probe's pacing seam, and a progress hook.
     * @param budgetStop version 3 only: asked with the bytes written at every [recheckEvery] boundary and
     *   once more after the last byte, before the copy is kept. A non-null answer stops it as
     *   [Outcome.BudgetStopped], carrying that answer, and deletes the partial. The default never stops
     *   anything, so a version-2 copy is unchanged.
     */
    fun copy(
        source: InputStream,
        dir: File,
        attemptId: String,
        limit: Long,
        available: () -> Long,
        cancelled: () -> Boolean,
        nowMs: Long,
        bufferSize: Int = 64 * 1024,
        recheckEvery: Long = RECHECK_EVERY_BYTES,
        afterBuffer: (bytesWritten: Long) -> Unit = {},
        budgetStop: (bytesWritten: Long) -> ShareAdmission.Stop? = { null },
    ): Outcome {
        require(isAttemptId(attemptId)) { "not an attempt id" }
        val part = File(dir, "$attemptId.part").toPath()
        val bin = File(dir, "$attemptId.bin").toPath()
        val marker = File(dir, "$attemptId.json").toPath()
        var written = 0L
        // Only files this call created are ever deleted: a marker CREATE_NEW refused is somebody else's.
        var markerCreated = false

        fun discard() {
            runCatching { Files.deleteIfExists(part) }
            if (markerCreated) runCatching { Files.deleteIfExists(marker) }
        }

        source.use { input ->
            val out = try {
                Files.newOutputStream(part, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
            } catch (e: IOException) {
                // CREATE_NEW refused or the directory is unusable: nothing of ours exists to delete,
                // and a colliding file is somebody else's — leave it.
                return Outcome.WriteFailed(attemptId, 0, e.javaClass.name)
            }
            val digest = MessageDigest.getInstance("SHA-256")
            var sinceCheck = 0L
            val result: Outcome? = out.use { sink ->
                val buffer = ByteArray(bufferSize)
                val atStart = available()
                if (atStart < FLOOR_BYTES) return@use Outcome.NoSpace(attemptId, 0, atStart)
                while (true) {
                    if (cancelled()) return@use Outcome.Cancelled(attemptId, written)
                    val n = try {
                        input.read(buffer)
                    } catch (e: IOException) {
                        return@use Outcome.SourceReadFailed(attemptId, written, e.javaClass.name)
                    } catch (e: SecurityException) {
                        return@use Outcome.SourceReadFailed(attemptId, written, e.javaClass.name)
                    }
                    if (n < 0) break
                    if (n == 0) continue
                    if (written + n > limit) return@use Outcome.OverLimit(attemptId, limit)
                    try {
                        sink.write(buffer, 0, n)
                    } catch (e: IOException) {
                        return@use Outcome.WriteFailed(attemptId, written, e.javaClass.name)
                    }
                    digest.update(buffer, 0, n)
                    written += n
                    sinceCheck += n
                    if (sinceCheck >= recheckEvery) {
                        sinceCheck = 0
                        val now = available()
                        if (now < FLOOR_BYTES) return@use Outcome.NoSpace(attemptId, written, now)
                        budgetStop(written)?.let { return@use Outcome.BudgetStopped(attemptId, written, it) }
                    }
                    afterBuffer(written)
                }
                // Once when it finishes, with fresh readings, before anything is kept.
                budgetStop(written)?.let { return@use Outcome.BudgetStopped(attemptId, written, it) }
                null
            }
            if (result != null) {
                discard()
                return result
            }
            val sha = hex(digest.digest())
            return try {
                Files.newOutputStream(marker, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { m ->
                    markerCreated = true // created by this call; a failed write below still leaves it ours to delete
                    m.write(markerText(attemptId, nowMs, written, sha).toByteArray())
                }
                // No REPLACE_EXISTING: a `.bin` of this name already existing is a collision, not ours to replace.
                Files.move(part, bin)
                Outcome.Staged(attemptId, written, sha)
            } catch (e: IOException) {
                discard()
                Outcome.WriteFailed(attemptId, written, e.javaClass.name)
            }
        }
    }

    /** Reads a staged copy back and digests it — the control that the bytes on disk are the bytes hashed. */
    fun readBack(dir: File, attemptId: String): Pair<Long, String>? {
        require(isAttemptId(attemptId))
        val bin = File(dir, "$attemptId.bin").toPath()
        if (!Files.isRegularFile(bin, LinkOption.NOFOLLOW_LINKS)) return null
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        Files.newInputStream(bin, LinkOption.NOFOLLOW_LINKS).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
                total += n
            }
        }
        return total to hex(digest.digest())
    }

    /** Deletes one attempt's files. Only regular files, only this attempt's three names. */
    fun discard(dir: File, attemptId: String): Int {
        require(isAttemptId(attemptId))
        var n = 0
        for (ext in listOf("part", "bin", "json")) {
            val p = File(dir, "$attemptId.$ext").toPath()
            if (Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS) && runCatching { Files.delete(p) }.isSuccess) n++
        }
        return n
    }

    // ---- sweep ---------------------------------------------------------------------------------

    data class SweepResult(
        val deleted: Int,
        val deletedBytes: Long,
        val keptLive: Int,
        val keptYoung: Int,
        val leftUnrecognised: Int,
        /** The staging directory itself was refused (a symlink, or not a directory) and nothing was read. */
        val refusedDir: Boolean = false,
    )

    /**
     * Removes staging entries this app can prove it owns and nothing is using.
     *
     * At process start pass `live = emptySet()` and `minAgeMs = 0`: offers live in memory only, so
     * after a process death every entry is an orphan. When a new staging run begins, pass the live
     * attempt ids and [BACKSTOP_AGE_MS].
     *
     * **Deleted only if all hold:** a regular file (symlinks are never followed and never deleted),
     * directly in [dir], named `s-<22>.part|bin|json`; a `.bin` needs a same-id marker carrying
     * [OWNER]; a `.json` must itself carry [OWNER] and its own id. Anything else is left and counted.
     */
    fun sweep(dir: File, live: Set<String>, nowMs: Long, minAgeMs: Long): SweepResult {
        val root = dir.toPath()
        if (!Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return SweepResult(0, 0, 0, 0, 0)
        if (Files.isSymbolicLink(root) || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
            return SweepResult(0, 0, 0, 0, 0, refusedDir = true)
        }
        val entries: List<Path> = Files.newDirectoryStream(root).use { it.toList() }
        var deleted = 0; var bytes = 0L; var keptLive = 0; var keptYoung = 0; var unrecognised = 0
        // Judge every entry before deleting any: a `.bin` is owned through its marker, so deleting
        // the marker first would strand the `.bin` as "unrecognised" — kept forever.
        val doomed = mutableListOf<Path>()
        for (p in entries) {
            val m = ENTRY.matchEntire(p.fileName.toString())
            if (m == null || Files.isSymbolicLink(p) || !Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)) {
                unrecognised++; continue
            }
            val id = m.groupValues[1]
            val owned = when (m.groupValues[2]) {
                "part" -> true
                "json" -> markerOwns(p, id)
                else -> markerOwns(root.resolve("$id.json"), id)
            }
            if (!owned) { unrecognised++; continue }
            if (id in live) { keptLive++; continue }
            // minAgeMs = 0 means no age condition at all — not "age ≥ 0", which a clock stepping
            // backwards (or an mtime in the future) would fail, keeping an orphan forever.
            if (minAgeMs > 0) {
                val age = nowMs - Files.getLastModifiedTime(p, LinkOption.NOFOLLOW_LINKS).toMillis()
                if (age < minAgeMs) { keptYoung++; continue }
            }
            doomed.add(p) // not `+=`: a Path is itself an Iterable<Path>
        }
        for (p in doomed) {
            val size = runCatching { Files.size(p) }.getOrDefault(0L)
            if (runCatching { Files.delete(p) }.isSuccess) { deleted++; bytes += size }
        }
        return SweepResult(deleted, bytes, keptLive, keptYoung, unrecognised)
    }

    fun sweepLine(r: SweepResult): String =
        if (r.refusedDir) "sweep refused: the staging directory is not a plain directory — nothing read, nothing deleted"
        else "sweep deleted=${r.deleted} bytes=${r.deletedBytes} keptLive=${r.keptLive} keptYoung=${r.keptYoung} leftUnrecognised=${r.leftUnrecognised}"

    // ---- marker --------------------------------------------------------------------------------

    fun markerText(attemptId: String, createdAtMs: Long, size: Long, sha256: String): String =
        """{"owner":"$OWNER","v":1,"offerId":"$attemptId","createdAtMs":$createdAtMs,"size":$size,"sha256":"$sha256"}"""

    private fun markerOwns(marker: Path, id: String): Boolean {
        if (Files.isSymbolicLink(marker) || !Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS)) return false
        if (Files.size(marker) > 4096) return false
        val text = runCatching { String(Files.readAllBytes(marker)) }.getOrNull() ?: return false
        return text.contains("\"owner\":\"$OWNER\"") && text.contains("\"offerId\":\"$id\"")
    }

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    /** SHA-256 of zero bytes — the digest a zero-byte share must carry. */
    const val EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
