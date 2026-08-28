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
 * The tests are split the way the fix is. The first group is the mechanism — the trailing IDLE
 * broadcast that put the residue there. The second is the invariant — an episode may not begin with
 * a number it did not obtain for itself. **The third group is the one that matters most**, because
 * this fix is being made immediately before step 70 runs: it pins that the inbound path, which 35c
 * depends on entirely, is untouched.
 */
class CallNumberRulesTest {

    // ---- the mechanism: who may write the field, and when -----------------------------------

    @Test
    fun `an IDLE broadcast may not fill the number`() {
        // The refill that caused it: the previous call's trailing IDLE arrives after end() has
        // blanked the field, finds it blank, and puts a finished call's number back.
        assertEquals(
            "",
            CallNumberRules.numberAfterBroadcast(
                stateExtra = "IDLE",
                incoming = "+919800000001",
                current = "",
            ),
        )
    }

    @Test
    fun `a RINGING broadcast still fills a blank, which is the whole inbound path`() {
        assertEquals(
            "8800000004",
            CallNumberRules.numberAfterBroadcast(
                stateExtra = "RINGING",
                incoming = "8800000004",
                current = "",
            ),
        )
    }

    @Test
    fun `a broadcast never overwrites a number already held`() {
        // An outgoing call's number came from call.dial; an empty or later extra must not erase it.
        assertEquals(
            "+919800000001",
            CallNumberRules.numberAfterBroadcast("OFFHOOK", null, "+919800000001"),
        )
        assertEquals(
            "+919800000001",
            CallNumberRules.numberAfterBroadcast("RINGING", "8800000004", "+919800000001"),
        )
    }

    @Test
    fun `an unknown or absent state is still allowed to fill a blank`() {
        // "Ignore IDLE" rather than "accept only RINGING", deliberately: which transition carries
        // the extra varies by OEM, and an allowlist could silently discard the inbound number that
        // 35c depends on. Only the state that is provably wrong is excluded.
        assertEquals("8800000004", CallNumberRules.numberAfterBroadcast(null, "8800000004", ""))
    }

    // ---- the invariant: what an episode may start with --------------------------------------

    @Test
    fun `defect 42 - a phone-placed outgoing episode starts blank, not with the last number`() {
        // The c2 case exactly: a dialing episode, no call.dial before it, residue in the field.
        assertEquals(
            "",
            CallNumberRules.numberAtEpisodeStart(
                phase = "dialing",
                fromDial = false,
                carried = "+919800000001",
            ),
        )
    }

    @Test
    fun `an outgoing episode the Mac dialled keeps its number`() {
        // Step 69's path, which must not regress: call.dial is a real source.
        assertEquals(
            "+919800000001",
            CallNumberRules.numberAtEpisodeStart("dialing", fromDial = true, carried = "+919800000001"),
        )
    }

    // ---- the guard that matters most, because step 70 runs next -----------------------------

    @Test
    fun `an inbound ringing episode keeps the number the broadcast gave it`() {
        // 35c depends on this and nothing else. The fix must not clear a number on the one path
        // that legitimately has one waiting when begin() runs. This test passes before and after —
        // it is a guard, not evidence — and it is here because the failure it guards against would
        // be discovered by wasting a second person's time.
        assertEquals(
            "8800000004",
            CallNumberRules.numberAtEpisodeStart("ringing", fromDial = false, carried = "8800000004"),
        )
    }

    @Test
    fun `an inbound episode with no number still reports nothing rather than the last call's`() {
        // A withheld caller ID. The honest blank, which CallWatcher turns into "number withheld by
        // the platform" and the Mac into "Unknown number".
        assertEquals("", CallNumberRules.numberAtEpisodeStart("ringing", fromDial = false, carried = ""))
    }
}
