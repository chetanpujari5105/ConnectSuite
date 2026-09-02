package com.chetan.connectsuite.core.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * F4 and F5 of `docs/phase-7-pairing-flow.md`: the phone saying which kind of silence it is in.
 *
 * Every case calls [LinkWaitStatus.of] rather than restating its conditions — `MediaPayloadsTest`
 * is the cautionary tale in `CLAUDE.md`, where a test that wrote the cursor predicate out a second
 * time stayed green after the real one was deleted.
 *
 * `nowMillis` is injected, so the twenty-second rule is tested at twenty seconds without waiting
 * twenty seconds.
 */
class LinkWaitStatusTest {

    private val t0 = 1_000_000L

    private fun listening(sinceAgo: Long = 0L, refusal: RefusedConnection? = null) = LinkState(
        running = true,
        clients = emptyList(),
        listeningSinceMillis = t0 - sinceAgo,
        lastRefusal = refusal,
    )

    // ---- the ordinary states -------------------------------------------------------------------

    @Test
    fun `a connected phone names the Mac`() {
        val status = LinkWaitStatus.of(
            LinkState(running = true, clients = listOf("Chetans-MacBook-Pro")),
            t0,
        )
        assertTrue(status is LinkWaitStatus.Connected)
        assertEquals("Connected to Chetans-MacBook-Pro", status.headline)
    }

    @Test
    fun `a stopped link says so and carries the reason`() {
        val status = LinkWaitStatus.of(
            LinkState(running = false, lastError = "Could not open ports: EADDRINUSE"),
            t0,
        )
        assertEquals("Not listening", status.headline)
        assertEquals("Could not open ports: EADDRINUSE", status.detail)
    }

    // ---- F4: the clock on silence --------------------------------------------------------------

    @Test
    fun `a short wait says nothing about networks`() {
        // The commonest state in normal use: scanned, and the Mac is dialling. Alarming a user
        // here would make the hint meaningless when it matters.
        val status = LinkWaitStatus.of(listening(sinceAgo = 3_000), t0)
        assertEquals("Listening for your Mac", status.headline)
        assertNull("a three-second wait must carry no hint", status.detail)
    }

    @Test
    fun `a long wait offers the network hint`() {
        val status = LinkWaitStatus.of(
            listening(sinceAgo = LinkWaitStatus.HINT_AFTER_MS),
            t0,
        )
        assertEquals("Listening for your Mac", status.headline)
        val detail = status.detail
        assertNotNull("the hint must appear at the threshold", detail)
        detail!!
        assertTrue("the hint must name Wi-Fi, the only actionable thing", detail.contains("Wi-Fi"))
        // It must not diagnose. J6 and J2 are indistinguishable on this device and the copy has to
        // say so — "if it stays like this", never "your Mac is on a different network".
        assertTrue("the hint must be conditional", detail.contains("If it stays like this"))
    }

    @Test
    fun `one millisecond before the threshold there is still no hint`() {
        // The boundary, in both directions. A rule tested only on one side of its threshold passes
        // with the comparison inverted.
        val status = LinkWaitStatus.of(
            listening(sinceAgo = LinkWaitStatus.HINT_AFTER_MS - 1),
            t0,
        )
        assertNull(status.detail)
    }

    @Test
    fun `an unknown start time withholds the hint rather than guessing`() {
        val status = LinkWaitStatus.of(
            LinkState(running = true, listeningSinceMillis = null),
            t0,
        )
        assertEquals("Listening for your Mac", status.headline)
        assertNull("no start time is not evidence of a long wait", status.detail)
    }

    // ---- F5: the refusal the log has always known about ----------------------------------------

    @Test
    fun `a recent refusal is shown instead of the wait`() {
        val status = LinkWaitStatus.of(
            listening(
                sinceAgo = 60_000,
                refusal = RefusedConnection("ab:cd:ef:01:23:45:67:89", "10.47.66.92", t0 - 5_000),
            ),
            t0,
        )
        assertTrue(status is LinkWaitStatus.Refused)
        assertEquals("A Mac tried to connect and was refused", status.headline)
        val detail = status.detail!!
        assertTrue("the address helps identify the machine", detail.contains("10.47.66.92"))
        assertTrue("the key prefix separates a stranger from a reinstalled Mac",
            detail.contains("ab:cd:ef:01:23:45:67:89"))
        assertTrue("it must say what to do", detail.contains("scan its code again"))
    }

    @Test
    fun `a refusal beats the network hint while both apply`() {
        // Both conditions are true here: waited well past the threshold AND was refused. The
        // refusal is the better explanation of the silence, so it must win.
        val status = LinkWaitStatus.of(
            listening(
                sinceAgo = 10 * LinkWaitStatus.HINT_AFTER_MS,
                refusal = RefusedConnection("ab:cd", null, t0 - 1_000),
            ),
            t0,
        )
        assertTrue("a refusal explains silence better than a clock does",
            status is LinkWaitStatus.Refused)
    }

    @Test
    fun `an old refusal expires back into the wait`() {
        // A refusal is an event, not a state. Left forever it would accuse a stranger who
        // connected once, an hour ago, of being the reason nothing is happening now.
        val status = LinkWaitStatus.of(
            listening(
                sinceAgo = 10 * LinkWaitStatus.HINT_AFTER_MS,
                refusal = RefusedConnection(
                    "ab:cd", null, t0 - LinkWaitStatus.REFUSAL_VISIBLE_MS,
                ),
            ),
            t0,
        )
        assertTrue("an expired refusal must fall back to the wait", status is LinkWaitStatus.Waiting)
        assertNotNull("and the wait's own hint still applies", status.detail)
    }

    @Test
    fun `a refusal never displaces a live connection`() {
        // The order in `of` matters: a Mac that connected after some stranger was turned away must
        // read as connected, not as refused.
        val status = LinkWaitStatus.of(
            LinkState(
                running = true,
                clients = listOf("Chetans-MacBook-Pro"),
                lastRefusal = RefusedConnection("ab:cd", null, t0),
            ),
            t0,
        )
        assertTrue(status is LinkWaitStatus.Connected)
    }

    @Test
    fun `every status says something`() {
        // The control for all of the above: a headline that is empty would make every assertion
        // about which branch ran pass while showing the user a blank card.
        listOf(
            LinkWaitStatus.of(LinkState(running = true, clients = listOf("M")), t0),
            LinkWaitStatus.of(LinkState(running = false), t0),
            LinkWaitStatus.of(listening(sinceAgo = 0), t0),
            LinkWaitStatus.of(listening(sinceAgo = LinkWaitStatus.HINT_AFTER_MS), t0),
            LinkWaitStatus.of(
                listening(refusal = RefusedConnection("ab", null, t0)),
                t0,
            ),
        ).forEach { assertTrue("empty headline on $it", it.headline.isNotBlank()) }
    }
}
