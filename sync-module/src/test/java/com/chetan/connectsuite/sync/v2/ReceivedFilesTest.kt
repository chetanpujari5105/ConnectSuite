package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The arrival notification's words and its batch fold. Runs [ReceivedFiles] itself — the class the
 * notification draws from — never a second copy of the sentences.
 */
class ReceivedFilesTest {

    private var clock = 1_000_000L
    private val files = ReceivedFiles { clock }

    @Test
    fun `one file names itself, its folder, its size and whether it was checked`() {
        val s = files.arrived("a.jpg", 2_048, "Received files", "MacBook Pro", verified = true)
        assertEquals("a.jpg arrived from MacBook Pro", s.title)
        assertEquals("In Received files · 2.0 KB · checksum matched", s.text)
    }

    @Test
    fun `an unchecked arrival says so rather than dressing as a checked one`() {
        val s = files.arrived("big.mov", 209_715_200, "Received files", "MacBook Pro", verified = false)
        assertEquals("In Received files · 200 MB · not checksummed", s.text)
    }

    @Test
    fun `a serial batch folds into one running count`() {
        files.arrived("1.jpg", 1, "DCIM", "Mac", true)
        clock += 400
        files.arrived("2.jpg", 1, "DCIM", "Mac", true)
        clock += 400
        val s = files.arrived("3.jpg", 1, "DCIM", "Mac", true)
        assertEquals("3 files arrived from Mac", s.title)
        assertEquals("Latest: 3.jpg, in DCIM", s.text)
    }

    @Test
    fun `a send long after the last one starts a new count rather than a total nobody sent`() {
        files.arrived("1.jpg", 1, "DCIM", "Mac", true)
        clock += ReceivedFiles.WINDOW_MS + 1
        val s = files.arrived("later.pdf", 1, "DCIM", "Mac", true)
        assertEquals(1, s.count)
        assertEquals("later.pdf arrived from Mac", s.title)
    }

    @Test
    fun `a blank peer name reads as your Mac`() {
        assertEquals("x arrived from your Mac", files.arrived("x", 1, "F", " ", true).title)
    }
}
