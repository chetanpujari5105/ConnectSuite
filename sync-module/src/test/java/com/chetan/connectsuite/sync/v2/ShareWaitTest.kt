package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.Extensions
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * `share.wait` (PROPOSED, development-only, 2026-09-29): a waiting offer lives 30 minutes when **both**
 * sides advertise it and exactly 10 when either does not. [ShareOffer.ttlFor] is held to the same
 * fixture as the Mac's `offerWaitMs`, so the two cannot drift apart.
 */
class ShareWaitTest {

    private val cases = Json.parseToJsonElement(
        listOf("../docs/fixtures/share-wait.json", "docs/fixtures/share-wait.json").map { File(it) }.first { it.isFile }.readText(),
    ).jsonObject["cases"]!!.jsonArray

    @Test fun `ttlFor follows the shared fixture, case by case`() {
        assertTrue("control: the fixture was read", cases.size >= 5)
        cases.forEach { c ->
            val o = c.jsonObject
            val n = o["negotiated"]!!.jsonPrimitive.intOrNull
            assertEquals(o["why"]!!.jsonPrimitive.content, o["waitMs"]!!.jsonPrimitive.long, ShareOffer.ttlFor(n))
        }
    }

    @Test fun `a debuggable phone advertises share wait 30, a release build does not until the owner flips the policy`() {
        assertFalse("the release policy is the owner's and is off", Extensions.WAIT_RELEASE)
        assertEquals(30, Extensions.advertised(debuggable = true, devV2Armed = false)[Extensions.SHARE_WAIT])
        assertNull(Extensions.advertised(debuggable = false, devV2Armed = false)[Extensions.SHARE_WAIT])
        assertEquals(30, Extensions.advertised(debuggable = false, devV2Armed = false, waitRelease = true)[Extensions.SHARE_WAIT])
        // No transfer, nothing to wait for: never advertised.
        assertNull(Extensions.advertised(debuggable = true, devV2Armed = false, productionTransfer = false)[Extensions.SHARE_WAIT])
    }

    @Test fun `an older Mac negotiates nothing, so this phone's offers wait exactly 10 minutes`() {
        val mine = Extensions.advertised(debuggable = true, devV2Armed = false)
        val oldMac = mapOf(Extensions.SHARE_FILE to 3, Extensions.SHARE_ASK to 1)
        assertNull(Extensions.negotiate(mine, oldMac, Extensions.SHARE_WAIT))
        assertEquals(ShareOffer.TTL_MS, ShareOffer.ttlFor(Extensions.negotiate(mine, oldMac, Extensions.SHARE_WAIT)))
        val newMac = oldMac + (Extensions.SHARE_WAIT to 30)
        assertEquals(30 * 60_000L, ShareOffer.ttlFor(Extensions.negotiate(mine, newMac, Extensions.SHARE_WAIT)))
    }

    @Test fun `offerStaged takes its lifetime from the session's negotiated wait - source guard`() {
        val src = com.chetan.connectsuite.sync.SourceTree.kotlinFiles().single { it.name == "ShareFeature.kt" }.readText()
        assertTrue(src.contains("ShareOffer.ttlFor(session.negotiated[Extensions.SHARE_WAIT])"))
        assertTrue("a caller's value may shorten, never lengthen", src.contains("require(ttlMs in 1..agreedMs)"))
    }
}
