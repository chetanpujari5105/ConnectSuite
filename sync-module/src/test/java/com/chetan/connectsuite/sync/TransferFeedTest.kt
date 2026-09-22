package com.chetan.connectsuite.sync

import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.sync.transfer.TransferProgress
import com.chetan.connectsuite.sync.ui.transfers.TransferFeed
import com.chetan.connectsuite.sync.ui.transfers.TransferFilter
import com.chetan.connectsuite.sync.ui.transfers.formatBytes
import com.chetan.connectsuite.sync.ui.transfers.formatEta
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransferFeedTest {

    private val t0 = 1_700_000_000_000L
    private val minute = 60_000L

    private fun progress(
        id: String,
        status: TransferStatus = TransferStatus.RUNNING,
        direction: TransferDirection = TransferDirection.OUTGOING,
        total: Long = 1_000,
        done: Long = 500,
        rate: Long = 0,
    ) = TransferProgress(
        transferId = id,
        jobId = "job-$id",
        peerDeviceId = "mac-1",
        fileName = "$id.jpg",
        direction = direction,
        totalBytes = total,
        bytesTransferred = done,
        status = status,
        bytesPerSecond = rate,
    )

    private fun entity(
        id: String,
        status: TransferStatus,
        at: Long,
        direction: TransferDirection = TransferDirection.OUTGOING,
        total: Long = 1_000,
        done: Long = 1_000,
        error: String? = null,
    ) = TransferEntity(
        transferId = id,
        jobId = "job-$id",
        peerDeviceId = "mac-1",
        direction = direction,
        fileName = "$id.jpg",
        relativePath = "$id.jpg",
        mimeType = "image/jpeg",
        totalBytes = total,
        bytesTransferred = done,
        status = status,
        checksum = null,
        localUri = null,
        startedAtMillis = at - minute,
        updatedAtMillis = at,
        errorMessage = error,
    )

    /**
     * **The defect this file exists for.** `TransfersViewModel` puts `RUNNING` *and* `PENDING` in
     * `active`, but drops from `history` only rows that are `RUNNING` and in the progress map. A
     * `PENDING` transfer satisfies neither exclusion and was rendered twice — and two identical
     * file names one above the other read as two files, not as a bug.
     */
    @Test
    fun `a pending transfer present in both lists appears once`() {
        val rows = TransferFeed.rows(
            active = listOf(progress("a", status = TransferStatus.PENDING)),
            history = listOf(entity("a", TransferStatus.PENDING, t0)),
        )
        assertEquals(1, rows.size)
        assertEquals("a", rows.single().id)
        // The live row wins: it is the one carrying a rate and an ETA.
        assertEquals(TransferStatus.PENDING, rows.single().status)
        assertNull("the live row has no timestamp of its own", rows.single().atMillis)
    }

    @Test
    fun `live rows come first, then history newest-first`() {
        val rows = TransferFeed.rows(
            active = listOf(progress("live")),
            history = listOf(
                entity("old", TransferStatus.COMPLETED, t0 - 60 * minute),
                entity("recent", TransferStatus.COMPLETED, t0 - 2 * minute),
                entity("middle", TransferStatus.COMPLETED, t0 - 20 * minute),
            ),
        )
        assertEquals(listOf("live", "recent", "middle", "old"), rows.map { it.id })
    }

    @Test
    fun `the filter selects by direction`() {
        val active = listOf(progress("out", direction = TransferDirection.OUTGOING))
        val history = listOf(
            entity("in1", TransferStatus.COMPLETED, t0, TransferDirection.INCOMING),
            entity("in2", TransferStatus.COMPLETED, t0 - minute, TransferDirection.INCOMING),
        )
        assertEquals(3, TransferFeed.rows(active, history, TransferFilter.All).size)
        assertEquals(listOf("out"), TransferFeed.rows(active, history, TransferFilter.Sending).map { it.id })
        assertEquals(listOf("in1", "in2"), TransferFeed.rows(active, history, TransferFilter.Received).map { it.id })
    }

    /**
     * The chip's number and the list under it have one source. A count computed over a different
     * collection than the rows is the denominator rule's failure with a filter strip on top.
     */
    @Test
    fun `every count equals the number of rows that filter actually shows`() {
        val active = listOf(progress("out"), progress("in", direction = TransferDirection.INCOMING))
        val history = listOf(
            entity("h1", TransferStatus.COMPLETED, t0),
            entity("h2", TransferStatus.FAILED, t0 - minute, TransferDirection.INCOMING),
            entity("out", TransferStatus.RUNNING, t0),
        )
        val counts = TransferFeed.counts(active, history)
        TransferFilter.entries.forEach { f ->
            assertEquals(
                "count disagrees with the list for $f",
                TransferFeed.rows(active, history, f).size,
                counts[f],
            )
        }
        // And the duplicate is not counted twice either.
        assertEquals(4, counts[TransferFilter.All])
    }

    /**
     * A bar only where one still means something. A finished transfer does not get a full bar and
     * an abandoned one does not get a partial one — both are over, and a bar invites watching.
     */
    @Test
    fun `only live and paused rows carry a progress fraction`() {
        fun fractionFor(status: TransferStatus): Float? =
            TransferFeed.rows(emptyList(), listOf(entity("x", status, t0, done = 400))).single().fraction

        assertEquals(0.4f, fractionFor(TransferStatus.PAUSED)!!, 0.001f)
        assertNull(fractionFor(TransferStatus.COMPLETED))
        assertNull(fractionFor(TransferStatus.FAILED))
        assertNull(fractionFor(TransferStatus.CANCELLED))

        assertNotNull(TransferFeed.rows(listOf(progress("live")), emptyList()).single().fraction)
    }

    /** Cancel is the only action a row offers, and only while there is something to cancel. */
    @Test
    fun `cancel is offered on live rows and nowhere else`() {
        assertTrue(TransferFeed.rows(listOf(progress("a")), emptyList()).single().canCancel)
        listOf(
            TransferStatus.COMPLETED,
            TransferStatus.FAILED,
            TransferStatus.CANCELLED,
            TransferStatus.PAUSED,
        ).forEach { status ->
            val row = TransferFeed.rows(emptyList(), listOf(entity("x", status, t0))).single()
            assertTrue("$status must not offer cancel", !row.canCancel)
        }
    }

    /** The real error string survives to the row — it is a better sentence than any invented one. */
    @Test
    fun `a failure carries the transfer layer's own reason`() {
        val row = TransferFeed.rows(
            emptyList(),
            listOf(entity("x", TransferStatus.FAILED, t0, error = "Connection lost")),
        ).single()
        assertEquals("Connection lost", row.error)
    }

    /**
     * Found on the emulator, not in review: a transfer with under a second of data left divides to
     * **0**, and "0 sec left" sat beside a bar at 68%. The formatter still formats zero honestly;
     * it is the caller that suppresses it, so this asserts the boundary the caller uses.
     */
    @Test
    fun `an eta of zero is not shown`() {
        val almostDone = progress("a", total = 1_000_000, done = 999_000, rate = 1_400_000)
        val row = TransferFeed.rows(listOf(almostDone), emptyList()).single()
        assertEquals(0L, row.etaSeconds)
        assertTrue("a zero eta must be suppressed", (row.etaSeconds ?: 0L) <= 0L)
    }

    @Test
    fun `eta reads in the largest useful unit and never says zero minutes`() {
        assertEquals("45 sec", formatEta(45))
        assertEquals("1 min", formatEta(60))
        assertEquals("2 min", formatEta(150))
        assertEquals("1 hr 5 min", formatEta(3_900))
    }

    @Test
    fun `bytes are decimal, like every file manager on both platforms`() {
        assertEquals("512 B", formatBytes(512))
        assertEquals("1.0 KB", formatBytes(1_000))
        assertEquals("12.4 MB", formatBytes(12_400_000))
        assertEquals("1.50 GB", formatBytes(1_500_000_000))
    }
}
