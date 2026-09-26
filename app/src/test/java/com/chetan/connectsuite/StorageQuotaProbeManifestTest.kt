package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The storage-quota probe is **debug-only, DUMP-gated and read-only**. What this reads is source —
 * manifests and Kotlin — because each fact is about which source set a thing lives in and what its
 * code calls; the merged manifests are checked separately when the build runs.
 */
class StorageQuotaProbeManifestTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val probe = "com.chetan.connectsuite.probe.StorageQuotaProbeActivity"

    private fun root(): File = listOf(File("."), File("..")).first { File(it, "app/src/main").isDirectory }

    private fun activities(manifest: File): List<Element> {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(manifest)
        val nodes = doc.getElementsByTagName("activity")
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    /** Code only: the KDoc names the calls this test forbids. */
    private fun code(f: File): String =
        f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")

    private fun sources(name: String): List<File> =
        root().walkTopDown().filter { it.isFile && it.name == name && !it.path.contains("/build/") }.toList()

    @Test fun `in the debug manifest it is exported only behind DUMP, with no filter, no UI and no recents entry`() {
        val a = activities(File(root(), "app/src/debug/AndroidManifest.xml")).single { it.getAttributeNS(androidNs, "name") == probe }
        assertEquals("android.permission.DUMP", a.getAttributeNS(androidNs, "permission"))
        assertEquals("true", a.getAttributeNS(androidNs, "exported"))
        assertEquals(0, a.getElementsByTagName("intent-filter").length)
        assertEquals("@android:style/Theme.NoDisplay", a.getAttributeNS(androidNs, "theme"))
        assertEquals("true", a.getAttributeNS(androidNs, "excludeFromRecents"))
    }

    @Test fun `in no manifest a release build is made from, and its classes live only in the debug source set`() {
        val main = activities(File(root(), "app/src/main/AndroidManifest.xml"))
        assertTrue("control: the main manifest was read", main.isNotEmpty())
        assertTrue(main.none { it.getAttributeNS(androidNs, "name").endsWith("StorageQuotaProbeActivity") })
        assertFalse("there is no release source set to carry it", File(root(), "app/src/release").exists())
        for (cls in listOf("StorageQuotaProbeActivity.kt", "StorageQuotaReading.kt")) {
            val where = sources(cls).map { it.relativeTo(root()).path.substringBefore("/java/") }
            assertEquals("$cls: one file, in the debug source set", listOf("app/src/debug"), where)
        }
    }

    @Test fun `the probe's code writes, creates, deletes and connects nothing`() {
        val files = listOf("StorageQuotaProbeActivity.kt", "StorageQuotaReading.kt").map { sources(it).single() }
        val all = files.joinToString("\n") { code(it) }
        assertTrue("control: the quota call is found in the code that was read", all.contains("getCacheQuotaBytes("))
        val forbidden = listOf(
            "stagingDir(", "mkdir", "createNewFile", "createDirector", ".delete(", "deleteRecursively", "Files.delete",
            "writeText", "writeBytes", "Files.write", "FileOutputStream", "openFileOutput", "outputStream(",
            "renameTo", "Socket", "LinkController", "LinkService", "startService", "sendBroadcast",
        )
        val found = forbidden.filter { all.contains(it) }
        assertEquals("calls a read-only probe must not make", emptyList<String>(), found)
        val probeCode = code(files[0])
        val logs = Regex("Log\\.[a-z]\\(TAG, ([^)]*)\\)").findAll(probeCode).map { it.groupValues[1].trim() }.toList()
        assertEquals("the only log arguments: the two markers and the formatted line", listOf("\"BEGIN\"", "line", "\"END\""), logs)
    }
}
