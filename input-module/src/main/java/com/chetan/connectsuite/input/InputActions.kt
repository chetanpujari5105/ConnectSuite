package com.chetan.connectsuite.input

import android.accessibilityservice.AccessibilityService

/**
 * The complete set of global actions this app exposes, and the complete set of keys.
 *
 * "Complete" is the point of this file. `performGlobalAction` is the whole of what an
 * AccessibilityService can do outside a gesture, and `input.key` cannot carry a keycode at all —
 * see docs/protocol.md, "What input cannot do, permanently". Enumerating both here, in one place,
 * is what stops someone adding `power` back on the strength of the name.
 */
enum class GlobalAction(val wire: String, val action: Int) {
    BACK("back", AccessibilityService.GLOBAL_ACTION_BACK),
    HOME("home", AccessibilityService.GLOBAL_ACTION_HOME),
    RECENTS("recents", AccessibilityService.GLOBAL_ACTION_RECENTS),
    NOTIFICATIONS("notifications", AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS),
    QUICK_SETTINGS("quick_settings", AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS),
    LOCK_SCREEN("lock_screen", AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN),
    ;

    companion object {
        fun forWire(wire: String): GlobalAction? = entries.firstOrNull { it.wire == wire }

        /**
         * Names the platform offers that this app deliberately does not, with the reason.
         *
         * They are listed rather than simply omitted so that the refusal can say *why* instead of
         * "unknown action", and so that the decision is visible to the next person who reads
         * `GLOBAL_ACTION_POWER_DIALOG` in the SDK and wonders why it is missing.
         */
        val refused: Map<String, String> = mapOf(
            "power" to "there is no way for any app to press the power button; " +
                "that needs a permission only the system holds",
            "power_dialog" to "opening the power menu remotely is one stray click from turning " +
                "off the phone this Mac is connected to",
            "volume_up" to "volume keys cannot be pressed by an accessibility service",
            "volume_down" to "volume keys cannot be pressed by an accessibility service",
            "screenshot" to "the phone's screen is already on your Mac; " +
                "take the screenshot there",
        )
    }
}

/** What an `input.key` name resolves to. There is no fourth kind, and there cannot be. */
sealed interface KeyAction {
    /** Delete the last character of the focused field, via `ACTION_SET_TEXT`. */
    data object Backspace : KeyAction

    /** `ACTION_IME_ENTER` on the focused field. Android 11+ only; there is no substitute below it. */
    data object ImeEnter : KeyAction

    /** An alias for the matching [GlobalAction] — Escape meaning Back, and so on. */
    data class Global(val action: GlobalAction) : KeyAction
}

object InputKeys {
    const val BACKSPACE = "backspace"
    const val ENTER = "enter"

    /**
     * Resolves a key name, or null if it is not one of the few that can exist.
     *
     * Letters and digits are deliberately *not* here. They would have to be typed, an
     * accessibility service cannot type, and `input.text` is the honest route — so a Mac sending
     * "a" gets told that rather than getting a silent no-op.
     */
    fun forWire(key: String): KeyAction? = when (val name = key.lowercase()) {
        BACKSPACE, "delete" -> KeyAction.Backspace
        ENTER, "return" -> KeyAction.ImeEnter
        else -> GlobalAction.forWire(name)?.let { KeyAction.Global(it) }
    }

    /**
     * Why a key cannot work, for the refusal message.
     *
     * A named reason for the keys people actually press first; a general one for the rest. Both
     * say the same true thing — an accessibility service has no way to synthesise a key event —
     * but a user who pressed volume-up deserves to be told about volume-up.
     */
    fun refusalFor(key: String): String {
        val name = key.lowercase()
        GlobalAction.refused[name]?.let { return it }
        if (name.length == 1) {
            return "single keys cannot be pressed on a phone by an accessibility service; " +
                "text goes through the mirror's typing box instead"
        }
        return "an accessibility service cannot synthesise key presses, and that is a platform " +
            "limit rather than a missing feature"
    }
}
