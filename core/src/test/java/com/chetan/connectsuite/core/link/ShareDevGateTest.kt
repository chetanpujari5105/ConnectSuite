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
    /** What the phone advertises: `share.ask` 1 always (docs/protocol.md → the `share.ask` extension). */
    private val phoneOne = one + (Extensions.SHARE_ASK to 1)
    private val phoneTwo = two + (Extensions.SHARE_ASK to 1)

    @Test fun `advertised is share-file 1 in every combination but debuggable AND armed`() {
        assertEquals(phoneOne, Extensions.advertised(debuggable = false, devV2Armed = false, productionTransfer = false, holdV2 = true))
        assertEquals(phoneOne, Extensions.advertised(debuggable = false, devV2Armed = true, productionTransfer = false, holdV2 = true))
        assertEquals(phoneOne, Extensions.advertised(debuggable = true, devV2Armed = false, productionTransfer = false, holdV2 = true))
        assertEquals("the control: the one combination that advertises 2", phoneTwo, Extensions.advertised(debuggable = true, devV2Armed = true, productionTransfer = false, holdV2 = true))
        assertEquals("the build constant itself is unchanged", phoneOne, Extensions.PHONE)
    }

    @Test fun `negotiated is 2 only for a debuggable armed phone facing a Mac that advertises 2`() {
        val macs = mapOf("old Mac (no ext)" to emptyMap(), "Mac at 1" to one, "Mac at 2" to two)
        for (debuggable in listOf(false, true)) for (armed in listOf(false, true)) for ((label, mac) in macs) {
            val h = Extensions.handshake(debuggable, armed, mac, productionTransfer = false, holdV2 = true)
            val expected = when {
                mac.isEmpty() -> emptyMap()
                debuggable && armed && mac == two -> two
                else -> one
            }
            assertEquals("debuggable=$debuggable armed=$armed $label", expected, h.negotiated)
            assertEquals("hello.ack and negotiation are one decision", Extensions.advertised(debuggable, armed, productionTransfer = false, holdV2 = true), h.advertised)
        }
    }

    @Test fun `the per-session log line says what was advertised and negotiated, and nothing else`() {
        val h = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = two, productionTransfer = false, holdV2 = true)
        assertEquals(
            "ext: phone advertises share.file 1 (debug share.file 2 armed for this handshake: false; debuggable build: true); " +
                "Mac advertises share.file 2; negotiated share.file 1",
            h.logLine,
        )
        val old = Extensions.handshake(debuggable = true, devV2Armed = true, macExt = emptyMap(), holdV2 = true)
        assertTrue(old.logLine, old.logLine.endsWith("Mac advertises no share.file; negotiated no share.file"))
    }

    // ---- version 3: several files per share (Extensions.multiFile, MULTI_FILE_RELEASE) ----------------

    private val three = mapOf(Extensions.SHARE_FILE to 3)
    private val phoneThree = three + (Extensions.SHARE_ASK to 1)

    @Test fun `share-file 3 needs the transfer and multiFile, and a hold lowers only a debuggable build to 2`() {
        for (debuggable in listOf(false, true)) for (v2 in listOf(false, true)) for (production in listOf(false, true))
            for (hold in listOf(false, true)) for (release in listOf(false, true)) {
                val got = Extensions.advertised(debuggable, v2, production, holdV2 = hold, multiFileRelease = release)
                val label = "debuggable=$debuggable v2=$v2 production=$production hold=$hold release=$release"
                val transfer = production || (debuggable && v2)
                val expected = when {
                    !transfer -> phoneOne
                    (debuggable || release) && !(debuggable && hold) -> phoneThree
                    else -> phoneTwo
                }
                assertEquals(label, expected, got)
            }
        assertEquals("the build constant itself is unchanged", phoneOne, Extensions.PHONE)
    }

    @Test fun `a release build advertises 2 while the release policy is off, and 3 only once it is flipped`() {
        assertFalse("the release policy is the owner's decision and is off", Extensions.MULTI_FILE_RELEASE)
        assertEquals(phoneTwo, Extensions.advertised(debuggable = false, devV2Armed = false))
        assertEquals(phoneThree, Extensions.advertised(debuggable = false, devV2Armed = false, multiFileRelease = true))
        assertTrue("a debuggable build does several files", Extensions.multiFile(debuggable = true))
        assertFalse("a release build does not, until the policy is flipped", Extensions.multiFile(debuggable = false))
    }

    @Test fun `a hold can only lower the version - a release build ignores it`() {
        assertEquals(phoneThree, Extensions.advertised(false, false, holdV2 = true, multiFileRelease = true))
        assertEquals(phoneTwo, Extensions.advertised(false, false, holdV2 = true))
    }

    @Test fun `negotiation 3+3 is 3, and a version-2 peer on either side keeps version 2`() {
        val macTwo = two + (Extensions.SHARE_ASK to 1)
        val macThree = three + (Extensions.SHARE_ASK to 1)
        assertEquals(macThree, Extensions.handshake(true, false, macThree).negotiated)
        assertEquals("version-3 phone, version-2 Mac", macTwo, Extensions.handshake(true, false, macTwo).negotiated)
        assertEquals("held phone, version-3 Mac", macTwo, Extensions.handshake(true, false, macThree, holdV2 = true).negotiated)
        assertEquals("release build, policy off, version-3 Mac", macTwo, Extensions.handshake(false, false, macThree).negotiated)
    }

    @Test fun `the v3 line is written on every handshake and names the policy, the hold, the build and both versions`() {
        val h = Extensions.handshake(true, false, three + (Extensions.SHARE_ASK to 1))
        assertEquals(
            "ext: share.file 3 — several files per share in this build: true (release policy: false); " +
                "held at version 2 for this handshake: false; debuggable build: true; " +
                "phone advertises share.file 3; negotiated share.file 3",
            h.v3Line,
        )
        val held = Extensions.handshake(true, false, two, holdV2 = true)
        assertTrue(held.v3Line, held.v3Line.contains("held at version 2 for this handshake: true;"))
        assertTrue(held.v3Line, held.v3Line.endsWith("phone advertises share.file 2; negotiated share.file 2"))
    }

    @Test fun `the hold and the v2 arm are separate instances — arming one never arms or consumes the other`() {
        assertTrue(ShareDevGate.holdV2 !== ShareDevGate.process)
    }

    @Test fun `ControlSession consumes the hold once per handshake, after the pairing check, and logs the v3 line`() {
        val src = code(File(root(), "core/src/main/java/com/chetan/connectsuite/core/link/ControlSession.kt"))
        assertEquals("one consume of the hold", 1, Regex("ShareDevGate\\.holdV2\\.consumeForHandshake\\(\\)").findAll(src).count())
        val consume = src.indexOf("ShareDevGate.holdV2.consumeForHandshake()")
        val issue = src.indexOf("server.sessions.issue(this)")
        assertTrue("control: both found", consume > 0 && issue > 0)
        assertTrue("consumed only after the Mac was accepted and a session token issued", consume > issue)
        assertTrue(src.contains("LinkLog.i(\"control\", handshake.v3Line)"))
        assertFalse("no main source arms the hold", src.contains("ShareDevGate.holdV2.arm("))
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
        // Was: one `consumeForHandshake(` in total. The version-2 hold (was the version-3 arm) answers a different
        // question, so the total is not raised — each arm is asserted by name, once each, and nothing else.
        assertEquals("the version-2 arm consumed in one place only", 1, Regex("ShareDevGate\\.process\\.consumeForHandshake\\(").findAll(src).count())
        assertEquals("the version-2 hold consumed in one place only", 1, Regex("ShareDevGate\\.holdV2\\.consumeForHandshake\\(").findAll(src).count())
        assertEquals("no other consume", 2, Regex("consumeForHandshake\\(").findAll(src).count())
        assertFalse("negotiation must not read the build constant directly", src.contains("Extensions.PHONE"))
        assertTrue("hello.ack carries the handshake's own value", src.contains("Extensions.toJson(handshake.advertised)"))
    }

    // ---- share.ask (docs/protocol.md → Extensions → the share.ask extension) ---------------------

    @Test fun `the share-file log line is unchanged by share-ask - the runbook quotes it byte for byte`() {
        val h = Extensions.handshake(debuggable = true, devV2Armed = true, macExt = two + (Extensions.SHARE_ASK to 1), holdV2 = true)
        assertEquals(
            "ext: phone advertises share.file 2 (debug share.file 2 armed for this handshake: true; debuggable build: true); " +
                "Mac advertises share.file 2; negotiated share.file 2",
            h.logLine,
        )
    }

    @Test fun `ordinary Send is negotiated only against a Mac that promises share-ask at share-file 2`() {
        val macs = mapOf(
            "old Mac (no ext)" to emptyMap(),
            "Mac at 1" to one,
            "synthetic-only development Mac" to two,
            "production Mac" to two + (Extensions.SHARE_ASK to 1),
        )
        val got = macs.mapValues { (_, mac) ->
            listOf(false, true).map { armed -> Extensions.ordinarySend(Extensions.handshake(debuggable = true, devV2Armed = armed, macExt = mac, productionTransfer = false, holdV2 = true).negotiated) }
        }
        assertEquals(
            mapOf(
                "old Mac (no ext)" to listOf(false, false),
                "Mac at 1" to listOf(false, false),
                "synthetic-only development Mac" to listOf(false, false),
                "production Mac" to listOf(false, true),
            ),
            got,
        )
    }

    @Test fun `the ask line names both sides, the negotiated value and the verdict, and nothing else`() {
        val off = Extensions.handshake(debuggable = true, devV2Armed = true, macExt = two, holdV2 = true)
        assertEquals("ext: share.ask — phone advertises 1, Mac advertises none, negotiated none; ordinary Send on this session: disabled", off.askLine)
        val on = Extensions.handshake(debuggable = true, devV2Armed = true, macExt = two + (Extensions.SHARE_ASK to 1), holdV2 = true)
        assertTrue(on.askLine, on.askLine.endsWith("negotiated 1; ordinary Send on this session: enabled (the Mac asks a person)"))
    }

    // ---- the phone's production transfer fact ---------------------------------------------------

    @Test fun `this build offers the transfer to every trusted Mac - pinned`() {
        // Recorded with the Mac's readiness (slice 3e passed 2026-09-25; §11 in 5e20963). Setting it back
        // to false is how the phone stops advertising share.file 2 outside an armed debug handshake.
        assertTrue(Extensions.PRODUCTION_TRANSFER)
        assertEquals(phoneTwo, Extensions.advertised(debuggable = false, devV2Armed = false, holdV2 = true))
        assertEquals(phoneTwo, Extensions.advertised(debuggable = true, devV2Armed = false, holdV2 = true))
    }

    @Test fun `this build - ordinary Send against each Mac, and the per-session lines`() {
        val production = two + (Extensions.SHARE_ASK to 1)
        fun send(mac: Map<String, Int>) = Extensions.ordinarySend(Extensions.handshake(false, false, mac, holdV2 = true).negotiated)
        assertTrue("control: the production Mac", send(production))
        assertFalse("the synthetic-only development Mac: 2 negotiated, no share.ask", send(two))
        assertFalse("a version-1 Mac", send(one))
        assertFalse("an old Mac", send(emptyMap()))
        val h = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = production, holdV2 = true)
        assertEquals(
            "ext: phone advertises share.file 2 (debug share.file 2 armed for this handshake: false; debuggable build: true); " +
                "Mac advertises share.file 2; negotiated share.file 2",
            h.logLine,
        )
        assertTrue(h.askLine, h.askLine.endsWith("negotiated 1; ordinary Send on this session: enabled (the Mac asks a person)"))
    }

    @Test fun `with production transfer on, a release build advertises 2 and Send enables only against share-ask`() {
        assertEquals(phoneTwo, Extensions.advertised(debuggable = false, devV2Armed = false, productionTransfer = true, holdV2 = true))
        val production = two + (Extensions.SHARE_ASK to 1)
        fun send(mac: Map<String, Int>) =
            Extensions.ordinarySend(Extensions.handshake(false, false, mac, productionTransfer = true, holdV2 = true).negotiated)
        assertTrue("control: the production pairing", send(production))
        assertFalse("the synthetic-only development Mac", send(two))
        assertFalse("a version-1 Mac", send(one))
        assertFalse("an old Mac with no ext", send(emptyMap()))
    }
}

