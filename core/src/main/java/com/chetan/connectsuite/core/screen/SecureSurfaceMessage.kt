package com.chetan.connectsuite.core.screen

/**
 * The one sentence this app uses for "Android is refusing to show you this screen".
 *
 * It lives in `:core` because two modules have to say exactly the same thing about exactly the
 * same wall: `mirror-module` says it when the captured frames come back blank, and `input-module`
 * says it when a gesture is aimed at that blanked screen. The phase brief for input asked for the
 * mirror's vocabulary rather than a second one, and two string literals in two modules is how
 * vocabularies drift — so there is one literal and both read it.
 */
object SecureSurfaceMessage {
    const val REASON: String =
        "The phone is showing content that Android blocks from being captured, " +
            "so the screen would appear black."

    const val FIX_HINT: String =
        "Leave the banking app, DRM video or lock screen and mirroring will resume."
}
