package com.chetan.connectsuite.core.link

/**
 * What a side-channel socket's first frame claims — docs/protocol.md → The stream claim on 42502.
 *
 * Until Camera v1 that frame held one thing, the session token, and the port decided the rest: a
 * socket on 42502 was the mirror's, a socket on 42503 was a transfer's. The camera's frames ride the
 * video port too, so the frame now says **which stream** it is for, and the mirror's form is left
 * byte-for-byte as it was:
 *
 * ```
 * <token>                               the mirror's (42502) or a transfer's (42503) — unchanged
 * <token> camera <32 lowercase hex>     a camera stream, 42502 only
 * <token> webcam <32 lowercase hex>     a webcam session (Camera v2), 42502 only
 * ```
 *
 * Pure and Android-free so the parse is tested on the JVM by calling this, not a copy of it.
 *
 * ### Strict on purpose
 *
 * A claim that is *nearly* a camera claim is refused rather than read generously. The claim is the
 * thing that routes a socket to a camera, and every byte of slack in the grammar is a socket some
 * peer could steer somewhere it was not admitted. So: exactly three fields, exactly one space
 * between each, the literal word `camera`, and a `streamId` of exactly 32 lowercase hex characters —
 * the shape the phone mints. Anything else is `null`, and the caller closes the socket.
 *
 * The token-only form keeps the old reader's one tolerance, a `trim()`, because the mirror's frame
 * went through `trim()` before this file existed and a Mac that relies on it must not break.
 */
sealed interface SideChannelClaim {

    /** The session token this socket presents. Resolved against the live sessions by the caller. */
    val token: String

    /** The token alone: the mirror's video socket, or a bulk socket. Its meaning is unchanged. */
    data class TokenOnly(override val token: String) : SideChannelClaim

    /** A camera stream, for one `streamId` minted by one `camera.request`. Video port only. */
    data class Camera(override val token: String, val streamId: String) : SideChannelClaim

    /**
     * A webcam session (docs/protocol.md → The webcam stream claim on 42502), for one `sessionId`
     * minted by one `webcam.request`. Video port only, and a separate type from [Camera] so a claim
     * can never be routed to the other feature: the word is the only thing that differs on the wire.
     */
    data class Webcam(override val token: String, val sessionId: String) : SideChannelClaim

    companion object {
        /** The claim word, as it appears on the wire. */
        const val CAMERA_WORD = "camera"

        /** Camera v2's claim word. */
        const val WEBCAM_WORD = "webcam"

        private val STREAM_ID = Regex("^[0-9a-f]{32}$")

        /** Hex session tokens only. The token-only form does not check this; a camera claim does. */
        private val TOKEN = Regex("^[0-9a-f]{16,128}$")

        /**
         * Parses one token frame, or returns null for a frame that is no claim at all.
         *
         * Null means *close the socket*. It never means "treat it as the mirror's" — a malformed
         * camera claim read as a token-only frame would fail to resolve and be reported to the
         * mirror's owner as an unauthorised video socket, which is a sentence about the wrong feature.
         */
        fun parse(frame: String): SideChannelClaim? {
            val trimmed = frame.trim()
            if (trimmed.isEmpty()) return null
            if (!trimmed.contains(' ')) return TokenOnly(trimmed)

            // From here on the frame is claiming more than a token, and is read exactly. The raw
            // frame, not the trimmed one, so a camera claim with stray whitespace is refused rather
            // than tidied into acceptance.
            val parts = frame.split(' ')
            if (parts.size != 3) return null
            val (token, word, id) = parts
            if (word != CAMERA_WORD && word != WEBCAM_WORD) return null
            if (!TOKEN.matches(token)) return null
            if (!STREAM_ID.matches(id)) return null
            return if (word == WEBCAM_WORD) Webcam(token = token, sessionId = id) else Camera(token = token, streamId = id)
        }

        /** The frame a Mac sends for [streamId] — the inverse of [parse], for tests and for symmetry. */
        fun cameraFrame(token: String, streamId: String): String = "$token $CAMERA_WORD $streamId"

        /** The frame a Mac sends for webcam [sessionId]: 104 bytes with a 64-hex token, inside the 128-byte cap. */
        fun webcamFrame(token: String, sessionId: String): String = "$token $WEBCAM_WORD $sessionId"
    }
}
