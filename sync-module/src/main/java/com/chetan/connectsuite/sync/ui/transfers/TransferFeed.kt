package com.chetan.connectsuite.sync.ui.transfers

import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.sync.transfer.TransferProgress

/** The filter strip. Three segments, and the counts beside them are real. */
enum class TransferFilter { All, Sending, Received }

/**
 * One row of the Transfers list, whether it is live or finished.
 *
 * [fraction] is **nullable and means "a bar is meaningful here"**. A finished transfer does not get
 * a full bar and a failed one does not get a partial one: both are over, and a bar on them invites
 * the reader to watch it. Zero and unknown are different states, which is the same reasoning
 * `SidekickProgress` takes a nullable progress for.
 */
data class TransferRowModel(
    val id: String,
    val jobId: String,
    val fileName: String,
    val totalBytes: Long,
    val direction: TransferDirection,
    val status: TransferStatus,
    val fraction: Float?,
    val etaSeconds: Long?,
    val bytesPerSecond: Long,
    val atMillis: Long?,
    val error: String?,
) {
    val isLive: Boolean get() = status == TransferStatus.RUNNING || status == TransferStatus.PENDING
    val canCancel: Boolean get() = isLive
}

/**
 * Active transfers and history, merged into one list.
 *
 * ### Why this is a function in its own file
 *
 * Because it makes three decisions a screen should not be trusted with, and a test can reach none
 * of them inside a composable — the `showsState` lesson, which this repo has now paid for twice.
 *
 * ### The de-duplication is a real fix, not tidying
 *
 * `TransfersViewModel` puts `RUNNING` **and** `PENDING` rows in `active`, and drops from `history`
 * only those that are `RUNNING` *and* currently in the progress map. A `PENDING` transfer therefore
 * satisfies neither exclusion and appears **twice** — once live, once from Room. Nothing in the old
 * screen noticed, because two identical file names one above the other read as two files.
 */
object TransferFeed {

    fun rows(
        active: List<TransferProgress>,
        history: List<TransferEntity>,
        filter: TransferFilter = TransferFilter.All,
    ): List<TransferRowModel> {
        val live = active.map { it.toRow() }
        val liveIds = live.mapTo(mutableSetOf()) { it.id }
        val past = history.filterNot { it.transferId in liveIds }.map { it.toRow() }

        // Live first, then history newest-first. Live rows have no timestamp of their own and do
        // not need one: "now" is the only answer, and it is the same answer for all of them.
        return (live + past.sortedByDescending { it.atMillis ?: 0L }).filter { it.matches(filter) }
    }

    /**
     * The number beside each segment.
     *
     * Computed over the same merged, de-duplicated list the rows come from, so the chip cannot
     * claim a total the list does not contain. A count and the thing it counts have one source —
     * the denominator rule, applied to a filter strip.
     */
    fun counts(
        active: List<TransferProgress>,
        history: List<TransferEntity>,
    ): Map<TransferFilter, Int> {
        val all = rows(active, history, TransferFilter.All)
        return TransferFilter.entries.associateWith { f -> all.count { it.matches(f) } }
    }

    private fun TransferRowModel.matches(filter: TransferFilter): Boolean = when (filter) {
        TransferFilter.All -> true
        TransferFilter.Sending -> direction == TransferDirection.OUTGOING
        TransferFilter.Received -> direction == TransferDirection.INCOMING
    }

    private fun TransferProgress.toRow() = TransferRowModel(
        id = transferId,
        jobId = jobId,
        fileName = fileName,
        totalBytes = totalBytes,
        direction = direction,
        status = status,
        fraction = fraction,
        etaSeconds = etaSeconds,
        bytesPerSecond = bytesPerSecond,
        atMillis = null,
        error = error,
    )

    private fun TransferEntity.toRow() = TransferRowModel(
        id = transferId,
        jobId = jobId,
        fileName = fileName,
        totalBytes = totalBytes,
        direction = direction,
        status = status,
        // A bar only where one still means something. A paused transfer keeps its bar because it
        // is genuinely half-done and will continue; a finished or abandoned one does not.
        fraction = if (status == TransferStatus.PAUSED && totalBytes > 0) {
            (bytesTransferred.toFloat() / totalBytes).coerceIn(0f, 1f)
        } else {
            null
        },
        etaSeconds = null,
        bytesPerSecond = 0,
        atMillis = updatedAtMillis,
        error = errorMessage,
    )
}
