package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareOffer.Effect
import com.chetan.connectsuite.sync.v2.ShareOffer.Offer
import com.chetan.connectsuite.sync.v2.ShareOffer.Result
import com.chetan.connectsuite.sync.v2.ShareOffer.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import kotlin.random.Random

/**
 * **`Σ` and the disk agree** (docs/protocol.md → Version 3 rule 4). [ShareOfferHeldTest] proves a copy
 * leaves `Σ` on every end; this proves the **same** end deletes that copy's files, and only that copy's.
 *
 * Real staged copies under a real cache directory ([ShareStaging.copy]); every transition is the real
 * `ShareOffer` function; every result is stored through [ShareOffer.storeLive] and its
 * [Effect.DeleteStaged] executed through [ShareStaging.discardStaged] — the branch `ShareFeature.apply`
 * runs, moved verbatim. **Restated, and so not reached:** `ShareFeature`'s lookup-and-store glue, its lock
 * and the order of `apply` outside it (between the map update and the deletion the copy is counted in the
 * budget's "other cache" `N` rather than in `Σ`; `Bq = ⌊Q·½⌋ − K` either way, so nothing is counted twice).
 */
class ShareOfferDiskTest {

    @get:Rule val tmp = TemporaryFolder()

    private val t0 = 1_000_000L
    private val idA = "s-AAAAAAAAAAAAAAAAAAAAAA"
    private val idB = "s-BBBBBBBBBBBBBBBBBBBBBB"
    private val bytesA = Random(1).nextBytes(100_718)
    private val bytesB = Random(2).nextBytes(230_778)

    private lateinit var cache: File
    private lateinit var a: Offer
    private lateinit var b: Offer

    /** Two real copies staged for two live offers, as the sheet leaves them before `offerStaged`. */
    private fun setUp(): MutableMap<String, Offer> {
        cache = tmp.newFolder("cache")
        val dir = ShareStaging.stagingDir(cache)!!
        fun stage(id: String, data: ByteArray, key: String): Offer {
            val s = ShareStaging.copy(ByteArrayInputStream(data), dir, id, Long.MAX_VALUE, { Long.MAX_VALUE }, { false }, t0)
            assertTrue("control: $id staged", s is ShareStaging.Outcome.Staged)
            s as ShareStaging.Outcome.Staged
            return Offer(id, key, s.bytes, s.sha256, t0, t0 + ShareOffer.TTL_MS, name = "$id.png")
        }
        a = stage(idA, bytesA, "token-A")
        b = stage(idB, bytesB, "token-B")
        return HashMap<String, Offer>().also { m -> ShareOffer.storeLive(m, a); ShareOffer.storeLive(m, b) }
    }

    private fun stagingDir() = File(cache, ShareStaging.DIR_NAME)
    private fun filesOf(id: String) = stagingDir().list()!!.filter { it.startsWith(id) }.toSet()

    /** Store, then run the one effect this test is about exactly as `apply` does. Returns the files it removed. */
    private fun step(live: MutableMap<String, Offer>, id: String, t: (Offer?) -> Result): Pair<Result, Int> {
        val r = t(live[id])
        r.offer?.let { ShareOffer.storeLive(live, it) }
        val removed = r.effects.filterIsInstance<Effect.DeleteStaged>().sumOf { ShareStaging.discardStaged(cache, id) }
        return r to removed
    }

    /**
     * The fact this file exists for, asserted of **one** offer after one step: A is out of `Σ` exactly when
     * its files are gone, and B's copy is untouched and still byte-exact.
     */
    private fun assertAgrees(live: Map<String, Offer>, why: String) {
        val inSigma = live.containsKey(idA)
        assertEquals("$why: A is in Σ exactly when its copy is on disk", inSigma, ShareHeldCopies.intact(stagingDir(), a))
        if (!inSigma) assertEquals("$why: nothing of A is left", emptySet<String>(), filesOf(idA))
        assertEquals("$why: Σ counts only live copies", live.values.sumOf { it.bytes }, ShareOffer.heldBytes(live.values))
        assertTrue("$why: B's copy is intact", ShareHeldCopies.intact(stagingDir(), b))
        assertEquals("$why: B's copy is byte-exact", b.bytes to b.sha256, ShareStaging.readBack(stagingDir(), idB))
        assertEquals("$why: B's files", setOf("$idB.bin", "$idB.json"), filesOf(idB))
    }

    private fun accept(o: Offer?, version: Int = 2) = ShareOffer.respond(o, "token-A", idA, "accept", null, t0 + 1, negotiatedVersion = version, stagedIntact = true)
    private fun begin(o: Offer?) = ShareOffer.beginPull(o, "token-A", idA, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", t0 + 2, 262_144)

    /** End A by [end] after [before]; its files go once, a repeated end removes nothing, B survives throughout. */
    private fun endsOnce(label: String, before: List<(Offer?) -> Result> = emptyList(), end: (Offer?) -> Result) {
        val live = setUp()
        assertAgrees(live, "$label, control before")
        before.forEach { t -> assertEquals("$label: a live step deletes nothing", 0, step(live, idA, t).second); assertAgrees(live, "$label, live step") }
        val (r, removed) = step(live, idA, end)
        assertFalse("$label: ended", ShareOffer.isLive(r.offer!!.state))
        assertEquals("$label: the copy and its marker", 2, removed)
        assertAgrees(live, label)
        val (again, removedAgain) = step(live, idA, end)
        assertNull("$label: a repeated end finds no live offer", again.offer)
        assertEquals("$label: a repeated end deletes nothing more", 0, removedAgain)
        assertAgrees(live, "$label, repeated")
    }

    @Test fun `saved deletes A's copy and keeps B's`() =
        endsOnce("saved", listOf({ accept(it) }, { begin(it) })) { ShareOffer.saved(it, "token-A", idA, true, a.bytes, true, "a.png", null, t0 + 3) }

    @Test fun `declined deletes A's copy and keeps B's`() =
        endsOnce("declined") { ShareOffer.respond(it, "token-A", idA, "decline", "user", t0 + 1, stagedIntact = true) }

    @Test fun `cancelled by the Mac while queued at version 3 deletes A's copy and keeps B's`() =
        endsOnce("cancelled while queued", listOf({ accept(it, version = 3) })) { ShareOffer.cancelFromMac(it, "token-A", idA, "user", t0 + 5) }

    @Test fun `the Mac cancelling the running pull deletes A's copy and keeps B's`() =
        endsOnce("pull cancelled", listOf({ accept(it) }, { begin(it) })) { ShareOffer.cancelPull(it, "token-A", "ts-AAAAAAAAAAAAAAAAAAAAAA") }

    @Test fun `withdrawn on the phone deletes A's copy and keeps B's`() = endsOnce("withdrawn") { o ->
        // cancelFromPhone takes a live offer; ShareFeature reaches it only through transition, which stops at null.
        if (o == null) Result(null, null, emptyList()) else ShareOffer.cancelFromPhone(o, "user")
    }

    @Test fun `expired while waiting deletes A's copy and keeps B's`() = endsOnce("expired") { o ->
        if (o == null) Result(null, null, emptyList()) else ShareOffer.expire(o, a.expiresAtMs)
    }

    @Test fun `the queue backstop deletes A's copy and keeps B's`() {
        var bound = 0L
        endsOnce("backstop", listOf({ o -> accept(o, version = 3).also { bound = it.offer!!.queueUntilMs!! } })) { o ->
            if (o == null) Result(null, null, emptyList()) else ShareOffer.expire(o, bound)
        }
    }

    @Test fun `the session ending deletes A's copy and keeps B's, which belongs to another session`() = endsOnce("session ended") { o ->
        if (o == null) Result(null, null, emptyList()) else ShareOffer.sessionEnded(o, "token-A")
    }

    @Test fun `staging-lost deletes nothing it did not find, and B is untouched`() {
        val live = setUp()
        Files.delete(File(stagingDir(), "$idA.bin").toPath())
        val (r, removed) = step(live, idA) { o -> ShareHeldCopies.check(stagingDir(), o!!) }
        assertEquals(State.Cancelled(ShareOffer.Side.PHONE, "staging-lost"), r.offer!!.state)
        assertEquals("only A's marker was left to delete", 1, removed)
        assertAgrees(live, "staging-lost")
    }

    @Test fun `a failed attempt keeps its copy on disk for the Retry window, and the window closing deletes it`() {
        val live = setUp()
        step(live, idA) { accept(it) }
        step(live, idA) { begin(it) }
        val (failed, kept) = step(live, idA) { ShareOffer.saved(it, "token-A", idA, false, null, null, null, "checksum", t0 + 3) }
        assertTrue(failed.offer!!.state is State.Failed)
        assertEquals("nothing deleted while a Retry is possible", 0, kept)
        assertAgrees(live, "failed")
        val (_, removed) = step(live, idA) { o -> ShareOffer.retryWindowClosed(o!!, failed.offer!!.retryUntilMs!!) }
        assertEquals(2, removed)
        assertAgrees(live, "retry window closed")
    }

    @Test fun `discardStaged with no cache directory, or a symlink where staging should be, deletes nothing`() {
        assertEquals(0, ShareStaging.discardStaged(null, idA))
        setUp()
        val elsewhere = tmp.newFolder("elsewhere")
        File(elsewhere, "$idA.bin").writeBytes(bytesA)
        val linked = tmp.newFolder("linked-cache")
        Files.createSymbolicLink(File(linked, ShareStaging.DIR_NAME).toPath(), elsewhere.toPath())
        assertEquals(0, ShareStaging.discardStaged(linked, idA))
        assertTrue("never followed through the link", File(elsewhere, "$idA.bin").exists())
        assertEquals("control: the real cache still deletes", 2, ShareStaging.discardStaged(cache, idA))
    }
}
