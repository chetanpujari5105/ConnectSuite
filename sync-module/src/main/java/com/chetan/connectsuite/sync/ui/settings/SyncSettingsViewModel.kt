package com.chetan.connectsuite.sync.ui.settings

import android.app.Application
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.SettingsStore
import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class AppEntry(
    val packageName: String,
    val label: String,
    val excluded: Boolean,
)

data class SyncSettingsUiState(
    val mirroringEnabled: Boolean = true,
    val notificationMirroringEnabled: Boolean = true,
    val smsMirroringEnabled: Boolean = false,
    val includeLowPriority: Boolean = false,
    val showReceivedAsNotifications: Boolean = true,
    val pairedDevices: List<TrustedDeviceEntity> = emptyList(),
    val apps: List<AppEntry> = emptyList(),
    val appsLoading: Boolean = true,
)

class SyncSettingsViewModel(application: Application) : AndroidViewModel(application) {

    private val settings = SettingsStore.get(application)
    private val trustedDao = ConnectSuiteDatabase.get(application).trustedDeviceDao()

    private val installedApps = MutableStateFlow<List<Pair<String, String>>?>(null)

    val uiState: StateFlow<SyncSettingsUiState> = combine(
        combine(
            settings.mirroringEnabled,
            settings.notificationMirroringEnabled,
            settings.smsMirroringEnabled,
            settings.includeLowPriority,
            settings.showReceivedAsNotifications,
        ) { master, notifications, sms, lowPriority, showReceived ->
            listOf(master, notifications, sms, lowPriority, showReceived)
        },
        settings.excludedPackages,
        trustedDao.observeAll(),
        installedApps,
    ) { toggles, excluded, devices, apps ->
        SyncSettingsUiState(
            mirroringEnabled = toggles[0],
            notificationMirroringEnabled = toggles[1],
            smsMirroringEnabled = toggles[2],
            includeLowPriority = toggles[3],
            showReceivedAsNotifications = toggles[4],
            pairedDevices = devices,
            apps = apps.orEmpty().map { (packageName, label) ->
                AppEntry(packageName, label, packageName in excluded)
            },
            appsLoading = apps == null,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SyncSettingsUiState())

    init {
        loadInstalledApps()
    }

    /** Loading and sorting the launcher-app list is slow enough to keep off the main thread. */
    private fun loadInstalledApps() {
        viewModelScope.launch {
            val packageManager = getApplication<Application>().packageManager
            val apps = withContext(Dispatchers.IO) {
                val installed = if (android.os.Build.VERSION.SDK_INT >= 33) {
                    packageManager.getInstalledApplications(
                        PackageManager.ApplicationInfoFlags.of(0),
                    )
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getInstalledApplications(0)
                }
                installed
                    // System apps without a launcher entry never post notifications the user
                    // recognises, so listing them just makes the screen harder to scan.
                    .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 ||
                        packageManager.getLaunchIntentForPackage(it.packageName) != null }
                    .map { it.packageName to packageManager.getApplicationLabel(it).toString() }
                    .sortedBy { it.second.lowercase() }
            }
            installedApps.value = apps
        }
    }

    fun setMirroringEnabled(enabled: Boolean) {
        viewModelScope.launch { settings.setMirroringEnabled(enabled) }
    }

    fun setNotificationMirroring(enabled: Boolean) {
        viewModelScope.launch { settings.setNotificationMirroring(enabled) }
    }

    fun setSmsMirroring(enabled: Boolean) {
        viewModelScope.launch { settings.setSmsMirroring(enabled) }
    }

    fun setIncludeLowPriority(enabled: Boolean) {
        viewModelScope.launch { settings.setIncludeLowPriority(enabled) }
    }

    fun setShowReceivedAsNotifications(enabled: Boolean) {
        viewModelScope.launch { settings.setShowReceivedAsNotifications(enabled) }
    }

    fun setAppExcluded(packageName: String, excluded: Boolean) {
        viewModelScope.launch { settings.setPackageExcluded(packageName, excluded) }
    }

    fun setDeviceNotificationMirroring(deviceId: String, enabled: Boolean) {
        viewModelScope.launch { trustedDao.setNotificationMirroring(deviceId, enabled) }
    }

    fun setDeviceSmsMirroring(deviceId: String, enabled: Boolean) {
        viewModelScope.launch { trustedDao.setSmsMirroring(deviceId, enabled) }
    }
}
