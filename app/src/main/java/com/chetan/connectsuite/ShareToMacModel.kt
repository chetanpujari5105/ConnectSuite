package com.chetan.connectsuite

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.sync.v2.ShareIntake
import com.chetan.connectsuite.sync.v2.ShareNames
import com.chetan.connectsuite.sync.v2.ShareStaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * One share, held across recreation — slice 1 of `docs/phase-7-share-plan.md`.
 *
 * **The URI never leaves this model**, and this model lives exactly as long as the activity that
 * owns the grant (an activity-scoped `ViewModel` survives a rotation and is cleared when the activity
 * finishes). The copy is made while the grant is held; afterwards only the private staged file is
 * touched, and in slice 1 nothing touches that either: there is no offer. Every way out —
 * Cancel, Close, leaving the screen, the activity finishing — deletes the staged copy.
 *
 * ### Recreation
 *
 * On the SM-S938B the grant survived `Activity.recreate()` (My Files' provider, `b3eca15`). That is
 * one reading on one phone, so it is re-checked rather than assumed: a recreated activity re-opens
 * the URI while a copy is running, and if that fails the copy is cancelled and the sheet says so.
 *
 * ### What reaches `link.log`
 *
 * The attempt id, byte counts, the MIME type's top-level type, the outcome and an exception's
 * **class**, with a running `staged / failed` tally. Never the URI, its authority, the display name,
 * the staging path or the contents (proposal §8).
 */
class ShareToMacModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<ShareSheetState>(ShareSheetState.Starting)
    val state: StateFlow<ShareSheetState> = _state.asStateFlow()

    var bound = false
        private set

    private var uri: Uri? = null
    @Volatile private var attemptId: String? = null
    @Volatile private var staged = false
    @Volatile private var accessLost = false
    private val cancelled = AtomicBoolean(false)
    /** Guards the hand-off between the copy finishing and a discard: exactly one of them owns the staged file. */
    private val lock = Any()
    private val app get() = getApplication<Application>()

    fun bind(intent: Intent) {
        bound = true
        val stream = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
            ?: intent.clipData?.takeIf { it.itemCount == 1 }?.getItemAt(0)?.uri
        val clipItems = intent.clipData?.itemCount ?: 0
        val resolverType = stream?.takeIf { it.scheme.equals("content", ignoreCase = true) }?.let { u ->
            runCatching { app.contentResolver.getType(u) }.getOrElse { e ->
                LinkLog.w("share", "getType failed: ${e.javaClass.name} — the intent's type is used instead")
                null
            }
        }
        val mime = ShareNames.mimeOf(resolverType, intent.type)
        val decision = ShareIntake.decide(intent.action, stream?.scheme, clipItems, mime, live.isNotEmpty())
        if (decision is ShareIntake.Decision.Refuse) {
            LinkLog.i("share", "refused: ${decision.reason} (clipItems=$clipItems, type=${topLevel(mime)})")
            _state.value = ShareSheetState.Refused(decision.reason)
            return
        }
        val source = stream!!
        uri = source
        viewModelScope.launch(Dispatchers.IO) { stage(source, mime) }
        // Ready's availability line follows the link: a Mac connecting or dropping changes the sentence.
        viewModelScope.launch {
            LinkController.get(app).state.collect {
                _state.update { s -> if (s is ShareSheetState.Ready) s.copy(availability = ShareIntake.availability(connectedMacName())) else s }
            }
        }
    }

    /** A recreated activity: while the copy is still running, prove the grant is still held. */
    fun onRecreated() {
        val source = uri ?: return
        if (_state.value !is ShareSheetState.Preparing) return
        viewModelScope.launch(Dispatchers.IO) {
            val ok = runCatching {
                app.contentResolver.openInputStream(source)?.use { it.read(ByteArray(1)) } ?: error("null stream")
            }
            if (ok.isFailure) {
                LinkLog.w("share", "attempt=${attemptId ?: "none"} access re-check after recreation failed: " +
                    "${ok.exceptionOrNull()!!.javaClass.name} — the copy is cancelled")
                accessLost = true
                cancelled.set(true)
            } else {
                LinkLog.i("share", "attempt=${attemptId ?: "none"} access re-check after recreation: ok")
            }
        }
    }

    /** Cancel a running copy and delete what was staged. Idempotent; safe from any state. */
    fun discard(why: String) {
        synchronized(lock) {
            cancelled.set(true)
            val id = attemptId ?: return
            if (staged) {
                val dir = ShareStaging.stagingDir(app.cacheDir)
                val removed = if (dir != null) ShareStaging.discard(dir, id) else 0
                LinkLog.i("share", "attempt=$id discarded ($why): $removed file(s) deleted")
                staged = false
            }
            live.remove(id)
        }
    }

    override fun onCleared() {
        discard("sheet closed")
    }

    private fun stage(source: Uri, mime: String) {
        val (providerName, expected) = describe(source)
        val name = ShareNames.displayName(
            providerName = providerName,
            lastPathSegment = source.lastPathSegment,
            mime = mime,
            timestamp = SimpleDateFormat("yyyy-MM-dd HHmmss", Locale.US).format(Date()),
            extensionFor = { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) },
        )
        val dir = ShareStaging.stagingDir(app.cacheDir)
        if (dir == null) {
            fail(name, null, ShareSheetState.Failure.StagingUnavailable, "staging directory unusable")
            return
        }
        ShareStaging.sweep(dir, live.toSet(), System.currentTimeMillis(), ShareStaging.BACKSTOP_AGE_MS).let {
            if (it.deleted > 0 || it.leftUnrecognised > 0 || it.refusedDir) LinkLog.i("share", "backstop ${ShareStaging.sweepLine(it)}")
        }
        val free = dir.usableSpace
        when (val pre = ShareStaging.preflight(expected, free)) {
            is ShareStaging.Preflight.NoSpace -> {
                fail(name, null, ShareSheetState.Failure.NoSpace(pre.needed, pre.available), "preflight refused, limit=${pre.limit}")
                return
            }
            is ShareStaging.Preflight.Go -> copy(source, dir, name, mime, expected, pre.limit)
        }
    }

    private fun copy(source: Uri, dir: File, name: String, mime: String, expected: Long?, limit: Long) {
        val id = ShareStaging.newAttemptId()
        attemptId = id
        live.add(id)
        _state.value = ShareSheetState.Preparing(name, 0, expected)
        val input = try {
            app.contentResolver.openInputStream(source) ?: error("openInputStream returned null")
        } catch (e: Exception) {
            fail(name, id, ShareSheetState.Failure.ReadFailed, "open failed: ${e.javaClass.name}")
            return
        }
        val outcome = ShareStaging.copy(
            source = input, dir = dir, attemptId = id, limit = limit,
            available = { dir.usableSpace }, cancelled = { cancelled.get() }, nowMs = System.currentTimeMillis(),
            afterBuffer = { n -> _state.update { s -> if (s is ShareSheetState.Preparing) s.copy(copied = n) else s } },
        )
        when (outcome) {
            is ShareStaging.Outcome.Staged -> {
                val keep = synchronized(lock) {
                    if (cancelled.get()) {
                        // Discarded in the instant after the last buffer: the sheet is going; leave no copy.
                        ShareStaging.discard(dir, id)
                        live.remove(id)
                        false
                    } else {
                        staged = true
                        true
                    }
                }
                if (!keep) {
                    LinkLog.i("share", "attempt=$id staged then discarded before it was shown — deleted")
                    return
                }
                val n = stagedCount.incrementAndGet()
                LinkLog.i("share", "attempt=$id staged bytes=${outcome.bytes} type=${topLevel(mime)} — " +
                    "$n staged / ${failedCount.get()} failed since start")
                _state.value = ShareSheetState.Ready(name, mime, outcome.bytes, ShareIntake.availability(connectedMacName()))
            }
            is ShareStaging.Outcome.Cancelled ->
                if (accessLost) fail(name, id, ShareSheetState.Failure.AccessLostOnRecreate, "cancelled: access lost after recreation")
                else { live.remove(id); LinkLog.i("share", "attempt=$id cancelled after ${outcome.bytesWritten} bytes; partial deleted") }
            is ShareStaging.Outcome.NoSpace -> fail(name, id,
                ShareSheetState.Failure.NoSpace((expected ?: outcome.bytesWritten) + ShareStaging.margin(expected ?: outcome.bytesWritten), outcome.available),
                "space fell below the floor after ${outcome.bytesWritten} bytes")
            is ShareStaging.Outcome.OverLimit -> fail(name, id, ShareSheetState.Failure.OverLimit(outcome.limit), "over the limit ${outcome.limit}")
            is ShareStaging.Outcome.SourceReadFailed -> fail(name, id, ShareSheetState.Failure.ReadFailed,
                "source read failed after ${outcome.bytesWritten} bytes: ${outcome.exceptionClass}")
            is ShareStaging.Outcome.WriteFailed -> fail(name, id, ShareSheetState.Failure.WriteFailed,
                "write failed after ${outcome.bytesWritten} bytes: ${outcome.exceptionClass}")
        }
    }

    private fun fail(name: String, id: String?, failure: ShareSheetState.Failure, why: String) {
        id?.let { live.remove(it) }
        val n = failedCount.incrementAndGet()
        LinkLog.w("share", "attempt=${id ?: "none"} not staged: $why — ${stagedCount.get()} staged / $n failed since start")
        _state.value = ShareSheetState.Failed(name, failure)
    }

    /** `DISPLAY_NAME` and `SIZE`, while the grant is held. Either may be absent; neither is trusted for the count. */
    private fun describe(source: Uri): Pair<String?, Long?> = runCatching {
        app.contentResolver.query(source, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (!c.moveToFirst()) return@use null to null
            val nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIdx = c.getColumnIndex(OpenableColumns.SIZE)
            val n = if (nameIdx >= 0 && !c.isNull(nameIdx)) c.getString(nameIdx) else null
            val s = if (sizeIdx >= 0 && !c.isNull(sizeIdx)) c.getLong(sizeIdx).takeIf { it >= 0 } else null
            n to s
        } ?: (null to null)
    }.getOrElse { e ->
        LinkLog.w("share", "name/size query failed: ${e.javaClass.name} — the size is treated as unknown")
        null to null
    }

    private fun connectedMacName(): String? = LinkController.get(app).anyLiveSession()?.peerName

    private fun topLevel(mime: String) = mime.substringBefore('/') + "/*"

    companion object {
        /** Live attempts in this process: the backstop sweep skips them, and v1 allows one at a time. */
        private val live: MutableSet<String> = ConcurrentHashMap.newKeySet()
        private val stagedCount = AtomicInteger()
        private val failedCount = AtomicInteger()

        /**
         * At process start every staged entry is an orphan — offers live in memory only. Called
         * synchronously from `ConnectSuiteApp.onCreate`, before any activity or service can stage.
         */
        fun startupSweep(cacheDir: File) {
            val dir = File(cacheDir, ShareStaging.DIR_NAME)
            val r = ShareStaging.sweep(dir, live = emptySet(), nowMs = System.currentTimeMillis(), minAgeMs = 0)
            LinkLog.i("share", "startup staging ${ShareStaging.sweepLine(r)}")
        }
    }
}
