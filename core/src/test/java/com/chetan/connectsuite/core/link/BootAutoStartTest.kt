package com.chetan.connectsuite.core.link

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The two halves of the Phase 6 boot gap, guarded separately because they fail separately.
 *
 * The defect was **a declared permission with nothing implementing it**:
 * `RECEIVE_BOOT_COMPLETED` sat in `app/src/main/AndroidManifest.xml` from Phase 1 while no
 * `<receiver>` in the project carried a `BOOT_COMPLETED` filter, so the link never came back after
 * a restart and nothing in the build could tell. That is the manifest form of a message type
 * listed in the protocol inventory and specified nowhere, which `check-protocol-spec.mjs` already
 * exists for — so it gets a check rather than a sentence.
 *
 * Neither half of this test can reach a real boot. `BOOT_COMPLETED` is a protected broadcast and
 * this handset refuses it from `adb` (uid 2000) with no root available, so what a reboot proves is
 * the user's to run. What these guard is the part that would otherwise be lost silently between
 * reboots: that a receiver exists, and that a boot start never asks for a foreground type the
 * platform is documented to deny it.
 */
class BootAutoStartTest {

    // ---- half one: the foreground types a boot start may claim ---------------------------

    private val connectedDevice = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    private val dataSync = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC

    @Test
    fun `a user-driven start claims both declared types`() {
        val types = LinkAutoStart.foregroundTypesFor(LinkStartReason.USER, sdkInt = 36)
        assertEquals(connectedDevice or dataSync, types)
    }

    /**
     * The assertion that fails if someone simplifies `foregroundTypesFor` back to one branch.
     *
     * Shown to fail before it was kept: with the `when` collapsed to always return
     * `connectedDevice or dataSync`, this reports `expected 16 but was 17`.
     */
    @Test
    fun `no automatic start ever claims dataSync`() {
        val automatic = listOf(
            LinkStartReason.BOOT,
            LinkStartReason.PACKAGE_REPLACED,
            LinkStartReason.UNKNOWN,
        )
        for (reason in automatic) {
            val types = LinkAutoStart.foregroundTypesFor(reason, sdkInt = 36)
            assertEquals("$reason must claim connectedDevice", connectedDevice, types and connectedDevice)
            assertEquals("$reason must not claim dataSync", 0, types and dataSync)
        }
    }

    @Test
    fun `below API 34 the type argument is meaningless and is not sent`() {
        for (reason in LinkStartReason.entries) {
            assertEquals(0, LinkAutoStart.foregroundTypesFor(reason, sdkInt = 33))
        }
    }

    /** An unrecognised or absent extra must not be read as a user start; it claims the small set. */
    @Test
    fun `an unknown start reason is treated as automatic`() {
        assertEquals(LinkStartReason.UNKNOWN, LinkStartReason.fromExtra(null))
        assertEquals(LinkStartReason.UNKNOWN, LinkStartReason.fromExtra("something-else"))
        assertEquals(LinkStartReason.BOOT, LinkStartReason.fromExtra("BOOT"))
    }

    @Test
    fun `every action the manifest filters is an action the code maps`() {
        val filtered = receivers()
            .filter { it.name.endsWith("LinkBootReceiver") }
            .flatMap { it.actions }
        assertTrue("LinkBootReceiver filters nothing", filtered.isNotEmpty())
        val unmapped = filtered.filter { LinkAutoStart.reasonFor(it) == null }
        assertEquals(
            "the manifest filters actions the receiver drops on the floor: $unmapped",
            emptyList<String>(),
            unmapped,
        )
    }

    @Test
    fun `an action nobody filters maps to nothing`() {
        assertEquals(null, LinkAutoStart.reasonFor("android.intent.action.SCREEN_ON"))
        assertEquals(null, LinkAutoStart.reasonFor(null))
        assertEquals(LinkStartReason.BOOT, LinkAutoStart.reasonFor(LinkAutoStart.ACTION_QUICKBOOT_POWERON))
    }

    // ---- the wake-lock relationship, defect 61 ------------------------------------------

    /**
     * The assertion the comment failed to be.
     *
     * Defect 61 was not a wrong value, it was a wrong *relationship*: a twelve-hour timeout is safe
     * on its own and fatal beside a re-arm that never runs. So this asserts the relationship, and it
     * is written to fail on the edit most likely to be made — lengthening the interval, or
     * shortening the timeout, without looking at the other one.
     */
    @Test
    fun `the wake lock is re-armed several times inside its own timeout`() {
        assertTrue(
            "a re-arm interval that is not shorter than the timeout means the lock lapses",
            LinkLockPolicy.REARM_INTERVAL_MS < LinkLockPolicy.TIMEOUT_MS,
        )
        val opportunities = LinkLockPolicy.TIMEOUT_MS / LinkLockPolicy.REARM_INTERVAL_MS
        assertTrue(
            "only $opportunities re-arm(s) fit inside one timeout; " +
                "${LinkLockPolicy.MIN_REARMS_PER_TIMEOUT} are required so a missed tick is survivable",
            opportunities >= LinkLockPolicy.MIN_REARMS_PER_TIMEOUT,
        )
    }

    /**
     * The margin, expressed the way the *refresh* needs it rather than the way the repair did.
     *
     * The first version of defect 61's fix re-acquired only on `!isHeld`, so the question was "do
     * enough ticks fit inside a timeout". That was the wrong question: a tick that finds the lock
     * held has to **extend** it, or the last tick before the timeout is followed by up to one whole
     * interval with no lock at all. The overnight run measured a 59m49s hold — eleven seconds short
     * of the 60-minute timeout — which is that gap about to open.
     *
     * What this asserts is the property the refresh needs: **the interval must leave room for a
     * dropped tick.** Two consecutive misses must still land inside the timeout, so the useful
     * inequality is `2 × interval < timeout`, and `MIN_REARMS_PER_TIMEOUT = 3` is that with one
     * tick's slack on top.
     */
    @Test
    fun `two consecutive missed ticks still land inside the timeout`() {
        assertTrue(
            "with interval=${LinkLockPolicy.REARM_INTERVAL_MS} and timeout=" +
                "${LinkLockPolicy.TIMEOUT_MS}, two missed ticks would outlast the lock",
            2 * LinkLockPolicy.REARM_INTERVAL_MS < LinkLockPolicy.TIMEOUT_MS,
        )
    }

    /**
     * The backstop must stay a backstop. An indefinite acquire (0 or negative) is the wrong fix
     * recorded against defect 61, and half a day is what the defect shipped with.
     */
    @Test
    fun `the timeout is a real backstop and not half a day`() {
        assertTrue("the timeout must be positive", LinkLockPolicy.TIMEOUT_MS > 0)
        assertTrue(
            "a timeout of ${LinkLockPolicy.TIMEOUT_MS}ms is long enough to be an overnight battery " +
                "complaint if a release path is ever missed",
            LinkLockPolicy.TIMEOUT_MS <= 2L * 60 * 60 * 1000,
        )
    }

    // ---- half two: the permission and the receiver must exist together --------------------

    private data class ReceiverDecl(val manifest: File, val name: String, val actions: List<String>)

    private fun manifests(): List<File> {
        val root = repoRoot()
        val found = root.walkTopDown()
            .onEnter { it.name != "build" && it.name != ".git" && it.name != "node_modules" }
            .filter { it.isFile && it.name == "AndroidManifest.xml" }
            .toList()
        assertTrue(
            "found no AndroidManifest.xml under $root — a scan that sees nothing passes every " +
                "assertion below it",
            found.size >= 4,
        )
        return found
    }

    private fun receivers(): List<ReceiverDecl> = manifests().flatMap { file ->
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = doc.getElementsByTagName("receiver")
        (0 until nodes.length).map { i ->
            val el = nodes.item(i) as Element
            val filters = el.getElementsByTagName("action")
            ReceiverDecl(
                manifest = file,
                name = el.getAttribute("android:name"),
                actions = (0 until filters.length).map {
                    (filters.item(it) as Element).getAttribute("android:name")
                },
            )
        }
    }

    /**
     * The control for the assertion below it, and it is not optional.
     *
     * "No receiver declares BOOT_COMPLETED" and "the parser found no receivers" are the same
     * result. This asserts the scan comes back with the receivers already known to be there, so a
     * broken walk or a renamed attribute fails here rather than passing the real check in silence.
     */
    @Test
    fun `the manifest scan finds the receivers already known to exist`() {
        val names = receivers().map { it.name }
        assertTrue(
            "expected the three known receivers, found $names",
            names.any { it.endsWith("ClipApplyReceiver") } &&
                names.any { it.endsWith("SmsMirrorReceiver") } &&
                names.any { it.endsWith("LinkBootReceiver") },
        )
    }

    @Test
    fun `RECEIVE_BOOT_COMPLETED is declared and something receives it`() {
        val declaring = manifests().filter {
            it.readText().contains("android.permission.RECEIVE_BOOT_COMPLETED")
        }
        assertTrue(
            "no manifest declares RECEIVE_BOOT_COMPLETED — if that was deliberate, this test and " +
                "the receiver should have gone with it",
            declaring.isNotEmpty(),
        )

        val boot = receivers().filter { "android.intent.action.BOOT_COMPLETED" in it.actions }
        assertTrue(
            "RECEIVE_BOOT_COMPLETED is declared in ${declaring.map { it.parentFile.parentFile.parentFile.name }} " +
                "and no <receiver> anywhere filters BOOT_COMPLETED. That is the Phase 6 defect " +
                "exactly: the permission is granted, the broadcast is sent, and nothing is " +
                "listening, so the link does not come back after a restart.",
            boot.isNotEmpty(),
        )
    }

    /**
     * `adb install -r` reaches the same hole by a second route, and unlike the reboot this one is
     * measurable from a laptop. CLAUDE.md documents the symptom ("it leaves the phone serverless")
     * without naming the fix; this asserts the fix stays wired.
     */
    @Test
    fun `MY_PACKAGE_REPLACED is received too`() {
        val replaced = receivers().filter { "android.intent.action.MY_PACKAGE_REPLACED" in it.actions }
        assertTrue(
            "nothing receives MY_PACKAGE_REPLACED — a reinstall keeps every grant and leaves no " +
                "listening socket",
            replaced.isNotEmpty(),
        )
    }

    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").isFile || File(dir, "settings.gradle").isFile) {
                return dir
            }
            dir = dir.parentFile
        }
        throw AssertionError(
            "could not find the repo root from ${System.getProperty("user.dir")}",
        )
    }
}
