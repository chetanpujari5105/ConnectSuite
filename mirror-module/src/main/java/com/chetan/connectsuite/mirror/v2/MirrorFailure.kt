package com.chetan.connectsuite.mirror.v2

import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.screen.SecureSurfaceMessage

/**
 * Every way mirroring can fail, each with its own sentence.
 *
 * The failure this type exists to prevent is an idle canvas on the Mac with nothing said about
 * why. "Mirroring unavailable" is not an answer a user can act on: consent denied, phone locked
 * and encoder dead need three different reactions, and the phone is the only side that knows
 * which happened. So no mirror path is allowed to fail by returning null, swallowing an
 * exception, or simply not sending frames — it fails by picking one of these and sending it.
 *
 * [reason] is written to be shown verbatim: the Mac puts it on the canvas where the video would
 * be, so it is a full sentence and never a code. [fixHint] is the second line, and is present
 * exactly when the user can do something about it.
 */
sealed class MirrorFailure(
    /** Wire error code from docs/protocol.md. Several failures share one; the reason is what differs. */
    val code: String,
    /** Shown on the Mac's canvas in place of the video. */
    val reason: String,
    /** Second line, when there is an action the user can take. */
    val fixHint: String? = null,
) {
    /** The `feature` field on the error, so the Mac greys the right pane. */
    val feature: String get() = Capability.MIRROR

    /** The user saw the system prompt and answered no. */
    data object ConsentDenied : MirrorFailure(
        code = ErrorCode.PERMISSION_DENIED,
        reason = "Screen capture was denied on the phone.",
        // Never a quoted button label: Android names it, and it varies by version and maker —
        // this Samsung shows "Next" then "Share screen", not the "Start now" this used to quote.
        fixHint = "Start mirroring again and approve screen sharing on the phone.",
    )

    /**
     * The request died before any result came back, which in practice means a newer mirror request
     * superseded it — see `MirrorConsentActivity.request`. Distinct from [ConsentDenied] because
     * nobody refused anything: the right advice is "try again", not "you said no".
     *
     * Deliberately *not* the screen-lock case, whatever the older comment here said. Locking the
     * phone with the prompt up is answered by the platform as RESULT_CANCELED and reported as
     * [ConsentDenied]; that was measured on hardware on 2026-08-26 and is recorded in
     * `docs/testing.md`. Back-press and Cancel go the same way.
     */
    data object ConsentDismissed : MirrorFailure(
        code = ErrorCode.PERMISSION_DENIED,
        reason = "The screen capture prompt closed before it was answered.",
        fixHint = "Start mirroring again, and let one request finish before starting another.",
    )

    /**
     * Consent was asked for and nothing answered it.
     *
     * The case this exists for is the one that produced a blank canvas for a minute: on Android 16
     * a backgrounded app cannot show the prompt at all, so nobody says no, nobody dismisses
     * anything, and every consent failure below stays unreachable because they are all reported
     * *from inside* the prompt. This one is reported by a timer instead, which is the only thing
     * that can speak when the prompt never existed.
     */
    data object ConsentTimeout : MirrorFailure(
        code = ErrorCode.CONSENT_TIMEOUT,
        // Shown on both ends, and true on both. It does not say a prompt was shown — while
        // Sidekick is backgrounded the request ends as a notification nobody tapped — and the hint
        // does not send anyone to that notification: it is removed at the same moment
        // (`setTimeoutAfter(CONSENT_TIMEOUT_MS)`), so after a timeout there is nothing to tap.
        // Measured on the SM-S938B, 2026-09-23: the old hint read, on the phone's own Mirror
        // screen, "Tap the Sidekick notification on the phone, or open Sidekick › Mirror".
        reason = "Screen sharing was not approved within 30 seconds, so the request ended.",
        fixHint = "Start mirroring again from your Mac, then approve screen sharing on your phone.",
    )

    /**
     * Android refuses to hand out a projection while the keyguard is up, and capture started
     * behind a lock screen would be black anyway.
     */
    data object PhoneLocked : MirrorFailure(
        code = ErrorCode.DEVICE_LOCKED,
        reason = "The phone is locked, so it cannot start screen capture.",
        fixHint = "Unlock the phone, then start mirroring again.",
    )

    /**
     * FLAG_SECURE content — a banking app, DRM video, the lock screen. Android blanks these in
     * the captured buffer and gives no callback saying so, so this is inferred from the encoder
     * producing uniformly blank frames. See [BlackFrameDetector].
     */
    data object SecureSurface : MirrorFailure(
        code = ErrorCode.SECURE_SURFACE,
        // Shared with input-module, deliberately: a user whose screen is blanked gets one
        // sentence about it whether they are watching the picture or trying to tap on it.
        reason = SecureSurfaceMessage.REASON,
        fixHint = SecureSurfaceMessage.FIX_HINT,
    )

    /** MediaCodec would not create or configure at the requested size. */
    class EncoderInitFailed(detail: String) : MirrorFailure(
        code = ErrorCode.ENCODER_FAILED,
        reason = "The phone's H.264 encoder would not start ($detail).",
        fixHint = "Lower the mirror resolution or bitrate on the Mac and try again.",
    )

    /** The codec was running and threw. Different sentence from init: it did work a moment ago. */
    class EncoderDied(detail: String) : MirrorFailure(
        code = ErrorCode.ENCODER_FAILED,
        reason = "The phone's H.264 encoder stopped part-way through the stream ($detail).",
        fixHint = "Start mirroring again. If it keeps happening, lower the bitrate.",
    )

    /**
     * A video socket arrived without a token matching a live control session. Almost always a
     * stale Mac reconnecting onto a session that has already been replaced.
     */
    data object VideoChannelUnauthorised : MirrorFailure(
        code = ErrorCode.UNAUTHORIZED,
        reason = "The video connection did not present a valid session token, so it was refused.",
        fixHint = "Disconnect and reconnect the Mac to get a fresh session.",
    )

    /**
     * The person saw Sidekick's own request screen and chose **Decline** — before Android's prompt
     * was ever shown. Distinct from [ConsentDenied], which is an answer to *Android's* prompt; the
     * Mac should hear that the phone's owner said no, not that a system dialog was cancelled.
     */
    data object DeclinedOnPhone : MirrorFailure(
        code = ErrorCode.PERMISSION_DENIED,
        reason = "Screen sharing was declined on the phone.",
        // "your Mac", not "this Mac": the phone's own Mirror screen shows this sentence too, to the
        // person who just declined — read there on the SM-S938B, 2026-09-23.
        fixHint = "If that was a mistake, start mirroring again from your Mac.",
    )

    /**
     * A webcam request or session (Camera v2) holds the phone, so the mirror did not start — and the
     * webcam was not stopped to make room (docs/protocol.md → Mirror coexistence). Refused before any
     * consent is asked and before any state of an existing session is touched.
     */
    data object CaptureBusy : MirrorFailure(
        code = ErrorCode.CAMERA_BUSY,
        reason = "The phone is being used as a webcam for a Mac (Sidekick Camera), so screen mirroring did not start.",
        fixHint = "Stop the webcam first, then start mirroring again.",
    )

    /** For logs: one line naming the case, not the prose. */
    val label: String
        get() = when (this) {
            ConsentDenied -> "consent-denied"
            DeclinedOnPhone -> "declined-on-phone"
            ConsentDismissed -> "consent-dismissed"
            ConsentTimeout -> "consent-timeout"
            PhoneLocked -> "phone-locked"
            SecureSurface -> "secure-surface"
            is EncoderInitFailed -> "encoder-init-failed"
            is EncoderDied -> "encoder-died"
            VideoChannelUnauthorised -> "video-unauthorised"
            CaptureBusy -> "capture-busy"
        }
}
