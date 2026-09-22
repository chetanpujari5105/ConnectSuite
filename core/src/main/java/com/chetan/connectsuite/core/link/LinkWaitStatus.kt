package com.chetan.connectsuite.core.link

/**
 * What the phone should say while it is listening — F4 and F5 of `docs/phase-7-pairing-flow.md`.
 *
 * ### The problem this exists for
 *
 * After a successful scan the phone said **"Listening for your Mac"**, forever, for all of:
 *
 *  - the Mac has not dialled yet (normal, a second or two),
 *  - the Mac dialled and the TLS handshake was refused,
 *  - the Mac is on a different network and never will dial.
 *
 * That is §3.2 of the flow document, and it is the mirror image of the Mac's J1/J2 problem — except
 * that **the phone's screen is the one the user is holding**, and unlike the Mac's half it needs no
 * protocol change to fix, because the phone can already see its own accept loop. `LinkTls` has
 * logged `Rejected unpaired client …` since Phase 1; the screen simply never heard it.
 *
 * ### Why it is a pure function in `core/` rather than a `when` inside the composable
 *
 * `CLAUDE.md`, twice over. A rule expressed in the renderer is reachable by no test — that is the
 * `showsState` failure, where the same condition was got wrong twice in two slices because it lived
 * in a file nothing could call. And a test that restates the rule instead of calling it is testing
 * a copy, which is `MediaPayloadsTest`. So the decision has one home, the screen renders whatever
 * comes out of it, and the test calls this.
 *
 * ### What it deliberately does not do
 *
 * It does not claim to distinguish J6 (*scanned, wrong network*) from J2 (*scanned, Mac still
 * searching*). **Nothing on the phone can**: both are silence on the accept loop, and the phone
 * cannot see a connection that is not being attempted. What [Waiting] does is put a clock on the
 * silence and, past [HINT_AFTER_MS], offer the explanation that is *actionable* — check both are on
 * the same Wi-Fi — while saying it as a possibility rather than a diagnosis. The honest sentence
 * for a state you cannot separate from its lookalike is one that names the lookalike, which is why
 * the copy says "if it stays like this" rather than "your Mac is on a different network".
 */
sealed interface LinkWaitStatus {

    /** The headline: what is true right now. */
    val headline: String

    /** The line under it, or `null` when the headline says everything. */
    val detail: String?

    /** Nothing is listening. The user has to start it, or nothing is paired yet. */
    data class NotListening(override val detail: String?) : LinkWaitStatus {
        override val headline = "Not listening"
    }

    /** A Mac is connected. The ordinary healthy state. */
    data class Connected(val clients: List<String>) : LinkWaitStatus {
        override val headline = "Connected to " + clients.joinToString(", ")
        override val detail: String? = null
    }

    /**
     * Listening, nothing has connected yet.
     *
     * [showNetworkHint] is the whole of F4. Before [HINT_AFTER_MS] this is an ordinary wait and
     * saying anything about networks would be alarming noise; after it, the wait has gone on longer
     * than a working setup ever does and the user deserves the one thing they can act on.
     */
    data class Waiting(val showNetworkHint: Boolean) : LinkWaitStatus {
        override val headline = "Listening for your Mac"
        override val detail: String? =
            if (showNetworkHint) {
                "Nothing has connected yet. If it stays like this, check that your Mac is awake " +
                    "and on the same Wi-Fi as this phone."
            } else {
                null
            }
    }

    /**
     * A Mac reached us and was turned away — F5.
     *
     * This is the state the log has always known about and the screen never did. The fingerprint
     * prefix is included because it is the one thing that distinguishes *"a stranger on the
     * network"* from *"the Mac you meant, with a key that has changed"*, and the second is what
     * happens after somebody reinstalls the Mac app.
     */
    data class Refused(val fingerprintPrefix: String, val address: String?) : LinkWaitStatus {
        override val headline = "A Mac tried to connect and was refused"
        override val detail: String =
            "It is not paired with this phone" +
                (address?.let { " (from $it)" } ?: "") +
                ". Key ${fingerprintPrefix}… — if that is your Mac, scan its code again to pair it."
    }

    companion object {
        /**
         * How long silence is ordinary before the network hint appears.
         *
         * 20 seconds rather than the flow document's suggested 30: the measured time from a scan to
         * a handshake on this hardware is 1.5 s at worst, so 20 s is already more than ten times the
         * observed worst case and a user staring at an unchanging screen has by then decided
         * something is broken. It is a constant rather than a literal so the test names the same
         * number the code does.
         */
        const val HINT_AFTER_MS = 20_000L

        /**
         * How long a refusal stays on screen.
         *
         * A refusal is an *event*, not a state, so it has to expire or the screen would accuse a
         * long-gone stranger forever. It outlives [HINT_AFTER_MS] deliberately: a refusal is a
         * better explanation of silence than the network hint is, so while both apply the refusal
         * wins — see [of].
         */
        const val REFUSAL_VISIBLE_MS = 60_000L

        /**
         * The decision, in one place.
         *
         * [nowMillis] is a parameter rather than a call to `System.currentTimeMillis()` so a test
         * can reach every branch without sleeping. A test that has to wait 20 seconds to check a
         * 20-second rule is a test nobody runs.
         */
        fun of(state: LinkState, nowMillis: Long): LinkWaitStatus {
            if (state.isConnected) return Connected(state.clients)
            if (!state.running) return NotListening(state.lastError)

            // A refusal explains the silence better than the clock does, so it is checked first —
            // but only while it is recent enough to be about the silence the user is looking at.
            val refusal = state.lastRefusal
            if (refusal != null && nowMillis - refusal.atMillis < REFUSAL_VISIBLE_MS) {
                return Refused(refusal.fingerprintPrefix, refusal.address)
            }

            val since = state.waitingSinceMillis
            // A null start time means we are waiting and do not know since when. Showing the hint
            // would be a guess; withholding it is the reading we actually have.
            //
            // `waitingSinceMillis` is the start of *this wait*, not of the server. Defect 67: when
            // it was the server's start time this whole branch was dead — every phone up for more
            // than twenty seconds took the hint path the instant its Mac went away.
            val waited = if (since == null) 0L else nowMillis - since
            return Waiting(showNetworkHint = waited >= HINT_AFTER_MS)
        }
    }
}

/**
 * A connection the phone turned away, kept just long enough to say so on screen.
 *
 * Only the first 23 characters of the fingerprint are carried, matching what `LinkTls` already
 * logs — enough to recognise a key, not enough to be mistaken for the pinned value itself.
 */
data class RefusedConnection(
    val fingerprintPrefix: String,
    val address: String?,
    val atMillis: Long,
)

