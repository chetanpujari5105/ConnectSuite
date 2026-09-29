package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import com.chetan.connectsuite.sync.v2.BulkClaim.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 148: a Files or Photos bulk transfer was claimable, and cancellable, from **any** trusted
 * session, by an id of the form `t-<counter>-<millis mod 100000>` that anyone could predict.
 *
 * The rules live in [BulkClaim]; `serve()` holds an `SSLSocket` no JVM test can build, so the last
 * test here is a source guard that `serve()` and `fs.transfer.cancel` still ask those rules — the
 * shape [FsArrivalTest] uses for defect 56's verdict.
 */
class BulkSessionBindingTest {

    @Test
    fun `a Files or Photos pull is bound to the session that agreed it`() {
        // Unbound entry (no share token): the agreeing session is the binding.
        val token = BulkClaim.claimToken(boundSessionToken = null, sessionId = "session-A")
        assertEquals("session-A", token)
        assertEquals(Decision.WrongSession, BulkClaim.decide(true, token, false, "session-B", 0L))
        assertEquals(Decision.Claim, BulkClaim.decide(true, token, false, "session-A", 0L))
        // A pull may still resume at an offset — only share pulls require 0.
        assertEquals(Decision.Claim, BulkClaim.decide(true, token, false, "session-A", 4096L))
    }

    @Test
    fun `a share pull keeps its own bound token`() {
        assertEquals("share-token", BulkClaim.claimToken("share-token", "session-A"))
    }

    @Test
    fun `a push is claimed only by its own session, and an absent owner is never a claim`() {
        assertEquals(Decision.Claim, BulkClaim.decidePush(true, "session-A", "session-A"))
        assertEquals(Decision.WrongSession, BulkClaim.decidePush(true, "session-A", "session-B"))
        assertEquals(Decision.WrongSession, BulkClaim.decidePush(true, "session-A", null))
        assertEquals(Decision.WrongSession, BulkClaim.decidePush(true, null, "session-A"))
        assertEquals(Decision.Unknown, BulkClaim.decidePush(false, null, "session-A"))
    }

    @Test
    fun `cancel is honoured only for the session's own transfer`() {
        assertTrue(BulkClaim.mayCancel("session-A", "session-A"))
        assertFalse(BulkClaim.mayCancel("session-A", "session-B"))
        assertFalse("an id nobody owns is not cancellable", BulkClaim.mayCancel(null, "session-A"))
        assertFalse(BulkClaim.mayCancel("session-A", null))
    }

    @Test
    fun `Files transfer ids carry 128 random bits and never collide with share ids`() {
        val ids = (1..2000).map { BulkClaim.newFilesTransferId() }
        assertEquals("no repeats in 2000", ids.size, ids.toSet().size)
        ids.forEach { id ->
            assertTrue(id, BulkClaim.isFilesTransferId(id))
            assertFalse("a Files id must not route to Share: $id", ShareRoot.isShareTransfer(id))
        }
        // Control: the old predictable form is not accepted as a Files id.
        assertFalse(BulkClaim.isFilesTransferId("t-7-12345"))
        assertNotEquals(ids[0], ids[1])
    }

    /**
     * The rules above are right; this is that `serve()` and the cancel handler still ask them. Each
     * assertion names the exact call, so reverting any one site turns exactly this test red.
     */
    @Test
    fun `serve and cancel ask the binding rules rather than deciding for themselves`() {
        val sources = SourceTree.kotlinFiles()
        assertTrue("the source scan found ${sources.size} files", sources.size > 10)
        val bulk = sources.single { it.name == "BulkTransfers.kt" }.readText()
        val fs = sources.single { it.name == "FsFeature.kt" }.readText()

        assertTrue("serve() must bind a pull through BulkClaim.claimToken", bulk.contains("BulkClaim.claimToken(it.boundSessionToken, it.sessionId)"))
        assertTrue("serve() must check a push's session", bulk.contains("BulkClaim.decidePush(true, arrivingCandidate.sessionId, channel.session.token)"))
        assertTrue("ids must come from the random generator", bulk.contains("BulkClaim.newFilesTransferId()"))
        assertFalse("the guessable id form must be gone", bulk.contains("System.currentTimeMillis() % 100000"))
        assertTrue("fs.transfer.cancel must go through cancelFor", fs.contains("BulkTransfers.cancelFor(session.token, transferId, reason)"))
        assertFalse("fs.transfer.cancel must not call the unchecked cancel", fs.contains("BulkTransfers.cancel(transferId"))
        // Defect 149: an unknown transfer is not a photo.
        assertFalse("an unknown bulk claim must not be tagged photos", bulk.contains("feature = \"photos\""))
    }
}
