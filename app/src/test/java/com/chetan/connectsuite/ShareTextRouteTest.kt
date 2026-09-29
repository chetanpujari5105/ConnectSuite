package com.chetan.connectsuite

import com.chetan.connectsuite.ShareTextRoute.Route
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A text-typed SEND is a file when it carries a stream (My Files `.txt`/`.csv`) and a selection when
 * it carries only text. Before 2026-09-29 both went to the clipboard send, which found no text in a
 * file share and told the person there was nothing to send.
 */
class ShareTextRouteTest {
    private val send = "android.intent.action.SEND"
    private val process = "android.intent.action.PROCESS_TEXT"

    @Test fun `a text file shared from My Files goes to the file sheet`() {
        assertEquals(Route.FILE, ShareTextRoute.of(send, hasStream = true, hasText = false))
    }

    @Test fun `a file with a caption is still the file`() {
        assertEquals(Route.FILE, ShareTextRoute.of(send, hasStream = true, hasText = true))
    }

    @Test fun `a shared link or selection with no stream stays a clipboard send`() {
        assertEquals(Route.TEXT, ShareTextRoute.of(send, hasStream = false, hasText = true))
        assertEquals(Route.TEXT, ShareTextRoute.of(process, hasStream = false, hasText = true))
    }

    @Test fun `PROCESS_TEXT never becomes a file, whatever it carries`() {
        assertEquals(Route.TEXT, ShareTextRoute.of(process, hasStream = true, hasText = true))
    }

    @Test fun `neither is nothing`() {
        assertEquals(Route.NOTHING, ShareTextRoute.of(send, hasStream = false, hasText = false))
    }
}
