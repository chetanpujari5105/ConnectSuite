package com.chetan.connectsuite.camera

import com.chetan.connectsuite.core.protocol.ErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The camera session machine, driven through its real transitions — docs/protocol.md → Camera.
 *
 * Every test calls the production machine; nothing here restates a rule. The owners are plain
 * objects compared by identity, exactly as `ControlSession`s are in the app.
 */
class CameraSessionMachineTest {

    private class Owner(val name: String) {
        override fun toString() = name
    }

    private val mac = Owner("mac")
    private val otherMac = Owner("other-mac")
    private val streamA = "0123456789abcdef0123456789abcdef"
    private val streamB = "fedcba9876543210fedcba9876543210"
    private val t0 = 1_000_000L

    private fun machine() = CameraSessionMachine<Owner>()

    private fun CameraSessionMachine<Owner>.requestFrom(
        owner: Owner = mac,
        streamId: String = streamA,
        facing: String? = "back",
        hasCamera: Boolean = true,
        mirrorBusy: Boolean = false,
        now: Long = t0,
        route: CameraRequestRoute = CameraRequestRoute.SCREEN,
    ) = request(owner, owner.name, "req-${owner.name}-$streamId", facing, streamId, now, hasCamera, mirrorBusy, route)

    /** Request, approve, attach and produce one frame: a stream in `running`. */
    private fun CameraSessionMachine<Owner>.running(owner: Owner = mac, streamId: String = streamA): CameraSessionMachine<Owner> {
        requestFrom(owner, streamId)
        approve(streamId, CameraFacing.BACK, t0 + 1_000)
        assertTrue(offerChannel(owner, streamId))
        assertNotNull(frameProduced(streamId, 0, 1280, 720).first)
        assertEquals(CameraPhase.RUNNING, ui().phase)
        return this
    }

    private inline fun <reified T> List<CameraEffect<Owner>>.only(): List<T> = filterIsInstance<T>()

    private fun List<CameraEffect<Owner>>.stoppedReason(): CameraStopReason? =
        only<CameraEffect.Stopped<Owner>>().singleOrNull()?.reason

    /** The release order docs/protocol.md → Lifecycle gives, ending in the stopped event. */
    private fun assertReleasesEverything(effects: List<CameraEffect<Owner>>, reason: CameraStopReason) {
        val kinds = effects.map { it.javaClass.simpleName }
        val stop = listOf("CancelTimers", "CloseCamera", "CloseStream", "ClearRequest", "Stopped")
        val firstStop = kinds.indexOf("CancelTimers")
        assertTrue("no teardown in $kinds", firstStop >= 0)
        assertEquals("teardown order", stop, kinds.subList(firstStop, firstStop + stop.size))
        assertEquals(reason, effects.stoppedReason())
    }

    // ---- consent ---------------------------------------------------------------------------------

    @Test
    fun `a Mac request alone never opens the camera`() {
        val m = machine()
        val effects = m.requestFrom()
        assertTrue("OpenCamera on a request: $effects", effects.only<CameraEffect.OpenCamera>().isEmpty())
        assertEquals(CameraPhase.AWAITING, m.ui().phase)
        // The ack carries awaiting-approval and the stream id, and is not approval.
        val ack = effects.only<CameraEffect.Ack<Owner>>().single()
        assertEquals("awaiting-approval", ack.payload["state"])
        assertEquals(streamA, ack.payload["streamId"])
        // Control: the same machine opens it the moment the owner approves — so the absence above is
        // about the missing tap and not about a machine that cannot open a camera at all.
        assertEquals(1, m.approve(streamA, CameraFacing.BACK, t0 + 1).only<CameraEffect.OpenCamera>().size)
    }

    @Test
    fun `no frame and no socket before approval`() {
        val m = machine()
        m.requestFrom()
        assertNull(m.frameProduced(streamA, 0, 1280, 720).first)
        assertFalse("a socket claimed a stream nobody approved", m.offerChannel(mac, streamA))
        assertEquals(CameraPhase.AWAITING, m.ui().phase)
    }

    @Test
    fun `approval is the one route to the camera, and opens it with the chosen camera`() {
        val m = machine()
        m.requestFrom(facing = "back")
        val effects = m.approve(streamA, CameraFacing.FRONT, t0 + 500)
        val open = effects.only<CameraEffect.OpenCamera>().single()
        assertEquals(CameraFacing.FRONT, open.facing)
        assertEquals("starting", effects.only<CameraEffect.SendState<Owner>>().single().payload["state"])
        assertTrue(CameraEffect.ClearRequest in effects)
        assertEquals(CameraPhase.STARTING, m.ui().phase)
    }

    @Test
    fun `a tap naming a stream that is not awaiting does nothing`() {
        val m = machine()
        assertTrue(m.approve(streamA, CameraFacing.BACK, t0).isEmpty())
        m.requestFrom()
        assertTrue("approved the wrong stream", m.approve(streamB, CameraFacing.BACK, t0).isEmpty())
        m.approve(streamA, CameraFacing.BACK, t0)
        assertTrue("approved twice", m.approve(streamA, CameraFacing.BACK, t0).isEmpty())
    }

    @Test
    fun `decline ends the request and opens nothing`() {
        val m = machine()
        m.requestFrom()
        val effects = m.decline(streamA)
        assertReleasesEverything(effects, CameraStopReason.DECLINED)
        assertTrue(effects.only<CameraEffect.OpenCamera>().isEmpty())
        assertEquals(CameraStopReason.DECLINED, m.ui().lastStop)
    }

    @Test
    fun `a refused permission ends the request as permission-denied`() {
        val m = machine()
        m.requestFrom()
        assertReleasesEverything(m.permissionDenied(streamA, t0 + 5_000), CameraStopReason.PERMISSION_DENIED)
        assertNull(m.liveStreamId())
    }

    // ---- expiry ----------------------------------------------------------------------------------

    @Test
    fun `an unanswered request expires at 30 seconds, not before`() {
        val m = machine()
        val armed = m.requestFrom().only<CameraEffect.ArmTimer>().single()
        assertEquals(CameraTimer.REQUEST, armed.timer)
        assertEquals(t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS, armed.atMillis)

        assertTrue(m.timerFired(CameraTimer.REQUEST, streamA, armed.atMillis - 1).isEmpty())
        assertReleasesEverything(m.timerFired(CameraTimer.REQUEST, streamA, armed.atMillis), CameraStopReason.EXPIRED)
    }

    @Test
    fun `a tap after expiry opens nothing`() {
        val m = machine()
        m.requestFrom()
        m.timerFired(CameraTimer.REQUEST, streamA, t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS)
        assertTrue(m.approve(streamA, CameraFacing.BACK, t0 + 31_000).isEmpty())
        assertEquals(CameraPhase.IDLE, m.ui().phase)
    }

    /**
     * The expiry timer runs on its own thread and can be late. A tap whose clock is already past the
     * request's deadline must not revive it — the Mac's own backstop has expired it, or is about to.
     */
    @Test
    fun `a tap at or after the deadline, before the expiry timer ran, opens nothing and ends the request as expired`() {
        val m = machine()
        m.requestFrom()
        val effects = m.approve(streamA, CameraFacing.BACK, t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS)
        assertTrue("the camera opened for an expired request: $effects", effects.only<CameraEffect.OpenCamera>().isEmpty())
        assertReleasesEverything(effects, CameraStopReason.EXPIRED)
        assertEquals(CameraPhase.IDLE, m.ui().phase)
    }

    @Test
    fun `a tap one millisecond before the deadline still opens the camera`() {
        val m = machine()
        m.requestFrom()
        val effects = m.approve(streamA, CameraFacing.BACK, t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS - 1)
        assertEquals(1, effects.only<CameraEffect.OpenCamera>().size)
        // The request's own timer, firing late, then finds a starting stream and does nothing.
        assertTrue(m.timerFired(CameraTimer.REQUEST, streamA, t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS + 5).isEmpty())
        assertEquals(CameraPhase.STARTING, m.ui().phase)
    }

    @Test
    fun `a permission answer after the deadline ends the request as expired, and one in time as permission-denied`() {
        val late = machine()
        late.requestFrom()
        assertReleasesEverything(
            late.permissionDenied(streamA, t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS),
            CameraStopReason.EXPIRED,
        )
        val inTime = machine()
        inTime.requestFrom()
        assertReleasesEverything(
            inTime.permissionDenied(streamA, t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS - 1),
            CameraStopReason.PERMISSION_DENIED,
        )
    }

    @Test
    fun `a grant or refusal for a replaced request does nothing, and never touches the new one`() {
        val m = machine()
        m.requestFrom(streamId = streamA)
        m.decline(streamA)
        m.requestFrom(streamId = streamB, now = t0 + 1_000)
        assertTrue(m.approve(streamA, CameraFacing.BACK, t0 + 2_000).isEmpty())
        assertTrue(m.permissionDenied(streamA, t0 + 2_000).isEmpty())
        assertEquals(CameraPhase.AWAITING, m.ui().phase)
        assertEquals(streamB, m.ui().streamId)
    }

    @Test
    fun `a request is awaiting only before its own deadline, whatever the timer has done`() {
        val m = machine()
        assertFalse(m.isAwaiting(t0))
        m.requestFrom()
        assertTrue(m.isAwaiting(t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS - 1))
        assertFalse("an expired request is put back in front of the owner", m.isAwaiting(t0 + CameraSessionMachine.REQUEST_TIMEOUT_MS))
        m.approve(streamA, CameraFacing.BACK, t0 + 1_000)
        assertFalse("a started stream is not a waiting request", m.isAwaiting(t0 + 1_000))
    }

    @Test
    fun `the current camera is the exact stream and epoch, and nothing once the stream ends`() {
        val m = machine().running()
        assertTrue(m.isCurrentCamera(streamA, 0))
        assertFalse(m.isCurrentCamera(streamB, 0))
        m.switch(mac, "sw", streamA, "front") { true }
        assertFalse("a replaced camera is still current", m.isCurrentCamera(streamA, 0))
        assertTrue(m.isCurrentCamera(streamA, 1))
        m.stopFromMac(mac, "stop", streamA)
        assertFalse("an ended stream's camera is still current", m.isCurrentCamera(streamA, 1))
    }

    @Test
    fun `a waiting request is not a camera anyone may open`() {
        val m = machine()
        m.requestFrom()
        assertFalse(m.isCurrentCamera(streamA, 0))
    }

    // ---- how the request reaches the owner (defect 171) ---------------------------------------------

    @Test
    fun `the route is the screen when Sidekick is in front, a notification only when one can be shown, else none`() {
        assertEquals(CameraRequestRoute.SCREEN, CameraRequestRoute.choose(screenVisible = true, notificationsDeliverable = false))
        assertEquals(CameraRequestRoute.SCREEN, CameraRequestRoute.choose(screenVisible = true, notificationsDeliverable = true))
        assertEquals(CameraRequestRoute.NOTIFICATION, CameraRequestRoute.choose(screenVisible = false, notificationsDeliverable = true))
        assertEquals(CameraRequestRoute.NONE, CameraRequestRoute.choose(screenVisible = false, notificationsDeliverable = false))
    }

    @Test
    fun `a notification is deliverable only with the permission, the app switch and an unblocked channel`() {
        assertTrue(CameraRequestDelivery.deliverable(permitted = true, appEnabled = true, channelImportance = 4))
        assertFalse(CameraRequestDelivery.deliverable(permitted = false, appEnabled = true, channelImportance = 4))
        assertFalse("app notifications off", CameraRequestDelivery.deliverable(permitted = true, appEnabled = false, channelImportance = 4))
        assertFalse("channel blocked", CameraRequestDelivery.deliverable(permitted = true, appEnabled = true, channelImportance = 0))
        assertFalse("channel never created", CameraRequestDelivery.deliverable(permitted = true, appEnabled = true, channelImportance = null))
    }

    @Test
    fun `the ack names the route taken, and the show effect carries that same route`() {
        for (route in CameraRequestRoute.entries) {
            val effects = machine().requestFrom(route = route)
            val ack = effects.only<CameraEffect.Ack<Owner>>().single()
            assertEquals(route.message, ack.payload["message"])
            assertEquals(route.fixHint, ack.payload["fixHint"])
            assertEquals(route, effects.only<CameraEffect.ShowRequest>().single().route)
        }
    }

    @Test
    fun `with no route to the owner the Mac is never told a notification or a screen is showing it`() {
        val message = CameraRequestRoute.NONE.message.lowercase()
        assertFalse(message.contains("has a notification"))
        assertFalse(message.contains("on your phone's screen"))
        assertTrue(message.contains("notifications are turned off"))
        assertTrue("the camera-off promise is kept", message.contains("camera stays off"))
    }

    @Test
    fun `an old request's timer cannot end the next stream`() {
        val m = machine()
        m.requestFrom(streamId = streamA)
        m.decline(streamA)
        m.requestFrom(streamId = streamB, now = t0 + 5_000)
        assertTrue(m.timerFired(CameraTimer.REQUEST, streamA, t0 + 30_000).isEmpty())
        assertEquals(CameraPhase.AWAITING, m.ui().phase)
    }

    // ---- refusals that change nothing ---------------------------------------------------------------

    @Test
    fun `refusals answer with the right code and change nothing`() {
        val m = machine()
        assertEquals(ErrorCode.BAD_REQUEST, m.requestFrom(facing = "sideways").only<CameraEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.CAMERA_UNAVAILABLE, m.requestFrom(hasCamera = false).only<CameraEffect.Refuse<Owner>>().single().code)
        val mirror = m.requestFrom(mirrorBusy = true).only<CameraEffect.Refuse<Owner>>().single()
        assertEquals(ErrorCode.CAMERA_BUSY, mirror.code)
        assertTrue(mirror.message.contains("mirroring"))
        assertEquals(CameraPhase.IDLE, m.ui().phase)

        // Control: the same machine accepts the same request once nothing refuses it.
        assertEquals(CameraPhase.IDLE, m.ui().phase)
        assertTrue(m.requestFrom().only<CameraEffect.Ack<Owner>>().isNotEmpty())
    }

    @Test
    fun `a second request is busy, whoever sends it, and does not replace the first`() {
        val m = machine()
        m.requestFrom(mac, streamA)
        for (owner in listOf(mac, otherMac)) {
            val refused = m.requestFrom(owner, streamB).only<CameraEffect.Refuse<Owner>>().single()
            assertEquals(ErrorCode.CAMERA_BUSY, refused.code)
        }
        assertEquals(streamA, m.ui().streamId)
    }

    @Test
    fun `a missing facing defaults to the back camera`() {
        val m = machine()
        m.requestFrom(facing = null)
        assertEquals(CameraFacing.BACK, m.ui().facing)
    }

    // ---- running, stopping, stopping again ------------------------------------------------------------

    @Test
    fun `the first frame after the socket attaches moves the stream to running, once`() {
        val m = machine()
        m.requestFrom()
        m.approve(streamA, CameraFacing.BACK, t0)
        // Frames before the socket are produced and refused — not buffered for later.
        assertNull(m.frameProduced(streamA, 0, 1280, 720).first)
        assertEquals(CameraPhase.STARTING, m.ui().phase)
        assertTrue(m.offerChannel(mac, streamA))
        val (ticket, effects) = m.frameProduced(streamA, 0, 1280, 720)
        assertNotNull(ticket)
        val running = effects.only<CameraEffect.SendState<Owner>>().single().payload
        assertEquals("running", running["state"])
        assertEquals(1280, running["width"])
        assertEquals(15, running["frameRate"])
        assertNull("a first start is not a switch", running["switched"])
        // Announced once.
        assertTrue(m.frameProduced(streamA, 0, 1280, 720).second.isEmpty())
    }

    @Test
    fun `the Mac's stop ends its stream, and a second stop is an answer rather than an error`() {
        val m = machine().running()
        val first = m.stopFromMac(mac, "s1", streamA)
        assertReleasesEverything(first, CameraStopReason.STOPPED_BY_MAC)
        assertEquals(true, first.only<CameraEffect.Ack<Owner>>().single().payload["stopped"])

        val again = m.stopFromMac(mac, "s2", streamA)
        assertEquals(false, again.only<CameraEffect.Ack<Owner>>().single().payload["stopped"])
        assertNull("a repeated stop released something again", again.stoppedReason())
        assertTrue(again.only<CameraEffect.Refuse<Owner>>().isEmpty())
    }

    @Test
    fun `a stop with no stream id is a bad request`() {
        val m = machine().running()
        assertEquals(ErrorCode.BAD_REQUEST, m.stopFromMac(mac, "s", null).only<CameraEffect.Refuse<Owner>>().single().code)
        assertEquals(CameraPhase.RUNNING, m.ui().phase)
    }

    @Test
    fun `no frame is sent after any stop`() {
        val stops: List<Pair<String, (CameraSessionMachine<Owner>) -> Unit>> = listOf(
            "mac stop" to { m -> m.stopFromMac(mac, "s", streamA) },
            "phone stop" to { m -> m.stopFromPhone() },
            "left screen" to { m -> m.visibilityLost() },
            "session ended" to { m -> m.sessionEnded(mac) },
            "stream closed" to { m -> m.streamClosed(streamA) },
            "camera failed" to { m -> m.cameraFailed(streamA, CameraStopReason.CAMERA_IN_USE) },
        )
        for ((name, stop) in stops) {
            val m = machine().running()
            stop(m)
            assertNull("$name: a frame was still sendable", m.frameProduced(streamA, 0, 1280, 720).first)
            assertNull("$name: the stream is still live", m.liveStreamId())
        }
    }

    @Test
    fun `every way out releases the camera, the socket, the timers and the notification`() {
        val paths: List<Triple<String, CameraStopReason, (CameraSessionMachine<Owner>) -> List<CameraEffect<Owner>>>> = listOf(
            Triple("mac stop", CameraStopReason.STOPPED_BY_MAC) { m -> m.stopFromMac(mac, "s", streamA) },
            Triple("phone stop", CameraStopReason.STOPPED_ON_PHONE) { m -> m.stopFromPhone() },
            Triple("left screen", CameraStopReason.LEFT_SCREEN) { m -> m.visibilityLost() },
            Triple("session ended", CameraStopReason.MAC_DISCONNECTED) { m -> m.sessionEnded(mac) },
            Triple("stream closed", CameraStopReason.STREAM_CLOSED) { m -> m.streamClosed(streamA) },
            Triple("in use", CameraStopReason.CAMERA_IN_USE) { m -> m.cameraFailed(streamA, CameraStopReason.CAMERA_IN_USE) },
            Triple("capture", CameraStopReason.CAPTURE_FAILED) { m -> m.cameraFailed(streamA, CameraStopReason.CAPTURE_FAILED) },
        )
        for ((name, reason, path) in paths) {
            val m = machine().running()
            val effects = path(m)
            try {
                assertReleasesEverything(effects, reason)
            } catch (e: AssertionError) {
                throw AssertionError("$name: ${e.message}", e)
            }
        }
    }

    // ---- switching -------------------------------------------------------------------------------

    @Test
    fun `a switch stays inside the approved stream`() {
        val m = machine().running()
        val effects = m.switch(mac, "sw", streamA, "front") { true }
        assertEquals("front", effects.only<CameraEffect.Ack<Owner>>().single().payload["facing"])
        val switch = effects.only<CameraEffect.SwitchCamera>().single()
        assertEquals(streamA, switch.streamId)
        assertEquals(1, switch.epoch)
        // No new stream, no new approval, no new socket, no request on the phone.
        assertTrue(effects.only<CameraEffect.OpenCamera>().isEmpty())
        assertTrue(effects.only<CameraEffect.ShowRequest>().isEmpty())
        assertTrue(effects.only<CameraEffect.CloseStream>().isEmpty())
        assertEquals(streamA, m.ui().streamId)
        assertEquals(CameraFacing.FRONT, m.ui().facing)
        assertFalse("a switch let a second socket claim the stream", m.offerChannel(mac, streamA))
    }

    @Test
    fun `frames from the replaced camera are refused, and the new camera announces itself`() {
        val m = machine().running()
        m.switch(mac, "sw", streamA, "front") { true }
        assertNull("an old-epoch frame got through", m.frameProduced(streamA, 0, 1280, 720).first)
        val (ticket, effects) = m.frameProduced(streamA, 1, 720, 1280)
        assertEquals(FrameTicket(CameraFacing.FRONT, 1), ticket)
        val running = effects.only<CameraEffect.SendState<Owner>>().single().payload
        assertEquals("front", running["facing"])
        assertEquals(true, running["switched"])
    }

    @Test
    fun `switch refusals change nothing`() {
        val m = machine().running()
        assertEquals(ErrorCode.UNAUTHORIZED, m.switch(otherMac, "a", streamA, "front") { true }.only<CameraEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.NOT_FOUND, m.switch(mac, "b", streamB, "front") { true }.only<CameraEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.BAD_REQUEST, m.switch(mac, "c", streamA, "up") { true }.only<CameraEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.BAD_REQUEST, m.switch(mac, "d", null, "front") { true }.only<CameraEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.CAMERA_UNAVAILABLE, m.switch(mac, "e", streamA, "front") { false }.only<CameraEffect.Refuse<Owner>>().single().code)
        assertEquals(CameraFacing.BACK, m.ui().facing)
        assertEquals(CameraPhase.RUNNING, m.ui().phase)
        // Control: the same switch, from the owner, with the camera present, is accepted.
        assertEquals(1, m.switch(mac, "f", streamA, "front") { true }.only<CameraEffect.SwitchCamera>().size)
    }

    @Test
    fun `a switch before approval is not found`() {
        val m = machine()
        m.requestFrom()
        assertEquals(ErrorCode.NOT_FOUND, m.switch(mac, "a", streamA, "front") { true }.only<CameraEffect.Refuse<Owner>>().single().code)
    }

    @Test
    fun `switching to the camera already on rebinds nothing`() {
        val m = machine().running()
        val effects = m.switch(mac, "a", streamA, "back") { true }
        assertTrue(effects.only<CameraEffect.SwitchCamera>().isEmpty())
        assertEquals(1, effects.only<CameraEffect.Ack<Owner>>().size)
    }

    @Test
    fun `the phone's own switch is the same rebind, with nothing to answer`() {
        val m = machine().running()
        val effects = m.phoneSwitch(streamA, CameraFacing.FRONT)
        assertEquals(listOf(CameraEffect.SwitchCamera(streamA, CameraFacing.FRONT, 1)), effects)
    }

    // ---- ownership and replacement sessions ----------------------------------------------------------

    @Test
    fun `another connection cannot stop, switch or claim the stream`() {
        val m = machine().running()
        assertEquals(ErrorCode.UNAUTHORIZED, m.stopFromMac(otherMac, "s", streamA).only<CameraEffect.Refuse<Owner>>().single().code)
        assertTrue(m.sessionEnded(otherMac).isEmpty())
        assertEquals(CameraPhase.RUNNING, m.ui().phase)
    }

    @Test
    fun `a socket claim is refused from another session, for another stream, or a second time`() {
        val m = machine()
        m.requestFrom()
        m.approve(streamA, CameraFacing.BACK, t0)
        assertFalse("another session claimed it", m.offerChannel(otherMac, streamA))
        assertFalse("another stream id claimed it", m.offerChannel(mac, streamB))
        assertTrue(m.offerChannel(mac, streamA))
        assertFalse("claimed twice", m.offerChannel(mac, streamA))
    }

    @Test
    fun `the replaced session's commands and claims reach nothing in the new one`() {
        val m = machine().running(mac, streamA)
        m.sessionEnded(mac) // the old connection dies; its stream ends with it
        m.running(otherMac, streamB) // a new connection approves a new stream

        // The old session's stream id is gone: its stop finds nothing and its switch is not found.
        assertEquals(false, m.stopFromMac(mac, "s", streamA).only<CameraEffect.Ack<Owner>>().single().payload["stopped"])
        // The old session naming the NEW stream is refused, not obeyed.
        assertEquals(ErrorCode.UNAUTHORIZED, m.stopFromMac(mac, "s", streamB).only<CameraEffect.Refuse<Owner>>().single().code)
        assertEquals(ErrorCode.UNAUTHORIZED, m.switch(mac, "w", streamB, "front") { true }.only<CameraEffect.Refuse<Owner>>().single().code)
        assertTrue("the old session's end touched the new stream", m.sessionEnded(mac).isEmpty())
        assertEquals(CameraPhase.RUNNING, m.ui().phase)
        assertEquals(streamB, m.ui().streamId)
    }

    @Test
    fun `the owner disconnecting ends the stream and sends nothing to anyone`() {
        val m = machine().running()
        val effects = m.sessionEnded(mac)
        assertReleasesEverything(effects, CameraStopReason.MAC_DISCONNECTED)
        assertNull(CameraStopReason.MAC_DISCONNECTED.wire)
        assertNull(CameraPayloads.stopped(streamA, "r", CameraStopReason.MAC_DISCONNECTED, 10, 0))
        assertTrue(effects.only<CameraEffect.SendState<Owner>>().isEmpty())
    }

    @Test
    fun `the owner disconnecting while a request waits ends the request too`() {
        val m = machine()
        m.requestFrom()
        assertReleasesEverything(m.sessionEnded(mac), CameraStopReason.MAC_DISCONNECTED)
        assertTrue(m.approve(streamA, CameraFacing.BACK, t0).isEmpty())
    }

    // ---- visibility and the start deadline ------------------------------------------------------------

    @Test
    fun `leaving the camera screen ends a live stream and leaves a waiting request alone`() {
        val waiting = machine()
        waiting.requestFrom()
        assertTrue(waiting.visibilityLost().isEmpty())
        assertEquals(CameraPhase.AWAITING, waiting.ui().phase)

        val live = machine().running()
        assertReleasesEverything(live.visibilityLost(), CameraStopReason.LEFT_SCREEN)
    }

    @Test
    fun `the start deadline names which half never arrived`() {
        val noSocket = machine()
        noSocket.requestFrom()
        val start = noSocket.approve(streamA, CameraFacing.BACK, t0).only<CameraEffect.ArmTimer>().single()
        assertEquals(CameraTimer.START, start.timer)
        assertTrue(noSocket.timerFired(CameraTimer.START, streamA, start.atMillis - 1).isEmpty())
        assertReleasesEverything(noSocket.timerFired(CameraTimer.START, streamA, start.atMillis), CameraStopReason.STREAM_NOT_OPENED)

        val noFrame = machine()
        noFrame.requestFrom()
        noFrame.approve(streamA, CameraFacing.BACK, t0)
        noFrame.offerChannel(mac, streamA)
        assertReleasesEverything(
            noFrame.timerFired(CameraTimer.START, streamA, t0 + CameraSessionMachine.START_TIMEOUT_MS),
            CameraStopReason.CAMERA_NOT_STARTED,
        )
        // Both share their wire value with a sibling and keep their own sentence.
        assertEquals("stream-closed", CameraStopReason.STREAM_NOT_OPENED.wire)
        assertEquals("camera-unavailable", CameraStopReason.CAMERA_NOT_STARTED.wire)
    }

    @Test
    fun `the start deadline does nothing to a stream already running`() {
        val m = machine().running()
        assertTrue(m.timerFired(CameraTimer.START, streamA, t0 + 60_000).isEmpty())
        assertEquals(CameraPhase.RUNNING, m.ui().phase)
    }

    @Test
    fun `a socket closing before it attached ends nothing`() {
        val m = machine()
        m.requestFrom()
        m.approve(streamA, CameraFacing.BACK, t0)
        assertTrue(m.streamClosed(streamA).isEmpty())
    }

    // ---- rapid start and stop ---------------------------------------------------------------------

    @Test
    fun `rapid request, approve and stop leave nothing behind for the next stream`() {
        val m = machine()
        repeat(5) { i ->
            val id = "%032x".format(i + 1)
            m.requestFrom(streamId = id)
            m.approve(id, CameraFacing.BACK, t0)
            m.stopFromPhone()
        }
        assertEquals(CameraPhase.IDLE, m.ui().phase)
        assertNull(m.liveStreamId())
        // The next stream starts from epoch 0 and needs its own approval.
        m.requestFrom(streamId = streamB)
        assertNull(m.frameProduced(streamB, 0, 1, 1).first)
        assertEquals(0, m.approve(streamB, CameraFacing.BACK, t0).only<CameraEffect.OpenCamera>().single().epoch)
    }

    @Test
    fun `the stopped payload carries the denominator`() {
        val payload = CameraPayloads.stopped(streamA, "r", CameraStopReason.STOPPED_ON_PHONE, framesSent = 900, framesDropped = 12)!!
        assertEquals("stopped", payload["state"])
        assertEquals("stopped-on-phone", payload["reason"])
        assertEquals(900L, payload["framesSent"])
        assertEquals(12L, payload["framesDropped"])
    }

    @Test
    fun `every wire stop reason is in the contract's closed set`() {
        val contract = setOf(
            "declined", "expired", "permission-denied", "camera-unavailable", "camera-in-use",
            "stopped-by-mac", "stopped-on-phone", "left-screen", "stream-closed", "capture-failed",
        )
        val wire = CameraStopReason.entries.mapNotNull { it.wire }.toSet()
        assertEquals(contract, wire)
    }

    // ---- defect 167: a Mac stop that crossed its own socket's close --------------------------------

    private fun List<CameraEffect<Owner>>.releases(): List<String> =
        map { it.javaClass.simpleName }.filter { it in setOf("CloseCamera", "CloseStream", "CancelTimers", "ClearRequest", "Stopped") }

    @Test
    fun `a stop that arrives just after its socket closed re-attributes that stream to the Mac`() {
        val m = machine().running()
        assertEquals(CameraStopReason.STREAM_CLOSED, m.streamClosed(streamA).stoppedReason())
        assertEquals(CameraStopReason.STREAM_CLOSED, m.ui().lastStop)
        val effects = m.stopFromMac(mac, "stop-1", streamA)
        assertEquals(
            listOf(CameraEffect.Reattributed(streamA, CameraStopReason.STREAM_CLOSED, CameraStopReason.STOPPED_BY_MAC)),
            effects.only<CameraEffect.Reattributed>(),
        )
        assertEquals("nothing is released twice: $effects", emptyList<String>(), effects.releases())
        // It ended nothing, so the ack still says so.
        assertEquals(mapOf("stopped" to false), effects.only<CameraEffect.Ack<Owner>>().single().payload)
        assertEquals(CameraStopReason.STOPPED_BY_MAC, m.ui().lastStop)
        // A repeat is idempotent: no second re-attribution.
        val again = m.stopFromMac(mac, "stop-2", streamA)
        assertTrue(again.only<CameraEffect.Reattributed>().isEmpty())
        assertEquals(CameraStopReason.STOPPED_BY_MAC, m.ui().lastStop)
    }

    @Test
    fun `a stop that arrives first ends the stream as the Mac's, and the later close changes nothing`() {
        val m = machine().running()
        assertReleasesEverything(m.stopFromMac(mac, "stop-1", streamA), CameraStopReason.STOPPED_BY_MAC)
        assertTrue(m.streamClosed(streamA).isEmpty())
        assertEquals(CameraStopReason.STOPPED_BY_MAC, m.ui().lastStop)
    }

    @Test
    fun `only the owner's stop, for that exact stream, re-attributes it`() {
        val m = machine().running()
        m.streamClosed(streamA)
        assertTrue(m.stopFromMac(otherMac, "stop-x", streamA).only<CameraEffect.Reattributed>().isEmpty())
        assertTrue(m.stopFromMac(mac, "stop-y", streamB).only<CameraEffect.Reattributed>().isEmpty())
        assertEquals(CameraStopReason.STREAM_CLOSED, m.ui().lastStop)
        // Control: the owner's stop for the stream does re-attribute it — the refusals above are about
        // the owner and the id, not a machine that never re-attributes.
        assertEquals(1, m.stopFromMac(mac, "stop-z", streamA).only<CameraEffect.Reattributed>().size)
    }

    @Test
    fun `a stale stop for the last stream cannot touch the next one`() {
        val m = machine().running()
        m.streamClosed(streamA)
        m.requestFrom(streamId = streamB)
        val effects = m.stopFromMac(mac, "late-stop", streamA)
        assertEquals(listOf("Ack"), effects.map { it.javaClass.simpleName })
        assertEquals(CameraPhase.AWAITING, m.ui().phase)
        assertEquals(streamB, m.ui().streamId)
    }

    @Test
    fun `a reason somebody stated is never re-attributed`() {
        val endings = listOf<Pair<CameraStopReason, (CameraSessionMachine<Owner>) -> Unit>>(
            CameraStopReason.LEFT_SCREEN to { it.running(); it.visibilityLost() },
            CameraStopReason.STOPPED_ON_PHONE to { it.running(); it.stopFromPhone() },
            CameraStopReason.STREAM_NOT_OPENED to {
                it.requestFrom(); it.approve(streamA, CameraFacing.BACK, t0 + 1_000)
                it.timerFired(CameraTimer.START, streamA, t0 + 1_000 + CameraSessionMachine.START_TIMEOUT_MS)
            },
        )
        for ((reason, end) in endings) {
            val m = machine()
            end(m)
            assertEquals(reason, m.ui().lastStop)
            assertTrue("$reason was re-attributed", m.stopFromMac(mac, "stop", streamA).only<CameraEffect.Reattributed>().isEmpty())
            assertEquals(reason, m.ui().lastStop)
        }
    }

    @Test
    fun `a genuine close with no stop stays a close, and its sentence names no cause`() {
        val m = machine().running()
        m.streamClosed(streamA)
        assertEquals(CameraStopReason.STREAM_CLOSED, m.ui().lastStop)
        val sentence = "${CameraStopReason.STREAM_CLOSED.message} ${CameraStopReason.STREAM_CLOSED.fixHint}"
        assertFalse("an unsupported diagnosis: $sentence", Regex("network|wi-?fi|router|connection", RegexOption.IGNORE_CASE).containsMatchIn(sentence))
    }
}
