package com.chetan.connectsuite.sync.v2

import android.content.Context
import com.chetan.connectsuite.core.link.LinkLog
import java.io.File
import java.io.InputStream

/**
 * The app's own folder — the one root that always exists, granted or not.
 *
 * ### Why an empty phone and an ungranted phone must not look the same
 *
 * `fs.list` with no `rootId` returns this root even when the user has added no folders at all. An
 * empty roots array would be indistinguishable from a phone with nothing on it, and the Mac would
 * have to guess which it was looking at — the absence rule from `CLAUDE.md` applied to a payload
 * rather than to a probe. One root plus a `grantHint` says both things at once: the feature works,
 * and there is more that has not been shared.
 *
 * ### It is a poor destination and that is not a defect
 *
 * A file put here is not somewhere the user will look. §4 of the payload spec settled the *expected*
 * destination as `Download/ConnectSuite` through `MediaStore`, which needs no grant of any kind and
 * lands where their file manager already looks. This root is the fallback beneath that, and it is
 * kept because it is the only thing that cannot fail.
 */
class AppFilesStore(context: Context) : FsStore {

    private val root: File = File(context.filesDir, "shared").apply { mkdirs() }

    override val rootId: String = FsPaths.APP_ROOT_ID
    override val label: String = FsPaths.APP_ROOT_LABEL
    override val kind: String = FsPaths.KIND_APP
    override val writable: Boolean = true

    override fun freeBytes(): Long = SafTreeStore.freeBytesAt(root.absolutePath)

    /**
     * Resolves a relative path inside the root, or null when it escapes.
     *
     * The escape check is by **canonical path**, not by inspecting the string: `splitPath` already
     * refuses a `..` segment on the wire, and this is the second, independent answer to the same
     * question — a symlink inside the folder resolves outward without any `..` appearing anywhere.
     * Two different mechanisms because they fail in different ways, which is the point of having
     * both.
     */
    private fun resolve(relative: String): File? {
        val candidate = File(root, relative)
        val canonicalRoot = runCatching { root.canonicalPath }.getOrNull() ?: return null
        val canonical = runCatching { candidate.canonicalPath }.getOrNull() ?: return null
        if (canonical != canonicalRoot && !canonical.startsWith("$canonicalRoot${File.separator}")) {
            LinkLog.w("fs", "$rootId refused a path resolving outside the root: $relative")
            return null
        }
        return candidate
    }

    private fun entryOf(file: File): FsPaths.Entry {
        val relative = file.relativeTo(root).path
        return FsPaths.Entry(
            id = FsPaths.encodeId(relative),
            name = file.name,
            dir = file.isDirectory,
            size = if (file.isDirectory) 0L else file.length(),
            mtimeMs = file.lastModified(),
            mime = if (file.isDirectory) FsPaths.DIR_MIME else "application/octet-stream",
        )
    }

    override fun listChildren(segments: List<String>): List<FsPaths.Entry>? {
        val dir = resolve(FsPaths.joinPath(segments)) ?: return null
        if (!dir.isDirectory) return null
        return (dir.listFiles() ?: return null).map(::entryOf)
    }

    private fun fileFor(id: String): File? = resolve(FsPaths.decodeId(id))

    override fun statById(id: String): FsPaths.Entry? {
        val file = fileFor(id) ?: return null
        return if (file.exists()) entryOf(file) else null
    }

    override fun mkdir(segments: List<String>, name: String): FsPaths.Entry? {
        val parent = resolve(FsPaths.joinPath(segments)) ?: return null
        if (!parent.isDirectory) return null
        val made = File(parent, name)
        if (made.exists()) return if (made.isDirectory) entryOf(made) else null
        return if (made.mkdir()) entryOf(made) else null
    }

    /** Compare-and-delete, evaluated twice. See [SafTreeStore.deleteIfUnchanged] for the argument. */
    override fun deleteIfUnchanged(
        id: String,
        expectSize: Long,
        expectMtimeMs: Long,
    ): DeleteOutcome {
        val file = fileFor(id) ?: return DeleteOutcome.Refused("that id is not inside this root")
        val seen = statById(id) ?: return DeleteOutcome.NotFound
        when (val verdict = FsPaths.deleteVerdict(seen, expectSize, expectMtimeMs)) {
            is FsPaths.DeleteVerdict.Mismatch -> {
                LinkLog.w("fs", "$rootId refusing to delete ${seen.name}: ${verdict.why}")
                return if (seen.dir) DeleteOutcome.Refused(verdict.why)
                else DeleteOutcome.Stale(seen.size, seen.mtimeMs)
            }
            is FsPaths.DeleteVerdict.Match -> Unit
        }

        val atTheMoment = statById(id) ?: return DeleteOutcome.NotFound
        if (FsPaths.deleteVerdict(atTheMoment, expectSize, expectMtimeMs)
            !is FsPaths.DeleteVerdict.Match
        ) {
            LinkLog.w(
                "fs",
                "$rootId refusing to delete ${atTheMoment.name}: it changed between the check and " +
                    "the delete — ${atTheMoment.size} bytes at ${atTheMoment.mtimeMs}",
            )
            return DeleteOutcome.Stale(atTheMoment.size, atTheMoment.mtimeMs)
        }

        return if (file.delete()) {
            LinkLog.i(
                "fs",
                "$rootId deleted ${atTheMoment.name} (${atTheMoment.size} bytes) after the size and " +
                    "modified time both matched what the Mac last saw",
            )
            DeleteOutcome.Deleted
        } else {
            DeleteOutcome.Refused("the file could not be removed")
        }
    }

    override fun openStream(id: String): InputStream? {
        val file = fileFor(id) ?: return null
        if (!file.isFile) return null
        return runCatching { file.inputStream() }.getOrNull()
    }
}
