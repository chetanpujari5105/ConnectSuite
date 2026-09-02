package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules in `apps.*`'s payloads: the order, the two counts, and the icon bounds.
 *
 * Deliberately reaches [AppsPayloads] rather than modelling it. `MediaPayloadsTest`'s first version
 * wrote the cursor predicate a second time in the test and stayed green with the real one deleted;
 * every assertion here calls the function the handler calls.
 *
 * **What it cannot reach, stated rather than implied:** the enumeration itself. `AppsStore` needs a
 * `PackageManager` and there is no honest JVM stand-in for one — a fake would be a second model of
 * the platform, which is the failure above wearing a different costume. The enumeration was
 * measured on hardware instead, with its control (`docs/testing.md` → Phase 7 Slice 3), and that is
 * the only place the 122 comes from.
 */
class AppsPayloadsTest {

    private fun app(pkg: String, label: String, fallback: Boolean = false) =
        AppsPayloads.App(
            packageName = pkg,
            label = label,
            updatedMs = 1_756_900_000_000L,
            versionName = "1.0",
            labelIsFallback = fallback,
        )

    @Test
    fun `apps sort by label, ignoring case`() {
        val sorted = AppsPayloads.sorted(
            listOf(app("c", "zulu"), app("a", "Alpha"), app("b", "beta")),
        )
        assertEquals(listOf("Alpha", "beta", "zulu"), sorted.map { it.label })
    }

    /**
     * The tiebreak, and it is load-bearing rather than decorative.
     *
     * Two apps genuinely can carry one label — a work-profile clone, an OEM shipping *Internet*
     * twice. Without the package tiebreak the order between them depends on the order
     * `queryIntentActivities` happened to return, which is not ours and is not stable, so a grid
     * would reshuffle two tiles between refreshes for no reason a person could see.
     *
     * This is the assertion that goes red when someone deletes the second `compareBy` clause as
     * redundant — the thing `CLAUDE.md`'s tiebreak rule says a clean run will never catch.
     */
    @Test
    fun `two apps sharing a label are ordered by package, stably`() {
        val duplicated = listOf(app("com.b.internet", "Internet"), app("com.a.internet", "Internet"))
        assertEquals(
            listOf("com.a.internet", "com.b.internet"),
            AppsPayloads.sorted(duplicated).map { it.packageName },
        )
        assertEquals(
            "the same input must give the same order however it arrives",
            AppsPayloads.sorted(duplicated).map { it.packageName },
            AppsPayloads.sorted(duplicated.reversed()).map { it.packageName },
        )
    }

    @Test
    fun `count and total agree when nothing is cut`() {
        val page = AppsPayloads.page((1..122).map { app("com.x$it", "App $it") })
        assertEquals(122, page.count)
        assertEquals(122, page.total)
        assertFalse(page.truncated)
    }

    /**
     * The cap, and the reason both numbers are on the wire.
     *
     * A list that silently returns its first thousand rows is the 200-page probe cap wearing a wire
     * format: the Mac would draw the instrument's bound and read it as the phone's contents. `total`
     * is what makes a truncation a reading rather than a wrong answer.
     */
    @Test
    fun `the cap is visible in the counts rather than silent`() {
        val page = AppsPayloads.page((1..1500).map { app("com.x$it", "App $it") })
        assertEquals(AppsPayloads.MAX_APPS, page.count)
        assertEquals(1500, page.total)
        assertTrue(page.truncated)
        assertEquals(AppsPayloads.MAX_APPS, page.apps.size)
    }

    @Test
    fun `an entry always carries a label, and says when the label is really the handle`() {
        val resolved = AppsPayloads.entry(app("com.instagram.android", "Instagram"))
        assertEquals("Instagram", resolved["label"]?.jsonPrimitive?.content)
        assertNull("a resolved label carries no fallback marker", resolved["labelIsFallback"])

        // AppLabels returns the package name when it genuinely cannot resolve one. That fallback is
        // correct and must not be "fixed" — what matters is that the Mac can tell, so it can draw a
        // handle in the mono face instead of as a name somebody chose. Defects 28 and 33.
        val fell = AppsPayloads.entry(app("com.headless.thing", "com.headless.thing", fallback = true))
        assertEquals("com.headless.thing", fell["label"]?.jsonPrimitive?.content)
        assertEquals(true, fell["labelIsFallback"]?.jsonPrimitive?.content?.toBoolean())
    }

    @Test
    fun `icon edges out of bounds are refused rather than clamped`() {
        // A clamp would answer a request for a 4096px icon with a 192px one and call it a success,
        // which is the same shape as an ack meaning `asked` being read as `opened`: the caller
        // believes it got what it asked for.
        assertEquals(AppsPayloads.DEFAULT_ICON_EDGE, AppsPayloads.iconEdgeOrNull(null))
        assertEquals(96, AppsPayloads.iconEdgeOrNull(96))
        assertEquals(AppsPayloads.MAX_ICON_EDGE, AppsPayloads.iconEdgeOrNull(AppsPayloads.MAX_ICON_EDGE))
        assertNull(AppsPayloads.iconEdgeOrNull(AppsPayloads.MAX_ICON_EDGE + 1))
        assertNull(AppsPayloads.iconEdgeOrNull(0))
        assertNull(AppsPayloads.iconEdgeOrNull(-8))
    }

    @Test
    fun `an icon batch is bounded at both ends`() {
        assertFalse("an empty batch is a round trip that asks nothing", AppsPayloads.iconBatchIsLegal(0))
        assertTrue(AppsPayloads.iconBatchIsLegal(1))
        assertTrue(AppsPayloads.iconBatchIsLegal(AppsPayloads.MAX_ICON_PACKAGES))
        assertFalse(AppsPayloads.iconBatchIsLegal(AppsPayloads.MAX_ICON_PACKAGES + 1))
    }
}
