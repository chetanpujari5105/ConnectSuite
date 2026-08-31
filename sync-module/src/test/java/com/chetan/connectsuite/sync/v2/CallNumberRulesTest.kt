package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Defect 42 — an outgoing call placed on the phone was labelled with the previous call's number.
 *
 * The sighting, from 2026-08-29, and the platform is the arbiter because the app's account of the
 * call is the thing under test:
 *
 * ```
 * platform  00:28:55  type=2, number=8800000004              <- the call that was actually placed
 * app       00:28:56  Call c2 dialing from +919800000001 (Chetan)
 * ```
 *
 * Two numbers for one call, and the one the app chose belonged to the episode before it. Worse than
 * defect 35, which drew a blank: a blank is visibly missing, and a name is believed.
 *
 * ### Reopened 2026-08-29, on the inbound path
 *
 * The first fix covered outgoing calls and deliberately left inbound alone, on the premise that the
 * `PHONE_STATE` broadcast supplies the number alongside the transition. A real inbound call showed
 * the premise is false here:
 *
 * ```
 * platform  08:29:43  MISSED   +919900000002
 * app       08:29:44  Call c1 ringing number withheld by the platform
 * app       08:29:44  Call c1 ended missed after 197ms
 * platform  09:40:23  INCOMING +918200000005
 * app       09:40:24  Call c2 ringing from +919900000002 (Contact B)   <- c1's number
 * ```
 *
 * The extra arrives *after* the state callback, so on a 197 ms call it lands after `end()`, fills
 * the blanked field, and waits 71 minutes for the next episode to read it. See defect 45 for why
 * that distinction — "never arrives" versus "never arrives in time" — decides a different question.
 *
 * The tests are split the way the fix is: the mechanism (who may write the field, and when), the
 * invariant (what an episode may start with), and last the guard whose assumption was falsified —
 * **rewritten rather than deleted**, because the property it meant to protect is still worth
 * protecting and only its location was wrong.
 */
class CallNumberRulesTest {

    // ---- the mechanism: who may write the field, and when -----------------------------------

    @Test
    fun `an IDLE broadcast may not fill the number`() {
        assertEquals(
            "",
            CallNumberRules.numberAfterBroadcast(
                stateExtra = "IDLE",
                incoming = "+919800000001",
                current = "",
                episodeLive = true,
            ),
        )
    }

    @Test
    fun `defect 42 reopened - nothing may be written between episodes`() {
        // The path that put c1's number on c2's card. c1 ended after 197ms, its RINGING broadcast
        // arrived afterwards, found the field blank, and filled it; 71 minutes later c2 read it.
        assertEquals(
            "",
            CallNumberRules.numberAfterBroadcast(
                stateExtra = "RINGING",
                incoming = "+919900000002",
                current = "",
                episodeLive = false,
            ),
        )
    }

    @Test
    fun `a RINGING broadcast during a live episode still fills a blank`() {
        // The path that must survive, or a device delivering the extra in time gains nothing.
        assertEquals(
            "8800000004",
            CallNumberRules.numberAfterBroadcast("RINGING", "8800000004", "", episodeLive = true),
        )
    }

    @Test
    fun `a broadcast never overwrites a number already held`() {
        assertEquals(
            "+919800000001",
            CallNumberRules.numberAfterBroadcast("OFFHOOK", null, "+919800000001", episodeLive = true),
        )
        assertEquals(
            "+919800000001",
            CallNumberRules.numberAfterBroadcast("RINGING", "8800000004", "+919800000001", episodeLive = true),
        )
    }

    @Test
    fun `an unknown or absent state is still allowed to fill a blank while live`() {
        // "Ignore IDLE" rather than "accept only RINGING": which transition carries the extra
        // varies by OEM, and an allowlist could discard a number that did arrive in time.
        assertEquals(
            "8800000004",
            CallNumberRules.numberAfterBroadcast(null, "8800000004", "", episodeLive = true),
        )
    }

    // ---- the invariant: what an episode may start with --------------------------------------

    @Test
    fun `defect 42 - a phone-placed outgoing episode starts blank, not with the last number`() {
        assertEquals("", CallNumberRules.numberAtEpisodeStart(fromDial = false, carried = "+919800000001"))
    }

    @Test
    fun `defect 42 reopened - an inbound episode starts blank too, with no exception`() {
        // This is the case the first fix deliberately allowed, on the premise that the broadcast
        // supplies the number alongside the transition. The premise is false on this device (see
        // defect 45), so the exception was the bug.
        assertEquals("", CallNumberRules.numberAtEpisodeStart(fromDial = false, carried = "8800000004"))
    }

    @Test
    fun `an outgoing episode the Mac dialled keeps its number`() {
        // Step 69's path, which must not regress: call.dial is a real source.
        assertEquals(
            "+919800000001",
            CallNumberRules.numberAtEpisodeStart(fromDial = true, carried = "+919800000001"),
        )
    }

    // ---- the guard whose assumption was falsified, rewritten rather than deleted -------------

    @Test
    fun `an inbound number arriving during its own episode is kept, and is not lost by this fix`() {
        // The previous version of this test asserted that a *ringing episode keeps whatever the
        // field holds at begin()*, and it passed for the whole life of the bug — because it
        // encoded the assumption that anything in the field belonged to this episode. That
        // assumption is defect 45.
        //
        // Rewritten, not deleted: the property still worth guarding is that a number arriving
        // while its own episode is open is not discarded. It is now expressed where the number is
        // actually written, which is the only place that can tell "mine" from "left over".
        val duringOwnEpisode =
            CallNumberRules.numberAfterBroadcast("RINGING", "8800000004", "", episodeLive = true)
        assertEquals("8800000004", duringOwnEpisode)

        val betweenEpisodes =
            CallNumberRules.numberAfterBroadcast("RINGING", "8800000004", "", episodeLive = false)
        assertEquals("", betweenEpisodes)
    }

    // ---- rule 3: correcting the card in place, defect 45 option 4 ----------------------------

    @Test
    fun `the card is corrected when the number arrives during the ring`() {
        // The defect itself: begin() published "" at +0ms, the extra landed 8-111ms later on all
        // six episodes measured on 2026-08-30, and nothing re-published, so the card read
        // "Unknown number" for the whole ring. This is the moment that has to return true.
        assertEquals(
            true,
            CallNumberRules.shouldCorrectCard(before = "", after = "8800000004", episodeLive = true),
        )
    }

    @Test
    fun `a broadcast that changed nothing does not re-publish the card`() {
        // OFFHOOK and IDLE both re-deliver the same extra. Without this clause one call sends three
        // identical cards and pays three contacts lookups for one answer. Reintroduce the bug by
        // dropping `after != before` from rule 3 and this is the assertion that goes red.
        assertEquals(
            false,
            CallNumberRules.shouldCorrectCard(
                before = "8800000004",
                after = "8800000004",
                episodeLive = true,
            ),
        )
    }

    @Test
    fun `a number arriving after the call ended draws no card`() {
        // c1's shape: a 197ms call where the extra lands after end(). There is no card on screen to
        // correct, and publishing call.incoming here would draw a live card for a finished call —
        // the same class of mistake rule 1 exists to prevent, one layer up.
        assertEquals(
            false,
            CallNumberRules.shouldCorrectCard(
                before = "",
                after = "8800000004",
                episodeLive = false,
            ),
        )
    }

    @Test
    fun `a still-blank number corrects nothing`() {
        // Nothing to correct the card *to*. Without this clause a withheld-number call would log a
        // correction that did not happen — a success line with no success behind it, which is the
        // failure this project keeps writing rules about.
        assertEquals(
            false,
            CallNumberRules.shouldCorrectCard(before = "", after = "", episodeLive = true),
        )
    }
}
