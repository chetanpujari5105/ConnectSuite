package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * L1/L2 T4-A: `FsProbeActivity`, the **only** writer of `FsCorruptionProbe.arm`, is declared again —
 * debug manifest only, `DUMP`-gated, no filter — and it can arm nothing but the scoped T4-A probe.
 *
 * What this reads is source, as `ShareDevGateRoutingTest` does: which source set a thing lives in and
 * what its code calls. The merged release manifest is read separately when the build runs.
 */
class FsProbeManifestTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val probe = "com.chetan.connectsuite.probe.FsProbeActivity"

    private fun root(): File = listOf(File("."), File("..")).first { File(it, "app/src/main").isDirectory }

    private fun activities(manifest: File): List<Element> {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(manifest)
        val nodes = doc.getElementsByTagName("activity")
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    /** Code only: the KDoc names the calls this test forbids. */
    private fun code(f: File): String =
        f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")

    private fun kotlin(): List<File> =
        root().walkTopDown().filter { it.isFile && it.extension == "kt" && !it.path.contains("/build/") && !it.path.contains("/src/test/") }.toList()

    @Test fun `in the debug manifest it is exported only behind DUMP, with no filter, no UI and no recents entry`() {
        val a = activities(File(root(), "app/src/debug/AndroidManifest.xml")).single { it.getAttributeNS(androidNs, "name") == probe }
        assertEquals("android.permission.DUMP", a.getAttributeNS(androidNs, "permission"))
        assertEquals("true", a.getAttributeNS(androidNs, "exported"))
        assertEquals(0, a.getElementsByTagName("intent-filter").length)
        assertEquals("@android:style/Theme.NoDisplay", a.getAttributeNS(androidNs, "theme"))
        assertEquals("true", a.getAttributeNS(androidNs, "excludeFromRecents"))
    }

    @Test fun `in no manifest a release build is made from, and its class lives only in the debug source set`() {
        val main = activities(File(root(), "app/src/main/AndroidManifest.xml"))
        assertTrue("control: the main manifest was read", main.isNotEmpty())
        assertTrue(main.none { it.getAttributeNS(androidNs, "name").endsWith("FsProbeActivity") })
        assertFalse("there is no release source set to carry it", File(root(), "app/src/release").exists())
        val cls = root().walkTopDown().filter { it.isFile && it.name == "FsProbeActivity.kt" && !it.path.contains("/build/") }.toList()
        assertEquals("one class, in the debug source set", listOf("app/src/debug"), cls.map { it.relativeTo(root()).path.substringBefore("/java/") })
    }

    @Test fun `it is the one writer of the arm, and it can arm only through the scoped probe`() {
        val all = kotlin()
        assertTrue("control: sources were read", all.any { it.name == "FsFeature.kt" })
        val writers = all.filter { Regex("FsCorruptionProbe\\.arm\\(").containsMatchIn(code(it)) }.map { it.name }
        assertEquals(listOf("FsProbeActivity.kt"), writers)
        val activity = code(all.single { it.name == "FsProbeActivity.kt" })
        assertFalse("it does not touch BulkTransfers at all", activity.contains("BulkTransfers"))
        assertFalse("it takes no offset of its own", Regex("getLongExtra\\(EXTRA_LEGACY_AT").containsMatchIn(activity))
        assertTrue("it reads debuggability from the installed build", activity.contains("ApplicationInfo.FLAG_DEBUGGABLE"))
        assertTrue("it never creates the link server it asks about", activity.contains("LinkController.peek()") && !activity.contains("LinkController.get("))
    }
}
