package com.chetan.connectsuite.input.ui

/**
 * The prominent disclosure shown before anyone is sent to Android's Accessibility settings.
 *
 * Google Play's AccessibilityService policy, for an app whose primary purpose is not helping
 * people with disabilities: the disclosure must be **in the app**, must require an **affirmative
 * action** to consent, and **cannot be bundled** with other disclosures. The Settings page's own
 * description (`input_service_description`) does not count, because the policy says it cannot
 * substitute for this. So `isAccessibilityTool` stays unset, and this exists instead.
 *
 * Pure: no Android here, so `InputDisclosureTest` reads the sentences the dialog draws.
 *
 * Every claim is measured against `ConnectSuiteInputService` rather than intended:
 *  - it subscribes to no accessibility events (`accessibilityEventTypes` is absent);
 *  - it reads the **focused editable field** — `setText(append)` and `backspace()` read its text
 *    to write it back, and nothing else consumes it;
 *  - it reads the **package of the app in front** when a gesture is dispatched
 *    (`foregroundPackage`) and only compares it: since defect 223 `InputFailure.ForegroundChanged`
 *    names no app in the refusal the Mac receives, and the phone's log line names none either. So
 *    "not sent anywhere, not even to your paired Mac" is now true, and `InputDisclosureTest` holds
 *    the refusal to it.
 */
object InputDisclosure {

    const val TITLE = "Let your Mac control this phone?"

    const val WHAT = "Sidekick Input uses Android's Accessibility service so the Mac you paired " +
        "can tap, swipe, scroll and type on this phone while you mirror its screen. It acts only " +
        "on what you do on the Mac, never on its own."

    const val READS = "What it reads: the text field you have selected, so typing and backspace " +
        "from the Mac can change it, and the name of the app in front, so a tap meant for one app " +
        "never lands in another. It does not read the rest of your screen or watch what you do."

    const val WHERE = "Nothing it reads is stored or sent anywhere, not even to your paired Mac. " +
        "If the app in front changes before a tap lands, the tap is refused and your Mac is told " +
        "only that a different app came to the front."

    const val OFF = "You can turn it off at any time in Settings › Accessibility."

    const val NEXT = "If you agree, Android's Accessibility settings open next. Turn on " +
        "Sidekick Input there."

    const val AGREE = "Agree"
    const val NOT_NOW = "Not now"

    val body: List<String> = listOf(WHAT, READS, WHERE, OFF, NEXT)

    val allText: List<String> get() = listOf(TITLE) + body + listOf(AGREE, NOT_NOW)
}
