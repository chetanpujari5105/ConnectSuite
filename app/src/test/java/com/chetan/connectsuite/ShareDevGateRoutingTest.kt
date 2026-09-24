package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Runbook §1: **the only way to arm `share.file: 2` is a `DUMP`-gated activity that exists in the
 * debug source set and nowhere else**, and no ordinary share can make an offer.
 *
 * What this reads is source — manifests and Kotlin files — because the facts are about which source
 * set a thing lives in, and a release build is assembled from `src/main` (plus `src/release`, which
 * this project does not have; asserted below). The merged release manifest itself is not built here.
 */
class ShareDevGateRoutingTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val activity = "com.chetan.connectsuite.probe.ShareDevV2Activity"

    private fun root(): File = listOf(File("."), File("..")).first { File(it, "app/src/main").isDirectory }

    private fun activities(manifest: File): List<Element> {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(manifest)
        val nodes = doc.getElementsByTagName("activity")
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    /** Code only: comments and KDoc name the calls these rules forbid. */
    private fun code(f: File): String =
        f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")

    private fun mainSources(): List<File> =
        root().listFiles()!!.filter { File(it, "src/main").isDirectory }
            .flatMap { File(it, "src/main").walkTopDown().filter { f -> f.isFile && f.extension == "kt" }.toList() }

    @Test fun `the arm activity is in the debug manifest, exported only behind DUMP, with no filter`() {
        val a = activities(File(root(), "app/src/debug/AndroidManifest.xml")).single { it.getAttributeNS(androidNs, "name") == activity }
        assertEquals("android.permission.DUMP", a.getAttributeNS(androidNs, "permission"))
        assertEquals("true", a.getAttributeNS(androidNs, "exported"))
        assertEquals(0, a.getElementsByTagName("intent-filter").length)
    }

    @Test fun `it is in no manifest a release build is made from`() {
        val main = activities(File(root(), "app/src/main/AndroidManifest.xml"))
        assertTrue("control: the main manifest was read", main.isNotEmpty())
        assertTrue(main.none { it.getAttributeNS(androidNs, "name").endsWith("ShareDevV2Activity") })
        assertFalse("there is no release source set to carry it", File(root(), "app/src/release").exists())
        val cls = root().walkTopDown().filter { it.isFile && it.name == "ShareDevV2Activity.kt" && !it.path.contains("/build/") }.toList()
        assertEquals("one class, in the debug source set", listOf("app/src/debug"), cls.map { it.relativeTo(root()).path.substringBefore("/java/") })
    }

    @Test fun `no main source in any module arms the gate`() {
        val sources = mainSources()
        assertTrue("control: the main sources were read", sources.any { it.name == "ControlSession.kt" })
        val writers = sources.filter { Regex("ShareDevGate\\.process\\.arm\\(").containsMatchIn(code(it)) }
        assertEquals(emptyList<File>(), writers)
    }

    @Test fun `an ordinary share still cannot make an offer — Send is disabled and nothing in main offers`() {
        val sources = mainSources()
        val offering = sources.filter { Regex("\\.offerStaged\\(").containsMatchIn(code(it)) }
        assertEquals("the only caller is the debug probe", emptyList<File>(), offering)
        val sheet = code(File(root(), "app/src/main/java/com/chetan/connectsuite/ShareToMacActivity.kt"))
        assertTrue("Send is drawn disabled, with no action", sheet.contains("Button(onClick = {}, enabled = false) { Text(ShareToMacCopy.SEND_BUTTON) }"))
    }
}
