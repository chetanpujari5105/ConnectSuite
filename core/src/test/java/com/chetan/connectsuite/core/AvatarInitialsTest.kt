package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.ui.components.initialsOf
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A monogram that renders blank is the empty-versus-failed confusion at 40dp: the reader cannot
 * tell "no name" from "the avatar failed to draw". So every input has to produce glyphs.
 */
class AvatarInitialsTest {

    @Test
    fun `two words give two initials`() {
        assertEquals("CP", initialsOf("Chetan Pujari"))
    }

    @Test
    fun `one word gives one letter`() {
        assertEquals("C", initialsOf("Chetan"))
        // The case that changed the rule: app names reach this now, and "WH" is an abbreviation
        // where "W" is a monogram.
        assertEquals("W", initialsOf("WhatsApp"))
        assertEquals("G", initialsOf("Gmail"))
    }

    @Test
    fun `hostname separators count as word breaks`() {
        assertEquals("CM", initialsOf("Chetans-MacBook-Pro"))
        // "SS", not "SM": the rule is the first letter of each of the first two words, and the
        // first two words here are "Samsung" and "SM". Asserted because it is the surprising one.
        assertEquals("SS", initialsOf("Samsung_SM-S938B"))
    }

    @Test
    fun `a blank name still renders something`() {
        assertEquals("?", initialsOf(""))
        assertEquals("?", initialsOf("   "))
    }

    @Test
    fun `a single character does not crash on take(2)`() {
        assertEquals("X", initialsOf("x"))
    }
}
