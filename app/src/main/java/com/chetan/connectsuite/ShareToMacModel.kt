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
import com.chetan.connectsuite.sync.v2.ShareAdmission
import com.chetan.connectsuite.sync.v2.ShareFeature
import com.chetan.connectsuite.sync.v2.ShareIntake
import com.chetan.connectsuite.sync.v2.ShareNames
import com.chetan.connectsuite.sync.v2.ShareOffer
import com.chetan.connectsuite.sync.v2.ShareStaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.Job
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
 * ### Send, and who owns the staged copy after it
 *
 * Send is enabled only when the connected Mac negotiated `share.file` 2 **and** `share.ask`
 * ([ShareIntake.availability]) — a Mac that promised to ask a person. No Mac build makes that promise
 * yet, so in every live pairing Send stays disabled. [send] offers through
 * `ShareFeature.offerStaged(requireAsk = true)`, which re-checks the same rule on the session it
 * actually uses. **On `Offered` the staged copy changes hands** — under [lock], in one step — from
 * this model to `ShareFeature`, whose every end deletes it; from then on [discard] deletes nothing
 * and leaving the screen does not cancel the offer ([onLeave]). The sheet then follows
 * `ShareFeature.views` through [reduce]; only the Mac's verified verdict makes it say Saved.
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
    /** The staged copy's digest, from the copy itself. The offer names it; nothing else does. */
    @Volatile private var stagedSha256: String? = null
    /** Set once, when an offer is made. From then on `ShareFeature` owns the staged copy. */
    @Volatile private var offeredId: String? = null
    private var follow: Job? = null
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
                _state.update { s -> if (s is ShareSheetState.Ready) s.copy(availability = currentAvailability()) else s }
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

    /**
     * Offer the prepared file to the connected Mac. Only from [ShareSheetState.Ready] with
     * [ShareIntake.Availability.Available]; `ShareFeature` re-checks `share.file` 2 + `share.ask` on the
     * session it actually uses, so a Mac that dropped or changed since the sheet drew makes no offer.
     */
    fun send() {
        val ready = _state.value as? ShareSheetState.Ready ?: return
        if (ready.availability !is ShareIntake.Availability.Available) return
        val outcome = synchronized(lock) {
            val id = attemptId
            val sha = stagedSha256
            if (cancelled.get() || !staged || id == null || sha == null || offeredId != null) return
            val o = ShareFeature.offerStaged(id, ready.bytes, sha, ready.name, ready.mime, requireAsk = true)
            if (o is ShareFeature.OfferOutcome.Offered) {
                // The hand-off: from here ShareFeature's ends delete the copy, and this model never does.
                staged = false
                offeredId = id
                live.remove(id)
            }
            o
        }
        val mac = connectedMacName() ?: ready.availability.macName
        when (outcome) {
            is ShareFeature.OfferOutcome.Offered -> {
                LinkLog.i("share", "attempt=${outcome.offerId} offered from the sheet; ShareFeature owns the staged copy now")
                _state.value = ShareSheetState.WaitingForMac(ready.name, ready.bytes, mac)
                follow = viewModelScope.launch {
                    ShareFeature.views.mapNotNull { it[outcome.offerId]?.state }.distinctUntilChanged().collect { st ->
                        _state.update { prev -> reduce(prev, ready.name, ready.bytes, mac, st) }
                    }
                }
            }
            ShareFeature.OfferOutcome.NoSession, is ShareFeature.OfferOutcome.NotNegotiated ->
                _state.value = ready.copy(availability = currentAvailability(), notOffered = null)
            is ShareFeature.OfferOutcome.Busy -> {
                // Never a silent no-op: the sheet names the waiting file, keeps this one prepared, and
                // watches the other offer so Send works again the moment it ends.
                LinkLog.i("share", "attempt=${attemptId ?: "none"} Send while ${outcome.other.offerId} is live: shown as busy; " +
                    "this copy stays prepared (${ready.bytes} bytes), the other offer is untouched")
                _state.value = onBusy(ready, outcome.other)
                watchOther(outcome.other.offerId)
            }
            is ShareFeature.OfferOutcome.Invalid -> {
                LinkLog.w("share", "attempt=${attemptId ?: "none"} not offered: ${outcome.why}")
                _state.value = ready.copy(notOffered = ShareSheetState.NotOffered.OUT_OF_RULE)
            }
        }
    }

    private var otherWatch: Job? = null

    /** Follows the offer that made Send busy, until it is no longer live; see [afterOtherChanged]. */
    private fun watchOther(otherId: String) {
        otherWatch?.cancel()
        otherWatch = viewModelScope.launch {
            ShareFeature.views.map { it[otherId]?.state }.distinctUntilChanged().collect { st ->
                _state.update { afterOtherChanged(it, st) }
                if (st == null || !ShareOffer.isLive(st)) {
                    LinkLog.i("share", "attempt=${attemptId ?: "none"} the offer in the way ($otherId) ended " +
                        "(${st?.let(ShareOffer::describe) ?: "no longer held"}); Send works again")
                    otherWatch?.cancel()
                }
            }
        }
    }

    /**
     * Withdraw **the other** file's offer — a person's explicit tap, only while it still waits for an
     * answer ([canWithdrawOther]). `ShareFeature` sends `share.cancel{user}` and deletes that file's staged
     * copy; this sheet's own prepared copy is untouched. Returns the withdrawn file's name, or null.
     */
    fun withdrawOther(): String? {
        val state = _state.value
        if (!canWithdrawOther(state)) return null
        val other = (state as ShareSheetState.Ready).waitingOther ?: return null
        LinkLog.i("share", "attempt=${attemptId ?: "none"} withdrawing the other offer ${other.offerId} at the person's request")
        ShareFeature.cancel(other.offerId, "user")
        return other.name
    }

    /** Withdraw a live offer (`share.cancel{user}`). `ShareFeature` deletes the staged copy. */
    fun withdraw() {
        if (!canWithdraw(_state.value)) return
        offeredId?.let { ShareFeature.cancel(it, "user") }
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
        // Live offers own their staged copies; the backstop must never reach one, however old.
        ShareStaging.sweep(dir, live.toSet() + ShareFeature.liveOfferIds(), System.currentTimeMillis(), ShareStaging.BACKSTOP_AGE_MS).let {
            if (it.deleted > 0 || it.leftUnrecognised > 0 || it.refusedDir) LinkLog.i("share", "backstop ${ShareStaging.sweepLine(it)}")
        }
        val free = dir.usableSpace
        // Below version 3 — every live pairing today — this is exactly the version-2 preflight. At
        // version 3 (PROPOSED, advertised by nothing) the copies already held for live offers count,
        // and with no approved cap a second concurrent copy is refused before a byte is read.
        val (version, held) = ShareFeature.stagingContext()
        when (val pre = ShareAdmission.forCopy(version, expected, held, free, ShareAdmission.APPROVED_CAP)) {
            is ShareAdmission.Copy.NoSpace -> {
                fail(name, null, ShareSheetState.Failure.NoSpace(pre.needed, pre.free), "preflight refused (share.file $version, $held bytes held)")
                return
            }
            is ShareAdmission.Copy.CapNotApproved -> {
                fail(name, null, ShareSheetState.Failure.HoldingAnother(pre.held),
                    "not copied: $held bytes already held for live offers and no concurrent-copy cap is approved (share.file $version)")
                return
            }
            is ShareAdmission.Copy.OverCap -> {
                fail(name, null, ShareSheetState.Failure.OverHoldCap(pre.held, pre.cap), "not copied: over the concurrent-copy cap (share.file $version)")
                return
            }
            is ShareAdmission.Copy.Go -> copy(source, dir, name, mime, expected, pre.limit)
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
                stagedSha256 = outcome.sha256
                _state.value = ShareSheetState.Ready(name, mime, outcome.bytes, currentAvailability())
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

    private fun currentAvailability(): ShareIntake.Availability {
        val session = LinkController.get(app).anyLiveSession()
        return ShareIntake.availability(session?.peerName, session?.negotiated)
    }

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
