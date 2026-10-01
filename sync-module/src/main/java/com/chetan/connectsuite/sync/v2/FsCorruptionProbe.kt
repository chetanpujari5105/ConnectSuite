package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.sync.v2.FsCorruptionProbe.T4A

/**
 * L1/L2 **T4-A** — one byte corrupted in transit on one Files block pull — and nothing else.
 * Debug builds only.
 *
 * It replaces a global switch. Until 2026-10-01 `BulkTransfers.debugCorruptAtByte` armed "the next
 * pull of any kind that covers byte N": a Photos original, a Share pull without its own arm, any Files
 * pull from any root, on whatever session asked first. `docs/testing.md` → slice 3c recorded that and
 * left its writer, `FsProbeActivity`, undeclared rather than expose it. This is what it became instead:
 *
 * - **one source.** The arm takes no name, size or offset. It names a document id; the root, the file
 *   name, the size and the byte are fixed below ([T4A]). Only `downloads:connectsuite` can match.
 * - **one session.** Arming records the one live, handshaken control session, and refuses when there
 *   is none or more than one. A pull from any other session — a replacement after a reconnect
 *   included — is never bound.
 * - **one transfer, bound before injection.** [claim] runs when a block pull is agreed, before its
 *   transfer is registered, and hands back the byte for that transfer's own `Pending` entry. The arm is
 *   consumed by it. The flip then happens only inside that entry's stream; there is no other place
 *   the byte is kept.
 * - **only block pulls.** [claim] has one caller, `FsFeature.onBeginBlockPull`. Photos
 *   (`media.original`), Share pulls, pushes and Files pulls at or below 64 MiB never ask.
 * - **bounded.** An arm expires after at most [MAX_TTL_MS]; it can be disarmed explicitly; the session
 *   it names ending clears it; and a request for the approved source that does not match in every
 *   respect (another session, another size or name, a resume) clears it rather than waiting.
 * - **fail-closed.** Anything that cannot be established — no debuggable build, no session, two
 *   sessions, a session with no token, a document id that is not one — refuses, and a refused arm
 *   also clears any earlier one.
 *
 * The flip is [flip]: XOR `0xFF` on exactly one outgoing byte, applied by `BulkTransfers` to the chunk
 * **after** `BlockPullSender` has hashed it, so every digest the phone reports is of the true bytes.
 * The source is only ever read; the byte is changed in the sender's buffer, never in the file.
 */
object FsCorruptionProbe {

    /** The one approved T4-A target: `sidekick-pass-stop-200mb.bin`, synthetic, in `Download/ConnectSuite`. */
    object T4A {
        const val ROOT_ID = FsPaths.DOWNLOADS_ROOT_ID
        const val NAME = "sidekick-pass-stop-200mb.bin"
        const val SIZE = 209_715_200L
        /** 64 KiB into zero-based block 800 of 1,600 at the rule's 128 KiB block size. */
        const val AT_BYTE = 104_923_136L
        const val BLOCK = 800L
    }

    const val DEFAULT_TTL_MS = 5 * 60_000L
    const val MIN_TTL_MS = 10_000L
    const val MAX_TTL_MS = 10 * 60_000L

    /** One live, handshaken control session, as the arm sees it. */
    data class Session(val token: String?, val peerFingerprint: String)

    /** A block pull as it is being agreed, before its transfer exists. */
    data class Candidate(
        val rootId: String,
        val documentId: String,
        val name: String,
        val size: Long,
        val sessionToken: String?,
        val blockSize: Int,
        /** Whether the begin carried a `resume` at all, accepted or not. T4-A is a fresh pull from byte 0. */
        val resumeAsked: Boolean,
    )

    sealed interface State {
        data object Disarmed : State
        data class Armed(
            val documentId: String,
            val sessionToken: String,
            val peerFingerprint: String,
            val armedAtMs: Long,
            val expiresAtMs: Long,
        ) : State
    }

    sealed interface ArmResult {
        data class Armed(val state: State.Armed) : ArmResult
        data class Refused(val why: String) : ArmResult
    }

    /** The one arm in the process. Its decisions are [FsCorruptionArm]'s; this object only names it and logs to `link.log`. */
    private val instance = FsCorruptionArm { level, message ->
        when (level) {
            'E' -> LinkLog.e("fs", message)
            'W' -> LinkLog.w("fs", message)
            else -> LinkLog.i("fs", message)
        }
    }

    fun state(): State = instance.state()

    fun arm(debuggable: Boolean, documentId: String?, sessions: List<Session>, nowMs: Long, ttlMs: Long = DEFAULT_TTL_MS): ArmResult =
        instance.arm(debuggable, documentId, sessions, nowMs, ttlMs)

    fun disarm(why: String): Boolean = instance.disarm(why)

    fun sessionEnded(token: String) = instance.sessionEnded(token)

    fun claim(candidate: Candidate, debuggable: Boolean, nowMs: Long): Long? = instance.claim(candidate, debuggable, nowMs)

        /**
     * What the receiver must do once the byte at [at] has been flipped, worded for the pull it is in
     * (defect 159). The probe is armed only for a block-verified pull now, and a block pull does not
     * report `CHECKSUM_MISMATCH` — it names the first block that does not match. The whole-file wording
     * stays for the classic path, which shares the hook.
     */
    fun expectation(at: Long, blockSize: Long?): String =
        if (blockSize != null && blockSize > 0) {
            "The receiver must name block ${at / blockSize} as not matching what the phone read, publish " +
                "nothing, delete its partial and record, and leave a .failed marker naming that block."
        } else {
            "The receiver must report CHECKSUM_MISMATCH, delete its partial and write a .failed sidecar."
        }

/**
     * Flips byte [at] of [chunk] — whose first byte is at [absoluteStart] in the file — by XOR `0xFF`.
     * Returns the byte as it was, or null when [at] is not in this chunk.
     */
    fun flip(chunk: ByteArray, absoluteStart: Long, at: Long): Byte? {
        if (at < absoluteStart || at >= absoluteStart + chunk.size) return null
        val index = (at - absoluteStart).toInt()
        val was = chunk[index]
        chunk[index] = (was.toInt() xor 0xFF).toByte()
        return was
    }
}

/**
 * [FsCorruptionProbe]'s decisions, with the log injected: `LinkLog` writes through `android.util.Log`,
 * which a JVM test in this module cannot call, so the rules live here and the tests run **this** code.
 */
class FsCorruptionArm(private val log: (level: Char, message: String) -> Unit) {

    private val lock = Any()
    private var state: FsCorruptionProbe.State = FsCorruptionProbe.State.Disarmed

    fun state(): FsCorruptionProbe.State = synchronized(lock) { state }

    /**
     * Arms T4-A for the one live session, or refuses. A refusal also clears an earlier arm: an arm
     * that was asked to change and could not is not left standing as it was.
     */
    fun arm(
        debuggable: Boolean,
        documentId: String?,
        sessions: List<FsCorruptionProbe.Session>,
        nowMs: Long,
        ttlMs: Long,
    ): FsCorruptionProbe.ArmResult = synchronized(lock) {
        val why = when {
            !debuggable -> "this build is not debuggable"
            documentId.isNullOrBlank() -> "no document id was given"
            documentId.toLongOrNull()?.takeIf { it > 0 } == null -> "\"$documentId\" is not a ${T4A.ROOT_ID} document id"
            ttlMs !in FsCorruptionProbe.MIN_TTL_MS..FsCorruptionProbe.MAX_TTL_MS ->
                "a lifetime of $ttlMs ms is outside ${FsCorruptionProbe.MIN_TTL_MS}..${FsCorruptionProbe.MAX_TTL_MS}"
            sessions.isEmpty() -> "no Mac is connected, so there is no session to bind"
            sessions.size > 1 -> "${sessions.size} sessions are live; the arm binds exactly one"
            sessions.single().token.isNullOrBlank() -> "the live session has no token"
            else -> null
        }
        if (why != null) {
            val had = state is FsCorruptionProbe.State.Armed
            state = FsCorruptionProbe.State.Disarmed
            log('W', "T4-A probe NOT armed: $why${if (had) "; the earlier arm is cleared" else ""}")
            return FsCorruptionProbe.ArmResult.Refused(why)
        }
        val session = sessions.single()
        val armed = FsCorruptionProbe.State.Armed(documentId!!, session.token!!, session.peerFingerprint, nowMs, nowMs + ttlMs)
        state = armed
        log(
            'E',
            "PROBE ARMED (T4-A): the next block pull of ${T4A.ROOT_ID}/$documentId (${T4A.NAME}, ${T4A.SIZE} bytes) " +
                "on session ${session.peerFingerprint.take(11)}… will have byte ${T4A.AT_BYTE} (block ${T4A.BLOCK}) " +
                "flipped after the phone hashes it. One transfer only; expires in ${ttlMs / 1000}s.",
        )
        FsCorruptionProbe.ArmResult.Armed(armed)
    }

    /** Clears the arm. Returns whether there was one. */
    fun disarm(why: String): Boolean = synchronized(lock) {
        val had = state is FsCorruptionProbe.State.Armed
        state = FsCorruptionProbe.State.Disarmed
        log('I', "T4-A probe disarmed: $why${if (had) "" else " (it was not armed)"}")
        had
    }

    /** Called for every ending session: an arm bound to it cannot be used by anything after it. */
    fun sessionEnded(token: String): Unit = synchronized(lock) {
        val armed = state as? FsCorruptionProbe.State.Armed ?: return
        if (armed.sessionToken != token) return
        state = FsCorruptionProbe.State.Disarmed
        log('I', "T4-A probe disarmed: the session it was bound to ended")
    }

    /**
     * Whether this block pull is the one T4-A transfer: the byte to flip for it, or null.
     *
     * A pull of anything other than the armed document leaves the arm in place and is untouched. A pull
     * of the armed document that differs in any other respect clears the arm (the setup is not the one
     * that was approved). A match consumes it.
     */
    fun claim(candidate: FsCorruptionProbe.Candidate, debuggable: Boolean, nowMs: Long): Long? = synchronized(lock) {
        val armed = state as? FsCorruptionProbe.State.Armed ?: return null
        if (!debuggable) return clear("the build is not debuggable")
        if (nowMs >= armed.expiresAtMs) return clear("it expired before a matching pull was agreed")
        if (candidate.rootId != T4A.ROOT_ID || candidate.documentId != armed.documentId) return null
        val mismatch = when {
            candidate.sessionToken != armed.sessionToken -> "the pull came from a different session than the one armed"
            candidate.name != T4A.NAME -> "the document is named \"${candidate.name}\", not ${T4A.NAME}"
            candidate.size != T4A.SIZE -> "the document is ${candidate.size} bytes, not ${T4A.SIZE}"
            candidate.blockSize <= 0 || T4A.AT_BYTE / candidate.blockSize != T4A.BLOCK ->
                "block size ${candidate.blockSize} would not put byte ${T4A.AT_BYTE} in block ${T4A.BLOCK}"
            candidate.resumeAsked -> "the pull asked to resume; T4-A is a fresh pull from byte 0"
            else -> null
        }
        if (mismatch != null) return clear("the approved source was asked for, but $mismatch")
        state = FsCorruptionProbe.State.Disarmed
        T4A.AT_BYTE
    }

    private fun clear(why: String): Long? {
        state = FsCorruptionProbe.State.Disarmed
        log('W', "T4-A probe disarmed without binding: $why")
        return null
    }
}
