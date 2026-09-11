package com.chetan.connectsuite.mirror.v2

import com.chetan.connectsuite.core.link.BackgroundRestriction

/**
 * Every way a mirror session can end, each with the sentence the Mac draws on its canvas.
 *
 * ### What this replaces, and why it is a defect rather than a tidy-up
 *
 * `MirrorEngine.stop` took a free `String`, and eight call sites wrote eight of them by hand:
 *
 * ```
 * "restarted by the Mac"      "the Mac disconnected"      "mirror feature uninstalled"
 * "restarted from the phone"  "stopped on the phone"      "mirror service destroyed"
 * "stopped by the Mac"        "screen capture was stopped on the phone"   ← the platform's
 * ```
 *
 * Two of them differ **by three words**. *"Stopped on the phone."* is the user tapping Stop in the
 * Mirror tab. *"Screen capture was stopped on the phone."* is `MediaProjection.Callback.onStop` —
 * Android taking the projection away — and it was the only thing the app ever said when the
 * background restriction was killing every session 107-116 ms in (defect 102). Eight attempts, one
 * sentence, and the sentence pointed at the phone's user as though they had done it.
 *
 * ### The platform hands back no reason, so this derives one
 *
 * There is no stop reason in the public API at any SDK level this app can compile against:
 * `MediaProjection.Callback` on `android.jar` 36.1 is `onStop()`, `onCapturedContentResize` and
 * `onCapturedContentVisibilityChanged`, and `MediaProjection.stop()` takes no argument. So
 * [AndroidRevokedWhileRestricted] and [AndroidRevoked] are **derived** by asking the one question
 * the app can answer at that instant — is this app background-restricted right now — and nothing
 * more is inferred than that reading supports.
 *
 * That is why there is no third member for *"the user tapped Stop in the status bar"*. It is the
 * commonest benign revoke and it would be a pleasant sentence to write, and from inside the app it
 * is **indistinguishable** from an unexplained revoke: same callback, no argument, no extra, and
 * the foreground service is alive in both. This is the folder-picker rule — when the platform
 * returns one result for two intents, nothing may be explained afterwards — so [AndroidRevoked]
 * names both possibilities rather than picking the likelier one and being confidently wrong half
 * the time.
 */
sealed class MirrorStopReason(
    /**
     * **Who ended the session.** The thing the eight strings got wrong, promoted to a field.
     *
     * The original defect was not that two sentences were similar — similarity is a symptom. It
     * was that a stop caused by *Android* was worded as a stop caused by *the person holding the
     * phone*, so eight sessions in a row told their owner they had done something they had not.
     * A string-distance check over the sentences is a proxy for that and a weak one: it passed
     * with the exact defect sentence restored, because the sibling sentence had meanwhile been
     * reworded. The attribution is the rule, so it is data on the type and the test asserts that
     * the sentence agrees with it.
     */
    val actor: Actor,
    /** One word for a log line. Never shown to anybody. */
    val label: String,
    /** Shown verbatim: the Mac's canvas and the phone's Mirror tab get this same string. */
    val sentence: String,
    /** Second line, when there is something the user can do. */
    val fixHint: String? = null,
) {

    /** Who ended it. Four, and the distinction that matters is the first against the second. */
    enum class Actor {
        /** The platform took the projection away. Nobody in this room asked for it. */
        ANDROID,

        /** Somebody tapped something on the phone. */
        PHONE_USER,

        /** The Mac asked, or stopped being there to ask. */
        MAC,

        /** This app's own teardown — a service destroyed, a feature uninstalled, a failure. */
        APP,
    }

    /** A second `mirror.start` arrived from the Mac while one was running. */
    data object RestartedByMac : MirrorStopReason(
        actor = Actor.MAC,
        label = "restarted-by-mac",
        sentence = "Mirroring restarted from the Mac.",
    )

    /** Start was tapped again in the phone's Mirror tab. */
    data object RestartedFromPhone : MirrorStopReason(
        actor = Actor.PHONE_USER,
        label = "restarted-from-phone",
        sentence = "Mirroring restarted from the phone.",
    )

    /** The control session went away, so there is nobody to send frames to. */
    data object MacDisconnected : MirrorStopReason(
        actor = Actor.MAC,
        label = "mac-disconnected",
        sentence = "The Mac disconnected, so mirroring stopped.",
    )

    /** The person holding the phone tapped Stop in the Mirror tab. */
    data object StoppedFromPhone : MirrorStopReason(
        actor = Actor.PHONE_USER,
        label = "stopped-from-phone",
        sentence = "You stopped mirroring on the phone.",
    )

    /** `mirror.stop` from the Mac. */
    data object StoppedByMac : MirrorStopReason(
        actor = Actor.MAC,
        label = "stopped-by-mac",
        sentence = "Mirroring was stopped from the Mac.",
    )

    /** The feature module was torn down — a disconnect or a shutdown, not a user action. */
    data object FeatureUninstalled : MirrorStopReason(
        actor = Actor.APP,
        label = "feature-uninstalled",
        sentence = "Mirroring stopped because the phone shut the mirror feature down.",
    )

    /** The foreground service hosting capture was destroyed. */
    data object ServiceDestroyed : MirrorStopReason(
        actor = Actor.APP,
        label = "service-destroyed",
        sentence = "The phone's screen-recording service stopped, so capture ended.",
    )

    /**
     * `onStop` fired, and `isBackgroundRestricted()` read **true** at that instant.
     *
     * The sentence somebody could have acted on eight times on 2026-09-10 instead of reading
     * *"Screen capture was stopped on the phone"* and looking at the phone.
     *
     * It states the mechanism as a *consequence of a reading* rather than as a certainty about
     * causation — the restriction is measured, the revoke is observed, and their connection on
     * this handset is measured too (lifting the op produced a 6 min 33 s session on the first tap,
     * after eight consecutive deaths). On a phone where those two turn out to be unrelated this
     * sentence is still the most useful thing the app can say, because the restriction is real and
     * is worth fixing whether or not it caused this particular stop.
     */
    data object AndroidRevokedWhileRestricted : MirrorStopReason(
        actor = Actor.ANDROID,
        label = "android-revoked-restricted",
        sentence = "Android stopped the capture because ConnectSuite's screen-recording service " +
            "lost its foreground status. This app is background-restricted on this phone.",
        fixHint = BackgroundRestriction.STEPS,
    )

    /**
     * `onStop` fired and this app is **not** restricted, so the cause is one of two things the
     * platform gives the app no way to tell apart. Both are named; neither is claimed.
     */
    data object AndroidRevoked : MirrorStopReason(
        actor = Actor.ANDROID,
        label = "android-revoked",
        sentence = "Android ended the screen capture.",
        fixHint = "This happens when Stop is tapped in the phone's notification shade, and when " +
            "Android takes the capture back for its own reasons. The phone does not get told " +
            "which, so start mirroring again if you did not stop it.",
    )

    /**
     * A [MirrorFailure] tore the session down and has already said why.
     *
     * Carries the failure's own sentence so `stop()` does not overwrite it with a mechanical one —
     * which is what the `stop(failure.reason)` call site was working around by re-publishing the
     * failure on top afterwards.
     */
    class Failed(failure: MirrorFailure) : MirrorStopReason(
        actor = Actor.APP,
        label = "failed-${failure.label}",
        sentence = failure.reason,
        fixHint = failure.fixHint,
    )

    companion object {
        /**
         * Which of the two revoke sentences applies, given the reading taken at that instant.
         *
         * Pure, and separate from the callback, so a JVM test can reach the decision — the
         * `LinkWaitStatus` lesson: a rule that lives inside a platform callback is a rule no test
         * can call.
         */
        fun revoked(backgroundRestricted: Boolean): MirrorStopReason =
            if (backgroundRestricted) AndroidRevokedWhileRestricted else AndroidRevoked
    }
}
