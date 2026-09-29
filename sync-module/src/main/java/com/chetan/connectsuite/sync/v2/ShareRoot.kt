package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.protocol.MessageType
import java.security.SecureRandom
import java.util.Base64

/**
 * What a `share:<offerId>` root may be used for — docs/protocol.md → Share → Version 2 → *The share
 * root*. Pure, so every `fs.*` verb's routing is reached by a JVM test.
 *
 * **Exactly one operation is routed to Share:** `fs.transfer.begin` with `direction: "pull"`.
 * Everything else on a share root is refused, here, before any Files code sees it — `FsRoots` never
 * learns a share root exists, so it can never be listed, stat-ed, thumbnailed, written or deleted.
 * Whether the one pull is then *allowed* (item `"0"`, the right session, the right state) is
 * [ShareOffer.beginPull]'s decision, not this one's.
 *
 * Share transfers carry their own id space ([newTransferId], 128 random bits), which is how a
 * `fs.transfer.cancel` naming one is told apart from a Files transfer without a lookup.
 */
object ShareRoot {

    const val PREFIX = "share:"
    const val TRANSFER_PREFIX = "ts-"
    private val TRANSFER = Regex("^ts-[A-Za-z0-9_-]{22}$")
    private val random = SecureRandom()

    sealed interface Route {
        /** Not a share root: Files handles it exactly as before. */
        data object NotShare : Route
        /** The one operation a share root permits, handed to Share with the offer id it names. */
        data class SharePull(val offerId: String) : Route
        /** Anything else on a share root: `NOT_FOUND`, `feature: "share"`. */
        data object Refuse : Route
    }

    fun isShareRoot(rootId: String?): Boolean = rootId != null && rootId.startsWith(PREFIX)

    /** Routing for every `fs.*` request that may carry a `rootId`. `direction` absent means pull. */
    fun route(type: String, rootId: String?, direction: String?): Route = when {
        !isShareRoot(rootId) -> Route.NotShare
        type == MessageType.FS_TRANSFER_BEGIN && (direction ?: "pull") == "pull" ->
            Route.SharePull(rootId!!.removePrefix(PREFIX))
        else -> Route.Refuse
    }

    /** A `fs.transfer.cancel` naming a share transfer belongs to Share; everything else to Files. */
    fun isShareTransfer(transferId: String?): Boolean = transferId != null && TRANSFER.matches(transferId)

    /** `ts-` + 22 base64url characters: 128 random bits, unlike Files' predictable ids (defect 148). */
    fun newTransferId(): String {
        val bytes = ByteArray(16).also { random.nextBytes(it) }
        return TRANSFER_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}

/**
 * Who may claim a pending pull on the bulk channel. Pure; `BulkTransfers.serve()` calls it.
 *
 * A pull with no binding (every Files and Photos pull today) is claimed by any authenticated session
 * exactly as before — that gap is defect 148, fixed separately. A **share** pull is bound to the
 * session that began it and to offset 0, and a claim that breaks either is refused **without
 * consuming the pending entry**, so a wrong claim cannot take the rightful session's transfer away.
 */
object BulkClaim {

    sealed interface Decision {
        data object Claim : Decision
        data object Unknown : Decision
        data object WrongSession : Decision
        data object WrongOffset : Decision
    }

    /**
     * @param requiredOffset a block pull (`fs.blocks`) may be claimed only at exactly the offset its ack
     *   agreed — `resume.from`, or 0 when no resume was accepted. Null for every other pull.
     */
    fun decide(
        exists: Boolean, boundSessionToken: String?, requireOffsetZero: Boolean, claimantToken: String?, offset: Long,
        requiredOffset: Long? = null,
    ): Decision =
        when {
            !exists -> Decision.Unknown
            boundSessionToken != null && boundSessionToken != claimantToken -> Decision.WrongSession
            requireOffsetZero && offset != 0L -> Decision.WrongOffset
            requiredOffset != null && offset != requiredOffset -> Decision.WrongOffset
            else -> Decision.Claim
        }

    /**
     * The token a pending pull is bound to (defect 148). A share pull carries its own
     * [BulkTransfers.Pending.boundSessionToken]; **every other pull — Files and Photos — is bound to
     * the session that agreed it**, which until 2026-09-29 it was not: `serve()` took any pending
     * pull by id alone, so a bulk socket from another trusted session could claim it.
     */
    fun claimToken(boundSessionToken: String?, sessionId: String): String = boundSessionToken ?: sessionId

    /** A push is claimed only by the session that agreed it; anything else is refused, entry kept. */
    fun decidePush(exists: Boolean, ownerToken: String?, claimantToken: String?): Decision = when {
        !exists -> Decision.Unknown
        ownerToken == null || ownerToken != claimantToken -> Decision.WrongSession
        else -> Decision.Claim
    }

    /**
     * Whether `fs.transfer.cancel` from [claimantToken] may stop this transfer: only the session that
     * owns it. An id nobody owns (never agreed, already finished, forgotten with its session) is
     * answered `stopped: false` and flagged nowhere — a cancel must not poison an id for later.
     */
    fun mayCancel(ownerToken: String?, claimantToken: String?): Boolean =
        ownerToken != null && claimantToken != null && ownerToken == claimantToken

    private val random = java.security.SecureRandom()
    private val FILES_TRANSFER = Regex("^tf-[A-Za-z0-9_-]{22}$")

    /** `tf-` + 128 random bits, base64url — a Files or Photos transfer id nobody can predict (defect 148). */
    fun newFilesTransferId(): String {
        val bytes = ByteArray(16).also { random.nextBytes(it) }
        return "tf-" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    fun isFilesTransferId(id: String): Boolean = FILES_TRANSFER.matches(id)
}
