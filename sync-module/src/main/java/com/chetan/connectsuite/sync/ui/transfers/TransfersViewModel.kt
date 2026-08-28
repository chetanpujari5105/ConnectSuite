package com.chetan.connectsuite.sync.ui.transfers

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.sync.transfer.PendingIncomingOffer
import com.chetan.connectsuite.sync.transfer.TransferEvent
import com.chetan.connectsuite.sync.transfer.TransferManager
import com.chetan.connectsuite.sync.transfer.TransferProgress
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class TransfersUiState(
    val active: List<TransferProgress> = emptyList(),
    val history: List<TransferEntity> = emptyList(),
    val pendingOffer: PendingIncomingOffer? = null,
)

class TransfersViewModel(application: Application) : AndroidViewModel(application) {

    private val transfers = TransferManager.get(application)

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    val uiState: StateFlow<TransfersUiState> = combine(
        transfers.progress,
        transfers.history,
        transfers.pendingOffers,
    ) { progress, history, offers ->
        TransfersUiState(
            active = progress.values
                .filter { it.status == TransferStatus.RUNNING || it.status == TransferStatus.PENDING }
                .sortedBy { it.fileName },
            history = history.filterNot { entity ->
                // Anything still moving is already shown in the active list.
                entity.status == TransferStatus.RUNNING && progress.containsKey(entity.transferId)
            },
            pendingOffer = offers.firstOrNull(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TransfersUiState())

    init {
        transfers.start()
        viewModelScope.launch {
            transfers.events.collect { event ->
                _message.value = when (event) {
                    is TransferEvent.FileSaved -> "Saved ${event.fileName} to Downloads/ConnectSuite"
                    is TransferEvent.JobCompleted ->
                        "Transfer complete — ${event.fileCount} file(s)"
                    is TransferEvent.JobFailed -> event.reason
                    is TransferEvent.OfferReceived -> null
                }
            }
        }
    }

    fun consumeMessage() { _message.value = null }

    fun sendFiles(deviceId: String, uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            val jobId = transfers.send(deviceId, uris)
            _message.value = if (jobId == null) {
                "Could not start the transfer — is the device still connected?"
            } else {
                "Waiting for the other device to accept ${uris.size} file(s)"
            }
        }
    }

    fun acceptOffer(jobId: String) {
        viewModelScope.launch { transfers.acceptOffer(jobId) }
    }

    fun declineOffer(jobId: String) {
        viewModelScope.launch { transfers.declineOffer(jobId) }
    }

    fun cancel(jobId: String) = transfers.cancel(jobId)

    fun resumeFor(deviceId: String) {
        viewModelScope.launch { transfers.resumePausedTransfers(deviceId) }
    }
}
