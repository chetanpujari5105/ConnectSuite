package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Intent routing, read from the manifests themselves: a plain-text share must keep going to
 * `SendSelectionActivity` → `clip.push`, and the file share must claim no text, no wildcard and no
 * multiple send. A later edit to either filter goes red here rather than on somebody's phone.
 */
class ShareManifestTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"

    private fun manifest(sourceSet: String): File =
        listOf("src/$sourceSet/AndroidManifest.xml", "app/src/$sourceSet/AndroidManifest.xml").map(::File).first { it.isFile }

    private data class Filter(val activity: String, val actions: Set<String>, val mimes: Set<String>)

    private fun filters(sourceSet: String): List<Filter> {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
            .newDocumentBuilder().parse(manifest(sourceSet))
        val activities = doc.getElementsByTagName("activity")
        return (0 until activities.length).flatMap { i ->
            val a = activities.item(i) as Element
            val name = a.getAttributeNS(androidNs, "name")
            val fs = a.getElementsByTagName("intent-filter")
            (0 until fs.length).map { j ->
                val f = fs.item(j) as Element
                fun attrs(tag: String, attr: String): Set<String> {
                    val nodes = f.getElementsByTagName(tag)
                    return (0 until nodes.length).map { (nodes.item(it) as Element).getAttributeNS(androidNs, attr) }.toSet()
                }
                Filter(name, attrs("action", "name"), attrs("data", "mimeType"))
            }
        }
    }

    private val send = "android.intent.action.SEND"
    private val sendMultiple = "android.intent.action.SEND_MULTIPLE"
    private fun claimsText(m: String) = m.startsWith("text/") || m == "*/*" || m == "*"

    @Test fun `plain-text SEND still goes to SendSelectionActivity`() {
        val main = filters("main")
        assertTrue("the manifest was read (control)", main.size > 3)
        assertTrue(main.any { it.activity == ".SendSelectionActivity" && send in it.actions && "text/plain" in it.mimes })
    }

    @Test fun `no other activity in any source set claims a text or wildcard SEND`() {
        val claimants = (filters("main") + filters("debug"))
            .filter { (send in it.actions || sendMultiple in it.actions) && it.mimes.any(::claimsText) }
            .map { it.activity }.toSet()
        assertEquals(setOf(".SendSelectionActivity"), claimants)
    }

    @Test fun `the file share takes exactly the proposal's types, one file only`() {
        val share = filters("main").filter { it.activity == ".ShareToMacActivity" }
        assertEquals("one filter", 1, share.size)
        assertEquals(setOf(send), share.single().actions)
        assertEquals(
            setOf("application/*", "image/*", "video/*", "audio/*", "font/*", "model/*"),
            share.single().mimes,
        )
    }
}
