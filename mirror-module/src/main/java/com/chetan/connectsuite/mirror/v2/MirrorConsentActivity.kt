package com.chetan.connectsuite.mirror.v2

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import com.chetan.connectsuite.core.link.LinkLog
import java.util.concurrent.atomic.AtomicReference

/**
 * The one screen the user must tap for every mirror session.
 *
 * MediaProjection consent cannot be cached — Android 14 re-asks every time, by design — so this
 * is not something that can be tidied away behind a setting. It exists to carry the system
 * prompt's result back to [MirrorEngine], and to separate two outcomes where it can:
 *
 *  - a result came back, and it was not RESULT_OK  -> [MirrorFailure.ConsentDenied]
 *  - the activity died before any result arrived   -> [MirrorFailure.ConsentDismissed]
 *
 * **The split is narrower than it looks, and measurement has now bounded it.** Everything that
 * dismisses the system dialog *while it is on screen* comes back through `onActivityResult` as
 * RESULT_CANCELED and is therefore reported as "denied":
 *
 *  - tapping Cancel,
 *  - pressing back,
 *  - **locking the phone with the power button** — measured on SM-S938B / Android 16 on
 *    2026-08-26, twice; see the recorded run in `docs/testing.md`.
 *
 * That last one was previously documented here as producing [MirrorFailure.ConsentDismissed]. It
 * does not, and cannot: the platform answers the request rather than destroying the activity under
 * it. The phone has no way to tell a deliberate refusal from a lock, so it says "denied" for both,
 * which is the honest reading of what it is actually told.
 *
 * What is left for [MirrorFailure.ConsentDismissed] is the activity dying with the request still
 * outstanding, which in practice means [request] superseding a pending callback with a newer one.
 * It is reachable, but it is not the screen-lock case and must not be described as one.
 *
 * There is a third outcome it deliberately does *not* report: the prompt never appearing. On
 * Android 16 a start issued from the background is dropped by the system without an exception, so
 * this class never runs and cannot say anything about it. [MirrorEngine] handles that case ahead
 * of time by only launching this from a visible Activity, and bounds what is left with a timeout.
 */
class MirrorConsentActivity : Activity() {

    private var resultDelivered = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Android refuses a projection behind the keyguard, and capture would be black anyway.
        // Checking first turns a confusing system failure into a sentence the user can act on.
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (keyguard.isKeyguardLocked) {
            resultDelivered = true
            deliver(null, MirrorFailure.PhoneLocked)
            finish()
            return
        }

        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        try {
            startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CONSENT)
        } catch (e: Exception) {
            resultDelivered = true
            deliver(null, MirrorFailure.EncoderInitFailed("no screen capture activity: ${e.message}"))
            finish()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CONSENT) return
        resultDelivered = true
        if (resultCode == RESULT_OK && data != null) {
            LinkLog.i("mirror", "Screen capture consent granted")
            deliver(data, null)
        } else {
            LinkLog.w("mirror", "Screen capture consent denied")
            deliver(null, MirrorFailure.ConsentDenied)
        }
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (!resultDelivered) {
            // Never answered: swiped away, screen locked under it, or the task was cleared.
            LinkLog.w("mirror", "Screen capture prompt dismissed without an answer")
            deliver(null, MirrorFailure.ConsentDismissed)
        }
    }

    private fun deliver(data: Intent?, failure: MirrorFailure?) {
        pending.getAndSet(null)?.invoke(data, failure)
    }

    companion object {
        private const val REQUEST_CONSENT = 4201

        /**
         * Where the result goes. A static handoff rather than a bound service because the caller
         * is a socket handler with no Context of its own and no lifecycle to bind against; the
         * reference is cleared as soon as it fires so a stale request cannot be answered twice.
         */
        private val pending = AtomicReference<((Intent?, MirrorFailure?) -> Unit)?>(null)

        /**
         * Shows the prompt and calls [onResult] exactly once with either the consent Intent or the
         * failure that explains its absence.
         *
         * [from] must be a visible Activity. That is not a convenience — it is the requirement
         * that makes the start legal at all on Android 16, where a start from an Application
         * context is dropped silently and this class simply never runs. The type says Activity so
         * that cannot be passed by accident again.
         *
         * No `FLAG_ACTIVITY_NEW_TASK`: the shim belongs on top of the screen the user is already
         * looking at, and a new task is both unnecessary and the shape the blocked start had.
         */
        fun request(from: Activity, onResult: (Intent?, MirrorFailure?) -> Unit) {
            val previous = pending.getAndSet(onResult)
            previous?.invoke(null, MirrorFailure.ConsentDismissed)
            from.startActivity(
                Intent(from, MirrorConsentActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION),
            )
        }

        /**
         * Drops a request nobody is waiting for any more.
         *
         * Called when the consent deadline expires: without it a prompt answered a minute later
         * would restart capture for a session the Mac has already been told is dead.
         */
        fun cancelPending() {
            pending.set(null)
        }
    }
}
