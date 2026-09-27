package com.chetan.connectsuite.probe

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.IntentCompat
import com.chetan.connectsuite.probe.ShareManyGrantRun.Phase
import com.chetan.connectsuite.sync.v2.ShareSelection
import java.lang.ref.WeakReference
import java.security.MessageDigest

/**
 * The instrument for docs/feature-a-multi-offer-proposal.md rev 4 §11 — **debug source set only, and
 * registered `android:enabled="false"`**: it is in no share sheet until someone enables the component by
 * hand (`pm enable`), and it refuses outside a debuggable build. The rules are [ShareManyGrantRun]; this
 * class only does I/O. It is not Feature A: no offer, no Mac, nothing written, nothing copied.
 *
 * It receives one `SEND_MULTIPLE`, logs the intake facts, reads every item once inside the live screen
 * (the control), and then reads the same items again:
 * - **stopped** — +1 s and +30 s after the first `onStop` that is not a finish (press Home). If the screen
 *   is still stopped after the last of those, it finishes itself, which starts the next phase;
 * - **recreated** — once, in the instance a rotation creates;
 * - **finished** — +1 s, +30 s, +120 s after the finishing `onDestroy` (Finish, Back, or the self-finish).
 *
 * ### What reaches logcat, and what never does
 *
 * Tag `ShareManyGrantProbe`. Counts, flags, authorities, phases, offsets and measured elapsed time, `ok`,
 * exception **classes**, byte counts and SHA-256 digests. **Never** a URI, a path, a display name or a
 * byte of content: `OpenableColumns` is never queried, and the bytes read are digested and dropped.
 * The screen shows counts only.
 *
 * ```
 * # only in a supervised run, and only with synthetic files:
 * adb -s <pinned> shell pm enable com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareManyGrantProbeActivity
 * # share 2+ synthetic files of ONE type to "Sidekick multi grant probe (debug)", then:
 * adb logcat -s ShareManyGrantProbe
 * adb -s <pinned> shell pm default-state com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareManyGrantProbeActivity
 * ```
 */
class ShareManyGrantProbeActivity : Activity() {

    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            Log.w(TAG, "not a debuggable build — no run")
            finish()
            return
        }
        status = TextView(this).apply { textSize = 16f }
        val done = Button(this).apply {
            text = "Finish"
            setOnClickListener { finish() }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
            addView(status, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(done)
        })
        ShareManyGrantProbe.attach(this)
        if (savedInstanceState != null) {
            ShareManyGrantProbe.onRecreated()
            return
        }
        if (!ShareManyGrantProbe.begin(applicationContext, intent)) finish()
    }

    override fun onStart() {
        super.onStart()
        ShareManyGrantProbe.onStarted()
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations && !isFinishing) ShareManyGrantProbe.onStopped()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) ShareManyGrantProbe.onFinished()
    }

    internal fun show(text: String) {
        if (::status.isInitialized) status.text = text
    }

    companion object {
        const val TAG = "ShareManyGrantProbe"
    }
}

/** Process-wide, so it outlives the activity — which is the whole experiment. */
internal object ShareManyGrantProbe {

    private val thread = HandlerThread("share-many-grant-probe").apply { start() }
    private val handler = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())

    private var context: Context? = null
    private var uris: List<Uri> = emptyList()
    @Volatile private var state: ShareManyGrantRun.State? = null
    private var screen = WeakReference<ShareManyGrantProbeActivity>(null)

    fun attach(a: ShareManyGrantProbeActivity) {
        screen = WeakReference(a)
        render()
    }

    /** False when nothing was started (refused, or a run still owes readings); the caller finishes. */
    fun begin(context: Context, intent: Intent): Boolean {
        val current = state
        if (current != null && busy(current)) {
            Log.w(ShareManyGrantProbeActivity.TAG, "a run is still taking readings — this share is ignored")
            return false
        }
        val extra: List<Uri?>? = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
        val clip: List<Uri?>? = intent.clipData?.let { c -> (0 until c.itemCount).map { c.getItemAt(it).uri } }
        val streams = ShareSelection.streams(extra, clip)
        val clipSet = clip.orEmpty().filterNotNull().toSet()
        val intake = ShareManyGrantRun.Intake(
            action = intent.action,
            type = intent.type,
            extraStreams = extra?.size ?: 0,
            clipItems = intent.clipData?.itemCount ?: 0,
            clipUris = clipSet.size,
            streamsAllInClip = extra?.takeIf { it.isNotEmpty() }?.let { e -> e.all { it != null && it in clipSet } },
            grantReadFlag = (intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0,
            mediaPermissionHeld = mediaPermissionHeld(context),
        )
        val items = streams.mapIndexed { i, u -> ShareManyGrantRun.Item(i, u?.scheme, u?.authority ?: "none", u != null && u in clipSet) }
        Log.i(ShareManyGrantProbeActivity.TAG, ShareManyGrantRun.intakeLine(intake, items))
        when (val a = ShareManyGrantRun.admit(intake, items)) {
            is ShareManyGrantRun.Admit.Refuse -> {
                Log.w(ShareManyGrantProbeActivity.TAG, "refused: ${a.why}")
                return false
            }
            is ShareManyGrantRun.Admit.Go -> Unit
        }
        this.context = context
        uris = streams.requireNoNulls()
        state = ShareManyGrantRun.State(intake, items)
        handler.post {
            for (i in uris.indices) {
                val r = read(context, uris[i])
                state = state!!.afterControl(i, r)
                Log.i(ShareManyGrantProbeActivity.TAG, ShareManyGrantRun.readLine(state!!, Phase.CONTROL, 0, 0, i, r, null))
            }
            Log.i(ShareManyGrantProbeActivity.TAG, ShareManyGrantRun.verdictLine(state!!, Phase.CONTROL))
            render()
        }
        return true
    }

    fun onStarted() {
        val now = SystemClock.elapsedRealtime()
        handler.post { state = state?.afterRestarted(now); render() }
    }

    fun onStopped() {
        val now = SystemClock.elapsedRealtime()
        handler.post {
            val before = state ?: return@post
            val after = before.afterStopped(now)
            state = after
            if (after.stoppedAtMs == null) {
                Log.i(ShareManyGrantProbeActivity.TAG, "stopped before every control was read — the stopped phase is not measured")
                return@post
            }
            if (before.stoppedAtMs != null) return@post // only the first stop is measured
            Log.i(ShareManyGrantProbeActivity.TAG, "screen stopped (not finished); readings at " +
                ShareManyGrantRun.STOPPED_OFFSETS_MS.joinToString(", ") { "+${it}ms" })
            schedule(Phase.STOPPED, now)
        }
    }

    fun onRecreated() {
        handler.post {
            val before = state ?: return@post
            if (before.recreated) return@post // one recreation is measured
            state = before.afterRecreated()
            if (!state!!.recreated) {
                Log.i(ShareManyGrantProbeActivity.TAG, "recreated before every control was read — not measured")
                return@post
            }
            take(Phase.RECREATED, 0L)
        }
    }

    fun onFinished() {
        val now = SystemClock.elapsedRealtime()
        handler.post {
            val before = state ?: return@post
            if (before.destroyedAtMs != null) return@post
            state = before.afterDestroyed(now)
            if (!before.controlsDone) {
                Log.i(ShareManyGrantProbeActivity.TAG, "finished before every control was read — no reading after finish")
                return@post
            }
            Log.i(ShareManyGrantProbeActivity.TAG, "screen finished; readings at " +
                ShareManyGrantRun.FINISHED_OFFSETS_MS.joinToString(", ") { "+${it}ms" })
            schedule(Phase.FINISHED, now)
        }
    }

    /** `postDelayed` from the event's own instant: `postAtTime` counts `uptimeMillis`, which stops in deep sleep. */
    private fun schedule(phase: Phase, originMs: Long) {
        for (off in ShareManyGrantRun.offsets(phase)) {
            val delay = (originMs + off - SystemClock.elapsedRealtime()).coerceAtLeast(0)
            handler.postDelayed({ take(phase, off) }, delay)
        }
    }

    private fun take(phase: Phase, offsetMs: Long) {
        val ctx = context ?: return
        val s = state ?: return
        if (phase == Phase.STOPPED && !s.stoppedStillHolds(offsetMs)) {
            for (i in s.items.indices) if (s.controls[i]?.ok == true) Log.i(ShareManyGrantProbeActivity.TAG, ShareManyGrantRun.notTakenLine(s, offsetMs, i))
            if (offsetMs == ShareManyGrantRun.offsets(phase).last()) finishPhase(phase)
            return
        }
        val owed = s.owed(phase).filter { it.first == offsetMs }.map { it.second }
        for (i in owed) {
            val r = read(ctx, uris[i])
            val now = SystemClock.elapsedRealtime()
            val fg = linkServiceForeground(ctx)
            state = state!!.afterReading(phase, offsetMs, now, i, r, fg)
            val origin = state!!.originOf(phase) ?: 0L
            Log.i(ShareManyGrantProbeActivity.TAG, ShareManyGrantRun.readLine(state!!, phase, offsetMs,
                if (phase == Phase.RECREATED) 0 else now - origin, i, r, if (phase == Phase.FINISHED) fg else null))
        }
        if (offsetMs == ShareManyGrantRun.offsets(phase).last()) finishPhase(phase)
        render()
    }

    private fun finishPhase(phase: Phase) {
        val s = state ?: return
        Log.i(ShareManyGrantProbeActivity.TAG, ShareManyGrantRun.verdictLine(s, phase))
        // The stopped phase is over; if the screen is still stopped, finishing it starts the finished phase.
        if (phase == Phase.STOPPED && s.stoppedStillHolds(ShareManyGrantRun.STOPPED_OFFSETS_MS.last())) {
            main.post { screen.get()?.takeIf { !it.isFinishing }?.finish() }
        }
    }

    private fun busy(s: ShareManyGrantRun.State): Boolean =
        s.destroyedAtMs == null || s.owed(Phase.FINISHED).isNotEmpty()

    private fun render() {
        val s = state
        val text = if (s == null) "Nothing received." else buildString {
            val ok = s.controls.values.count { it.ok && !it.capped }
            append("Sidekick multi grant probe (debug). Synthetic files only.\n\n")
            append("Items: ${s.items.size}. Read inside this screen: ${s.controls.size} of ${s.items.size}, $ok readable.\n\n")
            append("Press Home and wait 30 s to measure a stopped screen, rotate to measure a recreation, ")
            append("or press Finish to measure after finish. Results are in logcat (ShareManyGrantProbe).")
        }
        main.post { screen.get()?.show(text) }
    }

    private fun mediaPermissionHeld(context: Context): Boolean =
        listOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
            "android.permission.READ_MEDIA_VISUAL_USER_SELECTED", Manifest.permission.READ_EXTERNAL_STORAGE)
            .any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    /**
     * The whole stream up to [ShareManyGrantRun.READ_CAP_BYTES], digested and dropped. The exception's
     * **class** is kept and its message is not: a `SecurityException` message names the full URI.
     */
    private fun read(context: Context, uri: Uri): ShareManyGrantRun.Read = try {
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        var capped = false
        val stream = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("openInputStream returned null")
        stream.use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n <= 0) break
                digest.update(buffer, 0, n)
                total += n
                if (total > ShareManyGrantRun.READ_CAP_BYTES) {
                    capped = true
                    break
                }
            }
        }
        if (capped) ShareManyGrantRun.Read(false, total, null, null, capped = true)
        else ShareManyGrantRun.Read(true, total, digest.digest().joinToString("") { "%02x".format(it) }, null)
    } catch (e: Exception) {
        ShareManyGrantRun.Read(false, 0, null, e.javaClass.name)
    }

    private fun linkServiceForeground(context: Context): Boolean = ShareGrantProbe.linkServiceForeground(context)
}
