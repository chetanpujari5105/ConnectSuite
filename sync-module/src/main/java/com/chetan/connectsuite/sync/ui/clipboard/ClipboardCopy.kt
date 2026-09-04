package com.chetan.connectsuite.sync.ui.clipboard

/**
 * The clipboard screen's standing copy, out of the composable so it can be enumerated and tested.
 *
 * Same shape and same reason as `OnboardingCopy`: defect 65 was a sentence telling users to run an
 * ADB command for a feature deleted a week earlier, and it survived because **the module holding
 * the only user-facing copy in the product had nowhere to put a test.** A string inside a
 * `@Composable` is reachable by nothing.
 *
 * ### The `Send to Mac` block, and why it is copy rather than a button
 *
 * Defect 86. The selection-toolbar entry ships and **cannot be seen until a switch is flipped that
 * nobody would find**: One UI lists `ACTION_PROCESS_TEXT` apps in a per-app opt-in screen, all off
 * by default, reachable only from inside the selection toolbar itself. Measured 2026-09-04, our row
 * present and `checked=false` alongside **ten others also false** — ChatGPT, Claude, Perplexity,
 * DeepSeek and the rest — so the absence was everybody's rather than a fault of ours.
 *
 * Two things this deliberately is not:
 *
 * - **Not a deep link.** `SecProcessTextManageAppsFragment` is a Samsung internal fragment, not a
 *   documented action. An intent at it is the vendor-specific route `docs/single-device-audit.md`
 *   §4 exists to warn about, and it fails *silently* when the fragment is renamed by an update
 *   nobody controls. A sentence with the path in it survives that; an intent does not.
 * - **Not a state check.** No documented key carries this switch, so reading it would be a
 *   single-device guess — and a wrong reading shows a warning to people whose feature works.
 *
 * ### It says "your phone", not "Android"
 *
 * The screen this describes is `com.samsung.android.settings.*`. That names who wrote **this**
 * screen and says nothing about a Pixel, so the copy describes the handset in front of the reader
 * rather than asserting what Android does. `docs/single-device-audit.md` §4 is the rule; the
 * contrast is the sentence above it, where *Android forbids every app* is a claim about the
 * platform because it was measured as one.
 */
object ClipboardCopy {

    /** The card's title. Names the thing the user is looking for in their toolbar, verbatim. */
    const val SEND_TO_MAC_TITLE = "Send text without opening this app"

    /**
     * What the feature is. Stated before the setup, so a person who already has it switched on
     * reads a description rather than an instruction they have followed.
     */
    const val SEND_TO_MAC_WHAT =
        "Select text anywhere on this phone and you can send it straight to your Mac — no need " +
            "to copy it and come back here."

    /**
     * The setup, **in walking order**, because it is four taps and the third is invisible from the
     * first. Each step names what the user will see, not what the system calls it.
     */
    val SEND_TO_MAC_STEPS: List<String> = listOf(
        "Select some text in any app and let the little toolbar appear.",
        "Tap the three dots at the end of that toolbar.",
        "Tap Manage apps.",
        "Turn on ConnectSuite — the row says Send to Mac.",
    )

    /**
     * Where it then appears, and it matters more than it looks: without this line the setup reads
     * as having failed. It never lands beside Copy — this phone puts seven built-in items on that
     * first row (Cut, Copy, Paste, Translate, Share, Undo, Clipboard) and every app entry after
     * them, which is the framework's ordering and not something an app can bid for. Measured, along
     * with the two things that do not move it: a declared intent-filter priority is recorded as 0,
     * and an icon is not drawn in that menu at all.
     */
    const val SEND_TO_MAC_WHERE =
        "After that, Send to Mac is in the same three-dot menu whenever you select text. It will " +
            "not appear next to Copy — this phone keeps that first row for its own buttons."

    /**
     * Why it is off to begin with. One clause, and it is here to stop the reader concluding the
     * app is broken — which is exactly what happened when this shipped without the card.
     */
    const val SEND_TO_MAC_WHY_OFF =
        "Your phone ships this switched off for every app that offers it, not just this one."

    /** Everything the card renders, in order, so a test can read what a user reads. */
    val sendToMacBlock: List<String> =
        listOf(SEND_TO_MAC_TITLE, SEND_TO_MAC_WHAT) + SEND_TO_MAC_STEPS + listOf(SEND_TO_MAC_WHERE, SEND_TO_MAC_WHY_OFF)

    /**
     * Mechanisms this screen may never name, with the reason each is banned.
     *
     * `OnboardingCopy.forbiddenMechanisms`' shape, and its lesson: the `why` is a string in the same
     * artifact as the copy it guards, so a `strings` search over the APK matches the prohibition
     * itself. The enumeration is the test, never a grep — `CLAUDE.md`, *searching for a forbidden
     * thing finds the sentence forbidding it*.
     */
    val forbiddenMechanisms: List<Pair<String, String>> = listOf(
        "Settings > Display" to
            "The switch is not in Display, or anywhere a user can navigate to from Settings. It is " +
                "reachable only from inside the selection toolbar, which is why the steps start there.",
        "developer options" to
            "Nothing about this feature involves developer options, and sending a stranger there is " +
                "defect 65 exactly.",
        "Android puts" to
            "This screen is Samsung's. A sentence claiming Android does this would be a one-device " +
                "reading stated as a platform fact — docs/single-device-audit.md §4.",
    )
}
