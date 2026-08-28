package com.chetan.connectsuite.core.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** A notification received *from* a paired device and shown in this device's mirror feed. */
@Entity(tableName = "mirrored_notifications")
data class MirroredNotificationEntity(
    /** Stable across updates of the same notification: "<peerDeviceId>:<remote key>". */
    @PrimaryKey val id: String,
    val peerDeviceId: String,
    val remoteKey: String,
    val packageName: String,
    val appName: String,
    val title: String,
    val text: String,
    val postedAtMillis: Long,
    val receivedAtMillis: Long,
    val isDismissed: Boolean = false,
    val isClearable: Boolean = true,
    /** Base64 PNG of the small icon, downscaled before it goes over the wire. */
    val iconBase64: String? = null,
)

@Dao
interface MirroredNotificationDao {

    @Query("SELECT * FROM mirrored_notifications WHERE isDismissed = 0 ORDER BY postedAtMillis DESC")
    fun observeActive(): Flow<List<MirroredNotificationEntity>>

    @Query("SELECT * FROM mirrored_notifications ORDER BY postedAtMillis DESC LIMIT 300")
    fun observeAll(): Flow<List<MirroredNotificationEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(notification: MirroredNotificationEntity)

    @Query("UPDATE mirrored_notifications SET isDismissed = 1 WHERE id = :id")
    suspend fun markDismissed(id: String)

    @Query("DELETE FROM mirrored_notifications WHERE peerDeviceId = :peerDeviceId")
    suspend fun clearForPeer(peerDeviceId: String)

    @Query("DELETE FROM mirrored_notifications WHERE postedAtMillis < :before")
    suspend fun pruneOlderThan(before: Long)
}
