package com.chetan.connectsuite.sync.v2

/**
 * Where a call episode's number is allowed to come from.
 *
 * Pure and separate from [CallWatcher] so it can be tested on the JVM — `TelephonyManager` and
 * `Context` cannot be. Same seam as `SmsPayloads`, `CallWatcher.dispositionOf` and
 * `CallAckWording`, per CLAUDE.md: move the pure part out rather than mock the platform.
 *
 * ### Defect 42
 *
 * `CallWatcher.number` is a field that outlives an episode, and there was no rule about who is
 * allowed to write it or when. On 2026-08-29 that produced a call card naming the wrong person:
 *
 * ```
 * platform  00:28:55  type=2, number=8800000004            <- the call that was placed
 * app       00:28:56  Call c2 dialing from +919800000001 (Chetan)
 * ```
 *
 * The number the card showed was the **previous** episode's. That is worse than defect 35, which
 * drew a blank: a blank is visibly missing, and a name is believed.
 *
 * Two writers, two rules, and they close different halves of it.
 *
 * 1. [numberAfterBroadcast] — the `PHONE_STATE` receiver may not fill the field from an **IDLE**
 *    broadcast. An IDLE broadcast means no call is in progress, so a number arriving with one
 *    cannot belong to an episode that has not started. This is the refill path that put the
 *    residue there: the previous call's trailing IDLE arrives *after* `end()` has blanked the
 *    field, finds it blank, and fills it.
 *
 *    Deliberately phrased as "ignore IDLE" rather than "accept only RINGING". The extra is
 *    documented for the ringing case, but which transitions actually carry it varies by OEM, and
 *    an allowlist risks discarding the inbound number this project needs for 35c. Excluding the
 *    one state that is provably wrong is the change that cannot break the inbound path.
 *
 * 2. [numberAtEpisodeStart] — an episode may not begin with a number it did not obtain for itself.
 *    An outgoing call has exactly one legitimate source, `call.dial` via `expectOutgoing`, because
 *    nothing supplies a number for a call placed on the phone by hand. So a `dialing` episode that
 *    was not preceded by a dial from the Mac starts blank, and the card honestly reads
 *    "Unknown number" instead of the last person who was called.
 *
 * Rule 2 is the invariant and rule 1 is the mechanism. Rule 1 alone would fix the sighting; rule 2
 * makes the class of bug impossible whatever else learns to write that field later.
 *
 * ### The wrong fix, which is the third appearance of one shape in this codebase
 *
 * Reading the call log in `begin()` to find the outgoing number. The row for a call that is only
 * now dialling has not been written, so the read returns the **previous call's row** — reproducing
 * this exact defect by a second route while looking like a fix. `CallWatcher.dispositionOf` rejects
 * that shape in its own comment, defect 36 shipped it once, and defect 39 is still open with the
 * same temptation. `end()`'s `newestLogged` fallback is legitimate only because it runs after the
 * row is written.
 */
internal object CallNumberRules {

    private const val STATE_IDLE = "IDLE"

    /**
     * What `number` should hold after a `PHONE_STATE` broadcast.
     *
     * @param stateExtra `EXTRA_STATE` from the broadcast: "RINGING", "OFFHOOK", "IDLE", or null.
     * @param incoming `EXTRA_INCOMING_NUMBER`, which is blank or absent for most transitions.
     * @param current what the field holds now. Only ever a blank is filled — an outgoing call's
     *   number came from `call.dial` and an empty extra must not erase it.
     */
    fun numberAfterBroadcast(stateExtra: String?, incoming: String?, current: String): String {
        // No call is in progress, so any number here belongs to an episode that has ended.
        if (stateExtra.equals(STATE_IDLE, ignoreCase = true)) return current
        if (incoming.isNullOrBlank()) return current
        if (current.isNotBlank()) return current
        return incoming
    }

    /**
     * The number an episode is allowed to start with.
     *
     * @param phase "ringing", "dialing" — the phase [CallWatcher.begin] was called with.
     * @param fromDial true when `call.dial` set the number for this episode, via `expectOutgoing`.
     * @param carried whatever the field happens to hold at this moment.
     */
    fun numberAtEpisodeStart(phase: String, fromDial: Boolean, carried: String): String = when {
        // Inbound: the PHONE_STATE broadcast is the source, and it fires alongside this transition.
        phase == "ringing" -> carried
        // Outgoing from the Mac: `call.dial` is the source and it ran before the dial.
        fromDial -> carried
        // Outgoing placed on the phone: no source exists. Anything in the field is residue.
        else -> ""
    }
}
