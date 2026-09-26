package com.chetan.connectsuite.sync.v2

import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.attribute.BasicFileAttributes

/**
 * **The held-copy check, as one unit a JVM test can reach** — what `ShareFeature`'s 30-second loop and
 * its Accept check ask of the staging folder. docs/protocol.md → Share → `share.cancel` (`staging-lost`).
 *
 * - **Each offer is judged by its own file only**: `<offerId>.bin` in the staging folder, looked up by
 *   the offer's id — never by listing, never by name similarity, never another offer's file.
 * - **Looked at, never created or followed**: a missing staging folder means every copy is gone; a link
 *   where a copy should be is not a copy. Nothing here creates, reads, opens or deletes a file, and the
 *   source the person shared (a `content:` URI the share sheet read once) is never touched — only the
 *   private staged copy is.
 * - **Intact** means a regular file of exactly the offered length. The digest is not read here (that
 *   would read the whole file every 30 s); it is checked by the stream as a pull reads it.
 */
object ShareHeldCopies {

    /** Whether [offer]'s staged copy is still in [stagingDir] at the offered length. `null` dir → gone. */
    fun intact(stagingDir: File?, offer: ShareOffer.Offer): Boolean {
        if (stagingDir == null || !ShareStaging.isAttemptId(offer.offerId)) return false
        val attrs = try {
            Files.readAttributes(File(stagingDir, "${offer.offerId}.bin").toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
        } catch (_: java.io.IOException) {
            return false // absent (or unreadable): not a copy that could be sent
        }
        return attrs.isRegularFile && attrs.size() == offer.bytes
    }

    /**
     * One pass of the check over the live offers: each offer's own transition, [ShareOffer.stagingCheck],
     * decided by its own file. A pull in flight and an offer waiting for a verdict come back unchanged.
     */
    fun tick(offers: Collection<ShareOffer.Offer>, stagingDir: File?): List<ShareOffer.Result> = offers.map { check(stagingDir, it) }

    /** One offer's check — the exact call `ShareFeature`'s loop makes for each live offer. */
    fun check(stagingDir: File?, offer: ShareOffer.Offer): ShareOffer.Result = ShareOffer.stagingCheck(offer, intact(stagingDir, offer))
}
