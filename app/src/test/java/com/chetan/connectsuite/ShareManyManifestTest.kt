package com.chetan.connectsuite

import com.chetan.connectsuite.core.link.Extensions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Several files per share, read from the manifests and resources themselves (docs/feature-a-multi-offer-proposal.md
 * rev 4 §3, §18; docs/feature-a-v3-production-enablement.md):
 *
 * - `SEND_MULTIPLE` is claimed in the **main** manifest by exactly one activity, `ShareManyToMacActivity`, with
 *   the single-file sheet's types and no text;
 * - its `android:enabled` is the release-policy resource `@bool/share_many_enabled`, which is **true** in the
 *   debug source set and, in main, **equal to [Extensions.MULTI_FILE_RELEASE]** — so the share-sheet entry
 *   and the advertised `share.file` 3 are one decision and cannot drift apart;
 * - the grant probe stays in the debug manifest only, disabled.
 *
 * The single-file `SEND` filter is `ShareManifestTest`'s.
 */
class ShareManyManifestTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val sendMultiple = "android.intent.action.SEND_MULTIPLE"
    private val many = ".ShareManyToMacActivity"
    private val probe = "com.chetan.connectsuite.probe.ShareManyGrantProbeActivity"

    private fun file(path: String): File = listOf(path, "app/$path").map(::File).first { it.isFile }
    private fun exists(path: String) = listOf(path, "app/$path").any { File(it).isFile }
    private fun parse(path: String) = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(file(path))

    private data class Claim(val activity: String, val enabled: String, val affinity: String?, val actions: Set<String>, val mimes: Set<String>)

    private fun claims(sourceSet: String): List<Claim> {
        val doc = parse("src/$sourceSet/AndroidManifest.xml")
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
                Claim(
                    a.getAttributeNS(androidNs, "name"), a.getAttributeNS(androidNs, "enabled"),
                    a.getAttributeNodeNS(androidNs, "taskAffinity")?.value, attrs("action", "name"), attrs("data", "mimeType"),
                )
            }
        }
    }

    /** The value of `<bool name="share_many_enabled">` in [sourceSet]'s `res/values/bools.xml`. */
    private fun policyBool(sourceSet: String): Boolean {
        val bools = parse("src/$sourceSet/res/values/bools.xml").getElementsByTagName("bool")
        val hit = (0 until bools.length).map { bools.item(it) as Element }.single { it.getAttribute("name") == "share_many_enabled" }
        return when (val v = hit.textContent.trim()) {
            "true" -> true
            "false" -> false
            else -> error("share_many_enabled is not a literal boolean: $v")
        }
    }

    @Test fun `the main manifest claims SEND_MULTIPLE exactly once - the several-files screen - enabled by the policy resource`() {
        val main = claims("main")
        assertTrue("the manifest was read (control)", main.size > 3)
        val multi = main.filter { sendMultiple in it.actions }
        assertEquals(listOf(many), multi.map { it.activity })
        assertEquals("enabled only by the release-policy resource", "@bool/share_many_enabled", multi.single().enabled)
    }

    @Test fun `the release-policy resource equals MULTI_FILE_RELEASE in main, and is on in debuggable builds`() {
        assertEquals(
            "@bool/share_many_enabled (main) and Extensions.MULTI_FILE_RELEASE are one decision",
            Extensions.MULTI_FILE_RELEASE, policyBool("main"),
        )
        assertTrue("debuggable builds do several files (Extensions.multiFile(true))", policyBool("debug"))
        assertTrue("and the rule agrees", Extensions.multiFile(debuggable = true))
    }

    @Test fun `the several-files screen has the single-file types plus text files, its task affinity, SEND_MULTIPLE only`() {
        val c = claims("main").single { sendMultiple in it.actions }
        assertEquals(setOf(sendMultiple), c.actions)
        val single = claims("main").single { it.activity == ".ShareToMacActivity" }
        // The single-file sheet's types, plus `text/*`: a My Files selection of .txt/.csv files is a
        // text-typed SEND_MULTIPLE, which listed no Sidekick at all before (2026-09-29).
        assertEquals("the single-file types plus text/*", single.mimes + "text/*", c.mimes)
        assertEquals("the same task affinity as the single-file sheet", single.affinity, c.affinity)
        assertFalse(c.mimes.any { it == "*/*" })
    }

    @Test fun `the debug manifest claims SEND_MULTIPLE only for the grant probe - disabled, synthetic types only`() {
        val debug = claims("debug").filter { sendMultiple in it.actions }
        assertEquals(listOf(probe), debug.map { it.activity })
        assertEquals("disabled until enabled by hand", "false", debug.single().enabled)
        assertEquals(setOf("image/png", "application/octet-stream", "application/pdf"), debug.single().mimes)
    }

    @Test fun `the activity and its model live in the main source set, and the grant probe in debug only`() {
        assertTrue("control", exists("src/main/java/com/chetan/connectsuite/ShareManyToMacActivity.kt"))
        assertTrue("control", exists("src/main/java/com/chetan/connectsuite/ShareManyToMacModel.kt"))
        assertFalse(exists("src/debug/java/com/chetan/connectsuite/probe/ShareManyToMacActivity.kt"))
        assertFalse(exists("src/debug/java/com/chetan/connectsuite/probe/ShareManyToMacModel.kt"))
        assertTrue("control", exists("src/debug/java/com/chetan/connectsuite/probe/ShareManyGrantProbeActivity.kt"))
        assertFalse(exists("src/main/java/com/chetan/connectsuite/probe/ShareManyGrantProbeActivity.kt"))
    }
}
