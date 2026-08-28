package com.chetan.connectsuite.sync.transfer

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.core.protocol.ChunkSizes
import com.chetan.connectsuite.core.protocol.NetworkPacket
import com.chetan.connectsuite.core.protocol.PacketType
import com.chetan.connectsuite.core.protocol.TransferFileMeta
import com.chetan.connectsuite.core.protocol.TransferOffer
import com.chetan.connectsuite.core.protocol.TransferProtocol
import com.chetan.connectsuite.core.protocol.TransferResponse
import com.chetan.connectsuite.core.transport.ConnectionManager
import com.chetan.connectsuite.core.transport.DeviceConnection
import com.chetan.connectsuite.core.transport.RoutedPacket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/** Live progress for one file, kept in memory so the UI can show speed without hitting Room. */
data class TransferProgress(
    val transferId: String,
    val jobId: String,
    val peerDeviceId: String,
    val fileName: String,
    val direction: TransferDirection,
    val totalBytes: Long,
    val bytesTransferred: Long,
    val status: TransferStatus,
    val bytesPerSecond: Long = 0,
    val error: String? = null,
) {
    val fraction: Float
        get() = if (totalBytes <= 0) 0f else (bytesTransferred.toFloat() / totalBytes).coerceIn(0f, 1f)

    /** Seconds remaining, or null while there is not enough throughput data to say. */
    val etaSeconds: Long?
        get() = if (bytesPerSecond <= 0) null else (totalBytes - bytesTransferred) / bytesPerSecond
}

/** An offer waiting on the user's accept/decline. */
data class PendingIncomingOffer(
    val offer: TransferOffer,
    val peerDeviceId: String,
    val peerName: String,
)

sealed interface TransferEvent {
    data class OfferReceived(val offer: PendingIncomingOffer) : TransferEvent
    data class JobCompleted(val jobId: String, val fileCount: Int) : TransferEvent
    data class JobFailed(val jobId: String, val reason: String) : TransferEvent
    data class FileSaved(val fileName: String, val uri: Uri?) : TransferEvent
}

/**
 * Chunked file transfer over the paired connection.
 *
 * Both ends run the same manager; direction is decided per job. Sending is a straightforward
 * read-chunk / send-chunk loop with the chunk size adapting to observed throughput, and every
 * chunk carries its absolute offset — which is what lets an interrupted transfer resume from the
 * partial file rather than starting over.
 */
class TransferManager private constructor(private val appContext: Context) {

    private val connections = ConnectionManager.get(appContext)
    private val database = ConnectSuiteDatabase.get(appContext)
    private val transferDao = database.transferDao()
    private val trustedDao = database.trustedDeviceDao()
    private val fileStore = ReceivedFileStore(appContext)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var collectJob: Job? = null

    /** Jobs currently sending, so they can be cancelled. */
    private val sendJobs = ConcurrentHashMap<String, Job>()

    /** Receiving state, keyed by transferId. */
    private val receiving = ConcurrentHashMap<String, ReceivingFile>()

    /** Accepted jobs on the receiving end, keyed by jobId. */
    private val acceptedJobs = ConcurrentHashMap<String, TransferOffer>()

    private val _progress = MutableStateFlow<Map<String, TransferProgress>>(emptyMap())
    val progress: StateFlow<Map<String, TransferProgress>> = _progress.asStateFlow()

    private val _pendingOffers = MutableStateFlow<List<PendingIncomingOffer>>(emptyList())
    val pendingOffers: StateFlow<List<PendingIncomingOffer>> = _pendingOffers.asStateFlow()

    private val _events = MutableSharedFlow<TransferEvent>(replay = 0, extraBufferCapacity = 32)
    val events: SharedFlow<TransferEvent> = _events.asSharedFlow()

    val history: Flow<List<TransferEntity>> = transferDao.observeRecent()

    fun start() {
        if (collectJob?.isActive == true) return
        collectJob = scope.launch {
            // Anything left RUNNING is from a previous process that died mid-transfer.
            transferDao.pauseAllRunning(System.currentTimeMillis())
            fileStore.pruneStalePartials(PARTIAL_TTL_MS)
            connections.packets.collect(::onPacket)
        }
    }

    fun stop() {
        collectJob?.cancel()
        collectJob = null
        sendJobs.values.forEach(Job::cancel)
        sendJobs.clear()
        receiving.values.forEach { it.close() }
        receiving.clear()
    }

    // ---------------------------------------------------------------- sending

    /**
     * Offers [uris] to [deviceId]. Returns the job id, or null if the device is not connected.
     *
     * [relativePaths] preserves folder structure when the user picked a directory; pass null for
     * a flat selection.
     */
    suspend fun send(
        deviceId: String,
        uris: List<Uri>,
        relativePaths: Map<Uri, String>? = null,
    ): String? {
        val connection = connections.connectionTo(deviceId) ?: return null
        if (uris.isEmpty()) return null

        val jobId = UUID.randomUUID().toString()
        val files = uris.mapNotNull { uri ->
            val meta = readMetadata(uri) ?: return@mapNotNull null
            uri to TransferFileMeta(
                transferId = UUID.randomUUID().toString(),
                name = meta.name,
                relativePath = relativePaths?.get(uri).orEmpty(),
                size = meta.size,
                mimeType = meta.mimeType,
            )
        }
        if (files.isEmpty()) return null

        val offer = TransferOffer(
            jobId = jobId,
            files = files.map { it.second },
            totalBytes = files.sumOf { it.second.size },
            senderName = connections.localIdentity().deviceName,
        )

        files.forEach { (uri, meta) ->
            transferDao.upsert(
                TransferEntity(
                    transferId = meta.transferId,
                    jobId = jobId,
                    peerDeviceId = deviceId,
                    direction = TransferDirection.OUTGOING,
                    fileName = meta.name,
                    relativePath = meta.relativePath,
                    mimeType = meta.mimeType,
                    totalBytes = meta.size,
                    bytesTransferred = 0,
                    status = TransferStatus.PENDING,
                    checksum = null,
                    localUri = uri.toString(),
                    startedAtMillis = System.currentTimeMillis(),
                    updatedAtMillis = System.currentTimeMillis(),
                ),
            )
            publishProgress(meta.transferId, jobId, deviceId, meta.name,
                TransferDirection.OUTGOING, meta.size, 0, TransferStatus.PENDING)
        }

        pendingOutgoing[jobId] = files.toMap()
        connection.send(TransferProtocol.offerPacket(offer))
        return jobId
    }

    /** Outgoing jobs waiting for the peer's accept, keyed by jobId. */
    private val pendingOutgoing = ConcurrentHashMap<String, Map<Uri, TransferFileMeta>>()

    private fun startSending(
        connection: DeviceConnection,
        response: TransferResponse,
    ) {
        val files = pendingOutgoing.remove(response.jobId) ?: return
        if (!response.accepted) {
            scope.launch {
                files.values.forEach { meta ->
                    failTransfer(meta.transferId, response.reason.ifBlank { "Declined by the other device" })
                }
                _events.emit(
                    TransferEvent.JobFailed(
                        response.jobId,
                        response.reason.ifBlank { "The other device declined the transfer" },
                    ),
                )
            }
            return
        }

        sendJobs[response.jobId] = scope.launch {
            var sentFiles = 0
            try {
                for ((uri, meta) in files) {
                    val startOffset = response.resumeOffsets[meta.transferId] ?: 0L
                    sendOneFile(connection, response.jobId, uri, meta, startOffset)
                    sentFiles++
                }
                connection.send(
                    NetworkPacket.of(PacketType.TRANSFER_JOB_DONE) {
                        put("jobId", JsonPrimitive(response.jobId))
                    },
                )
                _events.emit(TransferEvent.JobCompleted(response.jobId, sentFiles))
            } catch (e: Exception) {
                Log.w(TAG, "Send job ${response.jobId} stopped", e)
                _events.emit(
                    TransferEvent.JobFailed(response.jobId, e.message ?: "Transfer interrupted"),
                )
            } finally {
                sendJobs.remove(response.jobId)
            }
        }
    }

    private suspend fun sendOneFile(
        connection: DeviceConnection,
        jobId: String,
        uri: Uri,
        meta: TransferFileMeta,
        startOffset: Long,
    ) = withContext(Dispatchers.IO) {
        val deviceId = connection.deviceId
        transferDao.updateStatus(meta.transferId, TransferStatus.RUNNING, null, now())

        val digest = MessageDigest.getInstance("SHA-256")
        var offset = startOffset
        var chunkSize = ChunkSizes.DEFAULT
        val meter = ThroughputMeter()

        appContext.contentResolver.openInputStream(uri)?.use { input ->
            if (startOffset > 0) {
                // Resuming: the receiver already hashed the earlier bytes, so hash them here too
                // or the final checksum will not match.
                var remaining = startOffset
                val skipBuffer = ByteArray(ChunkSizes.MAX)
                while (remaining > 0) {
                    val read = input.read(skipBuffer, 0, min(remaining, skipBuffer.size.toLong()).toInt())
                    if (read <= 0) break
                    digest.update(skipBuffer, 0, read)
                    remaining -= read
                }
            }

            val buffer = ByteArray(ChunkSizes.MAX)
            while (true) {
                val read = input.read(buffer, 0, chunkSize)
                if (read <= 0) break

                val chunk = buffer.copyOf(read)
                digest.update(chunk)

                val sent = connection.send(
                    NetworkPacket.of(PacketType.TRANSFER_CHUNK, payloadSize = read) {
                        put("transferId", JsonPrimitive(meta.transferId))
                        put("jobId", JsonPrimitive(jobId))
                        put("offset", JsonPrimitive(offset))
                    },
                    chunk,
                )
                if (!sent) {
                    // Connection dropped: keep the row PAUSED so it can resume on reconnect.
                    transferDao.updateProgress(meta.transferId, offset, now())
                    transferDao.updateStatus(
                        meta.transferId,
                        TransferStatus.PAUSED,
                        "Connection lost",
                        now(),
                    )
                    publishProgress(
                        meta.transferId, jobId, deviceId, meta.name, TransferDirection.OUTGOING,
                        meta.size, offset, TransferStatus.PAUSED, error = "Connection lost",
                    )
                    throw java.io.IOException("Connection lost while sending ${meta.name}")
                }

                offset += read
                val rate = meter.record(read.toLong())
                chunkSize = adaptChunkSize(chunkSize, rate)

                if (meter.shouldReport()) {
                    transferDao.updateProgress(meta.transferId, offset, now())
                    publishProgress(
                        meta.transferId, jobId, deviceId, meta.name, TransferDirection.OUTGOING,
                        meta.size, offset, TransferStatus.RUNNING, rate,
                    )
                }
            }
        } ?: throw java.io.IOException("Could not open ${meta.name}")

        val checksum = digest.digest().toHex()
        connection.send(
            NetworkPacket.of(PacketType.TRANSFER_FILE_DONE) {
                put("transferId", JsonPrimitive(meta.transferId))
                put("jobId", JsonPrimitive(jobId))
                put("sha256", JsonPrimitive(checksum))
                put("size", JsonPrimitive(offset))
            },
        )

        transferDao.updateProgress(meta.transferId, offset, now())
        transferDao.updateStatus(meta.transferId, TransferStatus.COMPLETED, null, now())
        publishProgress(
            meta.transferId, jobId, deviceId, meta.name, TransferDirection.OUTGOING,
            meta.size, offset, TransferStatus.COMPLETED,
        )
    }

    /**
     * Grows the chunk towards [ChunkSizes.MAX] on a fast link and shrinks it on a slow one, so a
     * weak Wi-Fi connection is not stuck waiting on 256 KB writes that keep timing out.
     */
    private fun adaptChunkSize(current: Int, bytesPerSecond: Long): Int = when {
        bytesPerSecond <= 0 -> current
        bytesPerSecond > 8_000_000 -> min(ChunkSizes.MAX, current * 2)
        bytesPerSecond < 1_000_000 -> max(ChunkSizes.MIN, current / 2)
        else -> current
    }

    // -------------------------------------------------------------- receiving

    /** Accepts a pending offer, resuming any files we already hold part of. */
    suspend fun acceptOffer(jobId: String) {
        val pending = _pendingOffers.value.firstOrNull { it.offer.jobId == jobId } ?: return
        val connection = connections.connectionTo(pending.peerDeviceId) ?: return

        val resumeOffsets = pending.offer.files.associate { meta ->
            meta.transferId to fileStore.partialBytes(meta.transferId)
        }.filterValues { it > 0 }

        pending.offer.files.forEach { meta ->
            val already = resumeOffsets[meta.transferId] ?: 0L
            transferDao.upsert(
                TransferEntity(
                    transferId = meta.transferId,
                    jobId = jobId,
                    peerDeviceId = pending.peerDeviceId,
                    direction = TransferDirection.INCOMING,
                    fileName = meta.name,
                    relativePath = meta.relativePath,
                    mimeType = meta.mimeType,
                    totalBytes = meta.size,
                    bytesTransferred = already,
                    status = TransferStatus.RUNNING,
                    checksum = meta.sha256.ifBlank { null },
                    localUri = fileStore.partialFileFor(meta.transferId).absolutePath,
                    startedAtMillis = System.currentTimeMillis(),
                    updatedAtMillis = System.currentTimeMillis(),
                ),
            )
            publishProgress(
                meta.transferId, jobId, pending.peerDeviceId, meta.name,
                TransferDirection.INCOMING, meta.size, already, TransferStatus.RUNNING,
            )
        }

        acceptedJobs[jobId] = pending.offer
        _pendingOffers.update { list -> list.filterNot { it.offer.jobId == jobId } }

        connection.send(
            TransferProtocol.responsePacket(
                TransferResponse(jobId = jobId, accepted = true, resumeOffsets = resumeOffsets),
            ),
        )
    }

    suspend fun declineOffer(jobId: String, reason: String = "Declined") {
        val pending = _pendingOffers.value.firstOrNull { it.offer.jobId == jobId } ?: return
        _pendingOffers.update { list -> list.filterNot { it.offer.jobId == jobId } }
        connections.connectionTo(pending.peerDeviceId)?.send(
            TransferProtocol.responsePacket(
                TransferResponse(jobId = jobId, accepted = false, reason = reason),
            ),
        )
    }

    /** Re-offers every paused transfer to a peer that just came back. */
    suspend fun resumePausedTransfers(deviceId: String) {
        val paused = transferDao.resumable(deviceId)
            .filter { it.direction == TransferDirection.OUTGOING }
        if (paused.isEmpty()) return

        val byJob = paused.groupBy { it.jobId }
        byJob.forEach { (_, entities) ->
            val uris = entities.mapNotNull { it.localUri?.let(Uri::parse) }
            if (uris.isNotEmpty()) send(deviceId, uris)
        }
    }

    fun cancel(jobId: String) {
        sendJobs.remove(jobId)?.cancel()
        pendingOutgoing.remove(jobId)
        acceptedJobs.remove(jobId)
        scope.launch {
            val peer = _progress.value.values.firstOrNull { it.jobId == jobId }?.peerDeviceId
            peer?.let {
                connections.connectionTo(it)?.send(
                    NetworkPacket.of(PacketType.TRANSFER_CANCEL) {
                        put("jobId", JsonPrimitive(jobId))
                    },
                )
            }
            _progress.value.values.filter { it.jobId == jobId }.forEach {
                transferDao.updateStatus(it.transferId, TransferStatus.CANCELLED, null, now())
                receiving.remove(it.transferId)?.close()
            }
            _progress.update { current -> current.filterValues { it.jobId != jobId } }
        }
    }

    private suspend fun onPacket(routed: RoutedPacket) {
        val packet = routed.incoming.packet
        when (packet.type) {
            PacketType.TRANSFER_OFFER -> onOffer(routed)
            PacketType.TRANSFER_RESPONSE ->
                TransferProtocol.parseResponse(packet)?.let { startSending(routed.connection, it) }
            PacketType.TRANSFER_CHUNK -> onChunk(routed)
            PacketType.TRANSFER_FILE_DONE -> onFileDone(routed)
            PacketType.TRANSFER_JOB_DONE -> onJobDone(routed)
            PacketType.TRANSFER_CANCEL -> packet.string("jobId")?.let(::cancel)
            PacketType.TRANSFER_ERROR -> {
                val transferId = packet.string("transferId") ?: return
                failTransfer(transferId, packet.string("message") ?: "Remote error")
            }
        }
    }

    private suspend fun onOffer(routed: RoutedPacket) {
        val offer = TransferProtocol.parseOffer(routed.incoming.packet) ?: return
        val deviceId = routed.connection.deviceId

        val trusted = trustedDao.find(deviceId)
        if (trusted?.fileTransferEnabled != true) {
            routed.connection.send(
                TransferProtocol.responsePacket(
                    TransferResponse(
                        jobId = offer.jobId,
                        accepted = false,
                        reason = "File transfer is turned off for this device",
                    ),
                ),
            )
            return
        }

        val pending = PendingIncomingOffer(
            offer = offer,
            peerDeviceId = deviceId,
            peerName = routed.connection.peerIdentity.deviceName,
        )
        _pendingOffers.update { it + pending }
        _events.emit(TransferEvent.OfferReceived(pending))
    }

    private suspend fun onChunk(routed: RoutedPacket) {
        val packet = routed.incoming.packet
        val payload = routed.incoming.payload ?: return
        val transferId = packet.string("transferId") ?: return
        val jobId = packet.string("jobId") ?: return
        val offset = packet.long("offset") ?: return

        val offer = acceptedJobs[jobId] ?: return // Chunk for a job we never accepted.
        val meta = offer.files.firstOrNull { it.transferId == transferId } ?: return

        val state = receiving.getOrPut(transferId) {
            ReceivingFile(fileStore.partialFileFor(transferId))
        }

        try {
            state.writeAt(offset, payload)
        } catch (e: Exception) {
            Log.e(TAG, "Writing chunk for ${meta.name} failed", e)
            failTransfer(transferId, e.message ?: "Could not write file")
            routed.connection.send(
                NetworkPacket.of(PacketType.TRANSFER_ERROR) {
                    put("transferId", JsonPrimitive(transferId))
                    put("message", JsonPrimitive(e.message ?: "Write failed"))
                },
            )
            return
        }

        val written = offset + payload.size
        val rate = state.meter.record(payload.size.toLong())
        if (state.meter.shouldReport()) {
            transferDao.updateProgress(transferId, written, now())
            publishProgress(
                transferId, jobId, routed.connection.deviceId, meta.name,
                TransferDirection.INCOMING, meta.size, written, TransferStatus.RUNNING, rate,
            )
        }
    }

    private suspend fun onFileDone(routed: RoutedPacket) {
        val packet = routed.incoming.packet
        val transferId = packet.string("transferId") ?: return
        val jobId = packet.string("jobId") ?: return
        val expectedChecksum = packet.string("sha256")

        val offer = acceptedJobs[jobId] ?: return
        val meta = offer.files.firstOrNull { it.transferId == transferId } ?: return

        val state = receiving.remove(transferId)
        state?.close()

        val file = fileStore.partialFileFor(transferId)
        val actualChecksum = runCatching { file.sha256() }.getOrNull()

        if (expectedChecksum != null && actualChecksum != null &&
            !expectedChecksum.equals(actualChecksum, ignoreCase = true)
        ) {
            // A corrupt file is worse than a missing one — drop the partial so a retry is clean.
            fileStore.discardPartial(transferId)
            failTransfer(transferId, "Checksum mismatch — the file arrived corrupted")
            return
        }

        val uri = fileStore.publish(
            transferId = transferId,
            displayName = meta.name,
            relativeSubPath = meta.relativePath.substringBeforeLast('/', "")
                .takeIf { it.isNotBlank() && it != meta.name },
        )

        if (uri == null) {
            failTransfer(transferId, "Could not save to Downloads")
            return
        }

        transferDao.updateProgress(transferId, meta.size, now())
        transferDao.updateStatus(transferId, TransferStatus.COMPLETED, null, now())
        publishProgress(
            transferId, jobId, routed.connection.deviceId, meta.name,
            TransferDirection.INCOMING, meta.size, meta.size, TransferStatus.COMPLETED,
        )
        _events.emit(TransferEvent.FileSaved(meta.name, uri))
    }

    private suspend fun onJobDone(routed: RoutedPacket) {
        val jobId = routed.incoming.packet.string("jobId") ?: return
        val offer = acceptedJobs.remove(jobId) ?: return
        _events.emit(TransferEvent.JobCompleted(jobId, offer.files.size))
    }

    private suspend fun failTransfer(transferId: String, reason: String) {
        transferDao.updateStatus(transferId, TransferStatus.FAILED, reason, now())
        receiving.remove(transferId)?.close()
        _progress.update { current ->
            val existing = current[transferId] ?: return@update current
            current + (transferId to existing.copy(status = TransferStatus.FAILED, error = reason))
        }
    }

    private fun publishProgress(
        transferId: String,
        jobId: String,
        peerDeviceId: String,
        fileName: String,
        direction: TransferDirection,
        totalBytes: Long,
        bytesTransferred: Long,
        status: TransferStatus,
        bytesPerSecond: Long = 0,
        error: String? = null,
    ) {
        _progress.update { current ->
            current + (
                transferId to TransferProgress(
                    transferId = transferId,
                    jobId = jobId,
                    peerDeviceId = peerDeviceId,
                    fileName = fileName,
                    direction = direction,
                    totalBytes = totalBytes,
                    bytesTransferred = bytesTransferred,
                    status = status,
                    bytesPerSecond = bytesPerSecond,
                    error = error,
                )
                )
        }
    }

    private data class FileMetadata(val name: String, val size: Long, val mimeType: String)

    private fun readMetadata(uri: Uri): FileMetadata? {
        val resolver = appContext.contentResolver
        val mimeType = resolver.getType(uri) ?: "application/octet-stream"

        resolver.query(uri, null, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            val name = if (nameIndex >= 0) cursor.getString(nameIndex) else null
            val size = if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex) else -1L
            if (name != null && size >= 0) return FileMetadata(name, size, mimeType)
        }

        // Fall back to reading the stream length; some providers report no SIZE column.
        val size = runCatching {
            resolver.openFileDescriptor(uri, "r")?.use { it.statSize }
        }.getOrNull() ?: return null
        val name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
        return FileMetadata(name, size, mimeType)
    }

    private fun now() = System.currentTimeMillis()

    /** Open handle on a partial file, seeking so out-of-order or resumed chunks land correctly. */
    private class ReceivingFile(file: File) {
        private val handle = RandomAccessFile(file, "rw")
        val meter = ThroughputMeter()

        fun writeAt(offset: Long, bytes: ByteArray) {
            handle.seek(offset)
            handle.write(bytes)
        }

        fun close() {
            runCatching { handle.close() }
        }
    }

    companion object {
        private const val TAG = "TransferManager"
        private const val PARTIAL_TTL_MS = 7L * 24 * 60 * 60 * 1000

        @Volatile
        private var instance: TransferManager? = null

        fun get(context: Context): TransferManager =
            instance ?: synchronized(this) {
                instance ?: TransferManager(context.applicationContext).also { instance = it }
            }
    }
}

/** Rolling throughput estimate plus a report throttle, so the UI updates ~5x a second. */
internal class ThroughputMeter {
    private var windowStart = System.nanoTime()
    private var windowBytes = 0L
    private var lastReport = 0L
    private var rate = 0L

    fun record(bytes: Long): Long {
        windowBytes += bytes
        val now = System.nanoTime()
        val elapsedNanos = now - windowStart
        if (elapsedNanos >= RATE_WINDOW_NANOS) {
            rate = (windowBytes * 1_000_000_000.0 / elapsedNanos).roundToLong()
            windowStart = now
            windowBytes = 0
        }
        return rate
    }

    fun shouldReport(): Boolean {
        val now = System.currentTimeMillis()
        if (now - lastReport < REPORT_INTERVAL_MS) return false
        lastReport = now
        return true
    }

    private companion object {
        const val RATE_WINDOW_NANOS = 500_000_000L
        const val REPORT_INTERVAL_MS = 200L
    }
}

internal fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

internal fun File.sha256(): String {
    val digest = MessageDigest.getInstance("SHA-256")
    inputStream().use { input ->
        val buffer = ByteArray(256 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().toHex()
}
