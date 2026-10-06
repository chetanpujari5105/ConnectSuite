package com.chetan.connectsuite

import com.chetan.connectsuite.SelectionIntent.Read
import com.chetan.connectsuite.SelectionIntent.Route
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What `SendSelectionActivity` takes out of its intent (2026-10-07). The toolbar route
 * (`PROCESS_TEXT`) and the share route (`SEND`) are separate senders with separate extras, and a
 * reading of one is not a reading of the other.
 */
class SelectionIntentTest {

    private val process = SelectionIntent.ACTION_PROCESS_TEXT
    private val send = SelectionIntent.ACTION_SEND

    /** A `CharSequence` that is not a `String` — the shape a `Spanned` takes, without android.text. */
    private fun styled(s: String): CharSequence = StringBuilder(s)

    @Test fun `the toolbar route reads EXTRA_PROCESS_TEXT and only that`() {
        assertEquals(Read.Text(Route.TOOLBAR, "picked"), SelectionIntent.read(process, "picked", "shared"))
        assertEquals("an EXTRA_TEXT on a toolbar start is not the selection", Read.NoText(Route.TOOLBAR), SelectionIntent.read(process, null, "shared"))
    }

    @Test fun `the share route reads EXTRA_TEXT and only that`() {
        assertEquals(Read.Text(Route.SHARE, "shared"), SelectionIntent.read(send, "picked", "shared"))
        assertEquals(Read.NoText(Route.SHARE), SelectionIntent.read(send, "picked", null))
    }

    /** The defect: a `Spanned` EXTRA_TEXT read as String is null. Read as CharSequence it is the text. */
    @Test fun `styled text arrives as its characters on both routes`() {
        assertEquals(Read.Text(Route.SHARE, "bold words"), SelectionIntent.read(send, null, styled("bold words")))
        assertEquals(Read.Text(Route.TOOLBAR, "bold words"), SelectionIntent.read(process, styled("bold words"), null))
    }

    @Test fun `any other action is refused before anything is read`() {
        for (action in listOf(null, "", "android.intent.action.VIEW", "android.intent.action.SEND_MULTIPLE", "android.intent.action.send")) {
            assertEquals("action=$action", Read.UnsupportedAction(Route.OTHER), SelectionIntent.read(action, "x", "y"))
        }
    }

    /** Malformed input is passed on whole — blank, control characters, a lone surrogate — and decided later. */
    @Test fun `odd text is handed on unaltered, never trimmed or repaired here`() {
        for (odd in listOf("", "   ", "\u0000\u0000", "line\r\nbreak", "\uD800", "a".repeat(70_000))) {
            assertEquals(Read.Text(Route.TOOLBAR, odd), SelectionIntent.read(process, odd, null))
        }
    }

    /** Repeated starts are independent: the reader holds no state between them. */
    @Test fun `the same intent read twice gives the same answer twice`() {
        val first = SelectionIntent.read(process, "again", null)
        val second = SelectionIntent.read(process, "again", null)
        assertEquals(first, second)
        assertEquals(Read.Text(Route.TOOLBAR, "again"), second)
    }

    @Test fun `route names are what the log prints`() {
        assertEquals("PROCESS_TEXT", Route.of(process).logName)
        assertEquals("SEND", Route.of(send).logName)
        assertEquals(Route.OTHER, Route.of(null))
    }

    @Test fun `hasText is either extra`() {
        assertTrue(SelectionIntent.hasText("a", null))
        assertTrue(SelectionIntent.hasText(null, styled("b")))
        assertFalse(SelectionIntent.hasText(null, null))
    }

    /** The constants are the platform's strings; a typo would make every start an unsupported action. */
    @Test fun `the action constants match the platform's`() {
        assertEquals("android.intent.action.PROCESS_TEXT", process)
        assertEquals("android.intent.action.SEND", send)
    }
}
