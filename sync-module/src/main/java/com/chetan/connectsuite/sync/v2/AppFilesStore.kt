package com.chetan.connectsuite.sync.v2

import android.content.Context
import com.chetan.connectsuite.core.link.LinkLog
import java.io.File
import java.io.InputStream
import java.io.OutputStream

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

    override fun openPartial(segments: List<String>, name: String): FsPartial? {
        val dir = resolve(FsPaths.joinPath(segments)) ?: return null
        if (!dir.isDirectory) return null
        // `resolve` is the escape check and it is applied to the partial's own path too, not only to
        // the directory: `name` comes off the wire, and a directory that resolves does not make
        // every child of it safe.
        val part = resolve(
            FsPaths.joinPath(segments + FsPartials.partNameFor(name)),
        ) ?: return null
        val finalFile = resolve(FsPaths.joinPath(segments + name)) ?: return null
        return LocalPartial(part, finalFile)
    }

    /**
     * A partial in the app's own folder — the same three endings as [SafTreeStore.SafPartial], on a
     * real filesystem where each of them is one call.
     *
     * It exists because this root is the one that cannot fail: no grant, no provider, no user. When
     * a push has nowhere else to land it lands here, and the convention has to hold identically or
     * the fallback would be the place the rules quietly stop applying.
     */
    private inner class LocalPartial(
        private val part: File,
        private val finalFile: File,
    ) : FsPartial {

        override val bytesOnDisk: Long
            get() = if (part.isFile) part.length() else 0L

        override fun append(): OutputStream? = runCatching {
            part.parentFile?.mkdirs()
            java.io.FileOutputStream(part, true)
        }.getOrElse {
            LinkLog.w("fs", "$rootId could not open ${part.name} for append", it)
            null
        }

        override fun read(): InputStream? =
            if (part.isFile) runCatching { part.inputStream() }.getOrNull() else null

        override fun commit(): FsPaths.Entry? {
            val sidecar = File(finalFile.parentFile, FsPartials.failedNameFor(finalFile.name))
            if (sidecar.exists()) sidecar.delete()
            if (finalFile.exists()) finalFile.delete()
            return if (part.renameTo(finalFile)) {
                entryOf(finalFile)
            } else {
                LinkLog.e("fs", "$rootId could not rename ${part.name} to ${finalFile.name}")
                null
            }
        }

        override fun discardAsFailed(sidecar: String) {
            if (!part.delete()) {
                LinkLog.e("fs", "$rootId could not delete the corrupt ${part.name}")
            }
            runCatching {
                File(finalFile.parentFile, FsPartials.failedNameFor(finalFile.name))
                    .writeText(sidecar)
            }.onFailure { LinkLog.w("fs", "$rootId could not write the .failed sidecar", it) }
        }

        override fun keep() = Unit
    }
}
