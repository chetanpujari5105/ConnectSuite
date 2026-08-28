package com.chetan.connectsuite.core.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import com.chetan.connectsuite.core.model.DeviceType
import kotlinx.coroutines.flow.Flow

/** A device the user has explicitly confirmed. Presence of a row *is* the trust decision. */
@Entity(tableName = "trusted_devices")
data class TrustedDeviceEntity(
    @PrimaryKey val deviceId: String,
    val name: String,
    val type: DeviceType,
    /** Base64 DER of the pinned certificate. */
    val certificate: String,
    val fingerprint: String,
    val pairedAtMillis: Long,
    val lastSeenAtMillis: Long,
    /** Last address we successfully reached, used to reconnect without waiting for discovery. */
    val lastAddress: String? = null,
    val lastPort: Int = 0,
    /** Per-device toggles for what this peer is allowed to receive. */
    val notificationMirroringEnabled: Boolean = true,
    val smsMirroringEnabled: Boolean = false,
    val fileTransferEnabled: Boolean = true,
)

@Dao
interface TrustedDeviceDao {

    @Query("SELECT * FROM trusted_devices ORDER BY lastSeenAtMillis DESC")
    fun observeAll(): Flow<List<TrustedDeviceEntity>>

    @Query("SELECT * FROM trusted_devices ORDER BY lastSeenAtMillis DESC")
    suspend fun getAll(): List<TrustedDeviceEntity>

    @Query("SELECT * FROM trusted_devices WHERE deviceId = :deviceId")
    suspend fun find(deviceId: String): TrustedDeviceEntity?

    @Query("SELECT * FROM trusted_devices WHERE deviceId = :deviceId")
    fun observe(deviceId: String): Flow<TrustedDeviceEntity?>

    @Query("SELECT fingerprint FROM trusted_devices WHERE deviceId = :deviceId")
    suspend fun fingerprintOf(deviceId: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(device: TrustedDeviceEntity)

    @Query("DELETE FROM trusted_devices WHERE deviceId = :deviceId")
    suspend fun forget(deviceId: String)

    @Query("UPDATE trusted_devices SET lastSeenAtMillis = :seenAt, lastAddress = :address, lastPort = :port WHERE deviceId = :deviceId")
    suspend fun touch(deviceId: String, seenAt: Long, address: String?, port: Int)

    @Query("UPDATE trusted_devices SET notificationMirroringEnabled = :enabled WHERE deviceId = :deviceId")
    suspend fun setNotificationMirroring(deviceId: String, enabled: Boolean)

    @Query("UPDATE trusted_devices SET smsMirroringEnabled = :enabled WHERE deviceId = :deviceId")
    suspend fun setSmsMirroring(deviceId: String, enabled: Boolean)
}
