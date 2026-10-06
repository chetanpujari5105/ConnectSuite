package com.chetan.connectsuite

/**
 * What [SendSelectionActivity] takes out of the intent that started it, with nothing Android in it so
 * a JVM test can reach every branch.
 *
 * ### The two routes are two different senders, and are kept apart on purpose
 *
 * `ACTION_PROCESS_TEXT` comes from another app's **text-selection toolbar**; the text is in
 * `EXTRA_PROCESS_TEXT`. `ACTION_SEND` comes from the **share sheet**; the text is in `EXTRA_TEXT`.
 * They reach the same activity, but a reading of one is not a reading of the other — stage D's first
 * successful send (2026-10-07) arrived as `ACTION_SEND`, and says nothing about the toolbar route.
 * So [Read] names the action it came from, and the log line carries it.
 *
 * ### Why the extras arrive here as `CharSequence`
 *
 * `EXTRA_TEXT` is documented as a `CharSequence`, and senders that keep formatting put a `Spanned` in
 * it. `Intent.getStringExtra` is `BaseBundle.getString`, which **casts** the stored value to `String`
 * and, on a `ClassCastException`, logs a type warning and returns `null` (AOSP `BaseBundle.getString`).
 * The activity read `EXTRA_TEXT` that way until 2026-10-07, so a share carrying styled text would have
 * been told *"Nothing was selected"* — a reading of the source, **not** measured on hardware, and not
 * the cause of stage D's step-6 failure (no start of this activity was logged there at all). The
 * activity now reads both extras with `getCharSequenceExtra`, which accepts either type, and
 * `SendSelectionProvenanceTest` refuses a `getStringExtra` on this path.
 *
 * Every piece of text read here is **selection** text, whichever action brought it: nothing in this
 * file can make it the phone's clipboard. The origin is stamped later by `ClipRoute.SELECTION`.
 */
object SelectionIntent {

    const val ACTION_PROCESS_TEXT = "android.intent.action.PROCESS_TEXT"
    const val ACTION_SEND = "android.intent.action.SEND"

    /** Which entry point a start came through. Logged; never sent to the Mac. */
    enum class Route(val logName: String) {
        TOOLBAR("PROCESS_TEXT"),
        SHARE("SEND"),
        OTHER("other action"),
        ;

        companion object {
            fun of(action: String?): Route = when (action) {
                ACTION_PROCESS_TEXT -> TOOLBAR
                ACTION_SEND -> SHARE
                else -> OTHER
            }
        }
    }

    /** What the intent held. Named, never a nullable string, so each case can be logged by name. */
    sealed interface Read {
        val route: Route

        /** Text to hand on. It may still be blank; [SelectionSend] decides that. */
        data class Text(override val route: Route, val text: String) : Read

        /** The action is one this activity does not serve. Nothing is read. */
        data class UnsupportedAction(override val route: Route) : Read

        /** The right action, and no text in the extra that action uses. */
        data class NoText(override val route: Route) : Read
    }

    /**
     * Reads the one extra that belongs to [action] — **never the other one**: a toolbar start that
     * happened to carry an `EXTRA_TEXT` is not a share, and a share is not a toolbar selection.
     */
    fun read(action: String?, processText: CharSequence?, sendText: CharSequence?): Read {
        val route = Route.of(action)
        val text = when (route) {
            Route.TOOLBAR -> processText
            Route.SHARE -> sendText
            Route.OTHER -> return Read.UnsupportedAction(route)
        }
        return if (text == null) Read.NoText(route) else Read.Text(route, text.toString())
    }

    /** Whether the intent carries text for the routing decision in [ShareTextRoute]. */
    fun hasText(processText: CharSequence?, sendText: CharSequence?): Boolean =
        processText != null || sendText != null
}
