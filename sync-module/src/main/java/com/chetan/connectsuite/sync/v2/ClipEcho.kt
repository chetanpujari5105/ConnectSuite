package com.chetan.connectsuite.sync.v2

/**
 * The echo interlock, phone side. The twin of `desktop/src/shared/clipEcho.ts`, verb for verb.
 *
 * ### Why it is an object now
 *
 * It was two `@Volatile` fields on [ClipFeature], assigned from four places. That was safe while
 * **neither end applied anything without a tap** — a person is a rate limiter, and a loop needing a
 * human to press a button once per hop is not a loop. Auto-apply takes the human out of the cycle,
 * so the interlock stops being a nicety and becomes the thing the feature rests on, and a rule the
 * feature rests on gets one home so a test can call it rather than model it.
 *
 * `ClipEchoTest` drives this against a peer that echoes everything back forever. [ClipFeature] holds
 * one of these and declares no clipboard text of its own; `scripts/check-clip-echo.mjs` fails the
 * commit if a third copy of `lastReceived` or `lastSent` appears anywhere else on either side.
 *
 * ### Duplicated rather than shared, and answerable to the contract
 *
 * There is no shared runtime between Kotlin and TypeScript, so this is the same deliberate
 * duplication as [ClipboardPayloads] — and `docs/protocol.md` § *The echo* is what both are
 * answerable to. The two test files are deliberately **not** each other's proof: each drives its own
 * implementation against an adversary, because two copies of a rule always agree with each other.
 *
 * ### Concurrency, stated rather than implied
 *
 * [arrived] runs on a socket thread, [maySend] and [wroteLocally] on the main thread. `@Volatile`
 * is sufficient: nothing here read-modify-writes, every operation is a plain assign or a compare. A
 * tagged union would prevent an ambiguous state and would do nothing about two callers, which is the
 * distinction `CLAUDE.md` draws and the reason this paragraph exists at all.
 *
 * ### What survives a link drop
 *
 * `lastSent` clears — the next Mac may be a different Mac and should get this phone's clipboard.
 * **`lastReceived` does not**, and that changed when auto-apply landed: clearing it opens a one-hop
 * bounce where the phone reads back a clip the Mac gave it and sends it home, and a Mac that
 * auto-applies then writes it over whatever the person has copied since. It is one string, never
 * rendered, never sent, never logged, and the clipboard it came from is still holding it — so it is
 * not a retention decision in the sense the history's is.
 */
class ClipEcho {

    /** What this side last received from the other side. The echo interlock, and nothing else. */
    @Volatile
    private var lastReceived: String? = null

    /** What this side last sent. Suppresses automatic re-sends of an unchanged clipboard. */
    @Volatile
    private var lastSent: String? = null

    /** What fired the send path: the phone's window focus, or a person pressing something. */
    enum class Trigger { AUTOMATIC, USER }

    /**
     * Why a send did or did not happen.
     *
     * Named refusals rather than a boolean, because both get said out loud. A silent no-op is what
     * makes the next person delete the gate to find out what it did.
     */
    sealed interface Decision {
        data object Send : Decision
        data object Echo : Decision
        data object Unchanged : Decision
    }

    /**
     * Text arrived from the other side. Call **before** writing any clipboard with it.
     *
     * The ordering is the interlock: a write that lands before the arm leaves a window in which this
     * side's own trigger reads its own new clipboard and sends it straight back.
     */
    fun arrived(text: String) {
        lastReceived = text
    }

    /**
     * This side wrote its own clipboard with [text] — auto-apply or a tap.
     *
     * **Arms only the unchanged rule**, and the narrowing came from a mutation that the Mac's twin
     * test could not see: removing the `lastReceived` half left every test green, because [arrived]
     * had already armed it on the only path that reaches here with an arriving entry. The half was
     * redundant where it was written for and wrong where it was reachable — after a tap that puts
     * an *older* entry on the clipboard, it made a later deliberate send refuse as an echo.
     *
     * What remains is the rule a watcher needs: a clipboard this side wrote is not a copy this side
     * made. The phone has no watcher — Android forbids one — so this guards the focus read instead,
     * which is the same statement about the same field.
     */
    fun wroteLocally(text: String) {
        lastSent = text
    }

    /** May this side send [text]? [Trigger.USER] skips the unchanged rule; nothing skips the echo rule. */
    fun maySend(text: String, trigger: Trigger): Decision = when {
        text == lastReceived -> Decision.Echo
        trigger == Trigger.AUTOMATIC && text == lastSent -> Decision.Unchanged
        else -> Decision.Send
    }

    /** Record a send that actually left. Called on success, never on the attempt. */
    fun sent(text: String) {
        lastSent = text
    }

    /** The link dropped. `lastSent` goes; `lastReceived` stays — see the class comment. */
    fun linkDropped() {
        lastSent = null
    }
}
