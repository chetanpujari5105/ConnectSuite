package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.camera.CameraRequestRoute
import com.chetan.connectsuite.core.protocol.ErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The webcam session machine, driven through its real transitions — docs/protocol.md → Webcam.
 *
 * Every test calls the production machine; nothing here restates a rule. Owners are plain objects
 * compared by identity, as `ControlSession`s are in the app. Thermal statuses are **injected** ints.
 */
class WebcamSessionMachineTest {

    private class Owner(val name: String) {
        override fun toString() = name
    }

    private val mac = Owner("mac")
    private val otherMac = Owner("other-mac")
    private val s1 = "0123456789abcdef0123456789abcdef"
    private val s2 = "fedcba9876543210fedcba9876543210"
    private val t0 = 1_000_000L
    private val cool = 0

    private fun machine() = WebcamSessionMachine<Owner>()

    private fun WebcamSessionMachine<Owner>.ask(
        owner: Owner = mac,
        sessionId: String = s1,
        facing: String? = null,
        trigger: String? = "consumer",
        hasCamera: Boolean = true,
        other: OtherCapture? = null,
        now: Long = t0,
    ) = request(owner, owner.name, "req-${owner.name}-$sessionId", facing, trigger, sessionId, now, hasCamera, other, CameraRequestRoute.SCREEN)

    /** Request, approve, attach, and the first IDR: a session in `running` at generation 1. */
    private fun WebcamSessionMachine<Owner>.running(owner: Owner = mac, sessionId: String = s1): WebcamSessionMachine<Owner> {
        ask(owner, sessionId)
        approve(sessionId, CameraFacing.FRONT, t0 + 1_000, null, cool)
        assertTrue(offerChannel(owner, sessionId))
        assertNotNull(accessUnitProduced(sessionId, 1, keyframe = true, width = 1920, height = 1080).first)
        assertEquals(WebcamPhase.RUNNING, ui().phase)
        return this
    }

    private inline fun <reified T> List<WebcamEffect<Owner>>.only(): List<T> = filterIsInstance<T>()

    private fun List<WebcamEffect<Owner>>.stopped(): WebcamEffect.Stopped<Owner>? = only<WebcamEffect.Stopped<Owner>>().singleOrNull()

    private fun List<WebcamEffect<Owner>>.opensCapture(): Boolean =
        any { it is WebcamEffect.OpenCapture || it is WebcamEffect.SwitchCapture }

    /** The single exit's order, ending in the stopped event. */
    private fun assertReleasesEverything(effects: List<WebcamEffect<Owner>>, reason: WebcamStopReason) {
        val kinds = effects.map { it.javaClass.simpleName }
        val order = listOf("CancelTimers", "CloseCapture", "CloseStream", "ClearRequest", "Stopped")
        val first = kinds.indexOf("CancelTimers")
        assertTrue("no teardown in $kinds", first >= 0)
        assertEquals("teardown order", order, kinds.subList(first, first + order.size))
        assertEquals(reason, effects.stopped()?.reason)
    }

    // ---- consent --------------------------------------------------------------------------------

    @Test
    fun `a Mac request alone never opens a camera or an encoder, and its ack is not approval`() {
        val m = machine()
        val effects = m.ask()
        assertFalse(effects.opensCapture())
        assertEquals(WebcamPhase.AWAITING, m.ui().phase)
        val ack = effects.only<WebcamEffect.Ack<Owner>>().single().payload
        assertEquals("awaiting-approval", ack["state"])
        assertEquals(s1, ack["sessionId"])
        assertEquals(30_000L, ack["expiresInMs"])
        assertEquals("front", ack["facing"])
        assertEquals(CameraRequestRoute.SCREEN.message, ack["message"])
        assertEquals(WebcamTrigger.CONSUMER, effects.only<WebcamEffect.ShowRequest>().single().trigger)
    }

    @Test
    fun `nothing but the owner's tap ever opens a capture`() {
        // Every entry point that is not approve(), thrown at a waiting request: none opens anything.
        val m = machine()
        m.ask()
        val effects = buildList {
            addAll(m.ask(owner = otherMac, sessionId = s2))
            addAll(m.switch(mac, "sw", s1, "back") { true })
            addAll(m.phoneSwitch(s1, CameraFacing.BACK))
            addAll(m.visibilityLost())
            addAll(m.thermalChanged(WebcamThermal.CRITICAL))
            addAll(m.timerFired(WebcamTimer.START, s1, t0 + 1))
            addAll(m.accessUnitProduced(s1, 1, true, 1920, 1080).second)
            addAll(m.captureFailed(s1, WebcamStopReason.CAPTURE_FAILED))
            addAll(m.streamClosed(s1))
        }
        assertFalse("something opened a capture without the tap: $effects", effects.opensCapture())
        assertFalse("a claim attached before the tap", m.offerChannel(mac, s1))
        assertEquals(WebcamPhase.AWAITING, m.ui().phase)
        assertTrue(m.approve(s1, CameraFacing.FRONT, t0 + 1, null, cool).opensCapture())
    }

    @Test
    fun `approval opens exactly one capture, at generation 1, and starts the 10-second clock`() {
        val m = machine()
        m.ask()
        val effects = m.approve(s1, CameraFacing.BACK, t0 + 5_000, null, cool)
        assertEquals(listOf(WebcamEffect.OpenCapture(s1, CameraFacing.BACK, 1)), effects.only<WebcamEffect.OpenCapture>())
        assertEquals("starting", effects.only<WebcamEffect.SendState<Owner>>().single().payload["state"])
        assertEquals(WebcamEffect.ArmTimer(WebcamTimer.START, s1, t0 + 15_000), effects.last())
        assertEquals(WebcamPhase.STARTING, m.ui().phase)
    }

    @Test
    fun `decline and the permission refusal end the request and open nothing`() {
        val m = machine()
        m.ask()
        assertReleasesEverything(m.decline(s1), WebcamStopReason.DECLINED)
        m.ask(sessionId = s2)
        val denied = m.permissionDenied(s2, t0 + 2_000)
        assertReleasesEverything(denied, WebcamStopReason.PERMISSION_DENIED)
        assertFalse(denied.opensCapture())
    }

    @Test
    fun `expiry ends the request, and a tap at or after the deadline opens nothing`() {
        val m = machine()
        m.ask()
        // The timer is late; the deadline is not.
        val late = m.approve(s1, CameraFacing.FRONT, t0 + 30_000, null, cool)
        assertFalse(late.opensCapture())
        assertReleasesEverything(late, WebcamStopReason.EXPIRED)
        // And the timer firing afterwards changes nothing.
        assertTrue(m.timerFired(WebcamTimer.REQUEST, s1, t0 + 30_001).isEmpty())

        val n = machine()
        n.ask()
        assertTrue(n.timerFired(WebcamTimer.REQUEST, s1, t0 + 29_999).isEmpty())
        assertReleasesEverything(n.timerFired(WebcamTimer.REQUEST, s1, t0 + 30_000), WebcamStopReason.EXPIRED)
    }

    @Test
    fun `a permission answer after the deadline is expiry, not a refusal, and a late grant opens nothing`() {
        val m = machine()
        m.ask()
        assertEquals(WebcamStopReason.EXPIRED, m.permissionDenied(s1, t0 + 31_000).stopped()?.reason)
        val n = machine()
        n.ask()
        assertFalse(n.approve(s1, CameraFacing.FRONT, t0 + 31_000, null, cool).opensCapture())
    }

    @Test
    fun `consent is never reused - a late tap for an ended session, and a new request needs its own tap`() {
        val m = machine()
        m.running()
        m.stopFromMac(mac, "stop", s1, "person", null)
        // A tap, a permission answer, a capture failure and an encoder buffer for the old session.
        assertTrue(m.approve(s1, CameraFacing.FRONT, t0 + 2_000, null, cool).isEmpty())
        assertTrue(m.permissionDenied(s1, t0 + 2_000).isEmpty())
        assertTrue(m.captureFailed(s1, WebcamStopReason.CAPTURE_FAILED).isEmpty())
        assertNull(m.accessUnitProduced(s1, 1, true, 1920, 1080).first)
        assertFalse(m.isCurrentCapture(s1, 1))
        // A new request is awaiting until its own tap.
        assertFalse(m.ask(sessionId = s2).opensCapture())
        assertEquals(WebcamPhase.AWAITING, m.ui().phase)
        assertFalse(m.offerChannel(mac, s1))
    }

    @Test
    fun `a request needs a trigger and a valid facing, and front is the default`() {
        for ((facing, trigger) in listOf(null to null, "front" to "meeting", "side" to "person", "Front" to "person")) {
            val r = machine().ask(facing = facing, trigger = trigger).only<WebcamEffect.Refuse<Owner>>().single()
            assertEquals("$facing/$trigger", ErrorCode.BAD_REQUEST, r.code)
        }
        val m = machine()
        m.ask(trigger = "person")
        assertEquals(CameraFacing.FRONT, m.ui().facing)
        assertEquals(WebcamTrigger.PERSON, m.ui().trigger)
        assertEquals(ErrorCode.CAMERA_UNAVAILABLE, machine().ask(hasCamera = false).only<WebcamEffect.Refuse<Owner>>().single().code)
    }

    // ---- busy and coexistence -------------------------------------------------------------------

    @Test
    fun `busy - another webcam request, Camera v1 and the mirror each refuse CAMERA_BUSY and change nothing`() {
        val m = machine()
        m.ask()
        val second = m.ask(owner = otherMac, sessionId = s2).only<WebcamEffect.Refuse<Owner>>().single()
        assertEquals(ErrorCode.CAMERA_BUSY, second.code)
        assertTrue(second.message.contains("Another Mac"))
        assertEquals(s1, m.ui().sessionId)

        val v1 = machine().ask(other = OtherCapture.CAMERA_V1).only<WebcamEffect.Refuse<Owner>>().single()
        assertEquals(ErrorCode.CAMERA_BUSY, v1.code)
        assertTrue(v1.message.contains("Camera pane"))
        val mirror = machine().ask(other = OtherCapture.MIRROR).only<WebcamEffect.Refuse<Owner>>().single()
        assertEquals(ErrorCode.CAMERA_BUSY, mirror.code)
        assertTrue(mirror.message.contains("mirroring"))
        // Refusing touched nothing: no stop effect of any kind for the other capture.
        assertTrue(machine().ask(other = OtherCapture.MIRROR).none { it is WebcamEffect.CloseCapture || it is WebcamEffect.CloseStream })
    }

    @Test
    fun `a mirror started between the request and the tap is preserved - the webcam does not start`() {
        val m = machine()
        m.ask()
        val effects = m.approve(s1, CameraFacing.FRONT, t0 + 1_000, OtherCapture.MIRROR, cool)
        assertFalse(effects.opensCapture())
        assertReleasesEverything(effects, WebcamStopReason.CAPTURE_BUSY)
        assertEquals("camera-in-use", WebcamStopReason.CAPTURE_BUSY.wire)
    }

    // ---- ownership and the claim ----------------------------------------------------------------

    @Test
    fun `the claim - every condition, and claimed once`() {
        val m = machine()
        m.ask()
        assertFalse("awaiting", m.offerChannel(mac, s1))
        m.approve(s1, CameraFacing.FRONT, t0 + 1, null, cool)
        assertFalse("another connection", m.offerChannel(otherMac, s1))
        assertFalse("another session", m.offerChannel(mac, s2))
        assertTrue(m.offerChannel(mac, s1))
        assertFalse("a second claim", m.offerChannel(mac, s1))
    }

    @Test
    fun `stop and switch from another connection are UNAUTHORIZED and change nothing`() {
        val m = machine().running()
        assertEquals(ErrorCode.UNAUTHORIZED, m.stopFromMac(otherMac, "x", s1, "person", null).only<WebcamEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.UNAUTHORIZED, m.switch(otherMac, "y", s1, "back") { true }.only<WebcamEffect.Refuse<Owner>>().single().code)
        assertEquals(WebcamPhase.RUNNING, m.ui().phase)
        assertEquals(1, m.ui().generation)
    }

    @Test
    fun `the owner's connection ending stops at once and sends nothing`() {
        val m = machine().running()
        assertTrue(m.sessionEnded(otherMac).isEmpty())
        val effects = m.sessionEnded(mac)
        assertReleasesEverything(effects, WebcamStopReason.MAC_DISCONNECTED)
        assertNull(WebcamStopReason.MAC_DISCONNECTED.wire)
    }

    // ---- stop causes ----------------------------------------------------------------------------

    @Test
    fun `each stop cause produces its reason, and a Mac failure is never worded as a Stop`() {
        val cases = mapOf(
            "person" to WebcamStopReason.STOPPED_BY_MAC,
            "no-consumers" to WebcamStopReason.NO_CONSUMERS,
            "shutdown" to WebcamStopReason.STOPPED_BY_MAC,
            "failure" to WebcamStopReason.MAC_FAILED,
        )
        for ((cause, reason) in cases) {
            val m = machine().running()
            val effects = m.stopFromMac(mac, "stop", s1, cause, "bridge-failed")
            assertReleasesEverything(effects, reason)
            assertEquals(mapOf("stopped" to true), effects.only<WebcamEffect.Ack<Owner>>().single().payload)
        }
        val failed = machine().running().stopFromMac(mac, "stop", s1, "failure", "stream-malformed").stopped()!!
        assertEquals(WebcamFailureDetail.STREAM_MALFORMED, failed.detail)
        val sentence = WebcamPayloads.stopped(s1, "r", failed.reason, failed.detail, 10, 0)!!
        assertEquals("mac-failed", sentence["reason"])
        val message = sentence["message"] as String
        assertTrue(message, message.startsWith("Your Mac ended the webcam"))
        assertFalse("a failure worded as someone stopping it: $message", message.contains("stopped the webcam"))
    }

    @Test
    fun `a failure detail is chosen from the closed set - an unknown or missing one is the generic sentence, never echoed`() {
        val injected = "<b>Error: java.io.IOException at Bridge.swift:42</b>"
        val effects = machine().running().stopFromMac(mac, "stop", s1, "failure", injected)
        val stopped = effects.stopped()!!
        assertEquals(WebcamFailureDetail.UNSPECIFIED, stopped.detail)
        val payload = WebcamPayloads.stopped(s1, "r", stopped.reason, stopped.detail, 0, 0)!!
        assertFalse(payload.values.any { it.toString().contains("IOException") })
        assertEquals(WebcamFailureDetail.UNSPECIFIED.message, payload["message"])
        assertEquals(mapOf("stopped" to true), effects.only<WebcamEffect.Ack<Owner>>().single().payload)
        // A detail beside another cause is ignored.
        assertNull(machine().running().stopFromMac(mac, "stop", s1, "person", "bridge-failed").stopped()!!.detail)
    }

    @Test
    fun `a malformed stop is BAD_REQUEST and still stops the camera`() {
        for (cause in listOf(null, "", "PERSON", "pause")) {
            val m = machine().running()
            val effects = m.stopFromMac(mac, "stop", s1, cause, null)
            assertReleasesEverything(effects, WebcamStopReason.STOPPED_BY_MAC)
            assertEquals("$cause", ErrorCode.BAD_REQUEST, effects.only<WebcamEffect.Refuse<Owner>>().single().code)
            assertEquals(WebcamPhase.IDLE, m.ui().phase)
        }
        assertEquals(ErrorCode.BAD_REQUEST, machine().running().stopFromMac(mac, "stop", null, "person", null).only<WebcamEffect.Refuse<Owner>>().single().code)
    }

    @Test
    fun `stop is idempotent, and a stop crossing the socket's close re-attributes stream-closed - once, for that session only`() {
        val m = machine().running()
        assertReleasesEverything(m.streamClosed(s1), WebcamStopReason.STREAM_CLOSED)
        val late = m.stopFromMac(mac, "stop", s1, "failure", "stream-malformed")
        assertEquals(
            WebcamEffect.Reattributed(s1, WebcamStopReason.STREAM_CLOSED, WebcamStopReason.MAC_FAILED),
            late.only<WebcamEffect.Reattributed>().single(),
        )
        assertEquals(mapOf("stopped" to false), late.only<WebcamEffect.Ack<Owner>>().single().payload)
        assertEquals(WebcamStopReason.MAC_FAILED, m.ui().lastStop)
        // Again: nothing more to re-attribute.
        assertTrue(m.stopFromMac(mac, "stop2", s1, "person", null).only<WebcamEffect.Reattributed>().isEmpty())
        // Another connection's stop for the ended session re-attributes nothing.
        val n = machine().running()
        n.streamClosed(s1)
        assertTrue(n.stopFromMac(otherMac, "x", s1, "person", null).only<WebcamEffect.Reattributed>().isEmpty())
    }

    // ---- switch, generations, the first IDR -----------------------------------------------------

    @Test
    fun `nothing is written before the socket, and running is announced by the first IDR on it`() {
        val m = machine()
        m.ask()
        m.approve(s1, CameraFacing.FRONT, t0 + 1, null, cool)
        // The encoder runs from the tap; with no socket nothing goes out and nothing is announced.
        assertNull(m.accessUnitProduced(s1, 1, true, 1920, 1080).first)
        assertTrue(m.offerChannel(mac, s1))
        // Its IDR went nowhere: the next P-frame cannot start the stream, so an IDR is asked for — once.
        val (none, ask) = m.accessUnitProduced(s1, 1, false, 1920, 1080)
        assertNull(none)
        assertEquals(listOf(WebcamEffect.RequestKeyframe(s1, 1)), ask)
        assertTrue(m.accessUnitProduced(s1, 1, false, 1920, 1080).second.isEmpty())
        val (ticket, effects) = m.accessUnitProduced(s1, 1, true, 1280, 720)
        assertEquals(WebcamAuTicket(s1, 1, CameraFacing.FRONT, firstOfGeneration = true), ticket)
        val running = effects.only<WebcamEffect.SendState<Owner>>().single().payload
        assertEquals("running", running["state"])
        assertEquals(1, running["generation"])
        // The size actually selected, separately from the target.
        assertEquals(1280, running["width"])
        assertEquals(720, running["height"])
        assertEquals(WebcamQuality.TARGET_WIDTH, running["targetWidth"])
        assertEquals(WebcamQuality.TARGET_HEIGHT, running["targetHeight"])
        assertEquals("h264", running["codec"])
        assertTrue(effects.contains(WebcamEffect.CancelTimers))
        assertEquals(WebcamAuTicket(s1, 1, CameraFacing.FRONT, false), m.accessUnitProduced(s1, 1, false, 1280, 720).first)
        assertEquals(1280, m.ui().selectedWidth)
    }

    @Test
    fun `a switch raises the generation, refuses the old one's AUs, and re-announces running from the new IDR`() {
        val m = machine().running()
        val effects = m.switch(mac, "sw", s1, "back") { true }
        assertEquals(WebcamEffect.SwitchCapture(s1, CameraFacing.BACK, 2), effects.only<WebcamEffect.SwitchCapture>().single())
        assertEquals(mapOf("facing" to "back"), effects.only<WebcamEffect.Ack<Owner>>().single().payload)
        // Late AUs from the front camera's encoder.
        assertNull(m.accessUnitProduced(s1, 1, false, 1920, 1080).first)
        assertNull(m.accessUnitProduced(s1, 1, true, 1920, 1080).first)
        assertFalse(m.isCurrentCapture(s1, 1))
        assertTrue(m.isCurrentCapture(s1, 2))
        val (ticket, announce) = m.accessUnitProduced(s1, 2, true, 1920, 1080)
        assertEquals(WebcamAuTicket(s1, 2, CameraFacing.BACK, firstOfGeneration = true), ticket)
        val running = announce.only<WebcamEffect.SendState<Owner>>().single().payload
        assertEquals(2, running["generation"])
        assertEquals("back", running["facing"])
        assertEquals(true, running["switched"])
        // The same facing again is acknowledged without a new generation.
        assertTrue(m.switch(mac, "same", s1, "back") { true }.only<WebcamEffect.SwitchCapture>().isEmpty())
        assertEquals(2, m.ui().generation)
    }

    @Test
    fun `switch errors - unknown session, bad facing, a camera this phone lacks`() {
        val m = machine().running()
        assertEquals(ErrorCode.NOT_FOUND, m.switch(mac, "a", s2, "back") { true }.only<WebcamEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.BAD_REQUEST, m.switch(mac, "b", s1, "sideways") { true }.only<WebcamEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.CAMERA_UNAVAILABLE, m.switch(mac, "c", s1, "back") { false }.only<WebcamEffect.Refuse<Owner>>().single().code)
        assertEquals(1, m.ui().generation)
    }

    @Test
    fun `stop and switch racing - whichever lands second finds the other's outcome, and release happens once`() {
        // Switch first, then stop: one teardown, and the switched capture is never left open.
        val a = machine().running()
        a.switch(mac, "sw", s1, "back") { true }
        val stop = a.stopFromMac(mac, "st", s1, "person", null)
        assertEquals(1, stop.count { it is WebcamEffect.CloseCapture })
        assertFalse(a.isCurrentCapture(s1, 2))
        // Stop first, then the switch: NOT_FOUND, and nothing opens.
        val b = machine().running()
        b.stopFromMac(mac, "st", s1, "person", null)
        val late = b.switch(mac, "sw", s1, "back") { true }
        assertFalse(late.opensCapture())
        assertEquals(ErrorCode.NOT_FOUND, late.only<WebcamEffect.Refuse<Owner>>().single().code)
        // And a second stop, then a phone stop: nothing is released twice.
        assertTrue(b.stopFromMac(mac, "st2", s1, "person", null).none { it is WebcamEffect.CloseCapture })
        assertTrue(b.stopFromPhone().isEmpty())
    }

    @Test
    fun `a ladder reconfiguration is a new generation too, and stale generations cannot reconfigure`() {
        val m = machine().running()
        assertEquals(2, m.reconfigured(s1, 1))
        assertNull("from a generation already passed", m.reconfigured(s1, 1))
        assertNull(m.reconfigured(s2, 2))
        assertNull(m.accessUnitProduced(s1, 2, false, 1280, 720).first)
        assertNotNull(m.accessUnitProduced(s1, 2, true, 1280, 720).first)
    }

    // ---- teardown routes ------------------------------------------------------------------------

    @Test
    fun `immediate stop routes - phone Stop, leaving the screen, capture failure, the socket, the start deadline`() {
        assertReleasesEverything(machine().running().stopFromPhone(), WebcamStopReason.STOPPED_ON_PHONE)
        assertReleasesEverything(machine().running().visibilityLost(), WebcamStopReason.LEFT_SCREEN)
        assertReleasesEverything(machine().running().captureFailed(s1, WebcamStopReason.CAMERA_IN_USE), WebcamStopReason.CAMERA_IN_USE)
        assertReleasesEverything(machine().running().streamClosed(s1), WebcamStopReason.STREAM_CLOSED)

        val noSocket = machine()
        noSocket.ask()
        noSocket.approve(s1, CameraFacing.FRONT, t0, null, cool)
        assertReleasesEverything(noSocket.timerFired(WebcamTimer.START, s1, t0 + 10_000), WebcamStopReason.STREAM_NOT_OPENED)
        val noIdr = machine()
        noIdr.ask()
        noIdr.approve(s1, CameraFacing.FRONT, t0, null, cool)
        noIdr.offerChannel(mac, s1)
        assertReleasesEverything(noIdr.timerFired(WebcamTimer.START, s1, t0 + 10_000), WebcamStopReason.CAMERA_NOT_STARTED)
        // A running session ignores the start deadline.
        assertTrue(machine().running().timerFired(WebcamTimer.START, s1, t0 + 60_000).isEmpty())
    }

    @Test
    fun `leaving the screen ends a live session and leaves a waiting request alone`() {
        val m = machine()
        m.ask()
        assertTrue(m.visibilityLost().isEmpty())
        assertEquals(WebcamPhase.AWAITING, m.ui().phase)
    }

    // ---- thermal --------------------------------------------------------------------------------

    @Test
    fun `thermal - the injected boundary is critical, a live session ends too-hot, and a tap while critical opens nothing`() {
        val severe = WebcamThermal.CRITICAL - 1
        val m = machine().running()
        assertTrue(m.thermalChanged(severe).isEmpty())
        assertEquals(WebcamPhase.RUNNING, m.ui().phase)
        assertReleasesEverything(m.thermalChanged(WebcamThermal.CRITICAL), WebcamStopReason.TOO_HOT)
        assertEquals("too-hot", WebcamStopReason.TOO_HOT.wire)

        val hot = machine()
        hot.ask()
        assertTrue("an awaiting request is not a capture", hot.thermalChanged(WebcamThermal.CRITICAL).isEmpty())
        val tap = hot.approve(s1, CameraFacing.FRONT, t0 + 1, null, WebcamThermal.CRITICAL + 1)
        assertFalse(tap.opensCapture())
        assertReleasesEverything(tap, WebcamStopReason.TOO_HOT)
    }

    @Test
    fun `the stopped payload carries the counts beside each other, and the disconnected ending sends nothing`() {
        val p = WebcamPayloads.stopped(s1, "req", WebcamStopReason.NO_CONSUMERS, null, 120, 4)!!
        assertEquals("no-consumers", p["reason"])
        assertEquals(120L, p["framesSent"])
        assertEquals(4L, p["framesDropped"])
        assertNull(WebcamPayloads.stopped(s1, "req", WebcamStopReason.MAC_DISCONNECTED, null, 1, 0))
    }
}
