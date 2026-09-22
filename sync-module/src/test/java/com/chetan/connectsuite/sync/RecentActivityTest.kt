package com.chetan.connectsuite.sync

import com.chetan.connectsuite.core.data.MirroredNotificationEntity
import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.sync.ui.devices.ActivityKind
import com.chetan.connectsuite.sync.ui.devices.RecentActivity
import com.chetan.connectsuite.sync.v2.ClipFeature
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Recent activity projection.
 *
 * The first test is the one this class exists for. `CLAUDE.md` records the Mac's Overview pane
 * drawing the five **oldest** events — a defect nothing in the build could notice, because four
 * plausible rows in the wrong order look exactly like four plausible rows in the right one. The
 * mutation that reintroduces it is one word (`sortedByDescending` → `sortedBy`) and this file goes
 * red on it.
 */
class RecentActivityTest {

    private val t0 = 1_700_000_000_000L
    private val minute = 60_000L

    private fun transfer(
        id: String,
        atMillis: Long,
        direction: TransferDirection = TransferDirection.OUTGOING,
        name: String = "IMG_3928.MP4",
        bytes: Long = 12_400_000,
    ) = TransferEntity(
        transferId = id,
        jobId = "job-$id",
        peerDeviceId = "mac-1",
        direction = direction,
        fileName = name,
        relativePath = name,
        mimeType = "video/mp4",
        totalBytes = bytes,
        bytesTransferred = bytes,
        status = TransferStatus.COMPLETED,
        checksum = null,
        localUri = null,
        startedAtMillis = atMillis - minute,
        updatedAtMillis = atMillis,
    )

    private fun notification(id: String, atMillis: Long, app: String) = MirroredNotificationEntity(
        id = id,
        peerDeviceId = "mac-1",
        remoteKey = id,
        packageName = "com.example.$app",
        appName = app,
        title = "Title",
        text = "Text",
        postedAtMillis = atMillis,
        receivedAtMillis = atMillis,
    )

    @Test
    fun `newest first`() {
        val result = RecentActivity.of(
            transfers = listOf(
                transfer("old", t0 - 60 * minute),
                transfer("newest", t0 - 2 * minute),
                transfer("middle", t0 - 18 * minute),
            ),
            notifications = emptyList(),
            clip = ClipFeature.PhoneState(),
        )

        assertEquals(
            listOf("transfer:newest", "transfer:middle", "transfer:old"),
            result.map { it.id },
        )
    }

    /**
     * The limit has to take the newest [n], not the first [n] of an unsorted list — a `take` before
     * a `sort` passes the ordering test above and still shows the wrong four rows.
     */
    @Test
    fun `the limit keeps the newest, not the first encountered`() {
        val transfers = (1..10).map { transfer("t$it", t0 - it * minute) }.reversed()
        val result = RecentActivity.of(transfers, emptyList(), ClipFeature.PhoneState(), limit = 3)

        assertEquals(3, result.size)
        assertEquals(listOf("transfer:t1", "transfer:t2", "transfer:t3"), result.map { it.id })
    }

    @Test
    fun `all three sources reach the list and keep their kinds`() {
        val result = RecentActivity.of(
            transfers = listOf(transfer("in", t0 - 30 * minute, TransferDirection.INCOMING)),
            notifications = listOf(notification("n1", t0 - 12 * minute, "WhatsApp")),
            clip = ClipFeature.PhoneState(
                lastSentPreview = "https://openai.com",
                lastSentAtMs = t0 - 2 * minute,
            ),
            limit = 10,
        )

        assertEquals(
            listOf(ActivityKind.ClipSent, ActivityKind.Notifications, ActivityKind.TransferIn),
            result.map { it.kind },
        )
    }

    /**
     * Notifications collapse to one row carrying the count. Four separate rows all reading
     * "notification mirrored" would evict the other two kinds entirely on a busy phone.
     */
    @Test
    fun `notifications collapse into one counted row at the newest timestamp`() {
        val result = RecentActivity.of(
            transfers = emptyList(),
            notifications = listOf(
                notification("a", t0 - 40 * minute, "WhatsApp"),
                notification("b", t0 - 12 * minute, "LinkedIn"),
                notification("c", t0 - 30 * minute, "WhatsApp"),
            ),
            clip = ClipFeature.PhoneState(),
        )

        assertEquals(1, result.size)
        assertEquals("3 notifications mirrored", result[0].title)
        assertEquals(t0 - 12 * minute, result[0].atMillis)
        // Distinct app names, so one chatty app does not fill the subtitle with itself.
        assertEquals("WhatsApp · LinkedIn", result[0].subtitle)
    }

    @Test
    fun `one notification is singular`() {
        val result = RecentActivity.of(
            emptyList(),
            listOf(notification("a", t0, "Gmail")),
            ClipFeature.PhoneState(),
        )
        assertEquals("1 notification mirrored", result[0].title)
    }

    /**
     * A clipboard entry that has never happened has a zero timestamp, and a zero timestamp is not
     * "1970" — it is *absent*. Rendering it would put a 55-year-old row at the bottom of every list.
     */
    @Test
    fun `an unset clipboard timestamp produces no row`() {
        val result = RecentActivity.of(emptyList(), emptyList(), ClipFeature.PhoneState())
        assertTrue(result.isEmpty())
    }

    @Test
    fun `direction decides the wording and the kind`() {
        val out = RecentActivity.of(
            listOf(transfer("o", t0, TransferDirection.OUTGOING)),
            emptyList(),
            ClipFeature.PhoneState(),
        ).single()
        val incoming = RecentActivity.of(
            listOf(transfer("i", t0, TransferDirection.INCOMING)),
            emptyList(),
            ClipFeature.PhoneState(),
        ).single()

        assertEquals(ActivityKind.TransferOut, out.kind)
        assertEquals("Sent to your Mac", out.title)
        assertEquals(ActivityKind.TransferIn, incoming.kind)
        assertEquals("Received from your Mac", incoming.title)
    }

    @Test
    fun `bytes are formatted in the decimal units a file manager shows`() {
        assertEquals("512 B", RecentActivity.formatBytes(512))
        assertEquals("1.0 KB", RecentActivity.formatBytes(1_000))
        assertEquals("12.4 MB", RecentActivity.formatBytes(12_400_000))
        assertEquals("1.50 GB", RecentActivity.formatBytes(1_500_000_000))
    }
}
