package com.chetan.connectsuite.probe

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.provider.OpenableColumns
import android.util.Log
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.IntentCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The private-staging proof for `docs/phase-7-share-proposal.md` rev 2 §5 — **debug-only**, not
 * Feature A. It receives one `ACTION_SEND`, and **while it still owns the grant** copies the stream
 * into `cacheDir/share-staging/` through [ShareStaging.copy]. No offer, no socket, no Mac.
 *
 * The screen shows the source's MIME type and authority (never the URI, never a name), the byte
 * count, whether three digests agree — computed during the copy, read back from the staged file,
 * and a fresh read of the source while the grant is still held — and the staging status.
 *
 * ### Recreation
 *
 * A rotation (or the Recreate button, which is the same relaunch path) destroys this instance and
 * builds a new one; the copy is held by the [StagingModel], which survives. **Whether the grant
 * survives recreation is not assumed.** The new instance re-opens the URI and reads it whole; if
 * that fails, a running copy is cancelled and its partial deleted, and the screen says so.
 *
 * ### Faults, for the matrix
 *
 * Checkboxes before *Start*: a slow copy (4 KiB buffers, 150 ms apart — room to cancel or rotate
 * mid-copy), a source read that fails after 32 KiB, a preflight that sees too little space, and free
 * space that drops below the floor mid-copy. Each injects at a seam [ShareStaging.copy] already
 * takes; none changes the rule under test.
 *
 * ### Logcat, tag `ShareStagingProbe`
 *
 * Attempt id, authority, case, byte counts, digests, outcome and exception **class**. Never the URI,
 * a path (the staging directory included), a display name or file contents.
 */
class ShareStagingProbeActivity : ComponentActivity() {

    private lateinit var model: StagingModel
    private lateinit var status: TextView
    private lateinit var slow: CheckBox
    private lateinit var failRead: CheckBox
    private lateinit var lowSpace: CheckBox
    private lateinit var spaceDrops: CheckBox
    private val render = Runnable { if (::status.isInitialized) status.text = model.describe() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model = ViewModelProvider(this)[StagingModel::class.java]
        buildViews()
        model.listener = { runOnUiThread(render) }

        if (model.uri == null) {
            val uri = streamOf(intent)
            if (uri == null || intent?.action != Intent.ACTION_SEND) {
                model.phase = "no single content:// stream on this intent — nothing staged"
                Log.w(TAG, "no single content:// EXTRA_STREAM — no attempt")
            } else {
                model.bind(applicationContext, uri, contentResolver.getType(uri) ?: intent.type)
            }
        } else {
            // Recreated. The grant is re-tested, not assumed.
            model.onRecreated(applicationContext)
        }
        render.run()
    }

    override fun onDestroy() {
        model.listener = null
        super.onDestroy()
    }

    private fun buildViews() {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
        }
        status = TextView(this).apply { textSize = 15f; contentDescription = "staging-status" }
        slow = CheckBox(this).apply { text = "Slow copy" }
        failRead = CheckBox(this).apply { text = "Fail read after 32 KiB" }
        lowSpace = CheckBox(this).apply { text = "Low space at preflight" }
        spaceDrops = CheckBox(this).apply { text = "Space drops mid-copy" }
        fun button(label: String, onClick: () -> Unit) = Button(this).apply {
            text = label
            contentDescription = label
            setOnClickListener { onClick() }
        }
        column.addView(TextView(this).apply { text = "Share staging proof (debug)"; textSize = 20f })
        column.addView(slow); column.addView(failRead); column.addView(lowSpace); column.addView(spaceDrops)
        column.addView(button("Start copy") {
            model.start(StagingModel.Faults(slow.isChecked, failRead.isChecked, lowSpace.isChecked, spaceDrops.isChecked))
        })
        column.addView(button("Cancel copy") { model.cancel("user") })
        column.addView(button("Recreate") { recreate() })
        column.addView(button("Finish") { finish() })
        column.addView(status)
        setContentView(ScrollView(this).apply { addView(column) })
    }

    private fun streamOf(intent: Intent?): Uri? {
        val uri = intent?.let { IntentCompat.getParcelableExtra(it, Intent.EXTRA_STREAM, Uri::class.java) }
            ?: intent?.clipData?.takeIf { it.itemCount == 1 }?.getItemAt(0)?.uri
        return uri?.takeIf { it.scheme == "content" }
    }

    companion object {
        const val TAG = "ShareStagingProbe"
    }
}

/**
 * Holds one attempt across recreation. Cleared when the activity finishes for good — and a copy
 * still running then is cancelled, which deletes its partial: the grant is about to go, and a copy
 * must never outlive the component that owns it.
 */
class StagingModel : ViewModel() {

    data class Faults(val slow: Boolean, val failRead: Boolean, val lowSpace: Boolean, val spaceDrops: Boolean)

    @Volatile var listener: (() -> Unit)? = null
    @Volatile var uri: Uri? = null
    private var context: Context? = null
    private var mime: String? = null
    private var authority: String = "none"
    private var expected: Long? = null

    @Volatile var phase: String = "ready — tap Start copy"
    @Volatile private var attemptId: String? = null
    @Volatile private var running = false
    private val cancelled = AtomicBoolean(false)
    @Volatile private var cancelReason: String? = null
    @Volatile private var written = 0L
    @Volatile private var result: String = ""
    @Volatile private var recreations = 0
    @Volatile private var recreationAccess: String = "not recreated"

    private val worker = HandlerThread("share-staging").apply { start() }
    private val handler = Handler(worker.looper)

    fun bind(context: Context, uri: Uri, mime: String?) {
        this.context = context
        this.uri = uri
        this.mime = mime
        authority = uri.authority ?: "none"
        expected = runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null
            }
        }.getOrElse { e ->
            Log.w(ShareStagingProbeActivity.TAG, "size query failed: ${e.javaClass.name} — preflight treats the size as unknown")
            null
        }
        Log.i(ShareStagingProbeActivity.TAG, "bound authority=$authority case=${ShareGrantRun.caseOf(mime)} mime=$mime expected=${expected ?: "unknown"}")
        notifyChanged()
    }

    fun onRecreated(context: Context) {
        recreations++
        val target = uri ?: return
        recreationAccess = "re-reading…"
        notifyChanged()
        // Its own thread: the copy's worker may be mid-copy, and this reading must not wait behind it.
        Thread {
            val read = readWhole(context, target)
            recreationAccess = if (read.ok) "ok bytes=${read.bytes}" else "FAILED ${read.exceptionClass}"
            Log.i(ShareStagingProbeActivity.TAG, "recreation=$recreations authority=$authority reopen " +
                if (read.ok) "ok=true bytes=${read.bytes} sha256=${read.sha256}" else "ok=false exception=${read.exceptionClass}")
            if (!read.ok && running) cancel("grant lost after recreation")
            notifyChanged()
        }.start()
    }

    fun start(faults: Faults) {
        val ctx = context ?: return
        val source = uri ?: return
        if (running || attemptId != null) return
        val id = ShareStaging.newAttemptId()
        attemptId = id
        running = true
        cancelled.set(false)
        phase = "staging"
        notifyChanged()
        handler.post { runAttempt(ctx, source, id, faults) }
    }

    fun cancel(reason: String) {
        if (!running) return
        cancelReason = reason
        cancelled.set(true)
        notifyChanged()
    }

    private fun runAttempt(ctx: Context, source: Uri, id: String, faults: Faults) {
        val dir = ShareStagingHolder.dir(ctx)
        if (dir == null) {
            finishAttempt("refused — staging directory is not a plain directory", null)
            return
        }
        Log.i(ShareStagingProbeActivity.TAG, "backstop " + ShareStaging.sweepLine(
            ShareStaging.sweep(dir, ShareStagingHolder.liveIds(), System.currentTimeMillis(), ShareStaging.BACKSTOP_AGE_MS),
        ))

        val real = { dir.usableSpace }
        val availableAtPreflight = if (faults.lowSpace) (expected ?: 0L) + 128L * 1024 * 1024 else real()
        when (val pre = ShareStaging.preflight(expected, availableAtPreflight)) {
            is ShareStaging.Preflight.NoSpace -> {
                Log.i(ShareStagingProbeActivity.TAG, "attempt=$id preflight=refused expected=${pre.expected ?: "unknown"} " +
                    "available=${pre.available} needed=${pre.needed} limit=${pre.limit} simulated=${faults.lowSpace}")
                finishAttempt("not enough space — needed ${pre.needed} bytes, ${pre.available} free; limit now ${pre.limit}. No copy made", null)
                return
            }
            is ShareStaging.Preflight.Go -> {
                Log.i(ShareStagingProbeActivity.TAG, "attempt=$id preflight=go expected=${expected ?: "unknown"} limit=${pre.limit}")
                var calls = 0
                val available: () -> Long = if (faults.spaceDrops) {
                    { if (calls++ == 0) real() else ShareStaging.FLOOR_BYTES - 1 }
                } else real
                val input = try {
                    ctx.contentResolver.openInputStream(source) ?: throw IOException("openInputStream returned null")
                } catch (e: Exception) {
                    Log.i(ShareStagingProbeActivity.TAG, "attempt=$id open failed exception=${e.javaClass.name}")
                    finishAttempt("source could not be opened (${e.javaClass.simpleName}) — no copy made", null)
                    return
                }
                val stream = if (faults.failRead) FailAfter(input, 32 * 1024) else input
                val outcome = ShareStaging.copy(
                    source = stream, dir = dir, attemptId = id, limit = pre.limit,
                    available = available, cancelled = { cancelled.get() }, nowMs = System.currentTimeMillis(),
                    bufferSize = if (faults.slow) 4096 else 64 * 1024,
                    recheckEvery = if (faults.spaceDrops) 16L * 1024 else ShareStaging.RECHECK_EVERY_BYTES,
                    afterBuffer = { n ->
                        written = n
                        if (faults.slow) { notifyChanged(); Thread.sleep(150) }
                    },
                )
                reportOutcome(ctx, dir, source, outcome)
            }
        }
    }

    private fun reportOutcome(ctx: Context, dir: File, source: Uri, outcome: ShareStaging.Outcome) {
        val leftovers = ShareStagingHolder.filesOf(dir, outcome.attemptId)
        when (outcome) {
            is ShareStaging.Outcome.Staged -> {
                val back = ShareStaging.readBack(dir, outcome.attemptId)
                val src = readWhole(ctx, source) // the grant is still ours: this activity has not finished
                val backMatch = back != null && back.first == outcome.bytes && back.second == outcome.sha256
                val srcMatch = src.ok && src.bytes == outcome.bytes && src.sha256 == outcome.sha256
                ShareStagingHolder.register(ctx, outcome.attemptId, outcome.bytes, outcome.sha256, source)
                Log.i(ShareStagingProbeActivity.TAG, "attempt=${outcome.attemptId} outcome=staged bytes=${outcome.bytes} " +
                    "sha256=${outcome.sha256} readBackMatch=$backMatch sourceRereadMatch=$srcMatch " +
                    "sourceReread=${if (src.ok) "ok" else src.exceptionClass} files=$leftovers")
                finishAttempt(
                    "STAGED bytes=${outcome.bytes}\nsha256=${outcome.sha256}\n" +
                        "digest match: copy=read-back $backMatch · copy=source re-read $srcMatch\nfiles for this attempt: $leftovers",
                    outcome,
                )
            }
            else -> {
                Log.i(ShareStagingProbeActivity.TAG, "attempt=${outcome.attemptId} outcome=$outcome " +
                    "cancelReason=${cancelReason ?: "none"} filesLeft=$leftovers")
                finishAttempt("${outcome::class.simpleName}${cancelReason?.let { " ($it)" } ?: ""}\nfiles left for this attempt: $leftovers", outcome)
            }
        }
    }

    private fun finishAttempt(text: String, outcome: ShareStaging.Outcome?) {
        running = false
        result = text
        phase = when (outcome) {
            is ShareStaging.Outcome.Staged -> "staged"
            null -> "refused"
            else -> "failed — partial deleted"
        }
        notifyChanged()
    }

    /** The activity is finishing for good. A copy still running is cancelled; it deletes its own partial. */
    override fun onCleared() {
        cancel("activity finished")
        ShareStagingHolder.onReceiverGone()
        worker.quitSafely()
        context = null
    }

    fun describe(): String = buildString {
        appendLine("source: ${mime ?: "unknown type"} · ${ShareGrantRun.caseOf(mime)} · $authority")
        appendLine("expected size: ${expected ?: "unknown"}")
        appendLine("attempt: ${attemptId ?: "none"}")
        appendLine("phase: $phase")
        if (running) appendLine("copied: $written bytes")
        appendLine("recreations: $recreations · grant after recreation: $recreationAccess")
        if (result.isNotEmpty()) appendLine(result)
    }

    private fun notifyChanged() { listener?.invoke() }
}

/** Process-wide: the staged entries the probe is holding, and the after-finish reading. */
internal object ShareStagingHolder {

    private data class Entry(val bytes: Long, val sha256: String, val source: Uri)

    private val thread = HandlerThread("share-staging-holder").apply { start() }
    private val handler = Handler(thread.looper)
    private val live = java.util.concurrent.ConcurrentHashMap<String, Entry>()
    @Volatile private var context: Context? = null

    /** A proof-slice stand-in for the offer's lifetime: an entry nobody discards is removed after this. */
    const val PROBE_EXPIRY_MS = 10L * 60 * 1000
    const val AFTER_FINISH_READ_MS = 2_000L

    fun dir(context: Context): File? {
        val dir = File(context.cacheDir, ShareStaging.DIR_NAME)
        val path = dir.toPath()
        if (Files.isSymbolicLink(path)) return null
        if (!dir.exists() && !dir.mkdirs()) return null
        return dir.takeIf { Files.isDirectory(path, java.nio.file.LinkOption.NOFOLLOW_LINKS) }
    }

    fun liveIds(): Set<String> = live.keys.toSet()

    fun filesOf(dir: File, id: String): String =
        listOf("part", "bin", "json").filter { File(dir, "$id.$it").exists() }.ifEmpty { listOf("none") }.joinToString(",")

    fun register(context: Context, id: String, bytes: Long, sha256: String, source: Uri) {
        this.context = context.applicationContext
        live[id] = Entry(bytes, sha256, source)
        handler.postDelayed({ expire(id) }, PROBE_EXPIRY_MS)
    }

    /** The receiving activity is gone. After [AFTER_FINISH_READ_MS], read every staged copy — and, as the contrast, the source. */
    fun onReceiverGone() {
        handler.postDelayed({
            val ctx = context ?: return@postDelayed
            val dir = dir(ctx) ?: return@postDelayed
            live.forEach { (id, e) ->
                val back = ShareStaging.readBack(dir, id)
                val src = readWhole(ctx, e.source)
                Log.i(ShareStagingProbeActivity.TAG, "after-finish +${AFTER_FINISH_READ_MS}ms attempt=$id " +
                    "staged=${if (back == null) "missing" else "ok bytes=${back.first} match=${back.first == e.bytes && back.second == e.sha256}"} " +
                    "source=${if (src.ok) "ok bytes=${src.bytes}" else "failed exception=${src.exceptionClass}"}")
            }
        }, AFTER_FINISH_READ_MS)
    }

    private fun expire(id: String) {
        val ctx = context ?: return
        val dir = dir(ctx) ?: return
        if (live.remove(id) != null) {
            Log.i(ShareStagingProbeActivity.TAG, "attempt=$id expired after ${PROBE_EXPIRY_MS}ms deletedFiles=${ShareStaging.discard(dir, id)}")
        }
    }
}

internal data class WholeRead(val ok: Boolean, val bytes: Long, val sha256: String?, val exceptionClass: String?)

/** The exception's class only: a `SecurityException` message on a refused grant names the full URI. */
internal fun readWhole(context: Context, uri: Uri): WholeRead = try {
    val digest = MessageDigest.getInstance("SHA-256")
    var total = 0L
    (context.contentResolver.openInputStream(uri) ?: throw IOException("openInputStream returned null")).use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            digest.update(buffer, 0, n)
            total += n
        }
    }
    WholeRead(true, total, digest.digest().joinToString("") { "%02x".format(it) }, null)
} catch (e: Exception) {
    WholeRead(false, 0, null, e.javaClass.name)
}

/** The read-failure fault: the source stream throws once [after] bytes have been delivered. */
private class FailAfter(input: InputStream, private val after: Int) : FilterInputStream(input) {
    private var delivered = 0
    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (delivered >= after) throw IOException("injected source-read failure")
        val n = super.read(b, off, minOf(len, after - delivered))
        if (n > 0) delivered += n
        return n
    }
}

/**
 * The startup sweep. A provider is created when the process starts, **before** any activity — so a
 * process started by a share intent sweeps first and cannot race the new attempt. Offers live in
 * memory only, so everything [ShareStaging.sweep] can prove is ours is an orphan here.
 */
class ShareStagingSweepProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        val ctx = context ?: return true
        val dir = File(ctx.cacheDir, ShareStaging.DIR_NAME)
        val r = ShareStaging.sweep(dir, live = emptySet(), nowMs = System.currentTimeMillis(), minAgeMs = 0)
        Log.i(ShareStagingProbeActivity.TAG, "startup " + ShareStaging.sweepLine(r))
        return true
    }

    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?): Int = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?): Int = 0
}
