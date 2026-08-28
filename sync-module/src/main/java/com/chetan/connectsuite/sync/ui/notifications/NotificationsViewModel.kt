package com.chetan.connectsuite.sync.ui.notifications

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chetan.connectsuite.core.data.MirroredNotificationEntity
import com.chetan.connectsuite.core.data.SettingsStore
import com.chetan.connectsuite.core.permissions.SpecialAccess
import com.chetan.connectsuite.sync.notifications.MirroredNotificationRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class NotificationsUiState(
    val notifications: List<MirroredNotificationEntity> = emptyList(),
    val listenerEnabled: Boolean = false,
    val mirroringEnabled: Boolean = true,
    val notificationMirroringEnabled: Boolean = true,
)

class NotificationsViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = MirroredNotificationRepository.get(application)
    private val settings = SettingsStore.get(application)

    /** Re-read on resume, since notification access is granted outside the app. */
    private val listenerEnabled = MutableStateFlow(
        SpecialAccess.isNotificationListenerEnabled(application),
    )

    val uiState: StateFlow<NotificationsUiState> = combine(
        repository.activeNotifications,
        listenerEnabled,
        settings.mirroringEnabled,
        settings.notificationMirroringEnabled,
    ) { notifications, listener, master, notificationsOn ->
        NotificationsUiState(
            notifications = notifications,
            listenerEnabled = listener,
            mirroringEnabled = master,
            notificationMirroringEnabled = notificationsOn,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), NotificationsUiState())

    init {
        repository.start()
    }

    fun refreshListenerState() {
        listenerEnabled.value = SpecialAccess.isNotificationListenerEnabled(getApplication())
    }

    fun dismiss(notification: MirroredNotificationEntity) = repository.dismiss(notification)
}
