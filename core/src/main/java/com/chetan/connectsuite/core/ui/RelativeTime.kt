package com.chetan.connectsuite.core.ui

import java.util.concurrent.TimeUnit

/**
 * "2 min ago". A pure function, in `core/`, because a screen is the one place a test cannot reach it.
 *
 * The rule this follows is the one `LinkWaitStatus` was extracted for: a decision about *what a
 * screen says* belongs somewhere a JVM test can call, or it goes wrong twice and nothing notices.
 *
 * [nowMillis] is a parameter rather than a call to the clock inside, for the same reason — a
 * function that reads `System.currentTimeMillis()` itself cannot be tested at a boundary, and every
 * boundary here (60 s, 60 min, 24 h) is a place this has to be checked.
 */
object RelativeTime {

    /** A timestamp in the future is clamped to "just now" rather than rendered as a negative age. */
    fun of(atMillis: Long, nowMillis: Long): String {
        val delta = (nowMillis - atMillis).coerceAtLeast(0L)
        val minutes = TimeUnit.MILLISECONDS.toMinutes(delta)
        val hours = TimeUnit.MILLISECONDS.toHours(delta)
        val days = TimeUnit.MILLISECONDS.toDays(delta)
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min ago"
            hours < 24 -> if (hours == 1L) "1 hr ago" else "$hours hr ago"
            days < 7 -> if (days == 1L) "yesterday" else "$days days ago"
            else -> "${days / 7} wk ago"
        }
    }
}
