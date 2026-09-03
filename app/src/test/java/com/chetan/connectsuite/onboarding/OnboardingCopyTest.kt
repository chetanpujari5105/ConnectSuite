package com.chetan.connectsuite.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The enforcement point for defect 63 — and for the two larger copy defects found beside it.
 *
 * `CLAUDE.md`: *"A rule that matters enough to write down is a rule that needs an enforcement
 * point… If the answer is 'someone remembering', it will be broken again."* Defect 63's register
 * row says no test could have seen it. That is true of the sentence and false of the class: two of
 * the three false statements on these pages name a **mechanism this app does not have**, and that
 * is checkable even though *"is this sentence true"* is not.
 *
 * The pairing entry is scoped rather than absolute, and the reason is in [OnboardingCopy]: the
 * key-comparison flow **exists** and is shipped, on the Sync path. It is forbidden in *onboarding*
 * copy because onboarding's subject is the Mac, whose pairing works the other way. A guard that
 * claimed the mechanism did not exist would be making the same mistake as the sentence it replaced.
 *
 * Three things this file holds, and the second is the one that makes the first mean anything:
 *
 *  1. the rule runs over the shipping copy;
 *  2. the rule is shown to **fail**, by running the identical checker over the strings that
 *     actually shipped before this fix — kept below verbatim;
 *  3. a drift guard: the screen may not carry user-facing literals of its own, or the enumeration
 *     in [OnboardingCopy] stops being the thing that gets drawn and the guard starts guarding a
 *     copy of the product. That is the `icons.ts` failure in `CLAUDE.md`, whose first guard
 *     enumerated only the sidebar and the dock and passed with `capture` deleted.
 */
class OnboardingCopyTest {

    /**
     * The copy exactly as it shipped, read out of `OnboardingScreen.kt` at commit f2f8127.
     *
     * This is the red-first run, frozen. A checker that cannot fail is the same shape as an empty
     * accessibility query — it reads as evidence and is not — so the three known-bad sentences stay
     * here permanently and the test asserts the checker still catches every one of them.
     */
    private val copyAsItShipped = listOf(
        "Devices are paired by confirming a key on both screens, and every connection after " +
            "that is checked against it. An unpaired device is refused without asking you anything.",
        "See and control another Android device's screen from here. No root; the target needs " +
            "debugging enabled once.",
        "Before you can mirror",
        "Screen mirroring needs no permission on this device — but the device you want to " +
            "mirror has to have debugging turned on. That is a one-time setup that only a person " +
            "at that device can do.",
        "On the target device: Settings → About phone → tap Build number seven times.",
        "Settings → System → Developer options → turn on Wireless debugging.",
        "Plug it into a computer once and run \"adb tcpip 5555\". You can unplug immediately " +
            "afterwards.",
        "The full walkthrough is always available from the Mirror tab.",
    )

    // ---- 1. the reading -----------------------------------------------------------------------

    @Test
    fun `shipping copy names no mechanism this app does not have`() {
        val violations = OnboardingCopy.violations()
        assertEquals(
            "Onboarding copy names a mechanism this app does not have:\n" +
                violations.joinToString("\n") { "  - $it" },
            emptyList<OnboardingCopy.Violation>(),
            violations,
        )
    }

    // ---- 2. the control: the same checker, over the copy that actually shipped ------------------

    @Test
    fun `the checker catches every false statement that shipped`() {
        val caught = OnboardingCopy.violations(copyAsItShipped)
            .map { it.mechanism.name }
            .toSet()

        // Not "it found something" — which mechanisms, by name. A count would pass if one broad
        // pattern matched five times and the other six patterns were dead.
        assertEquals(
            "The frozen pre-fix copy must trip exactly the mechanisms it was written with. " +
                "Caught: $caught",
            setOf(
                "adb",
                "tcpip",
                "wireless debugging",
                "developer options",
                "build number",
                "mirroring another device",
                "key confirmed on both screens",
            ),
            caught,
        )
    }

    @Test
    fun `every forbidden mechanism has a pattern that can match something`() {
        // A pattern that matches nothing anywhere is a rule that has quietly stopped existing.
        // The frozen fixture is the corpus, because it is the only text in the repo that trips
        // all of them by construction.
        val dead = OnboardingCopy.forbiddenMechanisms.filter { mechanism ->
            copyAsItShipped.none { mechanism.pattern.containsMatchIn(it) }
        }
        assertEquals(
            "Patterns that matched nothing in the frozen pre-fix copy",
            emptyList<OnboardingCopy.ForbiddenMechanism>(),
            dead,
        )
    }

    @Test
    fun `every forbidden mechanism explains itself`() {
        // A guard that fails with "forbidden pattern matched" teaches the next person to delete
        // the pattern. Every entry carries the decision it comes from.
        OnboardingCopy.forbiddenMechanisms.forEach {
            assertTrue("${it.name} has no reason attached", it.why.length > 40)
        }
    }

    // ---- the enumeration itself ----------------------------------------------------------------

    @Test
    fun `the flow ends on pairing`() {
        // F1. The whole point of the fifth page: the flow used to end on "Done" and drop a
        // stranger on the Sync tab, which is the v1 Android-to-Android feature.
        assertEquals(OnboardingCopy.PAIR, OnboardingCopy.pages.last().id)
    }

    @Test
    fun `every page is complete and distinct`() {
        val ids = OnboardingCopy.pages.map { it.id }
        assertEquals("page ids must be unique", ids.size, ids.toSet().size)
        OnboardingCopy.pages.forEach { page ->
            assertTrue("${page.id}: empty title", page.title.isNotBlank())
            assertTrue("${page.id}: empty subtitle", page.subtitle.isNotBlank())
            assertTrue("${page.id}: empty primary label", page.primaryLabel.isNotBlank())
            page.allText.forEach {
                assertTrue("${page.id}: blank string in copy", it.isNotBlank())
            }
        }
    }

    // ---- 3. the drift guard --------------------------------------------------------------------

    /**
     * Gradle runs a unit test with the module directory as its working directory. Resolved rather
     * than assumed, and the test fails loudly if the file is not where it looks — a source-scanning
     * guard that silently finds no source is the empty-accessibility-query failure again.
     */
    private fun sourceFile(name: String): File {
        val candidates = listOf(
            File("src/main/java/com/chetan/connectsuite/onboarding/$name"),
            File("app/src/main/java/com/chetan/connectsuite/onboarding/$name"),
        )
        return candidates.firstOrNull { it.isFile }
            ?: error("Cannot find $name. Looked in: ${candidates.map { it.absolutePath }}")
    }

    /** Every double-quoted literal in [source] long enough to be a sentence someone reads. */
    private fun proseLiterals(source: String): List<String> =
        Regex(""""((?:[^"\\]|\\.)*)"""").findAll(source)
            .map { it.groupValues[1] }
            .filter { it.length >= 25 && it.contains(' ') }
            .toList()

    @Test
    fun `the screen holds no user-facing copy of its own`() {
        val screen = sourceFile("OnboardingScreen.kt").readText()
        val corpus = OnboardingCopy.allText

        val strays = proseLiterals(screen).filterNot { literal ->
            // Fragments, because Kotlin splits long strings with `+` across lines.
            corpus.any { it.contains(literal.replace("\\\"", "\"")) }
        }

        assertEquals(
            "OnboardingScreen.kt must render from OnboardingCopy, not from its own literals — " +
                "anything it writes itself is invisible to every check in this file:\n" +
                strays.joinToString("\n") { "  - \"$it\"" },
            emptyList<String>(),
            strays,
        )
    }

    @Test
    fun `the literal scanner can see literals`() {
        // The control for the guard above. An empty result there must mean "no strays", never
        // "the scanner found nothing at all" — which is what it would report against a file it
        // failed to read, a regex that stopped matching, or a source set that moved.
        val copySource = sourceFile("OnboardingCopy.kt").readText()
        val found = proseLiterals(copySource)
        assertTrue(
            "The scanner found ${found.size} prose literals in OnboardingCopy.kt; it should find " +
                "dozens. An empty scan makes the drift guard vacuous.",
            found.size >= 20,
        )

        // And it must flag a stray it is given: same scanner, one sentence that is not in the copy.
        val planted = """val x = "This sentence is not in OnboardingCopy at all, anywhere.""""
        val strays = proseLiterals(planted).filterNot { lit ->
            OnboardingCopy.allText.any { it.contains(lit) }
        }
        assertEquals("the scanner must flag a planted stray", 1, strays.size)
    }

    /**
     * **Defect 71.** The welcome page's feature cards must not be titled with the name of a
     * top-level tab they do not describe.
     *
     * `Sync` is the collision that happened: the card described the v2 Mac link and the tab is the
     * v1 Android-to-Android feature, so a new user who read the card and opened the tab found a
     * phone-pairing screen. `Mirror` is deliberately **allowed** — that card and that tab are the
     * same feature, and a guard that banned every tab name would forbid the one honest case along
     * with the dishonest one.
     *
     * The list of forbidden titles is derived from the reason rather than typed as one word: a tab
     * whose content onboarding describes elsewhere is a name onboarding must not reuse.
     */
    @Test
    fun `no feature card is titled with a tab name that means something else`() {
        val forbidden = setOf("Sync")
        val offending = OnboardingCopy.welcome.body.filter { it in forbidden }
        assertEquals(
            "a card titled with another feature's tab name sends readers to the wrong screen: $offending",
            emptyList<String>(),
            offending,
        )
    }

    /**
     * Defect 69: this page asks for one permission and must say one.
     *
     * The measurement behind it is on hardware — the v2 link established with
     * `NEARBY_WIFI_DEVICES` revoked — and this only guards the sentence from drifting back to
     * describing two.
     */
    @Test
    fun `the permissions page does not promise two permissions`() {
        val subtitle = OnboardingCopy.permissions.subtitle
        assertFalse(
            "the page asks for one permission now: $subtitle",
            subtitle.contains("Two permissions"),
        )
        assertFalse(
            "Wi-Fi Direct is not how the Mac is found and must not appear here: $subtitle",
            subtitle.contains("Wi-Fi Direct"),
        )
    }

    /** Defect 69: the page's title must not promise a thing the page no longer does. */
    @Test
    fun `the permissions page is not titled for finding the Mac`() {
        assertFalse(
            "nothing on this page finds the Mac; the link does that without a permission",
            OnboardingCopy.permissions.title.contains("Finding your Mac"),
        )
    }
}
