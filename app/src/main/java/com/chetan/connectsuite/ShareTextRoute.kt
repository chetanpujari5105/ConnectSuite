package com.chetan.connectsuite

/**
 * Where a `SEND` with a text type goes: the **file** sheet when it carries a stream, the clipboard
 * send when it carries only text.
 *
 * Both arrive at [SendSelectionActivity], because a manifest filter can match a type and never an
 * extra. A `.txt` or `.csv` shared from My Files is `SEND` + `text/plain` (or `text/csv`) +
 * `EXTRA_STREAM` — it is a file, and until 2026-09-29 it reached the clipboard path, which read no
 * `EXTRA_TEXT` and said *nothing to send*. A link or a selection shared from a browser is `SEND` +
 * `text/plain` + `EXTRA_TEXT` and no stream, and still goes to `clip.push`.
 *
 * A share carrying **both** is a file with a caption (some apps add the file name as text): the file
 * is what the person picked, so it wins.
 */
object ShareTextRoute {
    enum class Route { FILE, TEXT, NOTHING }

    fun of(action: String?, hasStream: Boolean, hasText: Boolean): Route = when {
        action == ACTION_SEND && hasStream -> Route.FILE
        hasText -> Route.TEXT
        else -> Route.NOTHING
    }

    private const val ACTION_SEND = "android.intent.action.SEND"
}
