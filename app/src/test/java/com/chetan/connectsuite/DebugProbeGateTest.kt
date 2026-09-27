package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Defect 152. "Debug-only" means not in a release build; it does not mean unreachable by other apps on
 * the device a debug build is installed on. Every exported debug activity that has no intent filter
 * is an adb-driven harness, so it must require `android.permission.DUMP`. The shell user that
 * `adb shell am start` runs as holds it; an ordinary installed app cannot (its protection level is
 * `signature|privileged|development`).
 *
 * The two share-sheet probes carry a SEND filter and must stay reachable from the share sheet, so a
 * permission would break them. They are excluded by having a filter, and they read only what is
 * shared with them.
 *
 * The third (2026-09-27, Stage 2, development only) is `ShareManyToMacActivity`, the several-files
 * `SEND_MULTIPLE` screen. It carries a filter for the same reason and is also `android:enabled="false"`
 * until enabled by hand — `ShareManyManifestTest` pins that. The fourth (2026-09-28) is
 * `ShareManyGrantProbeActivity`, the §11 `SEND_MULTIPLE` grant measurement: a filter, and also disabled.
 */
class DebugProbeGateTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val gate = "android.permission.DUMP"

    private data class Activity(val name: String, val exported: Boolean, val filters: Int, val permission: String)

    private fun debugActivities(): List<Activity> {
        val file = listOf("src/debug/AndroidManifest.xml", "app/src/debug/AndroidManifest.xml").map(::File).first { it.isFile }
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(file)
        val nodes = doc.getElementsByTagName("activity")
        return (0 until nodes.length).map { i ->
            val a = nodes.item(i) as Element
            Activity(
                name = a.getAttributeNS(androidNs, "name").substringAfterLast('.'),
                exported = a.getAttributeNS(androidNs, "exported") == "true",
                filters = a.getElementsByTagName("intent-filter").length,
                permission = a.getAttributeNS(androidNs, "permission"),
            )
        }
    }

    @Test fun `every exported debug activity without an intent filter requires DUMP`() {
        val harnesses = debugActivities().filter { it.exported && it.filters == 0 }
        assertTrue("the manifest was read and has harnesses to judge (control)", harnesses.size >= 4)
        val ungated = harnesses.filter { it.permission != gate }.map { it.name }
        assertEquals("exported, filter-less debug activities without the DUMP gate", emptyList<String>(), ungated)
    }

    @Test fun `the offer probe in particular is gated — it makes the phone offer data to the Mac`() {
        val probe = debugActivities().single { it.name == "ShareOfferProbeActivity" }
        assertEquals(gate, probe.permission)
    }

    @Test fun `the share-sheet probes keep their filter and carry no permission, so the share sheet can reach them`() {
        val sheet = debugActivities().filter { it.filters > 0 }
        assertEquals(
            setOf("ShareGrantProbeActivity", "ShareStagingProbeActivity", "ShareManyToMacActivity", "ShareManyGrantProbeActivity"),
            sheet.map { it.name }.toSet(),
        )
        sheet.forEach { assertEquals(it.name, "", it.permission) }
    }
}
