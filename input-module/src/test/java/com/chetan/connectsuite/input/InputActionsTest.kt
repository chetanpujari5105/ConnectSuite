package com.chetan.connectsuite.input

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The two lists that are complete on purpose.
 *
 * `input.global` is exactly six actions and `input.key` is exactly what can exist. The tests below
 * are less about the happy path than about the absences: power is not here, keycodes are not here,
 * and both have to fail in a way that says so rather than in a way that reads as a bug.
 */
class InputActionsTest {

    @Test
    fun `the six global actions the protocol documents are the six that exist`() {
        assertEquals(
            setOf("back", "home", "recents", "notifications", "quick_settings", "lock_screen"),
            GlobalAction.entries.map { it.wire }.toSet(),
        )
    }

    @Test
    fun `there is no power action, and asking for one explains why`() {
        // The line docs/protocol.md used to carry was "back/home/recents/power". This is that
        // correction, pinned: `performGlobalAction` cannot press the power button, and the power
        // menu it *can* open would be one stray click from switching off the phone the Mac is
        // talking to.
        assertNull("power must never resolve to a global action", GlobalAction.forWire("power"))
        assertNull(GlobalAction.forWire("power_dialog"))
        assertNull(InputKeys.forWire("power"))

        val why = InputKeys.refusalFor("power")
        assertTrue("the refusal must name the wall: $why", why.contains("power button"))
    }

    @Test
    fun `volume keys are refused by name`() {
        assertNull(InputKeys.forWire("volume_up"))
        assertTrue(InputKeys.refusalFor("volume_up").contains("accessibility service"))
    }

    @Test
    fun `a letter is refused and pointed at input text instead`() {
        assertNull(InputKeys.forWire("a"))
        val why = InputKeys.refusalFor("a")
        assertTrue("a user pressing a letter must be told where text goes: $why", why.contains("text"))
    }

    @Test
    fun `the keys that can exist resolve`() {
        assertEquals(KeyAction.Backspace, InputKeys.forWire("backspace"))
        assertEquals(KeyAction.Backspace, InputKeys.forWire("delete"))
        assertEquals(KeyAction.ImeEnter, InputKeys.forWire("enter"))
        assertEquals(KeyAction.ImeEnter, InputKeys.forWire("return"))
        assertEquals(KeyAction.Global(GlobalAction.BACK), InputKeys.forWire("back"))
        assertEquals(KeyAction.Global(GlobalAction.HOME), InputKeys.forWire("home"))
    }

    @Test
    fun `key names are case-insensitive`() {
        // The Mac sends what its keyboard reported, and "Backspace" is what a browser calls it.
        assertEquals(KeyAction.Backspace, InputKeys.forWire("Backspace"))
        assertEquals(KeyAction.Global(GlobalAction.BACK), InputKeys.forWire("BACK"))
    }

    @Test
    fun `every global action is reachable as a key alias`() {
        // Escape means Back on a Mac keyboard, and the aliases are what make that work. If a
        // global action existed with no key route, the keyboard would be silently less capable
        // than the buttons.
        for (action in GlobalAction.entries) {
            assertEquals(KeyAction.Global(action), InputKeys.forWire(action.wire))
        }
    }

    @Test
    fun `an unknown key still gets a reason rather than nothing`() {
        assertNull(InputKeys.forWire("f13"))
        assertNotNull(InputKeys.refusalFor("f13"))
        assertTrue(InputKeys.refusalFor("f13").contains("platform limit"))
    }
}
