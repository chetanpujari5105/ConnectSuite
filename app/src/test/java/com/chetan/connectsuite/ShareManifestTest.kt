package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Intent routing, read from the manifests themselves: a text share goes to `SendSelectionActivity`
 * (which forwards a text *file* to the file sheet, `ShareTextRoute`), the single-file share claims no
 * text, no wildcard and no multiple send, and only the several-files screen takes a multiple send of
 * text files. A later edit to any filter goes red here rather than on somebody's phone.
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
        assertTrue(main.any { it.activity == ".SendSelectionActivity" && send in it.actions && "text/*" in it.mimes })
    }

    @Test fun `no other activity in any source set claims a text or wildcard SEND`() {
        val all = filters("main") + filters("debug")
        val sendText = all.filter { send in it.actions && it.mimes.any(::claimsText) }.map { it.activity }.toSet()
        assertEquals(setOf(".SendSelectionActivity"), sendText)
        // A multiple send of text files (My Files, 2026-09-29) goes to the several-files screen only.
        val multipleText = all.filter { sendMultiple in it.actions && it.mimes.any(::claimsText) }.map { it.activity }.toSet()
        assertEquals(setOf(".ShareManyToMacActivity"), multipleText)
        // And nobody claims the wildcard: `*/*` would list Sidekick for things it cannot send.
        assertTrue(all.none { f -> f.mimes.any { it == "*/*" || it == "*" } })
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

    /**
     * Every activity another app's moment launches — a share or the selection toolbar — carries an empty
     * `taskAffinity`, so a `FLAG_ACTIVITY_NEW_TASK` launch cannot put it in Sidekick's task and bring
     * `MainActivity` forward, whose focus would start an unasked clipboard sync (release-verification
     * report §6.3, the `SendSelectionActivity` new-task hazard). Absent and empty are different here:
     * absent means the package's affinity, which is exactly Sidekick's task.
     */
    @Test fun `every activity reached from another app's share or selection has an empty taskAffinity`() {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
            .newDocumentBuilder().parse(manifest("main"))
        val activities = doc.getElementsByTagName("activity")
        val entryActions = setOf(send, sendMultiple, "android.intent.action.PROCESS_TEXT")
        val reached = (0 until activities.length).map { activities.item(it) as Element }.filter { a ->
            val actions = a.getElementsByTagName("action")
            (0 until actions.length).any { (actions.item(it) as Element).getAttributeNS(androidNs, "name") in entryActions }
        }
        val names = reached.map { it.getAttributeNS(androidNs, "name") }
        assertTrue("control: the share and selection activities were found — $names",
            ".SendSelectionActivity" in names && ".ShareToMacActivity" in names)
        val wrong = reached.filter { it.getAttributeNodeNS(androidNs, "taskAffinity")?.value != "" }
            .map { it.getAttributeNS(androidNs, "name") }
        assertEquals("activities that would join Sidekick's task", emptyList<String>(), wrong)
    }
}
