package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 56 — **a truncated push was committed as the finished file** — and the ordering rule that
 * is the quiet way to bring it back.
 *
 * The bug was not in the digest comparison; it was in what happened when there was no digest to
 * compare. `fs.transfer.begin` pre-hashes only below a 64 MB ceiling, so **every push of a large
 * file agrees no digest**, and the receive path had nothing left that could tell an interruption
 * from a completion. It committed. The file appeared at its final name, whole to everything that
 * opened it, and half there.
 *
 * These call [FsPartials.arrivalVerdict] rather than restating it. A test that writes the rule out
 * a second time passes over a deleted implementation — `MediaPayloadsTest`'s lesson, and the reason
 * the decision has one home.
 */
class FsArrivalTest {

    private val agreedSha = "5fa81f70ae5a1c0b"

    @Test
    fun `a short arrival with no digest agreed is an interruption, not a completion`() {
        // Defect 56, in one assertion. Above the pre-hash ceiling `expectedSha` is null for every
        // push, so this is not an edge case — it is the ordinary large-file path.
        val verdict = FsPartials.arrivalVerdict(
            received = 12_058_624,
            agreed = 24_000_000,
            expectedSha = null,
            actualSha = "whatever the half hashed to",
        )
        assertEquals(FsPartials.Arrival.Short(12_058_624, 24_000_000), verdict)
        assertTrue("a short arrival is resumable and must keep its partial", verdict.keepsPartial)
    }

    @Test
    fun `a short arrival with a digest agreed is still short, never corrupt`() {
        // **The ordering rule.** A truncated arrival also fails its digest, so a digest-first
        // reading would call this Corrupt — and Corrupt destroys the partial. The symptom would not
        // be a corrupt file; it would be a large push restarting from zero every time the network
        // blinks, with a `.failed` sidecar explaining a corruption that never happened.
        //
        // This is the case whose two readings disagree, which is why it is the one that pins the
        // order. Swap the length and digest clauses in `arrivalVerdict` and only this test goes red.
        val verdict = FsPartials.arrivalVerdict(
            received = 12_058_624,
            agreed = 24_000_000,
            expectedSha = agreedSha,
            actualSha = "the digest of half a file, which of course does not match",
        )
        assertTrue("length is decided before digest: $verdict", verdict is FsPartials.Arrival.Short)
        assertTrue("and the partial the next attempt resumes from survives", verdict.keepsPartial)
    }

    @Test
    fun `an overrun is destroyed rather than kept, because it cannot be resumed into anything`() {
        // The mirror of the case above, and the reason `keepsPartial` is not simply "did it fail".
        // Both are failures; one is resumable and one is not, and there is no offset that means
        // "unsend those bytes".
        val verdict = FsPartials.arrivalVerdict(
            received = 24_000_001,
            agreed = 24_000_000,
            expectedSha = null,
            actualSha = "irrelevant",
        )
        assertEquals(FsPartials.Arrival.Overrun(24_000_001, 24_000_000), verdict)
        assertFalse("an overrun has no resume point", verdict.keepsPartial)
    }

    @Test
    fun `the agreed length arriving with no digest is complete and honestly unverified`() {
        // `verified: false` is not a failure, and it is not hidden either. It says nothing compared
        // the bytes — a separate field from `ok` precisely so a success nobody checked cannot look
        // like a success that was.
        assertEquals(
            FsPartials.Arrival.Complete(verified = false),
            FsPartials.arrivalVerdict(
                received = 3_000_000,
                agreed = 3_000_000,
                expectedSha = null,
                actualSha = "fd456163578b6b63",
            ),
        )
    }

    @Test
    fun `the agreed length arriving with a matching digest is the only verified outcome`() {
        assertEquals(
            FsPartials.Arrival.Complete(verified = true),
            FsPartials.arrivalVerdict(
                received = 3_000_000,
                agreed = 3_000_000,
                expectedSha = agreedSha,
                actualSha = agreedSha,
            ),
        )
    }

    @Test
    fun `the right number of wrong bytes is corrupt, and corrupt destroys the partial`() {
        val verdict = FsPartials.arrivalVerdict(
            received = 3_000_000,
            agreed = 3_000_000,
            expectedSha = agreedSha,
            actualSha = "aac8d165f1a8",
        )
        assertEquals(FsPartials.Arrival.Corrupt(agreedSha, "aac8d165f1a8"), verdict)
        assertFalse("a corrupt file is worse than a missing one", verdict.keepsPartial)
    }

    @Test
    fun `a zero-byte arrival against a non-zero agreement is short, not complete`() {
        // The first hardware run of push resume: the Mac reported 12 MB sent and **zero arrived**,
        // because `socket.destroy()` discards the send buffer. The phone must not treat an empty
        // stream as a finished zero-byte file when a length was agreed.
        assertEquals(
            FsPartials.Arrival.Short(0, 24_000_000),
            FsPartials.arrivalVerdict(0, 24_000_000, null, "e3b0c44298fc1c14"),
        )
    }

    @Test
    fun `a genuinely empty file that was agreed as empty is complete`() {
        // The control for the case above: zero is only wrong when something else was promised.
        assertEquals(
            FsPartials.Arrival.Complete(verified = false),
            FsPartials.arrivalVerdict(0, 0, null, "e3b0c44298fc1c14"),
        )
    }

    /**
     * The enforcement point, and the answer to *what would have to break for defect 56 to come
     * back*.
     *
     * The cases above prove the decision is right. They prove nothing about whether the receive
     * path still asks it — and the defect's original form was a receive path that decided for
     * itself, inline, in a branch no test could reach. So this scans the source: the verdict has
     * one home and [BulkTransfers] calls it.
     *
     * Shown to fail: renaming the call in `BulkTransfers.kt` turns this red on its own.
     */
    @Test
    fun `the receive path asks arrivalVerdict rather than deciding for itself`() {
        val sources = SourceTree.kotlinFiles()
        val bulk = sources.singleOrNull { it.name == "BulkTransfers.kt" }
            ?: throw AssertionError("BulkTransfers.kt is not where this guard expects it")
        val text = bulk.readText()
        assertTrue(
            "BulkTransfers must reach its completion verdict through FsPartials.arrivalVerdict — " +
                "an inline length comparison is the shape defect 56 shipped in",
            text.contains("FsPartials.arrivalVerdict("),
        )

        // The control this guard needs, and the reason it is not a bare `contains`: a scan that
        // cannot see the sources passes every assertion of this shape. `SourceTree` throws rather
        // than returning empty, and this confirms the walk reached a plausible tree.
        assertTrue(
            "the source scan found ${sources.size} files, which is not a tree it can conclude from",
            sources.size > 10,
        )
    }
}
