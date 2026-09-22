package com.chetan.connectsuite.onboarding

/**
 * Every sentence the onboarding flow shows a person, in one place, plus the rule that says which
 * sentences are not allowed to exist.
 *
 * ### Why the copy is not simply written where it is drawn
 *
 * Defect 63 was *"the onboarding security note describes a pairing flow this app does not have"*,
 * and its register row says **"no test could have seen it — it is a true-sounding sentence about a
 * mechanism"**. That is right about the sentence it was filed for and wrong about the class. Reading
 * all four pages against the implementation — which is what 63's own fix direction asked for, rather
 * than patching the one that was found — turned up **three** false statements, and two of them are
 * mechanically detectable:
 *
 * | Page | The sentence | Why it is false |
 * |---|---|---|
 * | 1, security card | *"Devices are paired by confirming a key on both screens"* | Defect 63 as filed — but see the correction below: the sentence is **true of Sync and false of the Mac**, which is worse than simply false |
 * | 1, Mirror card | *"See and control another Android device's screen from here. No root; the target needs debugging enabled once"* | Mirroring is v2/MediaProjection and sends **this phone's** screen **to the Mac**. The feature described here is the v1 ADB mirror, deleted 2026-08-26 |
 * | 3, whole page | *"tap Build number seven times"*, *"turn on Wireless debugging"*, *"run \"adb tcpip 5555\""* | Three numbered steps walking the user through setting up a feature that no longer exists, in an app whose locked decision #1 is *no ADB anywhere* |
 *
 * ### The pairing sentence is not invented, and that is the actual defect
 *
 * Defect 63 was filed as *"describes a pairing flow this app does not have"*. Read against the
 * code, that is not right: `PairingManager.acceptPairing` and `PairingRequestDialog` do exactly
 * what the sentence says — the dialog shows an 8-group `displayFingerprint`, `DevicesScreen` shows
 * this device's own `Key …`, and a person taps Accept. **That flow is shipped and works.** It is
 * the *Sync* path — v1, Android to Android — and it is the one the sentence was written for.
 *
 * What changed underneath it is that v2 added a *second* pairing path, to the Mac, with a
 * different trust model: the Mac draws a QR, the phone scans it, the fingerprint inside is pinned,
 * and nobody confirms anything. Onboarding now ends on that second path. So the sentence is not a
 * false statement about a mechanism — it is a **true statement about the wrong one of two**, sitting
 * four pages before the user meets the other, with nothing telling them which they are looking at.
 *
 * That is worse than the filed version rather than better, because a false sentence gets deleted
 * and an unqualified true one survives review. The replacement names the path it is about.
 *
 * It also scopes the guard below: *"a key confirmed on both screens"* is forbidden **in onboarding
 * copy**, because onboarding's subject is the Mac. It is not forbidden in the app at large, where
 * it describes something real.
 *
 * The third row is the largest and it is the one a check can hold: `adb tcpip 5555` survived in exactly
 * one place in this repository — user-facing copy — and a grep for it across all of `app/`,
 * `core/`, `sync-module/`, `mirror-module/` and `desktop/` returns that line and nothing else. A
 * mechanism the architecture forbids cannot be named in the copy, and unlike *"is this sentence
 * true"* that is a question a test can answer.
 *
 * So the copy lives here, [pages] enumerates it, and [violations] is the rule with one home. The
 * screen renders from this file and holds no user-facing literals of its own — which is the half
 * that makes the guard cover the thing it is named for. `icons.ts` is the cautionary tale in
 * `CLAUDE.md`: its first guard enumerated only the sidebar and the dock, and **passed with
 * `capture` deleted**. A guard over a list that the drawing code does not have to use is a guard
 * over a copy of the product.
 *
 * ### What this deliberately does not attempt
 *
 * It cannot tell whether a sentence is *true*. [forbiddenMechanisms] is a list of mechanisms this
 * app does not have, which is a much smaller and much more checkable claim. The pairing entry is
 * the weakest of them, because a false pairing description could be written in words the list does
 * not contain; it is here because the specific wording that shipped is worth pinning, not because
 * it closes the class.
 */
object OnboardingCopy {

    /** A single page of the flow. [id] is stable and is what the tests and the screen agree on. */
    data class Page(
        val id: String,
        val title: String,
        val subtitle: String,
        val primaryLabel: String,
        val secondaryLabel: String? = null,
        /** Body copy: cards, notes, footnotes. Every user-visible string on the page. */
        val body: List<String> = emptyList(),
    ) {
        /** Every string on this page that a person can read. */
        val allText: List<String>
            get() = listOfNotNull(title, subtitle, primaryLabel, secondaryLabel) + body
    }

    const val WELCOME = "welcome"
    const val PERMISSIONS = "permissions"
    const val MIRROR = "mirror"
    const val RELIABILITY = "reliability"
    const val PAIR = "pair"

    val welcome = Page(
        id = WELCOME,
        title = "Sidekick",
        subtitle = "Your phone and your Mac, over your own network. Nothing goes through a " +
            "server, and nothing uses mobile data.",
        primaryLabel = "Get started",
        body = listOf(
            // Feature card. **Defect 71: this card was titled "Sync" and that word is taken.**
            //
            // The app has a Sync tab, and it is the v1 Android-to-Android feature — a list of other
            // phones, with its own pairing. This card describes the v2 Mac link, which is a
            // different thing entirely. A new user read "Sync", opened the Sync tab looking for
            // their Mac, and found a phone-pairing screen.
            //
            // Renaming the card rather than the tab, because the tab's name is right for what the
            // tab does. And the new name is chosen to be **false of the other path** — defect 63's
            // rule: a title that would be true of either feature is unfalsifiable by inspection and
            // wrong half the time.
            "On your Mac",
            "Your notifications, texts, calls, photos, files and clipboard, on the Mac. " +
                "Anything you send lands at Wi-Fi speed.",
            // Feature card: Mirror. Rewritten: v2 sends THIS phone's screen TO the Mac, with a
            // consent tap on this phone every time. The old text described the deleted v1 mirror.
            "Mirror",
            "Put this phone's screen on the Mac and control it from there. Nothing to set up — " +
                "you tap to allow it, each time it starts.",
            // The security note. Defect 63: the first clause used to describe a key-comparison
            // flow this app has never implemented. The second clause was always accurate.
            "Pairing is a code you scan once. The certificate behind it is pinned, and every " +
                "connection after that is checked against it — an unpaired device is refused " +
                "without asking you anything.",
        ),
    )

    /**
     * **Defect 69.** This page used to ask for `NEARBY_WIFI_DEVICES` under the heading *"Finding your
     * Mac"*, with a rationale — shared with the Sync flow — explaining **Wi-Fi Direct**.
     *
     * Wi-Fi Direct is not how the Mac is found. It is v1 Sync's discovery, phone to phone. The v2
     * link is the phone advertising over mDNS and the Mac dialling in (locked decision #2), and the
     * page's title was changed to name the Mac in F1, which made a correct sentence false without
     * anybody touching it.
     *
     * **The permission is gone from this page because it was measured, not argued.** With
     * `NEARBY_WIFI_DEVICES` revoked on hardware, 2026-09-03: the phone bound all three ports,
     * `NsdAdvertiser` logged `Registered as ConnectSuite Samsung SM-S938B`, and the Mac established
     * a control session. Asking a new user for a permission the named feature does not need is worse
     * than a wrong sentence about it — so this page now asks for exactly one thing, and says so.
     *
     * The permission itself is untouched: Sync still needs it, still asks for it, and its rationale
     * is still correct there. Only this page stopped asking.
     */
    val permissions = Page(
        id = PERMISSIONS,
        title = "Staying in touch",
        subtitle = "One permission, so this phone can tell you what the link is doing. It is not " +
            "used for anything else, and the Mac is found without it.",
        primaryLabel = "Continue",
        secondaryLabel = "Skip for now",
        body = listOf(
            "Notification mirroring, texts and calls need extra access. Those are asked for " +
                "from the Sync tab, when you turn them on — not now.",
        ),
    )

    /** The label the primary button takes once this page's grant is in hand. */
    const val PERMISSIONS_PRIMARY_GRANTED = "Next"

    /** The action on every permission card in the flow. */
    const val ALLOW = "Allow"

    /**
     * Rewritten wholesale. This page used to be three numbered steps setting up wireless ADB for a
     * feature deleted on 2026-08-26; mirroring in v2 needs no setup at all, so the page's remaining
     * job is to say the one thing that surprises people — consent cannot be remembered.
     */
    val mirror = Page(
        id = MIRROR,
        title = "About mirroring",
        subtitle = "Screen mirroring needs no permission and no setup. There is one thing worth " +
            "knowing before you use it.",
        primaryLabel = "Next",
        body = listOf(
            "Android asks every time",
            "Your phone will ask permission to record the screen each time mirroring starts. " +
                "That is Android's rule and no app can turn it off — so the tap comes from you, " +
                "on this phone, every session.",
            "Some things stay black",
            "Your lock screen, banking apps and DRM video are hidden from screen recording by " +
                "Android itself. They arrive on the Mac as a black frame with a note saying why.",
        ),
    )

    val reliability = Page(
        id = RELIABILITY,
        title = "Keeping it running",
        subtitle = "Android stops background apps aggressively. For notifications to keep " +
            "arriving while Sidekick is not open, it needs to be exempt from battery " +
            "optimisation.",
        primaryLabel = "Next",
        body = listOf(
            "Ignore battery optimisation",
            "Without this, the connection is dropped within minutes of leaving the app and " +
                "notifications stop arriving.",
            "Some manufacturers need more",
            "Xiaomi, Samsung, OnePlus, Oppo and Vivo run their own app killers on top of " +
                "Android's. The Android setting above does not disable those. If notifications " +
                "stop arriving after a while, look for \"Autostart\", \"Battery saver\" or " +
                "\"Protected apps\" in your system settings and allow Sidekick there too.",
            "Open app settings",
        ),
    )

    /**
     * Page five — F1 in `docs/phase-7-pairing-flow.md`, and the reason that document exists.
     *
     * The flow used to end on **Done** and drop the user on the Sync tab, which is the v1
     * Android-to-Android feature. Pairing — the only thing that makes the previous four pages mean
     * anything — was mentioned on none of them, and the path to it was a button on a third tab
     * called *Mac*, underneath a line reading *"Ports 42501, 42502, 42503 · protocol v1"*.
     *
     * The secondary is *"I'll do this later"* rather than *"Skip"* deliberately: it is the honest
     * label for the one situation it is for, which is not having installed the Mac app yet.
     */
    val pair = Page(
        id = PAIR,
        title = "Connect your Mac",
        subtitle = "Open Sidekick on your Mac. It will show a code — scan it here, once, and " +
            "the two are paired for good.",
        primaryLabel = "Scan the code",
        secondaryLabel = "I'll do this later",
        body = listOf(
            "You will need the Mac app open and on the same Wi-Fi as this phone.",
        ),
    )

    /** The success state page five becomes after a scan. `%s` is the Mac's name. */
    const val PAIR_SUCCESS_TITLE = "Paired with %s"
    const val PAIR_SUCCESS_SUBTITLE =
        "That is the whole setup. This phone will now connect to that Mac by itself whenever " +
            "both are on the same network."
    const val PAIR_SUCCESS_PRIMARY = "Done"
    const val PAIR_SUCCESS_BODY =
        "You can pair another Mac, or remove this one, from the Mac tab."

    /** Every page, in the order they are shown. The screen iterates this; nothing hardcodes five. */
    val pages: List<Page> = listOf(welcome, permissions, mirror, reliability, pair)

    /** Every readable string in the flow, including the ones outside the [Page] model. */
    val allText: List<String>
        get() = pages.flatMap { it.allText } + listOf(
            PERMISSIONS_PRIMARY_GRANTED,
            ALLOW,
            PAIR_SUCCESS_TITLE,
            PAIR_SUCCESS_SUBTITLE,
            PAIR_SUCCESS_PRIMARY,
            PAIR_SUCCESS_BODY,
        )

    /**
     * A mechanism this app does not have, which therefore may not be named in copy.
     *
     * [why] is printed by the failure message, because a guard that fails with *"forbidden pattern
     * matched"* teaches the next person to delete the pattern.
     */
    data class ForbiddenMechanism(
        val name: String,
        val pattern: Regex,
        val why: String,
    )

    val forbiddenMechanisms: List<ForbiddenMechanism> = listOf(
        ForbiddenMechanism(
            name = "adb",
            pattern = Regex("""\badb\b""", RegexOption.IGNORE_CASE),
            why = "Locked architecture decision #1: no ADB anywhere in the v2 code path. The v1 " +
                "ADB mirror was deleted on 2026-08-26; copy telling a user to set it up outlived " +
                "the feature by a week.",
        ),
        ForbiddenMechanism(
            name = "tcpip",
            pattern = Regex("""\btcpip\b""", RegexOption.IGNORE_CASE),
            why = "Same decision. `adb tcpip 5555` survived in exactly one place in this " +
                "repository and it was a sentence shown to users.",
        ),
        ForbiddenMechanism(
            name = "wireless debugging",
            pattern = Regex("""wireless\s+debugging""", RegexOption.IGNORE_CASE),
            why = "Nothing in v2 needs developer options on any device. Asking a new user to " +
                "enable debugging is asking them to set up a deleted feature.",
        ),
        ForbiddenMechanism(
            name = "developer options",
            pattern = Regex("""developer\s+options""", RegexOption.IGNORE_CASE),
            why = "Same. Onboarding must not send anyone into developer settings.",
        ),
        ForbiddenMechanism(
            name = "build number",
            pattern = Regex("""build\s+number""", RegexOption.IGNORE_CASE),
            why = "The 'tap it seven times' instruction only ever existed to unlock developer " +
                "options for the ADB mirror.",
        ),
        ForbiddenMechanism(
            name = "mirroring another device",
            pattern = Regex(
                """another\s+(android\s+)?device'?s?\s+screen""",
                RegexOption.IGNORE_CASE,
            ),
            why = "Mirror v2 sends *this phone's* screen *to the Mac*. The reverse — driving " +
                "another Android device from here — was the v1 feature and is gone.",
        ),
        ForbiddenMechanism(
            name = "key confirmed on both screens",
            pattern = Regex(
                """(confirm\w*|compar\w*|match\w*)[^.]{0,40}\b(key|code|number|digits?)\b""" +
                    """|\b(key|code|number|digits?)s?\b[^.]{0,40}\bon both\b""",
                RegexOption.IGNORE_CASE,
            ),
            why = "Defect 63, scoped to onboarding. Onboarding's subject is the Mac, and the " +
                "Mac path is a QR the phone scans — no confirmation step, no key shown. The " +
                "key-comparison flow is real but belongs to Sync (Android to Android), so this " +
                "sentence sends a user waiting for a key that this path never shows them. " +
                "Forbidden here, not in the app at large.",
        ),
    )

    /** One sentence that broke one rule. */
    data class Violation(
        val mechanism: ForbiddenMechanism,
        val text: String,
        val matched: String,
    ) {
        override fun toString(): String =
            "\"$matched\" (${mechanism.name}) in: \"${text.take(120)}\"\n    → ${mechanism.why}"
    }

    /**
     * The rule, with one home.
     *
     * The test calls this rather than restating the patterns, because `CLAUDE.md`'s
     * `MediaPayloadsTest` lesson is that a test containing a second expression of the rule it
     * checks is testing a copy — and the copy stays green when the original is deleted.
     *
     * [texts] is a parameter rather than being read from [allText] directly so the test can run the
     * identical checker over the strings that shipped before this fix, which is the only way to
     * show that the checker can fail at all.
     */
    fun violations(texts: List<String> = allText): List<Violation> =
        texts.flatMap { text ->
            forbiddenMechanisms.mapNotNull { mechanism ->
                mechanism.pattern.find(text)?.let { match ->
                    Violation(mechanism, text, match.value)
                }
            }
        }
}
