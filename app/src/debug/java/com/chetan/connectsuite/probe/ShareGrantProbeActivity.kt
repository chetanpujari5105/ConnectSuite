package com.chetan.connectsuite.probe

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import androidx.core.content.IntentCompat
import com.chetan.connectsuite.core.link.LinkService
import java.security.MessageDigest

/**
 * The instrument for `docs/phase-7-share-proposal.md` §4 — **debug-only**, in `src/debug/`, so it
 * cannot reach a release build. It is not Feature A: no offer, no share root, no Mac.
 *
 * It receives one `ACTION_SEND`, reads the stream once before `finish()` (the control), and then —
 * from this process, which the foreground `LinkService` is holding — reopens the same URI at +1 s,
 * +30 s and +120 s after `onDestroy`. The rules are in [ShareGrantRun]; this class only does I/O.
 *
 * ### What reaches logcat, and what never does
 *
 * Tag `ShareGrantProbe`. The URI's **authority**, the case (media or file), the offset and measured
 * elapsed time, `ok`, the exception **class** on failure, and byte count plus SHA-256 on success —
 * the digest is of generated synthetic bytes, which is how the control is checked against the file
 * that was made. **Never** the URI string, a path, a display name, or a byte of content; the probe
 * does not query `OpenableColumns` at all, so it never holds a provider's name for the file.
 *
 * ### Why the reads run here and not inside `LinkService`
 *
 * A URI grant is held by a uid and a component, not by a class. The question is whether *this
 * process* can open the URI once the receiving activity is gone; `LinkService` matters because it is
 * what keeps the process alive and foreground in production. So every reading records whether the
 * foreground `LinkService` was running in this process at that moment, and [ShareGrantRun.State.verdict]
 * refuses to call a run PASS if it was not — that would answer a different question. Adding a debug
 * hook to `LinkService` itself would change production code for an experiment.
 *
 * ```
 * # nothing to start: share one file to "Sidekick grant probe (debug)" from Photos or Files,
 * # with LinkService already running, then:
 * adb logcat -s ShareGrantProbe
 * ```
 */
class ShareGrantProbeActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A re-created instance (rotation, process restore) must not start a second run on a URI
        // whose grant may already be gone; the first instance's run is the reading.
        if (savedInstanceState != null) {
            finish()
            return
        }
        val uri = streamOf(intent)
        if (uri == null || intent?.action != Intent.ACTION_SEND) {
            Log.w(TAG, "no single content:// EXTRA_STREAM on this intent — no run")
            finish()
            return
        }
        ShareGrantProbe.begin(applicationContext, uri, intent.type) { finish() }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) ShareGrantProbe.onReceiverDestroyed()
    }

    private fun streamOf(intent: Intent?): Uri? {
        val uri = intent?.let { IntentCompat.getParcelableExtra(it, Intent.EXTRA_STREAM, Uri::class.java) }
            ?: intent?.clipData?.takeIf { it.itemCount == 1 }?.getItemAt(0)?.uri
        return uri?.takeIf { it.scheme == "content" }
    }

    companion object {
        const val TAG = "ShareGrantProbe"
    }
}

/** Process-wide, so it outlives the activity — which is the whole experiment. */
internal object ShareGrantProbe {

    private val thread = HandlerThread("share-grant-probe").apply { start() }
    private val handler = Handler(thread.looper)

    private var uri: Uri? = null
    private var context: Context? = null
    @Volatile private var state: ShareGrantRun.State? = null

    fun begin(context: Context, uri: Uri, mime: String?, done: () -> Unit) {
        if (state != null && state!!.owedOffsets().isNotEmpty()) {
            Log.w(ShareGrantProbeActivity.TAG, "a run is still taking readings — this share is ignored")
            done()
            return
        }
        this.context = context
        this.uri = uri
        state = ShareGrantRun.State(authority = uri.authority ?: "none", case = ShareGrantRun.caseOf(mime))
        handler.post {
            val result = read(context, uri)
            val control = ShareGrantRun.Control(result.ok, result.bytes, result.sha256, result.exceptionClass)
            state = state!!.afterControl(control)
            Log.i(ShareGrantProbeActivity.TAG, ShareGrantRun.controlLine(state!!))
            // Finish only after the control, on the main thread; the destroy is what the readings time from.
            android.os.Handler(android.os.Looper.getMainLooper()).post(done)
        }
    }

    fun onReceiverDestroyed() {
        handler.post {
            val current = state ?: return@post
            if (current.destroyedAtMs != null) return@post
            val destroyedAt = SystemClock.elapsedRealtime()
            state = current.afterDestroyed(destroyedAt)
            if (current.control?.ok != true) {
                Log.i(ShareGrantProbeActivity.TAG, ShareGrantRun.verdictLine(state!!))
                return@post
            }
            ShareGrantRun.READING_OFFSETS_MS.forEach { offset ->
                handler.postAtTime({ takeReading(offset) }, destroyedAt + offset)
            }
            Log.i(
                ShareGrantProbeActivity.TAG,
                "receiver destroyed; readings scheduled at " +
                    ShareGrantRun.READING_OFFSETS_MS.joinToString(", ") { "+${it}ms" },
            )
        }
    }

    private fun takeReading(offset: Long) {
        val ctx = context ?: return
        val target = uri ?: return
        val now = SystemClock.elapsedRealtime()
        val result = read(ctx, target)
        val reading = ShareGrantRun.Reading(
            offsetMs = offset,
            elapsedMs = 0,
            ok = result.ok,
            bytes = result.bytes,
            sha256 = result.sha256,
            exceptionClass = result.exceptionClass,
            linkServiceForeground = linkServiceForeground(ctx),
        )
        state = state!!.afterReading(offset, now, reading)
        Log.i(ShareGrantProbeActivity.TAG, ShareGrantRun.readingLine(state!!, state!!.readings.last()))
        if (state!!.owedOffsets().isEmpty()) {
            Log.i(ShareGrantProbeActivity.TAG, ShareGrantRun.verdictLine(state!!))
        }
    }

    private data class ReadResult(val ok: Boolean, val bytes: Long, val sha256: String?, val exceptionClass: String?)

    /**
     * The whole stream, digested. The exception's **class** is kept and its message is not: a
     * `SecurityException` message on a refused grant names the full URI.
     */
    private fun read(context: Context, uri: Uri): ReadResult = try {
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        val stream = context.contentResolver.openInputStream(uri)
            ?: throw IllegalStateException("openInputStream returned null")
        stream.use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n <= 0) break
                digest.update(buffer, 0, n)
                total += n
            }
        }
        ReadResult(true, total, digest.digest().joinToString("") { "%02x".format(it) }, null)
    } catch (e: Exception) {
        ReadResult(false, 0, null, e.javaClass.name)
    }

    /** `getRunningServices` still answers for the caller's own services, which is all this needs. */
    @Suppress("DEPRECATION")
    private fun linkServiceForeground(context: Context): Boolean {
        val am = context.getSystemService(ActivityManager::class.java) ?: return false
        return am.getRunningServices(100).any {
            it.service.className == LinkService::class.java.name &&
                it.pid == android.os.Process.myPid() &&
                it.foreground
        }
    }
}
