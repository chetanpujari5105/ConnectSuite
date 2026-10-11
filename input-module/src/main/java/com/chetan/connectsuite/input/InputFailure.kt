package com.chetan.connectsuite.input

import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.screen.SecureSurfaceMessage

/**
 * Every way input can fail to reach the phone, each with its own sentence.
 *
 * The same rule the mirror follows, for the same reason: the user is looking at a picture of a
 * phone that did not react, and "input failed" is not something they can act on. Whether they
 * need to enable a service, unlock the phone, tap a text field, or simply try again are four
 * different answers, and the phone is the only side that knows which one it is.
 *
 * Locked decision #6 in CLAUDE.md is the rule; this is input's half of it. No path here is allowed
 * to fail by returning false, swallowing an exception, or acking a gesture that never happened.
 */
sealed class InputFailure(
    /** Wire error code from docs/protocol.md. */
    val code: String,
    /** Shown by the Mac verbatim. A full sentence, never a code. */
    val reason: String,
    /** Second line, present exactly when the user can do something about it. */
    val fixHint: String? = null,
) {
    /** The `feature` field on the error, so the Mac greys the right pane. */
    val feature: String get() = Capability.INPUT

    /**
     * The AccessibilityService is not enabled, so there is nothing to dispatch through.
     *
     * Reachable even though the capability gate should have stopped the Mac from asking: the
     * handlers are registered from app start and the grant can be revoked between the Mac
     * deciding to send and the phone receiving.
     */
    data object ServiceDisabled : InputFailure(
        code = ErrorCode.PERMISSION_DENIED,
        reason = "Sidekick Input, the accessibility service, is not enabled on the phone, so it cannot " +
            "tap, type or swipe.",
        fixHint = "On the phone: Settings > Accessibility > Installed apps > Sidekick Input, " +
            "and turn it on.",
    )

    /** No capture session, so the coordinates the Mac sent are in a space that does not exist. */
    data object NoCaptureSession : InputFailure(
        code = ErrorCode.FEATURE_UNAVAILABLE,
        reason = "The phone is not mirroring, so there is no screen for those coordinates to be on.",
        fixHint = "Start mirroring, then click on the picture.",
    )

    /**
     * The coordinate named a screen shape the phone has left — almost always a tap sent in the
     * few milliseconds around a rotation.
     *
     * This is the failure that would otherwise not be a failure at all: without the stamp the
     * gesture would be scaled against the current geometry and delivered somewhere the user did
     * not click, with no error anywhere. See docs/protocol.md, "The coordinate contract".
     */
    class GeometryStale(detail: String) : InputFailure(
        code = ErrorCode.GEOMETRY_STALE,
        reason = "That click was worked out against a screen shape the phone has already left " +
            "($detail), so it was refused rather than delivered to the wrong place.",
        fixHint = "Click again — the Mac has the phone's new screen shape now.",
    )

    /** The system would not accept the gesture, or cancelled it part-way. */
    class GestureRefused(detail: String) : InputFailure(
        code = ErrorCode.GESTURE_FAILED,
        reason = "The phone would not perform that gesture ($detail).",
        fixHint = "Try again. If it keeps happening, check the accessibility service is still on.",
    )

    /** `input.text` with nothing editable focused. */
    data object NoEditableFocus : InputFailure(
        code = ErrorCode.NO_EDITABLE_FOCUS,
        reason = "No text field has focus on the phone, so there is nowhere to put that text.",
        fixHint = "Click into a text field on the mirrored screen first, then type.",
    )

    /**
     * A key that cannot exist for an AccessibilityService.
     *
     * The reason spells out the wall rather than saying "unsupported", because a user who has just
     * pressed volume-up needs to know it will never work, not that it did not work this time.
     */
    class UnsupportedKey(key: String, why: String) : InputFailure(
        code = ErrorCode.UNSUPPORTED_KEY,
        reason = "The phone cannot press \"$key\" — $why.",
        fixHint = null,
    )

    data object PhoneLocked : InputFailure(
        code = ErrorCode.DEVICE_LOCKED,
        reason = "The phone is locked, so it will not accept taps or typing.",
        fixHint = "Unlock the phone.",
    )

    /**
     * The mirror is currently showing blanked frames, so the user cannot see what they would be
     * tapping.
     *
     * Same code and the same sentence as the mirror's — [SecureSurfaceMessage] is shared between
     * the two modules for exactly this. A second vocabulary for one wall is how a user ends up
     * with two explanations of the same black rectangle.
     */
    data object SecureSurface : InputFailure(
        code = ErrorCode.SECURE_SURFACE,
        reason = SecureSurfaceMessage.REASON,
        fixHint = SecureSurfaceMessage.FIX_HINT,
    )

    /**
     * The app in front changed between this gesture arriving and it being dispatched.
     *
     * The sibling of [GeometryStale], and defect 20. That one catches a coordinate aimed at a
     * screen *shape* the phone has left; this one catches a coordinate aimed at an *app* the phone
     * has left — a tap queued behind another gesture while a notification stole focus, or while the
     * user's own finger opened something else. The coordinates are still perfectly valid for the
     * screen they now land on, which is exactly what makes it dangerous: nothing else in the chain
     * would notice, and the tap would be delivered into whatever is in front.
     *
     * Only the package name is compared, never the window contents.
     */
    class ForegroundChanged(from: String, to: String) : InputFailure(
        code = ErrorCode.GEOMETRY_STALE,
        reason = "That click was aimed at $from, but $to is in front of the phone now, so it was " +
            "refused rather than delivered to the wrong app.",
        fixHint = "Click again — the Mac is showing what is on the phone now.",
    )

    /** Malformed payload — a required field missing or out of range. The Mac's bug, named. */
    class BadRequest(detail: String) : InputFailure(
        code = ErrorCode.FEATURE_UNAVAILABLE,
        reason = "The phone could not read that input message ($detail).",
        fixHint = null,
    )

    /** For logs: one line naming the case, not the prose. */
    val label: String
        get() = when (this) {
            ServiceDisabled -> "service-disabled"
            NoCaptureSession -> "no-capture-session"
            is GeometryStale -> "geometry-stale"
            is GestureRefused -> "gesture-refused"
            NoEditableFocus -> "no-editable-focus"
            is UnsupportedKey -> "unsupported-key"
            PhoneLocked -> "phone-locked"
            SecureSurface -> "secure-surface"
            is ForegroundChanged -> "foreground-changed"
            is BadRequest -> "bad-request"
        }
}
