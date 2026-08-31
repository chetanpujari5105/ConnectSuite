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
 * 1. [numberAfterBroadcast] — the `PHONE_STATE` receiver may fill the field **only while an episode
 *    is live**, and never from an **IDLE** broadcast.
 *
 * 2. [numberAtEpisodeStart] — an episode may not begin with a number it did not obtain for itself.
 *    With rule 1 in place there is exactly one way it can have obtained one: `call.dial` via
 *    `expectOutgoing`, for an outgoing call the Mac placed. Everything else starts blank.
 *
 * ### Why rule 1 grew a second clause on 2026-08-29 — the reopening
 *
 * The first version of rule 1 excluded only IDLE, on the reasoning that "which transitions actually
 * carry the extra varies by OEM, and an allowlist risks discarding the inbound number 35c needs".
 * That was too narrow, and a real inbound call showed why:
 *
 * ```
 * platform  08:29:43  MISSED   +919900000002
 * app       08:29:44  Call c1 ringing number withheld by the platform    <- begin() ran first
 * app       08:29:44  Call c1 ended missed after 197ms                   <- 197ms later, end() blanked it
 * ...71 minutes pass...
 * platform  09:40:23  INCOMING +918200000005
 * app       09:40:24  Call c2 ringing from +919900000002 (Contact B)   <- c1's number, on c2's card
 * ```
 *
 * The extra **is** delivered on this device. It simply arrives *after* the state callback, so
 * `begin()` has already published a blank card — and on a call as short as 197 ms it arrives after
 * `end()` too, where it finds the field blank, fills it, and waits for the next episode to read it.
 * Only three lines in `CallWatcher` write this field and the other two are ruled out for that
 * window, so this is the path.
 *
 * **So the phrase to hold on to is not "the extra never arrives" but "it has never arrived in time
 * to be used by the episode it belongs to".** Both produce the same symptom — every non-empty
 * inbound number this app has ever shown was residue — and they imply different fixes, which is why
 * the distinction is written down here rather than left as a detail. See defect 45.
 *
 * Rule 1's "only while live" clause makes the residue **structurally impossible** rather than
 * merely unlikely, and that is why rule 2 could then be simplified: with no way for a stale value
 * to be sitting there, `begin()` no longer needs to special-case the inbound path.
 *
 * ### The trade this makes, deliberately
 *
 * On a device that delivers the extra *before* the state callback, this discards it and the card
 * reads "Unknown number". That is a real cost and it is the right way round: a blank is visibly
 * missing and recoverable, and a stranger's name on a live call is neither. Defect 42 showed a user
 * someone else's name; that must not be possible again to buy back a number on an OEM nobody has
 * tested.
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
     * @param episodeLive whether a call episode is in progress right now. False means anything
     *   arriving belongs to a call that has ended, or to one that has not started.
     */
    fun numberAfterBroadcast(
        stateExtra: String?,
        incoming: String?,
        current: String,
        episodeLive: Boolean,
    ): String {
        // Defect 42, reopened. Nothing may be written into the field between episodes: a broadcast
        // arriving after end() would otherwise be read by the *next* begin() as though it were its
        // own. This is the clause that makes residue impossible rather than unlikely.
        if (!episodeLive) return current
        // No call is in progress, so any number here belongs to an episode that has ended.
        if (stateExtra.equals(STATE_IDLE, ignoreCase = true)) return current
        if (incoming.isNullOrBlank()) return current
        if (current.isNotBlank()) return current
        return incoming
    }

    /**
     * Rule 3 — whether the arrival of a number should re-publish the card that is already on screen.
     *
     * Defect 45, option 4. [numberAfterBroadcast] decides what the field holds; this decides whether
     * that change is worth telling the Mac about. Separated for the reason the other two are: the
     * predicate is the interesting part and it can be read and tested without a phone ringing.
     *
     * The card is corrected only when **the number genuinely arrived just now, for an episode that
     * is still open**. Every clause is load-bearing:
     *
     * - `after != before` — a broadcast that changed nothing must not re-publish. OFFHOOK and IDLE
     *   both re-deliver the same extra, and republishing on each would send three identical cards
     *   per call and pay three contacts lookups for one answer.
     * - `after.isNotBlank()` — there is nothing to correct a card *to* if the number is still empty.
     *   A blank re-publish would overwrite nothing with nothing and log a correction that did not
     *   happen.
     * - `episodeLive` — the card being corrected must still exist. After `end()` there is no card
     *   on screen, and a `call.incoming` arriving then would draw a live card for a call that is
     *   over. This is the same clause as rule 1's and for a closely related reason.
     *
     * There is deliberately **no timer and no delay**. This returns true on the event, or never;
     * "wait a moment for the number before publishing" is the shape defect 36 shipped, 37 declined,
     * 39 tempts and 45 names, and it is not to be reintroduced here as an optimisation.
     */
    fun shouldCorrectCard(before: String, after: String, episodeLive: Boolean): Boolean =
        episodeLive && after.isNotBlank() && after != before

    /**
     * The number an episode is allowed to start with.
     *
     * @param fromDial true when `call.dial` set the number for this episode, via `expectOutgoing`.
     * @param carried whatever the field happens to hold at this moment.
     */
    fun numberAtEpisodeStart(fromDial: Boolean, carried: String): String =
        // One legitimate source, now that rule 1 keeps the field empty between episodes: a dial
        // this Mac placed, recorded before the dial by `expectOutgoing`. There is deliberately no
        // longer a `phase` parameter — the question is provenance, not direction, and the inbound
        // special case that used to live here is exactly what defect 42's reopening was.
        if (fromDial) carried else ""
}
