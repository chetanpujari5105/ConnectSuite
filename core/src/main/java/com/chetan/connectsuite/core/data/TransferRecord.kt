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
