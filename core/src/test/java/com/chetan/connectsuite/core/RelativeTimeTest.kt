package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.ui.RelativeTime
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Every boundary, from both sides.
 *
 * A relative-time formatter is the sort of thing that is written once and read by every screen, and
 * its failure mode is silent: "59 min ago" rendering as "0 hr ago" looks like a design choice.
 */
class RelativeTimeTest {

    private val now = 1_700_000_000_000L
    private fun ago(ms: Long) = RelativeTime.of(now - ms, now)

    private val second = 1_000L
    private val minute = 60 * second
    private val hour = 60 * minute
    private val day = 24 * hour

    @Test
    fun `under a minute is just now`() {
        assertEquals("just now", ago(0))
        assertEquals("just now", ago(59 * second))
    }

    @Test
    fun `minutes up to the hour`() {
        assertEquals("1 min ago", ago(minute))
        assertEquals("59 min ago", ago(59 * minute + 59 * second))
    }

    @Test
    fun `the hour boundary, from both sides`() {
        assertEquals("59 min ago", ago(hour - second))
        assertEquals("1 hr ago", ago(hour))
        assertEquals("23 hr ago", ago(23 * hour))
    }

    @Test
    fun `the day boundary, from both sides`() {
        assertEquals("23 hr ago", ago(day - second))
        assertEquals("yesterday", ago(day))
        assertEquals("6 days ago", ago(6 * day))
    }

    @Test
    fun `a week and beyond`() {
        assertEquals("1 wk ago", ago(7 * day))
        assertEquals("3 wk ago", ago(21 * day))
    }

    /**
     * A clock that has gone backwards — an NTP correction, or a row written by a peer whose clock
     * runs fast — must not render as a negative age. "in -3 min" is the kind of thing that ships.
     */
    @Test
    fun `a future timestamp clamps rather than going negative`() {
        assertEquals("just now", RelativeTime.of(now + 10 * minute, now))
    }
}
