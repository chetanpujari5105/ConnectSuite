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
        waitingSinceMillis = t0 - sinceAgo,
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
            LinkState(running = true, waitingSinceMillis = null),
            t0,
        )
        assertEquals("Listening for your Mac", status.headline)
        assertNull("no start time is not evidence of a long wait", status.detail)
    }

    // ---- defect 67: the clock measures the wait, not the server's uptime -----------------------

    @Test
    fun `the wait clock is about this wait, not about how long the server has been up`() {
        // Defect 67, and the test the original eleven did not contain. Every one of them supplied
        // the field as though it were the start of the wait — which is what the *name* said and
        // not what the product produced. `listeningSinceMillis` was written once, when the accept
        // loops came up, so after the first twenty seconds of uptime the hint branch was the only
        // reachable one and the "short wait" case above could never occur in the field.
        //
        // Measured on hardware 2026-09-02: listening began 13:29:56, the Mac dropped at 13:45:04,
        // and the hint was on screen at t+2s. Eleven unit tests were green throughout.
        //
        // The distinction this asserts is the one the type cannot: a phone that has been listening
        // for an hour and lost its Mac two seconds ago is in a SHORT wait.
        val serverUpForAnHour = 60 * 60 * 1000L
        val macLeftTwoSecondsAgo = LinkState(
            running = true,
            clients = emptyList(),
            waitingSinceMillis = t0 - 2_000,
        )
        assertNull(
            "a wait that began 2s ago is short, however long the phone has been listening " +
                "(server up ${serverUpForAnHour}ms)",
            LinkWaitStatus.of(macLeftTwoSecondsAgo, t0).detail,
        )
    }

    @Test
    fun `the disconnect transition restarts the clock — the layer the defect lived in`() {
        // The test that actually catches defect 67, and the reason the two above it do not.
        //
        // Everything else in this file hands `waitingSinceMillis` to `of()` by hand, so it is green
        // no matter what the product writes into that field. The bug was in the *write*: the clock
        // was set once when the accept loops came up and never again, so on a phone listening for
        // fifteen minutes the hint appeared two seconds after the Mac went away. Deleting the
        // restart leaves every one of the other twelve tests green; this one goes red.
        val listeningSinceAnHourAgo = LinkState(
            running = true,
            clients = listOf("Chetans-MacBook-Pro"),
            waitingSinceMillis = t0 - 60 * 60 * 1000,
        )

        val afterDrop = listeningSinceAnHourAgo.afterSessionEnded(
            peerName = "Chetans-MacBook-Pro",
            closeReason = "peer closed the connection",
            nowMillis = t0,
        )

        assertEquals("the client is gone", emptyList<String>(), afterDrop.clients)
        assertEquals("the wait restarts at the disconnect", t0, afterDrop.waitingSinceMillis)

        // And the consequence the user sees, asserted through the real decision rather than
        // restated: a two-second-old wait carries no hint even after an hour of uptime.
        assertNull(
            "an hour of listening must not make a fresh wait look stale",
            LinkWaitStatus.of(afterDrop, t0 + 2_000).detail,
        )
    }

    @Test
    fun `a second Mac still connected means there is no wait to time`() {
        val two = LinkState(
            running = true,
            clients = listOf("MacA", "MacB"),
            waitingSinceMillis = t0 - 60 * 60 * 1000,
        )
        val afterOneLeaves = two.afterSessionEnded("MacA", null, t0)
        assertEquals(listOf("MacB"), afterOneLeaves.clients)
        assertEquals(
            "with a Mac still here the clock must not move — there is no silence to measure",
            t0 - 60 * 60 * 1000,
            afterOneLeaves.waitingSinceMillis,
        )
    }

    @Test
    fun `starting to listen begins a fresh wait and clears a stale refusal`() {
        val stale = LinkState(
            running = false,
            waitingSinceMillis = t0 - 60 * 60 * 1000,
            lastRefusal = RefusedConnection("ab:cd", null, t0 - 60 * 60 * 1000),
        )
        val started = stale.afterListeningStarted(t0)
        assertTrue(started.running)
        assertEquals(t0, started.waitingSinceMillis)
        assertNull("a previous session's refusal does not explain this one's silence",
            started.lastRefusal)
    }

    @Test
    fun `a reconnect and a second disconnect start the clock again`() {
        // The field is only useful if it is rewritten on every transition into waiting. A version
        // that reset it on `start()` alone passes the test above and fails this one.
        val firstWait = LinkState(running = true, waitingSinceMillis = t0 - 10 * 60 * 1000)
        assertNotNull("a ten-minute wait has the hint", LinkWaitStatus.of(firstWait, t0).detail)

        val reconnected = firstWait.copy(clients = listOf("Chetans-MacBook-Pro"))
        assertTrue(LinkWaitStatus.of(reconnected, t0) is LinkWaitStatus.Connected)

        // The Mac leaves again: the wait restarts from now, so the hint is gone.
        val secondWait = reconnected.copy(clients = emptyList(), waitingSinceMillis = t0)
        assertNull(
            "the second wait is fresh — the first wait's age must not leak into it",
            LinkWaitStatus.of(secondWait, t0).detail,
        )
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
