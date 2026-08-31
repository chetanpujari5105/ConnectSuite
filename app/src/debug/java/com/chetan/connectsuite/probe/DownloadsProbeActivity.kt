package com.chetan.connectsuite.probe

import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import androidx.activity.ComponentActivity
import com.chetan.connectsuite.sync.transfer.ReceivedFileStore
import kotlin.concurrent.thread

/**
 * A one-purpose probe for the push half of §4 of `docs/phase-5-fs-media-proposal.md`, and
 * **debug-only on purpose**: it lives in `src/debug/` so it cannot reach a release build.
 *
 * The question. `ReceivedFileStore` claims, in a class comment written for v1, that publishing to
 * `Download/ConnectSuite` through `MediaStore.Downloads` is *"the one way to write there on scoped
 * storage without asking for a storage permission at all"*. §1 has just spent a hardware run
 * learning what a documented-but-unobserved claim is worth, and this one decides whether the push
 * half of `fs.*` needs a SAF grant at all — so it is observed before anything depends on it.
 *
 * It calls the **real** [ReceivedFileStore.publish], not a copy of it. A re-implementation here
 * would be a second client issuing what looks like the same request, which is the mistake §1's
 * probe was built to avoid.
 *
 * Two readings, and the second is the one §4 turns on:
 *
 *  1. Does the insert-and-commit succeed at `targetSdk 36` with **no** storage permission granted?
 *     The permission dump is logged in the same run so the answer has its own control: "it worked"
 *     means nothing without "and here is what we held while it worked".
 *  2. During the copy — the window where `IS_PENDING=1` — is the file visible at its **final name**
 *     to an outside observer? `docs/protocol.md`'s sibling spec forbids a partial ever appearing
 *     under the name a complete file would have, and a pending row that is nonetheless present in
 *     the directory would break that quietly. The probe holds the window open by copying a large
 *     file; the observation itself is made from the shell, against the filesystem, while this runs.
 *
 * Run: `adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.DownloadsProbeActivity --ei mb 256`
 * Read: `adb logcat -s DownloadsProbe:V`
 */
class DownloadsProbeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val megabytes = intent.getIntExtra("mb", 256)
        val abandon = intent.getBooleanExtra("abandon", false)
        Log.i(TAG, "--- probe run start; targetSdk=${applicationInfo.targetSdkVersion} sdk=${Build.VERSION.SDK_INT} ---")
        logPermissionState()

        if (abandon) {
            thread(name = "downloads-probe-abandon") { abandonMidPublish(megabytes) }
            return
        }

        thread(name = "downloads-probe") {
            val store = ReceivedFileStore(applicationContext)
            val transferId = "probe-${System.currentTimeMillis()}"
            val displayName = "probe-$transferId.bin"
            val part = store.partialFileFor(transferId)

            val chunk = ByteArray(1 shl 20) { (it and 0x7f).toByte() }
            part.outputStream().use { out -> repeat(megabytes) { out.write(chunk) } }
            Log.i(TAG, "STAGED: ${part.absolutePath} bytes=${part.length()} (app-private cache, not the destination)")

            val startedAt = System.currentTimeMillis()
            Log.i(TAG, "COPY START at $startedAt — poll the destination directory from here")
            val uri = store.publish(transferId, displayName, null)
            val elapsed = System.currentTimeMillis() - startedAt
            if (uri == null) {
                Log.w(TAG, "RESULT: publish returned null after ${elapsed}ms — no row, nothing written")
                finish()
                return@thread
            }
            Log.i(TAG, "RESULT: published uri=$uri in ${elapsed}ms for $megabytes MB")

            contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    fun col(name: String) = c.getColumnIndex(name).takeIf { it >= 0 }?.let { c.getString(it) }
                    Log.i(
                        TAG,
                        "ROW: name=${col(MediaStore.Downloads.DISPLAY_NAME)} " +
                            "size=${col(MediaStore.Downloads.SIZE)} " +
                            "pending=${col(MediaStore.Downloads.IS_PENDING)} " +
                            "path=${col(MediaStore.Downloads.RELATIVE_PATH)} " +
                            "owner=${col(MediaStore.Downloads.OWNER_PACKAGE_NAME)}",
                    )
                } else {
                    Log.w(TAG, "ROW: the uri we just published returns no row")
                }
            } ?: Log.w(TAG, "ROW: query on the published uri returned no cursor at all")

            // Counted in a stream rather than read into memory: the first version of this line
            // called readBytes() on 256 MB and died with OutOfMemoryError, which said nothing about
            // the platform and everything about the probe.
            val readBack = runCatching {
                contentResolver.openInputStream(uri)!!.use { input ->
                    val buffer = ByteArray(1 shl 16)
                    var total = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        total += n
                    }
                    total
                }
            }
            Log.i(TAG, "READBACK: ${readBack.getOrNull() ?: "failed: ${readBack.exceptionOrNull()}"} bytes")
            Log.i(TAG, "STAGED AFTER: exists=${part.exists()} (publish deletes the partial on success)")
            finish()
        }
    }

    /**
     * Leaves an **abandoned pending row** in the destination, to answer reading 2 directly.
     *
     * This half is deliberately not [ReceivedFileStore.publish]: the question is what an
     * *interrupted* publish leaves behind, and the real client cannot be asked to demonstrate that
     * without being interrupted. So the insert is issued in the same shape the real one uses —
     * same collection, same `RELATIVE_PATH`, same `IS_PENDING=1` — the bytes are written, and the
     * commit is never made. What matters is not this code but what it leaves in the directory,
     * which is then observed from outside by something that has never seen this file.
     *
     * The 263 ms that the real 256 MB publish took is why this exists: the pending window is real
     * but far too short to sample from the shell, and a poll that misses it returns no reading at
     * all rather than a negative one.
     */
    private fun abandonMidPublish(megabytes: Int) {
        val displayName = "abandoned-${System.currentTimeMillis()}.bin"
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, displayName)
            put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ConnectSuite")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = contentResolver.insert(
            MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
            values,
        )
        if (uri == null) {
            Log.w(TAG, "ABANDON: insert returned null; nothing to observe")
            finish()
            return
        }
        val chunk = ByteArray(1 shl 20) { (it and 0x7f).toByte() }
        contentResolver.openOutputStream(uri)?.use { out -> repeat(megabytes) { out.write(chunk) } }
        Log.i(TAG, "ABANDON: left pending uri=$uri name=$displayName bytes=${megabytes}MB, never committed")
        finish()
    }

    /**
     * What this package holds *right now*, logged whether or not anything is granted.
     *
     * This is the control on reading 1. "The write worked" is only evidence about permissions
     * alongside the list of permissions that were not held while it worked — a success with no
     * denominator is the counter rule's failure in one line.
     */
    private fun logPermissionState() {
        val storagePermissions = listOf(
            "android.permission.READ_EXTERNAL_STORAGE",
            "android.permission.WRITE_EXTERNAL_STORAGE",
            "android.permission.READ_MEDIA_IMAGES",
            "android.permission.READ_MEDIA_VIDEO",
        )
        val state = storagePermissions.joinToString {
            val granted = checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
            "${it.substringAfterLast('.')}=$granted"
        }
        Log.i(TAG, "PERMISSIONS: $state")
        Log.i(
            TAG,
            "PERSISTED TREES: " +
                contentResolver.persistedUriPermissions.joinToString { it.uri.toString() }
                    .ifEmpty { "none" },
        )
    }

    private companion object {
        const val TAG = "DownloadsProbe"
    }
}
