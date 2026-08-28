package com.chetan.connectsuite.sync.transfer

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.webkit.MimeTypeMap
import java.io.File
import java.io.FileInputStream

/**
 * Where incoming files land.
 *
 * Bytes stream into a `.part` file in the app's cache first — a partial file must never appear in
 * the user's Downloads as if it were complete, and keeping it private is also what makes resume
 * safe. Only once the checksum verifies does the file get published to
 * `Downloads/ConnectSuite/` through MediaStore, which is the one way to write there on
 * scoped storage without asking for a storage permission at all.
 */
class ReceivedFileStore(private val appContext: Context) {

    private val partialDir: File
        get() = File(appContext.cacheDir, "transfers").apply { mkdirs() }

    fun partialFileFor(transferId: String): File = File(partialDir, "$transferId.part")

    fun partialBytes(transferId: String): Long =
        partialFileFor(transferId).takeIf { it.isFile }?.length() ?: 0L

    fun discardPartial(transferId: String) {
        partialFileFor(transferId).delete()
    }

    /**
     * Moves a completed `.part` file into Downloads/ConnectSuite.
     *
     * @return the published content URI, or null if publishing failed.
     */
    fun publish(transferId: String, displayName: String, relativeSubPath: String?): Uri? {
        val source = partialFileFor(transferId)
        if (!source.isFile) return null

        val relativePath = buildString {
            append(Environment.DIRECTORY_DOWNLOADS)
            append("/ConnectSuite")
            if (!relativeSubPath.isNullOrBlank()) {
                append('/')
                append(relativeSubPath.trim('/'))
            }
        }

        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, displayName)
            put(MediaStore.Downloads.MIME_TYPE, mimeTypeFor(displayName))
            put(MediaStore.Downloads.RELATIVE_PATH, relativePath)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }

        val resolver = appContext.contentResolver
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values) ?: return null

        return try {
            resolver.openOutputStream(uri)?.use { output ->
                FileInputStream(source).use { input -> input.copyTo(output, COPY_BUFFER) }
            } ?: return null

            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)

            source.delete()
            uri
        } catch (e: Exception) {
            Log.e(TAG, "Publishing $displayName failed", e)
            runCatching { resolver.delete(uri, null, null) }
            null
        }
    }

    /** Drops partial files from jobs that will never resume, so the cache does not grow forever. */
    fun pruneStalePartials(olderThanMillis: Long) {
        val cutoff = System.currentTimeMillis() - olderThanMillis
        partialDir.listFiles()?.forEach { file ->
            if (file.lastModified() < cutoff) file.delete()
        }
    }

    private fun mimeTypeFor(name: String): String {
        val extension = name.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
            ?: "application/octet-stream"
    }

    private companion object {
        const val TAG = "ReceivedFileStore"
        const val COPY_BUFFER = 256 * 1024
    }
}
