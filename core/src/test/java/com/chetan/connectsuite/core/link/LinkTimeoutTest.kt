package com.chetan.connectsuite.core.link

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Defect 199: `LinkService` was killed at 07:14:00 on 2026-10-07 with
 * `ForegroundServiceDidNotStopInTimeException … type dataSync`.
 *
 * What these tests reach: the type policy for every start route at every API level, the manifest
 * the platform checks a claim against, the service's timeout reaction (through [LinkTimeoutStop], the
 * exact object `LinkService.onTimeout` calls), the gate every automatic route passes, and the state
 * the link is left in.
 *
 * **What they cannot reach**, said so nobody assumes more: the platform's timer itself, whether
 * Android actually calls `onTimeout` and within what grace, `stopSelf`/`stopForeground` and the real
 * `onDestroy`, the notification being drawn, and `LinkServer.stop` closing real sockets. Those need a
 * device — see the verification plan in `docs/defects.md` → 199.
 */
class LinkTimeoutTest {

    private val connectedDevice = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    private val dataSync = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC

    /** Every type Android 15+ gives a time budget. A permanent link may claim none of them. */
    private val timeLimited = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING or
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE

    // ---- the type every route claims --------------------------------------------------------

    @Test
    fun `every start route claims exactly connectedDevice on API 34 and later`() {
        for (sdk in listOf(34, 35, 36)) {
            for (reason in LinkStartReason.entries) {
                assertEquals("$reason on API $sdk", connectedDevice, LinkAutoStart.foregroundTypesFor(reason, sdk))
            }
        }
    }

    @Test
    fun `no start route claims a type with a time budget`() {
        for (reason in LinkStartReason.entries) {
            val types = LinkAutoStart.foregroundTypesFor(reason, sdkInt = 36)
            assertEquals("$reason claims a time-limited type: 0x${types.toString(16)}", 0, types and timeLimited)
        }
    }

    @Test
    fun `below API 34 no type is passed to startForeground`() {
        for (reason in LinkStartReason.entries) {
            assertEquals(0, LinkAutoStart.foregroundTypesFor(reason, sdkInt = 29))
            assertEquals(0, LinkAutoStart.foregroundTypesFor(reason, sdkInt = 33))
        }
    }

    // ---- the manifest the platform checks the claim against ---------------------------------

    private val typeBits = mapOf(
        "connectedDevice" to connectedDevice,
        "dataSync" to dataSync,
        "mediaProjection" to ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
        "mediaProcessing" to ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING,
        "shortService" to ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE,
    )

    private data class ServiceDecl(val name: String, val types: List<String>)

    private fun services(): List<ServiceDecl> = manifests().flatMap { file ->
        val nodes = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file).getElementsByTagName("service")
        (0 until nodes.length).map { i ->
            val el = nodes.item(i) as Element
            ServiceDecl(
                el.getAttribute("android:name"),
                el.getAttribute("android:foregroundServiceType").split('|').filter { it.isNotBlank() },
            )
        }
    }

    /** The control: the scan sees the declarations already known to be there, so an empty result is not a pass. */
    @Test
    fun `the manifest scan finds the link and mirror services`() {
        val byName = services().associateBy { it.name.substringAfterLast('.') }
        assertNotNull("LinkService not found in ${byName.keys}", byName["LinkService"])
        assertEquals(listOf("mediaProjection"), byName["MirrorService"]?.types)
    }

    @Test
    fun `LinkService declares connectedDevice and nothing time-limited`() {
        val link = services().single { it.name.endsWith(".link.LinkService") }
        assertEquals(listOf("connectedDevice"), link.types)
    }

    /** `startForeground` throws `IllegalArgumentException` for a type outside the manifest attribute. */
    @Test
    fun `every type a route claims is declared on the service`() {
        val link = services().single { it.name.endsWith(".link.LinkService") }
        val declared = link.types.fold(0) { acc, t -> acc or (typeBits[t] ?: error("unmapped type $t")) }
        for (reason in LinkStartReason.entries) {
            val claimed = LinkAutoStart.foregroundTypesFor(reason, sdkInt = 36)
            assertEquals("$reason claims 0x${claimed.toString(16)} outside the manifest's 0x${declared.toString(16)}", claimed, claimed and declared)
        }
    }

    @Test
    fun `no manifest asks for the dataSync foreground permission`() {
        val asking = manifests().filter { it.readText().contains("android.permission.FOREGROUND_SERVICE_DATA_SYNC") }
        assertEquals(emptyList<File>(), asking)
        // Control: the same scan does see a foreground permission that is meant to be there.
        assertTrue(manifests().any { it.readText().contains("android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE") })
    }

    /**
     * `connectedDevice` has a runtime prerequisite on Android 14+: one of these declared (or a Bluetooth,
     * UWB or USB grant this app does not hold). Without it every claim throws `SecurityException`.
     */
    @Test
    fun `a connectedDevice prerequisite permission is declared`() {
        val prerequisites = listOf(
            "android.permission.CHANGE_NETWORK_STATE",
            "android.permission.CHANGE_WIFI_STATE",
            "android.permission.CHANGE_WIFI_MULTICAST_STATE",
            "android.permission.NFC",
            "android.permission.TRANSMIT_IR",
        )
        val text = manifests().joinToString("\n") { it.readText() }
        assertTrue("none of $prerequisites is declared", prerequisites.any { "\"$it\"" in text })
    }

    // ---- the timeout reaction -----------------------------------------------------------------

    private class Harness(var failClose: Boolean = false, var failStop: Boolean = false) {
        val calls = mutableListOf<String>()
        val logs = mutableListOf<String>()
        var closedWith: String? = null
        var shown: String? = null
        val latch = LinkTimeoutLatch()
        var clock = 1_000L
        val stop = LinkTimeoutStop(
            latch = latch,
            stopService = { calls += "stop"; if (failStop) throw IllegalStateException("stop") },
            closeLink = { calls += "close"; closedWith = it; if (failClose) throw IllegalStateException("close") },
            releaseLocks = { calls += "locks" },
            showInterrupted = { calls += "notify"; shown = it },
            log = { logs += it },
            now = { clock },
        )
    }

    @Test
    fun `a timeout stops the service first, then closes, releases and tells`() {
        val h = Harness()
        assertTrue(h.stop.onTimeout(startId = 3, fgsType = dataSync))
        assertEquals(listOf("stop", "close", "locks", "notify"), h.calls)
        assertEquals(LinkTimeout.interruptedSentence(dataSync), h.closedWith)
        assertEquals(h.closedWith, h.shown)
        assertEquals(LinkTimeoutLatch.TimedOut(dataSync, 1_000L), h.latch.current())
        assertTrue(h.logs.single().contains("dataSync"))
    }

    @Test
    fun `a second timeout re-requests the stop and does not clean up twice`() {
        val h = Harness()
        h.stop.onTimeout(3, dataSync)
        h.clock = 2_000L
        assertFalse(h.stop.onTimeout(4, dataSync))
        assertEquals(listOf("stop", "close", "locks", "notify", "stop"), h.calls)
        assertEquals("the first timeout is the one recorded", 1_000L, h.latch.current()?.atMillis)
    }

    @Test
    fun `a cleanup step that throws does not stop the rest`() {
        val h = Harness(failClose = true)
        assertTrue(h.stop.onTimeout(1, dataSync))
        assertEquals(listOf("stop", "close", "locks", "notify"), h.calls)
        assertTrue(h.logs.any { it.contains("could not close the link") })
    }

    @Test
    fun `a stop that throws is logged and cleanup still runs`() {
        val h = Harness(failStop = true)
        h.stop.onTimeout(1, dataSync)
        assertEquals(listOf("stop", "close", "locks", "notify"), h.calls)
        assertTrue(h.logs.any { it.contains("could not stop the service") })
    }

    /** One value constrained by itself (the fourth test variety in CLAUDE.md): who acted, and what brings it back. */
    @Test
    fun `the interruption sentence names Android, the type and the way back`() {
        val s = LinkTimeout.interruptedSentence(dataSync)
        assertTrue(s, s.startsWith("Android stopped"))
        assertTrue(s, s.contains("dataSync"))
        assertTrue(s, s.contains("Open Sidekick to reconnect"))
        assertFalse("a stop Android caused must not be worded as one the owner caused: $s", Regex("\\byou\\b", RegexOption.IGNORE_CASE).containsMatchIn(s))
    }

    @Test
    fun `an unnamed type still gets a name`() {
        assertEquals("type 0x40000", LinkTimeout.typeName(0x40000))
    }

    // ---- no restart loop; legitimate starts still start ----------------------------------------

    @Test
    fun `after a timeout the automatic routes hold, and a running link is left alone`() {
        val h = Harness()
        h.stop.onTimeout(1, dataSync)
        assertEquals(LinkAutoStart.Gate.HELD_AFTER_TIMEOUT, LinkAutoStart.gate(running = false, timedOut = h.latch.current()))
        assertEquals(LinkAutoStart.Gate.ALREADY_RUNNING, LinkAutoStart.gate(running = true, timedOut = h.latch.current()))
    }

    @Test
    fun `with no timeout the automatic routes start a stopped link`() {
        assertEquals(LinkAutoStart.Gate.START, LinkAutoStart.gate(running = false, timedOut = null))
        assertEquals(LinkAutoStart.Gate.ALREADY_RUNNING, LinkAutoStart.gate(running = true, timedOut = null))
    }

    @Test
    fun `only a person clears the hold`() {
        for (reason in LinkStartReason.entries - LinkStartReason.USER) {
            assertFalse("$reason with no visible app must not clear the hold", LinkTimeoutLatch.clearsOn(reason, appVisible = false))
            assertTrue("$reason while the app is visible is a person asking", LinkTimeoutLatch.clearsOn(reason, appVisible = true))
        }
        assertTrue(LinkTimeoutLatch.clearsOn(LinkStartReason.USER, appVisible = false))
    }

    @Test
    fun `clearing returns what it cleared, once, and the routes start again`() {
        val h = Harness()
        h.stop.onTimeout(1, dataSync)
        assertEquals(dataSync, h.latch.clear()?.fgsType)
        assertNull(h.latch.clear())
        assertEquals(LinkAutoStart.Gate.START, LinkAutoStart.gate(running = false, timedOut = h.latch.current()))
    }

    // ---- the state the link is left in -----------------------------------------------------------

    @Test
    fun `a stop with a reason says it, and a stop without one keeps what was there`() {
        val before = LinkState(running = true, clients = listOf("Mac"), lastError = "earlier")
        val timedOut = before.afterStopped(LinkTimeout.interruptedSentence(dataSync))
        assertFalse(timedOut.running)
        assertEquals(emptyList<String>(), timedOut.clients)
        assertEquals(LinkTimeout.interruptedSentence(dataSync), timedOut.lastError)
        // onDestroy's second stop() must not erase the timeout's sentence.
        assertEquals(timedOut.lastError, timedOut.afterStopped().lastError)
        assertEquals("earlier", before.afterStopped().lastError)
    }

    // ---- API compatibility ---------------------------------------------------------------------

    /**
     * The override is what the platform calls on API 35+. Deleting it compiles cleanly — the base method
     * is an empty default — and restores the crash, so its presence is asserted.
     */
    @Test
    fun `LinkService overrides the two-argument onTimeout`() {
        val cls = Class.forName("com.chetan.connectsuite.core.link.LinkService", false, javaClass.classLoader)
        val m = cls.getDeclaredMethod("onTimeout", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        assertEquals(cls, m.declaringClass)
    }

    // ---- shared -----------------------------------------------------------------------------------

    private fun manifests(): List<File> {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null && !File(dir, "settings.gradle.kts").isFile) dir = dir.parentFile
        val root = dir ?: throw AssertionError("no repo root above ${System.getProperty("user.dir")}")
        val found = root.walkTopDown()
            .onEnter { it.name != "build" && it.name != ".git" && it.name != "node_modules" }
            .filter { it.isFile && it.name == "AndroidManifest.xml" && "/src/main/" in it.path }
            .toList()
        assertTrue("found only ${found.size} manifests under $root", found.size >= 4)
        return found
    }
}
