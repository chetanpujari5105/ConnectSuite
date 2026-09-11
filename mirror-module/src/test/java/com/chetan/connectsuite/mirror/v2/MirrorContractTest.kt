package com.chetan.connectsuite.mirror.v2

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.MessageType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirror may only be advertised when it is genuinely wired up.
 *
 * The bug this guards against is the one the capability contract was introduced for: the phone
 * telling the Mac "ask me to mirror and I will", the Mac un-greying the pane, and the user
 * getting a canvas that never receives a frame. Mirroring has two independent halves — the
 * control handlers and the video socket sink — and either one alone is a promise the phone
 * cannot keep.
 */
class MirrorContractTest {

    private val mirrorContract = CapabilityContract.contracts.getValue(Capability.MIRROR)

    private fun advertisable(registered: Set<String>, videoServed: Boolean): Boolean =
        CapabilityContract.advertisable(
            // Mirroring needs no permission and no Settings toggle: MediaProjection consent is
            // asked per session, so the permission half is always open and only the handler and
            // video-sink halves are under test here.
            grantedPermissions = emptySet(),
            specialAccessHeld = emptySet(),
            registeredTypes = registered,
            videoServed = videoServed,
            bulkServed = false,
            backgroundRestricted = false,
        ).contains(Capability.MIRROR)

    // ---- the truth table ------------------------------------------------------------------

    @Test
    fun `mirror is advertisable only when handlers and the video sink are both present`() {
        val handlers = MirrorFeature.handledTypes

        assertFalse("neither half — must not advertise", advertisable(emptySet(), videoServed = false))
        assertFalse("handlers but no video sink — a session that never delivers a frame", advertisable(handlers, videoServed = false))
        assertFalse("video sink but no handlers — nothing answers mirror.start", advertisable(emptySet(), videoServed = true))
        assertTrue("both halves present — this is the only combination that may advertise", advertisable(handlers, videoServed = true))
    }

    @Test
    fun `what MirrorFeature registers actually satisfies the contract`() {
        // Ties the implementation to the contract. If someone removes mirror.stop from
        // handledTypes, this fails here rather than silently un-advertising on a real phone.
        assertTrue(
            "MirrorFeature must register every message the mirror contract requires; " +
                "missing ${mirrorContract.requests - MirrorFeature.handledTypes}",
            MirrorFeature.handledTypes.containsAll(mirrorContract.requests),
        )
        assertTrue("the mirror contract must require the video channel", mirrorContract.needsVideoChannel)
    }

    @Test
    fun `dropping either half takes the capability straight back off`() {
        val handlers = MirrorFeature.handledTypes
        assertTrue(advertisable(handlers, videoServed = true))

        // uninstall() clears the sink and unregisters the handlers; both directions must matter.
        assertFalse("clearing the video sink must un-advertise", advertisable(handlers, videoServed = false))
        mirrorContract.requests.forEach { required ->
            assertFalse(
                "removing $required must un-advertise mirror",
                advertisable(handlers - required, videoServed = true),
            )
        }
    }

    @Test
    fun `mirror screenoff is not registered because no honest handler exists`() {
        // Turning the phone's display off needs a system-signed permission. Advertising it would
        // be the exact false promise the contract exists to stop.
        assertFalse(
            "mirror.screenoff must not be registered",
            MirrorFeature.handledTypes.contains(MessageType.MIRROR_SCREENOFF),
        )
        assertFalse(
            "and the contract must not require it either",
            mirrorContract.requests.contains(MessageType.MIRROR_SCREENOFF),
        )
    }

    @Test
    fun `mirror rotate is an event from the phone, not a request it handles`() {
        // This used to sit alongside mirror.screenoff as "not implemented, assert it never
        // appears". Rotation *is* implemented now, and it is still not a handler: the Mac cannot
        // turn a phone, so there is nothing for it to ask for. MirrorEngine sends the event from
        // its DisplayListener. Registering a handler for it would mean the Mac could claim the
        // phone had rotated when it had not, and the geometry the Mac drew would stop matching the
        // geometry the encoder produces.
        assertFalse(
            "mirror.rotate is outbound; registering a handler for it would invert the direction",
            MirrorFeature.handledTypes.contains(MessageType.MIRROR_ROTATE),
        )
        assertFalse(
            "and it must not be required of the phone as a request",
            mirrorContract.requests.contains(MessageType.MIRROR_ROTATE),
        )
    }

    // ---- rotation ---------------------------------------------------------------------------

    @Test
    fun `a turn to landscape is a resize, and a brightness change is nothing`() {
        val portrait = CaptureGeometry(1080, 2340, 450)
        val landscape = CaptureGeometry(2340, 1080, 450)

        // DisplayListener fires for brightness, refresh rate and HDR too. Swapping the encoder
        // costs an IDR and ~100ms of still picture, so a callback that changes no geometry and no
        // rotation must do nothing at all.
        assertEquals(
            DisplayChange.NOTHING,
            displayChangeFor(portrait, 0, portrait, 0),
        )
        assertEquals(
            DisplayChange.RESIZE,
            displayChangeFor(portrait, 0, landscape, 1),
        )
        assertEquals(
            "and back again",
            DisplayChange.RESIZE,
            displayChangeFor(landscape, 1, portrait, 0),
        )
    }

    @Test
    fun `a 180 degree turn is announced but not resized`() {
        // Same pixels, different way up: the Mac's HUD would be wrong if it were not told, and an
        // encoder swap would cost a keyframe for a picture of identical shape.
        val portrait = CaptureGeometry(1080, 2340, 450)
        assertEquals(DisplayChange.ANNOUNCE, displayChangeFor(portrait, 0, portrait, 2))
    }

    @Test
    fun `nothing happens before capture is running`() {
        // Null geometry means there is no encoder yet, so there is nothing to swap and no Mac
        // expecting a size. A rotation during the consent prompt must not try.
        assertEquals(DisplayChange.NOTHING, displayChangeFor(null, -1, CaptureGeometry(1080, 2340, 450), 1))
    }

    @Test
    fun `rotating the phone transposes the capture and keeps the density`() {
        // The cap is on the short edge, so it lands on height in portrait and on width in
        // landscape. What must not happen is the cap changing meaning across a turn: the same
        // panel has to produce the same pixel count either way up, or the bitrate the link was
        // sized for changes every time the user tilts the phone.
        val portrait = MirrorConfig().geometryFor(1440, 3120, 600)
        val landscape = MirrorConfig().geometryFor(3120, 1440, 600)
        assertEquals(portrait.width, landscape.height)
        assertEquals(portrait.height, landscape.width)
        assertEquals(portrait.dpi, landscape.dpi)
    }

    // ---- failure reasons ------------------------------------------------------------------

    @Test
    fun `every mirror failure carries a distinct, non-empty reason`() {
        val failures = listOf(
            MirrorFailure.ConsentDenied,
            MirrorFailure.ConsentDismissed,
            MirrorFailure.ConsentTimeout,
            MirrorFailure.PhoneLocked,
            MirrorFailure.SecureSurface,
            MirrorFailure.EncoderInitFailed("codec busy"),
            MirrorFailure.EncoderDied("fatal"),
            MirrorFailure.VideoChannelUnauthorised,
        )

        // The list above is written out by hand so each case can be constructed with a realistic
        // detail string, which means it can fall behind the sealed class. This is what stops that:
        // a new failure with no entry here would otherwise ship untested, and the one that mattered
        // most — ConsentTimeout — was added precisely because a gap in this set went unnoticed
        // until a Mac sat on a blank canvas for a minute.
        val declared = MirrorFailure::class.java.declaredClasses
            .filter { MirrorFailure::class.java.isAssignableFrom(it) }
            .map { it.simpleName }
            .toSet()
        assertEquals(
            "every MirrorFailure subclass must appear in this test; missing " +
                "${declared - failures.map { it.javaClass.simpleName }.toSet()}",
            declared,
            failures.map { it.javaClass.simpleName }.toSet(),
        )

        // The whole point: one path, one sentence. An idle canvas with no explanation is the
        // failure mode this replaces.
        assertEquals("all failure paths must be covered", declared.size, failures.size)
        assertEquals(
            "every failure needs its own reason string",
            failures.size,
            failures.map { it.reason }.toSet().size,
        )
        assertEquals(
            "every failure needs its own log label",
            failures.size,
            failures.map { it.label }.toSet().size,
        )
        failures.forEach { failure ->
            assertTrue("${failure.label} has an empty reason", failure.reason.isNotBlank())
            assertTrue("${failure.label} reason should read as a sentence", failure.reason.trim().endsWith("."))
            assertEquals("${failure.label} must report the mirror feature", Capability.MIRROR, failure.feature)
        }
    }

    @Test
    fun `the two consent failures say different things`() {
        // Denied and dismissed both surface as RESULT_CANCELED from the system prompt, and
        // collapsing them loses the difference between "you said no" and "it never asked".
        assertTrue(MirrorFailure.ConsentDenied.reason != MirrorFailure.ConsentDismissed.reason)
        assertNotNull(MirrorFailure.ConsentDenied.fixHint)
        assertNotNull(MirrorFailure.ConsentDismissed.fixHint)
    }

    @Test
    fun `encoder init and encoder death are told apart`() {
        val init = MirrorFailure.EncoderInitFailed("configure failed")
        val died = MirrorFailure.EncoderDied("transient")
        assertTrue("init failure must name the configuration", init.reason.contains("configure failed"))
        assertTrue("mid-stream death must say it stopped part-way", died.reason.contains("part-way"))
        assertTrue(init.reason != died.reason)
    }

    // ---- supporting behaviour -------------------------------------------------------------

    @Test
    fun `a run of blank keyframes reads as a secure surface, a real screen does not`() {
        val detector = BlackFrameDetector(run = 3, maxBytes = 2_000)
        assertFalse(detector.offer(50_000))
        assertFalse(detector.offer(120))
        assertFalse(detector.offer(140))
        assertTrue("three blank keyframes in a row means FLAG_SECURE", detector.offer(130))

        // One real frame is enough to clear it: the user left the banking app.
        detector.reset()
        assertFalse(detector.offer(90_000))
        assertFalse(detector.offer(120))
        assertFalse(detector.offer(45_000))
        assertFalse("a real screen never trips it", detector.offer(120))
    }

    @Test
    fun `a starved stream is probed for a keyframe, and a still one is not probed twice`() {
        // Defect 23's second half. On hardware the three keyframes BlackFrameDetector needs took
        // ~60 seconds to arrive on a blanked screen, because a blanked screen is a still one and a
        // still one feeds the encoder almost nothing. These are the numbers that replace the wait.
        val probe = BlankProbe(afterTinyFrames = 8, intervalMs = 700, backoffMs = 5_000, maxBytes = 2_000)

        // Seven blank-sized deltas are not yet a cue; the eighth is.
        repeat(7) { assertFalse("delta ${it + 1} must not probe", probe.offerDelta(120, 1_000L + it)) }
        assertTrue("the eighth blank delta asks for the measurement", probe.offerDelta(120, 1_007L))

        // Rate limited: the probe is one keyframe request, not one per frame.
        repeat(60) { assertFalse("probes must not repeat inside the interval", probe.offerDelta(120, 1_100L + it)) }
        assertTrue("a second probe is due after the interval", probe.offerDelta(120, 1_800L))
    }

    @Test
    fun `a probe that finds real content backs off longer than one that finds a blank screen`() {
        val probe = BlankProbe(afterTinyFrames = 2, intervalMs = 700, backoffMs = 5_000, maxBytes = 2_000)

        // A still screen with content on it: the probe comes back large, which answers the
        // question. Asking again in 700ms would cost a real keyframe every 700ms for as long as
        // the user reads the page — so the answer is remembered for backoffMs instead.
        probe.offerDelta(120, 0L)
        assertTrue(probe.offerDelta(120, 1L))
        probe.onKeyframe(80_000, 100L)
        probe.offerDelta(120, 200L)
        assertFalse("content found: no probe until the backoff is out", probe.offerDelta(120, 4_000L))
        assertTrue("the probe is due the moment the backoff expires", probe.offerDelta(120, 5_100L))

        // A blank keyframe answers nothing, so it must not buy the same silence: the detector
        // still needs its run of three and this is what delivers them in seconds.
        probe.onKeyframe(511, 5_300L)
        probe.offerDelta(120, 5_400L)
        assertTrue("a blank keyframe does not back the probe off", probe.offerDelta(120, 6_000L))
    }

    @Test
    fun `the blank run is measured, so a detection lag cannot hide`() {
        val probe = BlankProbe(afterTinyFrames = 2, maxBytes = 2_000)
        assertEquals("nothing blank yet", -1L, probe.blankSinceMs(9_000L))

        probe.offerDelta(120, 1_000L)
        assertEquals("measured from the first blank frame", 2_000L, probe.blankSinceMs(3_000L))

        // One real frame and the run is over — the number must not carry across an episode, or the
        // next report would claim a lag that included the time the screen was working.
        probe.onKeyframe(90_000, 3_100L)
        assertEquals(-1L, probe.blankSinceMs(3_200L))
    }

    @Test
    fun `the Mac and the phone judge blankness by the same number`() {
        // The two thresholds are twins: this one decides whether the phone *says* the surface is
        // secure, and BLANK_KEYFRAME_BYTES in desktop/src/renderer/mirror.ts decides whether the
        // Mac may take the sentence explaining it off the canvas. A Mac with a looser number would
        // wipe the message over frames the phone still calls blank, which is defect 23 again with
        // an extra step. The renderer is module-free, so this is checked against the source text.
        val mirrorTs = java.io.File("../desktop/src/renderer/mirror.ts")
        assertTrue("desktop/src/renderer/mirror.ts must exist to check the twin", mirrorTs.exists())
        val declared = Regex("const BLANK_KEYFRAME_BYTES = ([0-9_]+);")
            .find(mirrorTs.readText())
            ?.groupValues
            ?.get(1)
            ?.replace("_", "")
            ?.toInt()
        assertEquals("the Mac's blank-keyframe threshold must match the phone's", 2_000, declared)
    }

    @Test
    fun `the default cap scales a 1440p panel down to 1080 on its short edge`() {
        // The S25 Ultra's panel, which is the reason the cap exists: captured natively it produces
        // a bitrate a phone hotspot cannot carry.
        val geometry = MirrorConfig().geometryFor(1440, 3120, 600)
        assertEquals(1080, geometry.width)
        assertEquals(2340, geometry.height)
        // Density scales with the geometry, or apps lay out against a screen they think is huge.
        assertEquals(450, geometry.dpi)
    }

    @Test
    fun `the cap never upscales a phone already below it`() {
        val geometry = MirrorConfig().geometryFor(1080, 2340, 420)
        assertEquals(1080, geometry.width)
        assertEquals(2340, geometry.height)
        assertEquals(420, geometry.dpi)
    }

    @Test
    fun `a raised cap captures nearer the native panel`() {
        val geometry = MirrorConfig(maxResolution = 1440).geometryFor(1440, 3120, 600)
        assertEquals(1440, geometry.width)
        assertEquals(3120, geometry.height)
    }

    @Test
    fun `capture geometry is always even, whatever the aspect ratio`() {
        // 19.5:9-ish panels scale to odd numbers constantly; H.264 encoders reject them.
        val geometry = MirrorConfig(maxResolution = 721).geometryFor(1441, 3121, 601)
        assertEquals(0, geometry.width % 2)
        assertEquals(0, geometry.height % 2)
    }

    @Test
    fun `a landscape panel is capped on its short edge, not its width`() {
        // Short edge is the height here. Capping the *width* would send a 1080-tall picture that
        // is 2340 wide, which is not what "1080p" means to anyone.
        val geometry = MirrorConfig().geometryFor(3120, 1440, 600)
        assertEquals(1080, geometry.height)
        assertEquals(2340, geometry.width)
    }

    @Test
    fun `an absurd cap is clamped rather than trusted`() {
        val tiny = MirrorConfig(maxResolution = 1).geometryFor(1440, 3120, 600)
        assertEquals(MirrorConfig.MIN_RESOLUTION, minOf(tiny.width, tiny.height))

        // Above the panel there is nothing more to capture, so it stays native.
        val huge = MirrorConfig(maxResolution = 99_999).geometryFor(1440, 3120, 600)
        assertEquals(1440, huge.width)
        assertEquals(3120, huge.height)
    }

    @Test
    fun `the video frame header matches docs protocol`() {
        // 1 byte flags + 8 bytes PTS + 4 bytes length. The Mac's reader hard-codes this size, so
        // a change here without a change there desynchronises every frame after the first.
        assertEquals(13, VideoChannel.HEADER_BYTES)
        assertEquals(0x01, VideoChannel.FLAG_KEYFRAME)
        assertEquals(0x02, VideoChannel.FLAG_CONFIG)
    }
}
