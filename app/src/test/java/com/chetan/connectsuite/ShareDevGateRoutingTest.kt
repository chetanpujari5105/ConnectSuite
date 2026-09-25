package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareIntake
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

    /*
     * Was: "no main source calls offerStaged; Send is drawn disabled with no action". That guarded the
     * premise *ordinary Send does not exist*, which the share.ask commit deliberately ended. It is not
     * loosened to "at most one caller" (a raised count guards nothing); it is replaced by the two
     * questions the new premise rests on, each asserted by name:
     *  1. the one main caller makes an ORDINARY offer, so it must pass requireAsk = true;
     *  2. the sheet's Send is enabled only by Availability.Available, which only share.ask produces.
     */
    @Test fun `the one ordinary offer in main requires share-ask, and Send is enabled only by Available`() {
        val sources = mainSources()
        val offering = sources.filter { Regex("\\.offerStaged\\(").containsMatchIn(code(it)) }
        assertEquals("one main caller: the share sheet's model", listOf("ShareToMacModel.kt"), offering.map { it.name })
        val call = Regex("\\.offerStaged\\(([^)]*)\\)").findAll(code(offering.single())).map { it.groupValues[1] }.toList()
        assertEquals("called once", 1, call.size)
        assertTrue("an ordinary offer must require share.ask: ${call.single()}", call.single().contains("requireAsk = true"))
        // The Button now reads `canSend(state)` (the silent-Send fix, 2026-09-25), so the question moved with
        // it rather than being loosened: the button's only enabling expression is canSend, and canSend's
        // body *requires* Available — conjoined, never or-ed. Its behaviour is asserted below as well.
        val sheet = code(File(root(), "app/src/main/java/com/chetan/connectsuite/ShareToMacActivity.kt"))
        assertTrue("Send is enabled only through canSend", sheet.contains("Button(onClick = onSend, enabled = canSend(state))"))
        val copy = code(File(root(), "app/src/main/java/com/chetan/connectsuite/ShareToMacCopy.kt"))
        val body = Regex("fun canSend\\(state: ShareSheetState\\): Boolean =([^\\n]*\\n[^\\n]*)").find(copy)?.groupValues?.get(1)
        assertTrue("control: canSend's body was found", body != null)
        assertTrue("canSend requires Availability.Available: $body", body!!.contains("state.availability is Availability.Available &&"))
        assertFalse("canSend never or-s another way in: $body", body.contains("||"))
    }

    @Test fun `canSend is false for every availability but Available, busy or not`() {
        for (a in listOf(ShareIntake.Availability.NotConnected, ShareIntake.Availability.NotSupported("Mac"))) {
            assertFalse("$a", canSend(ShareSheetState.Ready("a.bin", "b/c", 1, a)))
            assertFalse("$a", canSend(ShareSheetState.Ready("a.bin", "b/c", 1, a, ShareSheetState.NotOffered.OUT_OF_RULE)))
        }
        assertTrue("control", canSend(ShareSheetState.Ready("a.bin", "b/c", 1, ShareIntake.Availability.Available("Mac"))))
    }
}
