package com.chetan.connectsuite.core.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

enum class TransferDirection { INCOMING, OUTGOING }

enum class TransferStatus { PENDING, RUNNING, PAUSED, COMPLETED, FAILED, CANCELLED }

/**
 * One file inside a transfer job. Rows survive process death, which is what makes
 * resume-after-drop possible: [bytesTransferred] is the byte offset to restart from.
 */
@Entity(tableName = "transfers")
data class TransferEntity(
    @PrimaryKey val transferId: String,
    val jobId: String,
    val peerDeviceId: String,
    val direction: TransferDirection,
    val fileName: String,
    val relativePath: String,
    val mimeType: String,
    val totalBytes: Long,
    val bytesTransferred: Long,
    val status: TransferStatus,
    val checksum: String?,
    /** Content URI (outgoing) or absolute path of the partial file (incoming). */
    val localUri: String?,
    val startedAtMillis: Long,
    val updatedAtMillis: Long,
    val errorMessage: String? = null,
)

@Dao
interface TransferDao {

    @Query("SELECT * FROM transfers ORDER BY updatedAtMillis DESC LIMIT 200")
    fun observeRecent(): Flow<List<TransferEntity>>

    @Query("SELECT * FROM transfers WHERE status IN ('RUNNING', 'PENDING', 'PAUSED') ORDER BY startedAtMillis")
    fun observeActive(): Flow<List<TransferEntity>>

    @Query("SELECT * FROM transfers WHERE transferId = :transferId")
    suspend fun find(transferId: String): TransferEntity?

    @Query("SELECT * FROM transfers WHERE peerDeviceId = :peerDeviceId AND status = 'PAUSED'")
    suspend fun resumable(peerDeviceId: String): List<TransferEntity>

    /**
     * The most recent incoming record for one destination, for resuming an `fs.*` push.
     *
     * **Looked up by where the file is going, not by `transferId`**, because a retry after a dropped
     * socket is a *new* transfer with a new id arriving at the same place. Without this the record
     * could never be found again and every interruption would restart from zero — which would look
     * like resume being unimplemented rather than unfindable.
     *
     * This is the row `docs/protocol.md` means by *"anything that decides to append consults the
     * transfer record, not the filename"*. A `.part` with no row here is a stranger's file.
     */
    @Query(
        "SELECT * FROM transfers WHERE relativePath = :relativePath AND fileName = :fileName " +
            "AND direction = 'INCOMING' ORDER BY updatedAtMillis DESC LIMIT 1",
    )
    suspend fun findIncomingAt(relativePath: String, fileName: String): TransferEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(transfer: TransferEntity)

    @Query("UPDATE transfers SET bytesTransferred = :bytes, updatedAtMillis = :now WHERE transferId = :transferId")
    suspend fun updateProgress(transferId: String, bytes: Long, now: Long)

    @Query("UPDATE transfers SET status = :status, errorMessage = :error, updatedAtMillis = :now WHERE transferId = :transferId")
    suspend fun updateStatus(transferId: String, status: TransferStatus, error: String?, now: Long)

    @Query("UPDATE transfers SET status = 'PAUSED', updatedAtMillis = :now WHERE status = 'RUNNING'")
    suspend fun pauseAllRunning(now: Long)

    @Query("DELETE FROM transfers WHERE status IN ('COMPLETED', 'CANCELLED') AND updatedAtMillis < :before")
    suspend fun pruneOlderThan(before: Long)
}
