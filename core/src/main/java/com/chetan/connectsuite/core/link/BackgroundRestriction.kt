package com.chetan.connectsuite.core.link

import android.content.Context

/**
 * What the phone and the Mac say when Android has background-restricted this app.
 *
 * Defect 102. One UI restricts apps it judges unused, **on its own and with no notice**
 * (`SUPPORT_BG_AD_RESTRICTION_BY_AI=1`), and a restricted app cannot hold the foreground service a
 * `MediaProjection` is handed to. On this handset that produced a mirror that died 107-116 ms into
 * every one of eight attempts, behind the sentence *"Screen capture was stopped on the phone"* —
 * true of the projection, and silent about the cause. Nothing in the app looked at the one API
 * that would have named it.
 *
 * ### Why the copy lives here rather than in the composable
 *
 * `showsState` is the worked example in `CLAUDE.md`: a condition expressed only inside a
 * `@Composable` was got wrong twice in two slices because nothing in the build could reach it.
 * These strings are read by `LinkRoute`'s card, by [CapabilityStatus.reason], and by the mirror's
 * stop sentence, and all three have to agree — so they have one home and a test.
 *
 * ### The two things this copy must not do
 *
 * Both are recorded as wrong fixes in the register, and both are the kind of wrong that reads as
 * helpful:
 *
 *  1. **It must not offer a retry.** Each foreground-service start buys another provisional
 *     allowance and another withdrawal; seven taps on 2026-09-10 bought seven.
 *  2. **It must not mention battery optimisation.** That is a different switch, this app already
 *     asks for it during onboarding, was granted it, and is restricted regardless. Sending someone
 *     to a toggle they have already turned on is the "granted in Settings, but Android has not
 *     started the service" mistake with a new subject.
 *
 * ### The deep link goes to App info, and that is the whole of what the platform offers
 *
 * There is no public `Intent` action for the Battery page *inside* App info —
 * `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` is the other switch (see 2 above) and
 * `ACTION_APP_BATTERY_SETTINGS` is not public API. `ACTION_APPLICATION_DETAILS_SETTINGS` lands on
 * App info and the remaining two taps are named in [steps] rather than implied by a button that
 * claims to go further than it does.
 */
object BackgroundRestriction {

    /**
     * The sentence that reaches the Mac as an `unavailable` reason, exactly as every other
     * capability's does.
     *
     * Written to be read by somebody who is looking at a greyed pane on a different machine, so it
     * names the phone, names what it cannot do, and does not ask them to tap anything here — the
     * action is on the phone and the phone's own card carries it.
     */
    const val CAPABILITY_REASON: String =
        "the phone has restricted this app's background activity, so it cannot hold the " +
            "foreground service screen capture needs — open Sidekick on the phone to fix it"

    /** The phone card's headline. A statement of fact, not a warning. */
    const val HEADLINE: String = "Android has restricted this app"

    /**
     * The phone card's body.
     *
     * Names the consequence before the cause, because the consequence is what the person came in
     * with — they tapped Start mirroring and got nothing.
     */
    const val BODY: String =
        "Screen mirroring cannot start while this is set: Android ends the capture within a " +
            "fraction of a second and reports it as a capture failure. Your phone can set this by " +
            "itself for apps it thinks you have stopped using."

    /** The two taps the button cannot make on the user's behalf. */
    const val STEPS: String = "In App info, open Battery and allow background usage."

    /** The button. Names where it actually goes. */
    const val ACTION_LABEL: String = "Open App info"

    /**
     * Why this is not the battery-optimisation prompt, for anyone who recognises the screen.
     *
     * Present because the two are one screen apart and a user who has already granted the
     * exemption will otherwise conclude they have already done this.
     */
    const val NOT_THE_SAME_SWITCH: String =
        "This is not the battery optimisation setting — that one is already granted."

    /** Every line the phone's card shows, in order, for the test that pins them. */
    val steps: List<String> = listOf(HEADLINE, BODY, STEPS, NOT_THE_SAME_SWITCH)
}

/**
 * The one place this app asks Android whether it has been background-restricted.
 *
 * Separate from [BackgroundRestriction] so that object stays free of every Android symbol and can
 * be read by a plain JVM test — the `SmsStore` lesson in `CLAUDE.md`: an object holding an Android
 * static in a field initializer kills any test that so much as names it.
 *
 * **Two callers, deliberately.** `CapabilityDetector` asks on every refresh, which decides whether
 * `mirror` is advertised at all; `MirrorEngine` asks again at the instant a projection is revoked,
 * which decides what the stop sentence says. Those are two different moments and the answer can
 * differ between them — One UI can set the op while the app is backgrounded, which is precisely
 * the window no refresh covers. One reading, asked twice, is the point.
 */
object BackgroundRestrictionReading {

    /**
     * `ActivityManager.isBackgroundRestricted()`, public since API 28; this app is minSdk 29, so
     * there is no version branch to write.
     *
     * Returns `false` when the reading cannot be taken, and [onUnavailable] is called with the
     * throwable so the caller can log it in its own tag. A `runCatching { }.getOrNull()` here would
     * be a claim that the reason cannot matter, and it plainly can: a throw means *no reading*,
     * which is a different fact from *not restricted*. `false` is still the value returned —
     * withholding the mirror on a phone whose `ActivityManager` behaved unexpectedly is the worse
     * of the two ways to be wrong — but nothing gets to be silent about it.
     */
    fun isSet(context: Context, onUnavailable: (Throwable) -> Unit): Boolean =
        runCatching {
            val manager =
                context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            manager.isBackgroundRestricted
        }.getOrElse {
            onUnavailable(it)
            false
        }
}
