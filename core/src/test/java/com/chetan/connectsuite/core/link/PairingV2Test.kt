package com.chetan.connectsuite.core.link

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Pairing v2, the phone's half — `docs/protocol.md` → *Pairing (version 2)*; audit S1 (defect 182) and
 * the QR's v2 shape. S2b is `SideChannelAuthTest`.
 *
 * Reached: the production [PairingV2] proofs (against vectors from an independent implementation),
 * the production [PhonePairing] decisions with a fixed clock and fixed nonces, and
 * [PairingQrPayload.classify]. Not reached: `ControlSession` itself
 * (it needs an `SSLSocket` and a `LinkServer` with a `Context`), the TLS trust manager, Room and
 * `SharedPreferences` — the source checks below hold the ordering in `ControlSession`, and the Mac's
 * loopback integration tests drive a full exchange against a phone stand-in built from the same rules.
 */
class PairingV2Test {

    private fun root(): File = listOf(File("."), File("..")).first { File(it, "core/src/main").isDirectory }
    private val vectors by lazy {
        Json.parseToJsonElement(File(root(), "docs/fixtures/pairing-v2-vectors.json").readText()).jsonObject["vectors"]!!.jsonArray
    }
    private fun JsonObject.s(key: String) = this[key]!!.jsonPrimitive.content

    // ---- the proofs, byte for byte, against an implementation that is neither app ----------------

    @Test fun `transcripts and proofs match the independent vectors in both directions`() {
        assertEquals("control: the fixture holds vectors", 3, vectors.size)
        for (element in vectors) {
            val v = element.jsonObject
            for (role in listOf(PairingV2.ROLE_PHONE, PairingV2.ROLE_MAC)) {
                val t = PairingV2.transcript(role, v.s("macFingerprint"), v.s("phoneFingerprint"), v.s("macNonce"), v.s("phoneNonce"))
                assertEquals("${v.s("name")} $role transcript", v.s("${role}Transcript"), t.joinToString("") { "%02x".format(it) })
                val p = PairingV2.proof(v.s("secret"), role, v.s("macFingerprint"), v.s("phoneFingerprint"), v.s("macNonce"), v.s("phoneNonce"))
                assertEquals("${v.s("name")} $role proof", v.s("${role}Proof"), p)
                assertTrue(PairingV2.verify(v.s("secret"), role, v.s("macFingerprint"), v.s("phoneFingerprint"), v.s("macNonce"), v.s("phoneNonce"), p))
            }
        }
    }

    @Test fun `a proof fails for the other role, another secret, another certificate, an altered nonce or a bad shape`() {
        val v = vectors[0].jsonObject
        val secret = v.s("secret"); val fm = v.s("macFingerprint"); val fp = v.s("phoneFingerprint")
        val nm = v.s("macNonce"); val np = v.s("phoneNonce"); val phoneProof = v.s("phoneProof")
        val other = vectors[1].jsonObject
        assertTrue("control", PairingV2.verify(secret, PairingV2.ROLE_PHONE, fm, fp, nm, np, phoneProof))
        assertFalse("domain separation", PairingV2.verify(secret, PairingV2.ROLE_MAC, fm, fp, nm, np, phoneProof))
        assertFalse("wrong secret", PairingV2.verify(other.s("secret"), PairingV2.ROLE_PHONE, fm, fp, nm, np, phoneProof))
        assertFalse("wrong phone certificate (relay)", PairingV2.verify(secret, PairingV2.ROLE_PHONE, fm, other.s("phoneFingerprint"), nm, np, phoneProof))
        assertFalse("wrong Mac certificate", PairingV2.verify(secret, PairingV2.ROLE_PHONE, other.s("macFingerprint"), fp, nm, np, phoneProof))
        assertFalse("altered Mac nonce", PairingV2.verify(secret, PairingV2.ROLE_PHONE, fm, fp, other.s("macNonce"), np, phoneProof))
        assertFalse("altered phone nonce", PairingV2.verify(secret, PairingV2.ROLE_PHONE, fm, fp, nm, other.s("phoneNonce"), phoneProof))
        assertFalse("uppercase hex is not the encoding", PairingV2.verify(secret, PairingV2.ROLE_PHONE, fm, fp, nm, np, phoneProof.uppercase()))
        assertFalse("missing", PairingV2.verify(secret, PairingV2.ROLE_PHONE, fm, fp, nm, np, null))
        assertFalse("truncated", PairingV2.verify(secret, PairingV2.ROLE_PHONE, fm, fp, nm, np, phoneProof.dropLast(2)))
        assertFalse("a malformed secret is false, not a crash", PairingV2.verify("zz", PairingV2.ROLE_PHONE, fm, fp, nm, np, phoneProof))
    }

    // ---- the phone's decisions ------------------------------------------------------------------

    private val v0 get() = vectors[0].jsonObject
    private var clock = 1_000_000L
    private fun pairing(nonce: String = v0.s("phoneNonce")) = PhonePairing(now = { clock }, nonce = { nonce }, ttlMs = 300_000)
    private fun pairObj(nonce: String = v0.s("macNonce"), v: Int = 2) =
        JsonObject(mapOf("v" to JsonPrimitive(v), "nonce" to JsonPrimitive(nonce)))
    private fun armed(p: PhonePairing = pairing()) = p.apply { arm(v0.s("macFingerprint"), v0.s("secret"), "Test Mac", "192.0.2.1") }
    private fun macProofFor(e: PhonePairing.Exchange, secret: String = v0.s("secret")) =
        PairingV2.proof(secret, PairingV2.ROLE_MAC, e.macFingerprint, e.phoneFingerprint, e.macNonce, e.phoneNonce)

    @Test fun `a valid pairing sends the vector's phone proof, accepts the Mac's, and retires the arm`() {
        val p = armed()
        val d = p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), hasLegacyToken = false)
        assertTrue(d is PhonePairing.HelloDecision.SendProof)
        d as PhonePairing.HelloDecision.SendProof
        assertEquals("the phone proof is the independent vector's", v0.s("phoneProof"), d.proof)
        val c = p.onConfirm(d.exchange, v0.s("macProof"))
        assertEquals(PhonePairing.ConfirmDecision.Accepted(PhonePairing.Paired(PhonePairing.normalize(v0.s("macFingerprint")), "Test Mac", "192.0.2.1")), c)
        assertNull("the arm is retired: no TLS admission, no second pairing", p.pendingFingerprint())
    }

    @Test fun `a trusted Mac reconnecting with no pairing request is not a pairing at all`() {
        assertEquals(PhonePairing.HelloDecision.NotPairing, pairing().onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), null, false))
    }

    @Test fun `a v1 token is refused whatever else is true — no fallback`() {
        val reason = PairRejectReason.UPGRADE_REQUIRED
        assertEquals(PhonePairing.HelloDecision.Reject(reason), armed().onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), null, true))
        assertEquals("even with a v2 pair beside it", PhonePairing.HelloDecision.Reject(reason), armed().onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), true))
        assertEquals("even unarmed", PhonePairing.HelloDecision.Reject(reason), pairing().onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), null, true))
    }

    @Test fun `armed but the Mac sent no pair is TOKEN_MISSING, and a pair while unarmed is NOT_ARMED`() {
        assertEquals(PhonePairing.HelloDecision.Reject(PairRejectReason.TOKEN_MISSING), armed().onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), null, false))
        assertEquals(PhonePairing.HelloDecision.Reject(PairRejectReason.NOT_ARMED), pairing().onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false))
    }

    @Test fun `a malformed pair request is a failed attempt`() {
        val p = armed()
        assertEquals(PhonePairing.HelloDecision.Reject(PairRejectReason.PROOF_INVALID), p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(v = 1), false))
        assertEquals(PhonePairing.HelloDecision.Reject(PairRejectReason.PROOF_INVALID), p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(nonce = "ABC"), false))
        assertEquals(PhonePairing.HelloDecision.Reject(PairRejectReason.PROOF_INVALID), p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), JsonObject(emptyMap()), false))
    }

    @Test fun `a wrong Mac proof, a wrong secret or a wrong certificate is refused and counted, and the fifth clears the arm`() {
        val p = armed()
        fun exchange() = (p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false) as PhonePairing.HelloDecision.SendProof).exchange
        val wrongSecret = macProofFor(exchange(), secret = vectors[1].jsonObject.s("secret"))
        val e1 = exchange()
        assertEquals(PhonePairing.ConfirmDecision.Reject(PairRejectReason.PROOF_INVALID), p.onConfirm(e1, wrongSecret))
        val e2 = exchange()
        val relayed = PairingV2.proof(v0.s("secret"), PairingV2.ROLE_MAC, e2.macFingerprint, vectors[1].jsonObject.s("phoneFingerprint"), e2.macNonce, e2.phoneNonce)
        assertEquals("wrong certificate in the transcript", PhonePairing.ConfirmDecision.Reject(PairRejectReason.PROOF_INVALID), p.onConfirm(e2, relayed))
        assertEquals("the phone's own proof reflected back", PhonePairing.ConfirmDecision.Reject(PairRejectReason.PROOF_INVALID), p.onConfirm(exchange(), v0.s("phoneProof")))
        assertEquals(PhonePairing.ConfirmDecision.Reject(PairRejectReason.PROOF_INVALID), p.onConfirm(exchange(), null))
        assertEquals(PhonePairing.ConfirmDecision.Reject(PairRejectReason.TOO_MANY_ATTEMPTS), p.onConfirm(exchange(), "00".repeat(32)))
        assertNull("cleared", p.pendingFingerprint())
    }

    @Test fun `a proof replayed from an earlier exchange is refused`() {
        var n = 0
        val nonces = listOf(v0.s("phoneNonce"), vectors[1].jsonObject.s("phoneNonce"))
        val p = PhonePairing(now = { clock }, nonce = { nonces[n++] }, ttlMs = 300_000).also { armed(it) }
        val first = (p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false) as PhonePairing.HelloDecision.SendProof).exchange
        val captured = macProofFor(first)
        val second = (p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false) as PhonePairing.HelloDecision.SendProof).exchange
        assertNotEquals("control: fresh nonces per exchange", first.phoneNonce, second.phoneNonce)
        assertEquals(PhonePairing.ConfirmDecision.Reject(PairRejectReason.PROOF_INVALID), p.onConfirm(second, captured))
    }

    @Test fun `an expired arm is refused at hello and at confirm, and cleared`() {
        val p = armed()
        val e = (p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false) as PhonePairing.HelloDecision.SendProof).exchange
        clock += 300_001
        assertEquals(PhonePairing.ConfirmDecision.Reject(PairRejectReason.TOKEN_EXPIRED), p.onConfirm(e, macProofFor(e)))
        assertNull(p.pendingFingerprint())
        val q = armed(); clock += 300_001
        assertEquals(PhonePairing.HelloDecision.Reject(PairRejectReason.TOKEN_EXPIRED), q.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false))
    }

    @Test fun `cancel drops the arm mid-exchange, and re-arming invalidates the old exchange`() {
        val p = armed()
        val e = (p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false) as PhonePairing.HelloDecision.SendProof).exchange
        p.cancel()
        assertNull(p.pendingFingerprint())
        assertEquals(PhonePairing.ConfirmDecision.Reject(PairRejectReason.NOT_ARMED), p.onConfirm(e, macProofFor(e)))
        armed(p)
        assertEquals("a new scan is a new arm", PhonePairing.ConfirmDecision.Reject(PairRejectReason.NOT_ARMED), p.onConfirm(e, macProofFor(e)))
    }

    @Test fun `two concurrent exchanges — the first valid confirm wins, the second is NOT_ARMED`() {
        var n = 0
        val nonces = listOf(v0.s("phoneNonce"), vectors[1].jsonObject.s("phoneNonce"))
        val p = PhonePairing(now = { clock }, nonce = { nonces[n++] }, ttlMs = 300_000).also { armed(it) }
        val a = (p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false) as PhonePairing.HelloDecision.SendProof).exchange
        val b = (p.onHello(v0.s("macFingerprint"), v0.s("phoneFingerprint"), pairObj(), false) as PhonePairing.HelloDecision.SendProof).exchange
        assertTrue(p.onConfirm(b, macProofFor(b)) is PhonePairing.ConfirmDecision.Accepted)
        assertEquals(PhonePairing.ConfirmDecision.Reject(PairRejectReason.NOT_ARMED), p.onConfirm(a, macProofFor(a)))
    }

    @Test fun `a different trusted Mac is not affected by an arm for someone else`() {
        val other = vectors[2].jsonObject.s("macFingerprint")
        assertEquals(PhonePairing.HelloDecision.NotPairing, armed().onHello(other, v0.s("phoneFingerprint"), null, false))
    }

    // ---- the QR ----------------------------------------------------------------------------------

    @Test fun `a v2 code is accepted, a v1 Mac's code is told apart, anything else is invalid, and the secret is never printed`() {
        val fp = v0.s("macFingerprint"); val secret = v0.s("secret")
        val v2 = PairingQrPayload.classify("""{"v":2,"host":"192.0.2.1","fp":"$fp","secret":"$secret","name":"Mac"}""")
        assertTrue(v2 is PairingQrPayload.Scan.V2)
        assertFalse("toString must not carry the secret", (v2 as PairingQrPayload.Scan.V2).payload.toString().contains(secret))
        assertEquals(PairingQrPayload.Scan.LegacyMac, PairingQrPayload.classify("""{"host":"192.0.2.1","fp":"$fp","token":"abcd","name":"Mac"}"""))
        assertEquals(PairingQrPayload.Scan.Invalid, PairingQrPayload.classify("""{"v":2,"host":"h","fp":"$fp","secret":"short","name":"Mac"}"""))
        assertEquals(PairingQrPayload.Scan.Invalid, PairingQrPayload.classify("""{"v":3,"host":"h","fp":"$fp","secret":"$secret","name":"Mac"}"""))
        assertEquals(PairingQrPayload.Scan.Invalid, PairingQrPayload.classify("not json"))
        assertNull(PairingQrPayload.parse("""{"host":"192.0.2.1","fp":"$fp","token":"abcd","name":"Mac"}"""))
    }

    // ---- what the code is not allowed to do --------------------------------------------------------

    private fun code(name: String): String = File(root(), "core/src/main/java/com/chetan/connectsuite/core/link/$name").readText()
        .replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")

    @Test fun `trust is persisted before hello_ack, and only on an accepted confirm`() {
        val src = code("ControlSession.kt")
        val accepted = src.indexOf("is PhonePairing.ConfirmDecision.Accepted")
        val persist = src.indexOf("server.persistPairing(")
        val complete = src.indexOf("completeHandshake(hello)")
        assertTrue("control: all three were found", accepted >= 0 && persist >= 0 && complete >= 0)
        assertTrue("persist inside the accepted branch, before the handshake completes", persist in (accepted + 1) until complete)
        assertEquals("one persist call", 1, Regex("persistPairing\\(").findAll(src).count())
        assertFalse("the v1 token path is gone", src.contains("acceptPairToken"))
    }

    @Test fun `no secret reaches a log line, and proofs compare in constant time`() {
        for (file in listOf("ControlSession.kt", "LinkServer.kt", "PairingV2.kt", "PairingQr.kt")) {
            val logLines = code(file).lines().filter { it.contains("LinkLog.") }
            assertFalse("$file logs a secret: ${logLines.filter { it.contains("secret", true) }}", logLines.any { it.contains("secret", ignoreCase = true) })
        }
        val v2 = code("PairingV2.kt")
        assertTrue("MessageDigest.isEqual", v2.contains("MessageDigest.isEqual"))
        assertFalse("no == on proof strings", Regex("expected\\s*==\\s*candidate|candidate\\s*==\\s*expected").containsMatchIn(v2))
        val arming = Regex("fun completePairing[\\s\\S]*?\\n    }").find(code("LinkServer.kt"))!!.value
        assertTrue("control: the arming function was found", arming.contains("pairing.arm("))
        assertFalse("scanning persists nothing", arming.contains("trustStore."))
    }
}
