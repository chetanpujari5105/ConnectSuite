package com.chetan.connectsuite.input

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.content.Context
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.chetan.connectsuite.core.link.LinkAutoStart
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkStartReason
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The one thing on the phone that can actually touch the screen.
 *
 * Everything Phase 3 does goes through three platform calls and no others: `dispatchGesture` for
 * anything with coordinates, `performGlobalAction` for back/home/recents and friends, and
 * `ACTION_SET_TEXT` on the focused node for text. There is no fourth mechanism — no key events, no
 * `adb shell input`, no shell at all — and the walls that follow from that are written down in
 * docs/protocol.md and in CLAUDE.md's platform walls.
 *
 * The user enables this by hand in Settings and can revoke it the same way, which is why
 * [onServiceConnected] and [onUnbind] both tell the link to recompute its capabilities: that is
 * what makes the Mac's `input` chip go live and grey again **without a reconnect**.
 */
class ConnectSuiteInputService : AccessibilityService() {

    /**
     * Serialises gestures.
     *
     * Android dispatches one gesture at a time and drops any that arrives while another is in
     * flight — silently, with the callback never firing. A drag that reached us as thirty small
     * strokes would therefore deliver the first and lose twenty-nine, which is worse than either
     * doing it properly or refusing. So each gesture waits for the one before it, and the Mac's
     * side coalesces a drag into a single stroke before sending it at all.
     */
    private val gestureLock = Mutex()

    override fun onServiceConnected() {
        super.onServiceConnected()
        connected = this
        LinkLog.i("input", "Accessibility service connected")
        // The permission half of the `input` capability has just flipped. Recomputing here is what
        // makes the Mac's chip light up mid-session instead of at the next handshake.
        announceCapabilityChange()

        // **Defect 80.** Being bound is a way this process comes up, and until this line it was the
        // only one with nothing behind it. At boot a broadcast follows within seconds; after a
        // low-memory kill, after this service is toggled, or after a crash `START_STICKY` did not
        // catch, nothing does — and the app sat alive, granted, feature-complete and with no
        // listening socket for as long as nobody opened it.
        //
        // The decision is not here: whether anything is paired, whether the link is already up, and
        // what to do when the trust store will not answer all live in `LinkAutoStart.ensureRunning`,
        // which the boot receiver and the notification-listener rebind also call. A rule written
        // three times would be three things to get wrong. This is idempotent and logs
        // `already listening — nothing to do` with its reason attached, which is the usual outcome
        // and is the point: it costs nothing when the link is fine and is the only thing watching
        // when it is not.
        LinkAutoStart.ensureRunning(this, LinkStartReason.ACCESSIBILITY_BIND)
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        connected = null
        LinkLog.i("input", "Accessibility service disconnected")
        // Twice, deliberately. The immediate call covers the usual case; the delayed one covers
        // the race where Settings has unbound us but has not yet written the secure setting that
        // `CapabilityDetector` reads, which would otherwise leave `input` advertised over a
        // service that is gone.
        announceCapabilityChange()
        Handler(Looper.getMainLooper()).postDelayed(
            { announceCapabilityChange() },
            CAPABILITY_RECHECK_MS,
        )
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        connected = null
        announceCapabilityChange()
        super.onDestroy()
    }

    /**
     * Nothing. The service config subscribes to no event types, because this service watches
     * nothing — it only acts when the Mac asks it to.
     *
     * That is a privacy decision as much as an efficiency one: an accessibility service that
     * receives window-content events sees everything the user reads, and this one has no reason
     * to.
     */
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    private fun announceCapabilityChange() {
        runCatching { LinkController.get(applicationContext).refreshCapabilities() }
            .onFailure { LinkLog.w("input", "Could not refresh capabilities: ${it.message}") }
    }

    // ---- gestures --------------------------------------------------------------------------

    /**
     * The package of the app in front, or null if it cannot be read.
     *
     * Pulled on demand from the active window rather than by subscribing to window-change events.
     * That distinction is the whole privacy stance of this service: `accessibilityEventTypes` stays
     * empty, so nothing streams to us, and this reads one field of one node at the moment a gesture
     * is about to be dispatched. The package name is compared and discarded — no window contents
     * are read, and nothing is retained.
     */
    fun foregroundPackage(): String? = runCatching {
        val root = rootInActiveWindow ?: return@runCatching null
        try {
            root.packageName?.toString()
        } finally {
            @Suppress("DEPRECATION")
            root.recycle()
        }
    }.getOrNull()

    /**
     * Dispatches one stroke through [points] and waits for the system to say what became of it.
     *
     * Waiting is the point. `dispatchGesture` returns true for "accepted for dispatch", not for
     * "happened", so acking on the return value would tell the Mac a tap landed when the system
     * had cancelled it a frame later. The callback is the only thing that knows.
     *
     * [aimedAt] is the package that was in front when this gesture arrived; see [foregroundGuard].
     */
    suspend fun stroke(
        points: List<DisplayPoint>,
        durationMs: Long,
        aimedAt: String? = null,
    ): InputFailure? {
        if (points.isEmpty()) return InputFailure.BadRequest("a stroke needs at least one point")
        val path = Path().apply {
            moveTo(points.first().x, points.first().y)
            if (points.size == 1) {
                // A tap is one point, and a path of one point has zero length. Some Android
                // versions validate a stroke's length rather than its emptiness and reject that,
                // so the path is given half a pixel of travel: enough to have a length, far too
                // little to reach a different pixel, and invisible to any hit test on the phone.
                lineTo(points.first().x + HAIRLINE_PX, points.first().y)
            }
            for (point in points.drop(1)) lineTo(point.x, point.y)
        }
        val stroke = try {
            GestureDescription.StrokeDescription(path, 0, durationMs)
        } catch (e: IllegalArgumentException) {
            // Thrown for an empty path, a zero duration, or coordinates off the display. All of
            // those are the Mac having computed something impossible, and naming it beats a crash.
            return InputFailure.BadRequest("the phone rejected that path: ${e.message}")
        }
        return dispatch(GestureDescription.Builder().addStroke(stroke).build(), durationMs, aimedAt)
    }

    private suspend fun dispatch(
        gesture: GestureDescription,
        durationMs: Long,
        aimedAt: String?,
    ): InputFailure? {
        val budget = durationMs + GESTURE_GRACE_MS
        return gestureLock.withLock {
            // Checked *inside* the lock, which is the only place it means anything: the wait for
            // the gesture ahead of this one is exactly the window in which the foreground app can
            // change, and defect 20 was a queue draining onto whatever had taken focus meanwhile.
            val nowInFront = foregroundPackage()
            foregroundGuard(aimedAt, nowInFront)?.let { failure ->
                LinkLog.w(
                    "input",
                    "Gesture dropped: aimed at $aimedAt but $nowInFront is in front now",
                )
                return@withLock failure
            }
            val started = SystemClock.uptimeMillis()
            val outcome = awaitGestureResult(budget) { sink ->
                // The `null` handler is deliberate and was measured, not assumed: the platform
                // delivers `onPerformGestureResult` on this service's main looper first and only
                // then re-posts to whatever handler is passed here, so a handler of our own
                // changes which thread `completed()` runs on and never whether it arrives. See
                // defect 18's probe in docs/testing.md.
                dispatchGesture(
                    gesture,
                    object : GestureResultCallback() {
                        override fun onCompleted(description: GestureDescription?) = sink.completed()
                        override fun onCancelled(description: GestureDescription?) = sink.cancelled()
                    },
                    null,
                )
            }
            val elapsed = SystemClock.uptimeMillis() - started
            when (outcome) {
                // Logged, and logged at the same volume as the failures. A log that records only
                // refusals cannot tell "input is completely broken" from "input mostly works",
                // which is the whole reason defect 18 survived 197 gestures unnoticed.
                GestureOutcome.Completed -> {
                    LinkLog.i(
                        "input",
                        "Gesture landed in ${elapsed}ms (${durationMs}ms stroke, ${budget}ms budget)",
                    )
                    null
                }

                is GestureOutcome.Failed -> {
                    LinkLog.w(
                        "input",
                        "Gesture failed after ${elapsed}ms of a ${budget}ms budget: " +
                            outcome.failure.reason,
                    )
                    outcome.failure
                }
            }
        }
    }

    // ---- global actions --------------------------------------------------------------------

    fun global(action: GlobalAction): InputFailure? =
        if (performGlobalAction(action.action)) {
            null
        } else {
            InputFailure.GestureRefused("the phone refused the ${action.wire} action")
        }

    // ---- text ------------------------------------------------------------------------------

    /**
     * Replaces or extends the focused editable field's contents.
     *
     * There is no typing here and there cannot be: `ACTION_SET_TEXT` writes the whole field in one
     * operation, so IME composing state and autocorrect are lost either way and a password field
     * will usually refuse outright. Both of those are documented in docs/protocol.md rather than
     * worked around, because there is no way around them.
     */
    fun setText(text: String, append: Boolean): InputFailure? {
        val node = focusedEditable() ?: return InputFailure.NoEditableFocus
        return try {
            val value = if (append) (node.text?.toString() ?: "") + text else text
            writeText(node, value)
        } finally {
            @Suppress("DEPRECATION")
            node.recycle()
        }
    }

    /** Backspace: the only editing key that can be honoured, and only by rewriting the field. */
    fun backspace(): InputFailure? {
        val node = focusedEditable() ?: return InputFailure.NoEditableFocus
        return try {
            val existing = node.text?.toString().orEmpty()
            // An empty field is not a failure — pressing backspace in one does nothing on a real
            // keyboard too, and reporting an error for it would put a red line on the Mac for a
            // keystroke that behaved exactly as expected.
            if (existing.isEmpty()) null else writeText(node, existing.dropLast(1))
        } finally {
            @Suppress("DEPRECATION")
            node.recycle()
        }
    }

    /** The IME's action key — Search, Send, Go, Next — on the focused field. Android 11+. */
    fun imeEnter(): InputFailure? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return InputFailure.UnsupportedKey(
                key = InputKeys.ENTER,
                why = "this phone runs Android ${Build.VERSION.RELEASE}, and the accessibility " +
                    "action for the Enter key was only added in Android 11",
            )
        }
        val node = focusedEditable() ?: return InputFailure.NoEditableFocus
        return try {
            if (node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)) {
                null
            } else {
                InputFailure.GestureRefused("the focused field refused the Enter action")
            }
        } finally {
            @Suppress("DEPRECATION")
            node.recycle()
        }
    }

    private fun writeText(node: AccessibilityNodeInfo, value: String): InputFailure? {
        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
        }
        return if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)) {
            null
        } else {
            // The common cause by far is a password field, which refuses SET_TEXT by design.
            InputFailure.GestureRefused(
                "the focused field would not accept text — password fields refuse this",
            )
        }
    }

    private fun focusedEditable(): AccessibilityNodeInfo? {
        val focused = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return null
        if (focused.isEditable) return focused
        @Suppress("DEPRECATION")
        focused.recycle()
        return null
    }

    companion object {
        /**
         * The connected instance, or null when the user has not enabled the service.
         *
         * This is the truth about whether input can work, more so than the secure setting the
         * capability detector reads: the setting says the user granted it, this says the system
         * has actually bound us and `dispatchGesture` has somewhere to go.
         */
        @Volatile
        private var connected: ConnectSuiteInputService? = null

        fun peek(): ConnectSuiteInputService? = connected

        fun isConnected(): Boolean = connected != null

        /** Half a pixel: a tap's path needs a non-zero length without moving the target. */
        private const val HAIRLINE_PX = 0.5f

        /** Android may take a moment to write the secure setting after unbinding us. */
        private const val CAPABILITY_RECHECK_MS = 1_000L

        /**
         * How long past a gesture's own duration it gets to report back.
         *
         * **Measured, not guessed** — the 2000ms this used to be was never compared against
         * anything, because defect 18 meant the branch that printed it was reached by every
         * *successful* gesture. 184 gestures on an S25 Ultra (Android 16) with mirroring running
         * at 1080p60 and a 120Hz list flinging under it, across 60/100/200/400ms strokes:
         *
         * | overhead over the stroke's own duration | median | p95 | p99 | max |
         * |---|---|---|---|---|
         * | | 4ms | 15ms | 19ms | 20ms |
         *
         * Zero failures in that run, and zero cancellations in the 197 real gestures logged
         * before it. So the mechanism needs about 20ms and this is 25× that.
         *
         * The headroom is not for the dispatch — it is for the *delivery*. The platform hands the
         * result to this service's main looper before anything else touches it, so a main-thread
         * stall (a GC pause, a recomposition storm) delays the callback no matter how quickly the
         * gesture itself finished. Half a second absorbs a stall that would already be visible as
         * jank, and refuses beyond that.
         *
         * Erring generous is deliberate and asymmetric. Too tight tells the user a tap failed when
         * it landed, which is defect 18's exact class of lie and cost two days. Too loose only
         * delays the gesture queued behind a genuinely stuck one — and at 5s, the protocol's
         * longest gesture, the total stays at 5.5s, inside the Mac's own 9s request timeout
         * (`InputClient.TIMEOUT_MS`) so the two ends cannot disagree about who gave up.
         */
        private const val GESTURE_GRACE_MS = 500L

        /** True when the keyguard is up, in which case nothing will be delivered anyway. */
        fun isPhoneLocked(context: Context): Boolean {
            val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            return keyguard?.isKeyguardLocked == true
        }
    }
}
