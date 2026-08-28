package com.chetan.connectsuite.core.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "connectsuite_settings")

/** User-facing toggles that are not per-device (those live on [TrustedDeviceEntity]). */
class SettingsStore(private val appContext: Context) {

    private object Keys {
        /** Master kill switch: when off, nothing is mirrored to any device. */
        val MIRRORING_ENABLED = booleanPreferencesKey("mirroring_enabled")
        val NOTIFICATION_MIRRORING = booleanPreferencesKey("notification_mirroring")
        val SMS_MIRRORING = booleanPreferencesKey("sms_mirroring")
        val CALL_LOG_MIRRORING = booleanPreferencesKey("call_log_mirroring")

        /** Packages the user has excluded from notification mirroring. */
        val EXCLUDED_PACKAGES = stringSetPreferencesKey("excluded_packages")

        /** Also mirror silent / low-importance notifications. Off by default: it is noisy. */
        val INCLUDE_LOW_PRIORITY = booleanPreferencesKey("include_low_priority")

        /** Show incoming mirrored notifications as real notifications on this device. */
        val SHOW_RECEIVED_AS_NOTIFICATIONS = booleanPreferencesKey("show_received_notifications")

        /** Screen-mirroring defaults, set in the Mirror module's quality selector. */
        val MIRROR_MAX_HEIGHT = intPreferencesKey("mirror_max_height")
        val MIRROR_BITRATE_MBPS = intPreferencesKey("mirror_bitrate_mbps")
        val MIRROR_MAX_FPS = intPreferencesKey("mirror_max_fps")
    }

    val mirroringEnabled: Flow<Boolean> =
        appContext.dataStore.data.map { it[Keys.MIRRORING_ENABLED] ?: true }

    val notificationMirroringEnabled: Flow<Boolean> =
        appContext.dataStore.data.map { it[Keys.NOTIFICATION_MIRRORING] ?: true }

    /** Off by default — SMS mirroring is opt-in, not something that starts silently. */
    val smsMirroringEnabled: Flow<Boolean> =
        appContext.dataStore.data.map { it[Keys.SMS_MIRRORING] ?: false }

    val callLogMirroringEnabled: Flow<Boolean> =
        appContext.dataStore.data.map { it[Keys.CALL_LOG_MIRRORING] ?: false }

    val excludedPackages: Flow<Set<String>> =
        appContext.dataStore.data.map { it[Keys.EXCLUDED_PACKAGES] ?: emptySet() }

    val includeLowPriority: Flow<Boolean> =
        appContext.dataStore.data.map { it[Keys.INCLUDE_LOW_PRIORITY] ?: false }

    val showReceivedAsNotifications: Flow<Boolean> =
        appContext.dataStore.data.map { it[Keys.SHOW_RECEIVED_AS_NOTIFICATIONS] ?: true }

    val mirrorMaxHeight: Flow<Int> =
        appContext.dataStore.data.map { it[Keys.MIRROR_MAX_HEIGHT] ?: 1080 }

    val mirrorBitrateMbps: Flow<Int> =
        appContext.dataStore.data.map { it[Keys.MIRROR_BITRATE_MBPS] ?: 8 }

    val mirrorMaxFps: Flow<Int> =
        appContext.dataStore.data.map { it[Keys.MIRROR_MAX_FPS] ?: 60 }

    suspend fun setMirroringEnabled(enabled: Boolean) = put(Keys.MIRRORING_ENABLED, enabled)
    suspend fun setNotificationMirroring(enabled: Boolean) = put(Keys.NOTIFICATION_MIRRORING, enabled)
    suspend fun setSmsMirroring(enabled: Boolean) = put(Keys.SMS_MIRRORING, enabled)
    suspend fun setCallLogMirroring(enabled: Boolean) = put(Keys.CALL_LOG_MIRRORING, enabled)
    suspend fun setIncludeLowPriority(enabled: Boolean) = put(Keys.INCLUDE_LOW_PRIORITY, enabled)
    suspend fun setShowReceivedAsNotifications(enabled: Boolean) =
        put(Keys.SHOW_RECEIVED_AS_NOTIFICATIONS, enabled)

    suspend fun setMirrorQuality(maxHeight: Int, bitrateMbps: Int, maxFps: Int) {
        appContext.dataStore.edit {
            it[Keys.MIRROR_MAX_HEIGHT] = maxHeight
            it[Keys.MIRROR_BITRATE_MBPS] = bitrateMbps
            it[Keys.MIRROR_MAX_FPS] = maxFps
        }
    }

    suspend fun setPackageExcluded(packageName: String, excluded: Boolean) {
        appContext.dataStore.edit { preferences ->
            val current = preferences[Keys.EXCLUDED_PACKAGES] ?: emptySet()
            preferences[Keys.EXCLUDED_PACKAGES] = if (excluded) {
                current + packageName
            } else {
                current - packageName
            }
        }
    }

    /** Synchronous-ish read for the notification listener, which is not a coroutine context. */
    suspend fun snapshot(): SettingsSnapshot = SettingsSnapshot(
        mirroringEnabled = mirroringEnabled.first(),
        notificationMirroringEnabled = notificationMirroringEnabled.first(),
        smsMirroringEnabled = smsMirroringEnabled.first(),
        callLogMirroringEnabled = callLogMirroringEnabled.first(),
        excludedPackages = excludedPackages.first(),
        includeLowPriority = includeLowPriority.first(),
        showReceivedAsNotifications = showReceivedAsNotifications.first(),
    )

    private suspend fun put(key: androidx.datastore.preferences.core.Preferences.Key<Boolean>, value: Boolean) {
        appContext.dataStore.edit { it[key] = value }
    }

    companion object {
        @Volatile
        private var instance: SettingsStore? = null

        fun get(context: Context): SettingsStore =
            instance ?: synchronized(this) {
                instance ?: SettingsStore(context.applicationContext).also { instance = it }
            }
    }
}

data class SettingsSnapshot(
    val mirroringEnabled: Boolean,
    val notificationMirroringEnabled: Boolean,
    val smsMirroringEnabled: Boolean,
    val callLogMirroringEnabled: Boolean,
    val excludedPackages: Set<String>,
    val includeLowPriority: Boolean,
    val showReceivedAsNotifications: Boolean,
)
