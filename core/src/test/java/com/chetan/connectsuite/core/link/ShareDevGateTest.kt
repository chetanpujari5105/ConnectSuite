package com.chetan.connectsuite.core.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The phone's development gate for `share.file: 2` (runbook §1). The claim is that **every**
 * combination except one advertises and negotiates version 1 or less, so the table below is the
 * whole input space, not a sample: debuggable × armed × what the Mac advertised.
 */
class ShareDevGateTest {

    private val one = mapOf(Extensions.SHARE_FILE to 1)
    private val two = mapOf(Extensions.SHARE_FILE to 2)

    @Test fun `advertised is share-file 1 in every combination but debuggable AND armed`() {
        assertEquals(one, Extensions.advertised(debuggable = false, devV2Armed = false))
        assertEquals(one, Extensions.advertised(debuggable = false, devV2Armed = true))
        assertEquals(one, Extensions.advertised(debuggable = true, devV2Armed = false))
        assertEquals("the control: the one combination that advertises 2", two, Extensions.advertised(debuggable = true, devV2Armed = true))
        assertEquals("the build constant itself is unchanged", one, Extensions.PHONE)
    }

    @Test fun `negotiated is 2 only for a debuggable armed phone facing a Mac that advertises 2`() {
        val macs = mapOf("old Mac (no ext)" to emptyMap(), "Mac at 1" to one, "Mac at 2" to two)
        for (debuggable in listOf(false, true)) for (armed in listOf(false, true)) for ((label, mac) in macs) {
            val h = Extensions.handshake(debuggable, armed, mac)
            val expected = when {
                mac.isEmpty() -> emptyMap()
                debuggable && armed && mac == two -> two
                else -> one
            }
            assertEquals("debuggable=$debuggable armed=$armed $label", expected, h.negotiated)
            assertEquals("hello.ack and negotiation are one decision", Extensions.advertised(debuggable, armed), h.advertised)
        }
    }

    @Test fun `the per-session log line says what was advertised and negotiated, and nothing else`() {
        val h = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = two)
        assertEquals(
            "ext: phone advertises share.file 1 (debug share.file 2 armed for this handshake: false; debuggable build: true); " +
                "Mac advertises share.file 2; negotiated share.file 1",
            h.logLine,
        )
        val old = Extensions.handshake(debuggable = true, devV2Armed = true, macExt = emptyMap())
        assertTrue(old.logLine, old.logLine.endsWith("Mac advertises no share.file; negotiated no share.file"))
    }

    // ---- the arm itself ---------------------------------------------------------------------------

    @Test fun `a new process is unarmed — the state a restart returns to`() {
        val fresh = ShareDevGate()
        assertFalse(fresh.isArmed())
        assertFalse(fresh.consumeForHandshake())
    }

    @Test fun `an arm is consumed by exactly one handshake — a reconnect after it is back at 1`() {
        val g = ShareDevGate()
        g.arm()
        assertTrue(g.consumeForHandshake())
        assertFalse("the next handshake", g.consumeForHandshake())
        g.arm()
        g.disarm()
        assertFalse("disarm before a handshake", g.consumeForHandshake())
    }

    // ---- what no JVM test can run, read from the source instead -------------------------------------

    private fun root(): File = listOf(File("."), File("..")).first { File(it, "core/src/main").isDirectory }

    /** Code only: the KDoc explaining these rules names the very calls they forbid. */
    private fun code(f: File): String =
        f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")

    private val linkDir get() = File(root(), "core/src/main/java/com/chetan/connectsuite/core/link")

    @Test fun `nothing persists the arm — it is one field in memory`() {
        val src = code(File(linkDir, "ShareDevGate.kt"))
        assertTrue("control: the file was read", src.contains("AtomicBoolean"))
        for (persistence in listOf("SharedPreferences", "DataStore", "File(", "Context", "Room", "getSharedPreferences", "Settings.")) {
            assertFalse(persistence, src.contains(persistence))
        }
    }

    @Test fun `ControlSession consumes the arm once, after the pairing check, and sends what it negotiated with`() {
        val src = code(File(linkDir, "ControlSession.kt"))
        val pairing = src.indexOf("acceptPairToken(")
        val consume = src.indexOf("ShareDevGate.process.consumeForHandshake()")
        assertTrue("control: the pairing check was found", pairing >= 0)
        assertTrue("the arm is consumed in onHello", consume >= 0)
        assertTrue("after the pairing check, so a refused Mac cannot use it up", consume > pairing)
        assertEquals("consumed in one place only", 1, Regex("consumeForHandshake\\(").findAll(src).count())
        assertFalse("negotiation must not read the build constant directly", src.contains("Extensions.PHONE"))
        assertTrue("hello.ack carries the handshake's own value", src.contains("Extensions.toJson(handshake.advertised)"))
    }
}
