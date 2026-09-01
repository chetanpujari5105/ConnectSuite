package com.chetan.connectsuite.probe

import android.app.ActivityManager
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import androidx.activity.ComponentActivity

/**
 * The instrument for `docs/phase-5-clipboard-proposal.md` §2 — **debug-only**, in `src/debug/` so it
 * cannot reach a release build, and written before a line of the feature exists.
 *
 * ### The question
 *
 * `CLAUDE.md` carries one sentence: *background clipboard reads are blocked since Android 10 unless
 * the app has an enabled AccessibilityService or is the default IME*. This app has such a service,
 * so by that sentence clipboard is a small feature. The sentence is **inherited from documentation
 * and has never been observed on this handset**, and every other load-bearing platform claim in this
 * project changed when it was finally measured — the SAF refusal, the bound-selection cursor, the
 * pending `MediaStore` resume. So the feature's shape is decided by this probe rather than by a doc.
 *
 * ### Four readings, and each one's lookalike
 *
 * 1. **Foreground read of our own clip.** The positive control, and the run **stops** if it fails:
 *    a background refusal means nothing unless the read works at all. This is the precondition
 *    `CLAUDE.md` states as *prove the query returns a known positive*.
 * 2. **Background read of a clip we own.** Interesting, and **not the answer**, because *the owner
 *    may read its own clip* is an entire ordinary explanation that looks identical to *background
 *    reads are allowed*. Recorded separately so it cannot be mistaken for reading 3.
 * 3. **Background read of a clip owned by another app** — the reading the feature turns on. The
 *    operator copies anything from any other app while this samples. The probe does not need to
 *    know what they copied: it knows what **it** put there, so a clip that is readable *and no
 *    longer ours* is a foreign clip successfully read.
 * 4. **The same, with the accessibility service disabled** — the control that says reading 3 was
 *    about the accessibility grant and not about something else. It is a separate run, and the
 *    probe logs the raw `enabled_accessibility_services` string on every run so the two are
 *    distinguishable afterwards rather than by memory.
 * 5. **Whether `OnPrimaryClipChangedListener` fires at all while backgrounded** — §7's open
 *    question, and a *different* question from reading: the platform may allow the read and never
 *    deliver the callback, in which case `clip.push` from the phone is impossible and the feature
 *    degrades to `clip.request`. Its control is our own foreground write, which must fire the
 *    callback once; a listener that never fires even for that is not wired up, and its silence
 *    afterwards would say nothing about the platform.
 *
 * ### What this instrument reports about itself
 *
 * Everything that shapes the answer, because *a result shaped by the instrument's bound will be
 * read as a result about the thing measured*:
 *
 *  - **the sample interval and the window**, so a state that lived between two samples is a missing
 *    reading and not a negative one — the 263 ms `MediaStore` publish, `CLAUDE.md`'s sixth row;
 *  - **the process importance at every sample**, because `moveTaskToBack` is a *request* to go to
 *    the background and importance is the measurement of whether it happened. A registration line
 *    is not an execution line;
 *  - **`stopped=`** — `window`, `no-stimulus`, or `control-failed` — so a run that ended itself
 *    cannot be read as the platform ending it;
 *  - **and whether the stimulus ever arrived.** This is the one that would otherwise sink the run:
 *    with reads blocked, *the user never copied anything* and *every read was refused* produce the
 *    identical silence. `verify` resolves it from the foreground afterwards — if the foreign clip is
 *    there when we are focused, the operator did copy and the background nulls were refusals; if it
 *    is not, this run holds **no reading at all** and says so.
 *
 * Nothing here logs clipboard **text**. Length, MIME, label, `EXTRA_IS_SENSITIVE` and whether it is
 * still the marker we wrote — never the content. A probe for a feature whose whole risk is other
 * people's passwords must not put one in `logcat`, and `LinkLog` writes to a rotating file on disk.
 *
 * ### Running it
 *
 * ```
 * # reading 1 + 2 + 3, with the accessibility service ENABLED
 * adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ClipProbeActivity \
 *   --es mode foreign --ei seconds 45
 * # …then, while it samples, copy any text in any other app on the phone…
 * adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ClipProbeActivity \
 *   --es mode verify
 *
 * # reading 4: turn the accessibility service off in Settings, then repeat both commands
 *
 * # the write direction, which §2 does not name and which nothing else measures either
 * adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ClipProbeActivity \
 *   --es mode write
 * adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ClipProbeActivity \
 *   --es mode verify
 * ```
 *
 * Read: `adb logcat -s ClipProbe:V`. The platform's own refusal, if it refuses, is
 * `ClipboardService: Denying clipboard access to …` — worth watching in the same window, since its
 * presence names the refuser even though its absence proves nothing.
 */
class ClipProbeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        run(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        run(intent)
    }

    private fun run(intent: Intent) {
        val mode = intent.getStringExtra("mode") ?: "foreign"
        val seconds = intent.getIntExtra("seconds", 45)
        Log.i(TAG, "--- clip probe: mode=$mode window=${seconds}s interval=${INTERVAL_MS}ms ---")
        logEnvironment()

        when (mode) {
            "foreign" -> startForeignRun(seconds)
            "write" -> startWriteRun(seconds)
            "verify" -> verify()
            else -> Log.w(TAG, "unknown mode '$mode' — nothing was measured. Use foreign, write or verify.")
        }
    }

    // --- the environment every reading has to be interpreted against ------------------------------

    private fun logEnvironment() {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
        val ours = enabled != null && TextUtils.SimpleStringSplitter(':').also { it.setString(enabled) }
            .any { it.startsWith("$packageName/") }
        val ime = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
        Log.i(
            TAG,
            "ENV sdk=${Build.VERSION.SDK_INT} targetSdk=${applicationInfo.targetSdkVersion} " +
                "package=$packageName accessibilityServiceOfOurs=$ours defaultImeIsOurs=" +
                "${ime?.startsWith("$packageName/") == true}",
        )
        // The raw string, not only the boolean: reading 4 is the same command with this changed, and
        // "it was off, I think" is not a control.
        Log.i(TAG, "ENV enabled_accessibility_services=${enabled ?: "<null>"}")
        Log.i(TAG, "ENV default_input_method=${ime ?: "<null>"}")
    }

    // --- readings 1-3 -----------------------------------------------------------------------------

    private fun startForeignRun(seconds: Int) {
        val marker = "CS-PROBE-${System.currentTimeMillis()}"
        // `ours` is set before the write, not after it: the listener fires *during* the control
        // write, and a callback that reported `stillOurMarker=false` about the marker we were in
        // the act of writing would be the instrument describing its own lag as a finding.
        ours = marker
        registerListener()
        if (!foregroundControl(marker)) return

        Log.i(
            TAG,
            "STIMULUS: copy any text in any other app now. This run samples for ${seconds}s; " +
                "then run the same command with --es mode verify.",
        )
        moveTaskToBack(true)
        sampleInBackground(seconds) { elapsed, sample ->
            Log.i(TAG, "SAMPLE t=${elapsed}ms $sample")
        }
    }

    /**
     * Reading 1, and the run's precondition rather than one of its results.
     *
     * Writes a marker and reads it straight back while focused. If this does not come back, the
     * clipboard is not readable *at all* on this build and every later null is uninterpretable —
     * so the run stops here and says which of the two it is.
     */
    private fun foregroundControl(marker: String): Boolean {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("ConnectSuite probe", marker))
        val back = runCatching { clipboard.primaryClip }.getOrNull()
        val text = back?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
        val matched = text == marker
        Log.i(
            TAG,
            "CONTROL foreground read of our own clip: returned=${back != null} " +
                "items=${back?.itemCount ?: 0} matchedOurMarker=$matched " +
                "length=${text?.length ?: -1} ${describe(back?.description)}",
        )
        if (!matched) {
            Log.w(
                TAG,
                "stopped=control-failed — the foreground read did not return the marker this probe " +
                    "had just written, so nothing measured afterwards could be told from a broken " +
                    "instrument. No reading was taken.",
            )
        }
        return matched
    }

    // --- the write direction, which nothing else in this repo measures ----------------------------

    private fun startWriteRun(seconds: Int) {
        val marker = "CS-PROBE-WRITE-${System.currentTimeMillis()}"
        wroteFromBackground = marker
        ours = marker
        Log.i(TAG, "WRITE run: backgrounding, then writing '$marker' from the background in 3s")
        moveTaskToBack(true)
        Handler(Looper.getMainLooper()).postDelayed({
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val importance = importance()
            val threw = runCatching {
                clipboard.setPrimaryClip(ClipData.newPlainText("ConnectSuite probe", marker))
            }.exceptionOrNull()
            Log.i(
                TAG,
                "WRITE attempted from importance=$importance (${importanceName(importance)}) " +
                    "threw=${threw?.javaClass?.simpleName ?: "no"} — a call that does not throw is " +
                    "not a clipboard that changed; run --es mode verify to read the effect.",
            )
            // The write is the stimulus; the effect is read in verify, from the foreground, because
            // reading it here would measure the thing under test with the thing under test.
            sampleInBackground(seconds) { elapsed, sample -> Log.i(TAG, "SAMPLE t=${elapsed}ms $sample") }
        }, 3_000)
    }

    /**
     * Reading 5 — the observer half of the wall, and it has its own known positive.
     *
     * Registered *before* [foregroundControl] writes its marker, so the control write must produce
     * exactly one callback while we are focused. A listener that stays silent through that is not
     * wired up, and nothing it fails to report afterwards is evidence about the platform. Every
     * callback logs whether the read it then attempted succeeded, because the two are separable:
     * a delivered callback over a refused read is a real state and it is the worst one to guess at.
     */
    private fun registerListener() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        listenerCallbacks = 0
        listenerCallbacksWhileBackground = 0
        val listener = ClipboardManager.OnPrimaryClipChangedListener {
            val importance = importance()
            val clip = runCatching { clipboard.primaryClip }.getOrNull()
            val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
            listenerCallbacks++
            if (importance != ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                listenerCallbacksWhileBackground++
            }
            Log.i(
                TAG,
                "LISTENER fired #$listenerCallbacks importance=$importance " +
                    "(${importanceName(importance)}) readAfterCallback=${clip != null} " +
                    "stillOurMarker=${text != null && text == ours} length=${text?.length ?: -1}",
            )
        }
        clipboard.addPrimaryClipChangedListener(listener)
        registered = listener
        Log.i(TAG, "LISTENER registered — the foreground control write below must fire it once, or it is not wired up")
    }

    // --- the sampler ------------------------------------------------------------------------------

    /**
     * Samples the clipboard on a fixed interval and reports every one of them, including the ones
     * that returned nothing.
     *
     * A run reports `stopped=window`: it ends because the window ended, which is the instrument's
     * own bound and is therefore in the output. Nothing here concludes anything — the conclusion
     * needs [verify], because a silent window has two causes and this end of it cannot separate
     * them.
     */
    private fun sampleInBackground(seconds: Int, onSample: (Long, String) -> Unit) {
        val startedAt = System.currentTimeMillis()
        val deadline = startedAt + seconds * 1000L
        var samples = 0
        var readable = 0
        var foreign = 0
        var backgroundSamples = 0

        val handler = Handler(Looper.getMainLooper())
        lateinit var tick: Runnable
        tick = Runnable {
            val now = System.currentTimeMillis()
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val importance = importance()
            val clip = runCatching { clipboard.primaryClip }.getOrNull()
            val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
            val isOurs = text != null && text == ours
            samples++
            if (importance != ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) backgroundSamples++
            if (clip != null) readable++
            if (clip != null && !isOurs) foreign++

            onSample(
                now - startedAt,
                "importance=$importance (${importanceName(importance)}) returned=${clip != null} " +
                    "items=${clip?.itemCount ?: 0} stillOurMarker=$isOurs length=${text?.length ?: -1} " +
                    "${describe(clip?.description)}",
            )

            if (now < deadline) {
                handler.postDelayed(tick, INTERVAL_MS)
            } else {
                lastRun = RunSummary(samples, backgroundSamples, readable, foreign)
                Log.i(
                    TAG,
                    "stopped=window — $samples samples over ${seconds}s at ${INTERVAL_MS}ms, " +
                        "$backgroundSamples of them taken while not foreground; " +
                        "$readable readable / ${samples - readable} refused-or-empty; " +
                        "$foreign of the readable ones were NOT our marker; " +
                        "listener fired $listenerCallbacks times, " +
                        "$listenerCallbacksWhileBackground of them while not foreground " +
                        "(one foreground callback is the control — zero means the listener is not wired up, " +
                        "not that the platform withheld it).",
                )
                Log.i(
                    TAG,
                    "NOT A CONCLUSION YET: with 0 foreign reads, 'reads are blocked' and 'nothing " +
                        "was ever copied' look identical from here. Run --es mode verify.",
                )
            }
        }
        handler.postDelayed(tick, INTERVAL_MS)
    }

    // --- the verification that turns a silence into a reading, or into no reading -----------------

    private fun verify() {
        val summary = lastRun
        if (summary == null) {
            Log.w(TAG, "stopped=no-run — nothing has sampled in this process. Start with --es mode foreign.")
            return
        }
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = runCatching { clipboard.primaryClip }.getOrNull()
        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
        val stillOurs = text != null && text == ours
        Log.i(
            TAG,
            "VERIFY foreground read: returned=${clip != null} stillOurMarker=$stillOurs " +
                "length=${text?.length ?: -1} ${describe(clip?.description)}",
        )

        val wrote = wroteFromBackground
        if (wrote != null) {
            Log.i(
                TAG,
                if (text == wrote) {
                    "READING (write direction): the background setPrimaryClip LANDED — the marker " +
                        "written while not foreground is the clip we can now read while focused."
                } else {
                    "READING (write direction): the background setPrimaryClip DID NOT LAND — the " +
                        "call did not throw and the clipboard does not hold the marker. A silent " +
                        "no-op, which is the failure mode a Mac would never see."
                },
            )
            return
        }

        when {
            summary.foreign > 0 -> Log.i(
                TAG,
                "READING: background reads of a FOREIGN clip SUCCEEDED — ${summary.foreign} of " +
                    "${summary.samples} samples, ${summary.backgroundSamples} of which were taken " +
                    "while not foreground. Interpret against the ENV lines above: with our " +
                    "accessibility service enabled this is the documented behaviour; the control " +
                    "run with it disabled is what says the grant is why.",
            )
            !stillOurs && clip != null -> Log.w(
                TAG,
                "READING: background reads were REFUSED. The clipboard now holds a clip that is " +
                    "not ours and is readable from the foreground, so the stimulus did arrive and " +
                    "${summary.samples - summary.readable} silent samples were refusals, not an " +
                    "absence of anything to read.",
            )
            else -> Log.w(
                TAG,
                "stopped=no-stimulus — the clipboard still holds our own marker, so nothing was " +
                    "ever copied by another app and THIS RUN HOLDS NO READING. Not a negative " +
                    "result: the stimulus never happened. Repeat, and copy something in another " +
                    "app while it samples.",
            )
        }
    }

    // --- helpers ----------------------------------------------------------------------------------

    /** Everything about a clip except its contents. */
    private fun describe(description: ClipDescription?): String {
        if (description == null) return "description=<none>"
        val sensitive = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            description.extras?.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE, false) ?: false
        } else {
            description.extras?.getBoolean("android.content.extra.IS_SENSITIVE", false) ?: false
        }
        val mimes = (0 until description.mimeTypeCount).joinToString(",") { description.getMimeType(it) }
        return "label='${description.label}' mimes=[$mimes] isSensitive=$sensitive"
    }

    private fun importance(): Int {
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        return info.importance
    }

    private fun importanceName(importance: Int): String = when (importance) {
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "foreground"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "foreground-service"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "visible"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE -> "perceptible"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED -> "cached"
        else -> "other"
    }

    private data class RunSummary(
        val samples: Int,
        val backgroundSamples: Int,
        val readable: Int,
        val foreign: Int,
    )

    private companion object {
        const val TAG = "ClipProbe"

        /**
         * 500 ms, and it is in every summary line for the reason `CLAUDE.md` records: a window that
         * falls between two samples is a missing reading, not a negative one. This probe is not
         * chasing a 263 ms window — the clipboard holds its state until something replaces it — so
         * the interval bounds latency, not detection. It is reported anyway, because a bound the
         * instrument imposes belongs in what it reports whether or not it mattered this time.
         */
        const val INTERVAL_MS = 500L

        /** The marker this probe last wrote, so a clip can be told from our own echo. */
        @Volatile
        var ours: String? = null

        /** Reading 5's counters. The foreground control callback is included and is the positive. */
        @Volatile
        var listenerCallbacks = 0

        @Volatile
        var listenerCallbacksWhileBackground = 0

        /** Held so the listener is not collected; a probe whose listener vanished measures nothing. */
        @Volatile
        var registered: ClipboardManager.OnPrimaryClipChangedListener? = null

        /** Set only by the write run, so `verify` knows which question it is answering. */
        @Volatile
        var wroteFromBackground: String? = null

        @Volatile
        var lastRun: RunSummary? = null
    }
}
