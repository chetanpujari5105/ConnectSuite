package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Stage 2's fences, read from the manifests themselves (docs/feature-a-multi-offer-proposal.md rev 4 §3, §18):
 * `SEND_MULTIPLE` is claimed by exactly one activity, in the **debug** source set only, **disabled** by
 * default, with the single-file sheet's types and no text — and the main manifest (what a release build
 * merges) claims no `SEND_MULTIPLE` at all. The single-file `SEND` filter is `ShareManifestTest`'s.
 */
class ShareManyManifestTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val sendMultiple = "android.intent.action.SEND_MULTIPLE"
    private val many = "com.chetan.connectsuite.probe.ShareManyToMacActivity"
    private val probe = "com.chetan.connectsuite.probe.ShareManyGrantProbeActivity"

    private fun manifest(sourceSet: String): File =
        listOf("src/$sourceSet/AndroidManifest.xml", "app/src/$sourceSet/AndroidManifest.xml").map(::File).first { it.isFile }

    private data class Claim(val activity: String, val enabled: String, val actions: Set<String>, val mimes: Set<String>)

    private fun claims(sourceSet: String): List<Claim> {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(manifest(sourceSet))
        val activities = doc.getElementsByTagName("activity")
        return (0 until activities.length).flatMap { i ->
            val a = activities.item(i) as Element
            val fs = a.getElementsByTagName("intent-filter")
            (0 until fs.length).map { j ->
                val f = fs.item(j) as Element
                fun attrs(tag: String, attr: String): Set<String> {
                    val n = f.getElementsByTagName(tag)
                    return (0 until n.length).map { (n.item(it) as Element).getAttributeNS(androidNs, attr) }.toSet()
                }
                Claim(a.getAttributeNS(androidNs, "name"), a.getAttributeNS(androidNs, "enabled"), attrs("action", "name"), attrs("data", "mimeType"))
            }
        }
    }

    @Test fun `the main manifest claims no SEND_MULTIPLE - a release build cannot receive several files`() {
        val main = claims("main")
        assertTrue("the manifest was read (control)", main.size > 3)
        assertTrue(main.none { sendMultiple in it.actions })
    }

    @Test fun `exactly two debug activities claim SEND_MULTIPLE - the screen and the grant probe - both disabled`() {
        val debug = claims("debug").filter { sendMultiple in it.actions }
        assertEquals(setOf(many, probe), debug.map { it.activity }.toSet())
        assertEquals(2, debug.size)
        debug.forEach { assertEquals("${it.activity} is disabled until enabled by hand", "false", it.enabled) }
    }

    @Test fun `the grant probe's filter is the synthetic stimuli's types only - no text, no wildcard, no SEND`() {
        val p = claims("debug").filter { it.activity == probe }
        assertEquals("one filter", 1, p.size)
        assertEquals(setOf(sendMultiple), p.single().actions)
        assertEquals(setOf("image/png", "application/octet-stream", "application/pdf"), p.single().mimes)
    }

    @Test fun `the several-files screen claims SEND_MULTIPLE disabled, with the single-file types and no text`() {
        val c = claims("debug").single { sendMultiple in it.actions && it.activity == many }
        assertEquals("disabled until enabled by hand", "false", c.enabled)
        assertEquals(setOf(sendMultiple), c.actions)
        val single = claims("main").single { it.activity == ".ShareToMacActivity" }
        assertEquals("the same types as the single-file sheet", single.mimes, c.mimes)
        assertFalse(c.mimes.any { it.startsWith("text/") || it == "*/*" })
    }

    @Test fun `the activity and its model live in the debug source set only`() {
        fun exists(path: String) = listOf(path, "app/$path").any { File(it).isFile }
        assertTrue("control", exists("src/debug/java/com/chetan/connectsuite/probe/ShareManyToMacActivity.kt"))
        assertTrue("control", exists("src/debug/java/com/chetan/connectsuite/probe/ShareManyToMacModel.kt"))
        assertTrue("control", exists("src/debug/java/com/chetan/connectsuite/probe/ShareManyGrantProbeActivity.kt"))
        assertFalse(exists("src/main/java/com/chetan/connectsuite/probe/ShareManyGrantProbeActivity.kt"))
        assertFalse(exists("src/main/java/com/chetan/connectsuite/probe/ShareManyToMacActivity.kt"))
        assertFalse(exists("src/main/java/com/chetan/connectsuite/ShareManyToMacActivity.kt"))
    }
}
