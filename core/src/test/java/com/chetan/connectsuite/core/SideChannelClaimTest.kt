package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.SideChannelClaim
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The side-channel claim — docs/protocol.md → The stream claim on 42502.
 *
 * Two properties carry the weight. The mirror's token-only frame must parse to exactly what it did
 * before Camera v1 existed (a Mac built before it must keep mirroring), and anything that is
 * *nearly* a camera claim must be refused rather than read generously — because the claim is what
 * routes a socket to a camera.
 */
class SideChannelClaimTest {

    private val token = "a".repeat(64)
    private val stream = "0123456789abcdef0123456789abcdef"

    @Test
    fun `a token-only frame is the mirror's, exactly as before`() {
        assertEquals(SideChannelClaim.TokenOnly(token), SideChannelClaim.parse(token))
        // The old reader trimmed; a Mac relying on that must not break.
        assertEquals(SideChannelClaim.TokenOnly(token), SideChannelClaim.parse("  $token\n"))
    }

    @Test
    fun `a well-formed camera claim names its stream`() {
        val claim = SideChannelClaim.parse(SideChannelClaim.cameraFrame(token, stream))
        assertEquals(SideChannelClaim.Camera(token, stream), claim)
        // Inside the 128-byte token frame cap the protocol leaves unchanged.
        assertTrue(SideChannelClaim.cameraFrame(token, stream).toByteArray().size <= 128)
    }

    @Test
    fun `nearly a camera claim is no claim`() {
        val refused = listOf(
            "$token mirror $stream", // another word
            "$token Camera $stream", // the word is case-sensitive
            "$token camera", // no stream id
            "$token camera $stream extra", // a fourth field
            "$token  camera $stream", // two spaces
            "$token camera ${stream.uppercase()}", // upper-case hex is not what the phone mints
            "$token camera ${stream.dropLast(1)}", // 31 characters
            "$token camera ${stream}0", // 33 characters
            "$token camera ${stream.dropLast(1)}g", // not hex
            "not-hex camera $stream", // a token that is not hex
            " $token camera $stream", // leading whitespace on a camera claim
            "$token camera $stream ", // trailing whitespace on a camera claim
        )
        for (frame in refused) {
            assertNull("accepted: \"$frame\"", SideChannelClaim.parse(frame))
        }
        // Control: the same builder, unmodified, is accepted — so the refusals above are about the
        // mutation each one makes and not about the builder.
        assertEquals(SideChannelClaim.Camera(token, stream), SideChannelClaim.parse("$token camera $stream"))
    }

    @Test
    fun `an empty frame is no claim`() {
        assertNull(SideChannelClaim.parse(""))
        assertNull(SideChannelClaim.parse("   "))
    }
}
