package com.chetan.connectsuite.sync.v2

import android.content.ContentResolver
import android.net.Uri
import android.system.Os
import android.system.OsConstants
import com.chetan.connectsuite.core.link.LinkLog
import java.io.FileDescriptor
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.InputStream

/**
 * `fstat` on a descriptor a provider opened — the Android half of [SourceStability] (defect 166). It
 * never builds or opens a path: the descriptor is the provider's own answer, under the grant the app
 * already holds, so nothing here widens what the app can reach.
 */
internal object LiveStat {

    /** The file behind [fd], or null when it is not a regular file (a pipe has no size or mtime to trust). */
    fun of(fd: FileDescriptor): SourceStamp? {
        val st = runCatching { Os.fstat(fd) }.getOrElse {
            LinkLog.w("fs", "fstat failed on an open source descriptor; using the provider's index instead", it)
            return null
        }
        if (!OsConstants.S_ISREG(st.st_mode)) return null
        return SourceStamp(
            size = st.st_size,
            mtimeMs = st.st_mtim.tv_sec * 1_000L + st.st_mtim.tv_nsec / 1_000_000L,
            dev = st.st_dev,
            ino = st.st_ino,
        )
    }

    /** The descriptor a transfer is reading from, when the provider gave a file stream. */
    fun ofStream(input: InputStream?): SourceStamp? = (input as? FileInputStream)?.let { of(it.fd) }

    /**
     * A fresh look by [uri]. `FileNotFoundException` is the one answer that means **gone**; any other
     * failure is logged with its type and read as *unavailable*, because an exception's name is the
     * provider's notion and not proof the file changed (CLAUDE.md, the `getOrNull` rule).
     */
    fun byUri(resolver: ContentResolver, uri: Uri): SourceStability.ById = try {
        resolver.openFileDescriptor(uri, "r")?.use { pfd ->
            of(pfd.fileDescriptor)?.let { SourceStability.ById.Stamp(it) } ?: SourceStability.ById.Unavailable
        } ?: SourceStability.ById.Gone
    } catch (e: FileNotFoundException) {
        SourceStability.ById.Gone
    } catch (e: Exception) {
        LinkLog.w("fs", "could not open $uri for its own metadata; using the provider's index instead", e)
        SourceStability.ById.Unavailable
    }
}
