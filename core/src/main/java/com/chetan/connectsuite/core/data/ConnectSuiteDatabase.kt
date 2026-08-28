package com.chetan.connectsuite.core.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.chetan.connectsuite.core.model.DeviceType

class Converters {
    @TypeConverter fun deviceTypeToString(value: DeviceType): String = value.name
    @TypeConverter fun stringToDeviceType(value: String): DeviceType =
        runCatching { DeviceType.valueOf(value) }.getOrDefault(DeviceType.UNKNOWN)

    @TypeConverter fun directionToString(value: TransferDirection): String = value.name
    @TypeConverter fun stringToDirection(value: String): TransferDirection =
        TransferDirection.valueOf(value)

    @TypeConverter fun statusToString(value: TransferStatus): String = value.name
    @TypeConverter fun stringToStatus(value: String): TransferStatus =
        TransferStatus.valueOf(value)
}

@Database(
    entities = [TrustedDeviceEntity::class, TransferEntity::class, MirroredNotificationEntity::class],
    version = 1,
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class ConnectSuiteDatabase : RoomDatabase() {

    abstract fun trustedDeviceDao(): TrustedDeviceDao
    abstract fun transferDao(): TransferDao
    abstract fun notificationDao(): MirroredNotificationDao

    companion object {
        @Volatile
        private var instance: ConnectSuiteDatabase? = null

        fun get(context: Context): ConnectSuiteDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    ConnectSuiteDatabase::class.java,
                    "connectsuite.db",
                ).build().also { instance = it }
            }
    }
}
