package com.chetan.connectsuite.probe

import android.app.Application
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.SystemClock
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chetan.connectsuite.ShareManyCopy
import com.chetan.connectsuite.ShareManyRow
import com.chetan.connectsuite.ShareToMacModel
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.sync.v2.ShareAdmission
import com.chetan.connectsuite.sync.v2.ShareBudgetReadings
import com.chetan.connectsuite.sync.v2.ShareFeature
import com.chetan.connectsuite.sync.v2.ShareIntake
import com.chetan.connectsuite.sync.v2.ShareManyQueue
import com.chetan.connectsuite.sync.v2.ShareNames
import com.chetan.connectsuite.sync.v2.ShareOffer
import com.chetan.connectsuite.sync.v2.ShareSelection
import com.chetan.connectsuite.sync.v2.ShareStaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/**
 * **Stage 2 — the several-files review screen's state. Debug source set only; development only.**
 * docs/feature-a-multi-offer-proposal.md rev 4 §3, §11–§15. The rules live in [ShareManyQueue] (sync-module)
 * and [ShareManyCopy]; this class only connects them to the URIs, the session and `ShareFeature`.
 *
 * - **Review first, copy after.** [bind] reads each item's name and size from `OpenableColumns`
 *   without opening its content. Nothing is copied until [send].
 * - **The URIs are read only while the screen is alive** (§11). [screenClosed] ends every file not yet
 *   offered; offered files continue from their private copies, owned by `ShareFeature`.
 * - **§12's retry triggers:** an offer on the session ending, each copy finishing or failing (the queue's
 *   own loop), and every 5 s while any file waits. One consumer runs the queue, so copies never overlap.
 *   The §12 stall clock (PROPOSED, development only) is evaluated at each of them, on `elapsedRealtime`.
 * - [screenClosed] runs on the main thread and may wait for **one** `openInputStream` already under way
 *   on the queue's thread — never for a read or a copy — so that no URI is opened after it returns.
 *
 * **Not built (open decisions, proposal §20):** Stop preparing, the notification, and keeping the
 * display on while preparing. What `link.log` gets: counts, versions, attempt ids, reason types,
 * exception class names and outcomes — never a name, a URI, a path, or an exception's message.
 */
class ShareManyToMacModel(app: Application) : AndroidViewModel(app) {

    sealed interface Screen {
        data object Starting : Screen
        data class Refused(val reason: ShareSelection.Refusal, val count: Int, val index: Int?, val mac: String?) : Screen
        /** One file: the single-file sheet, at any version (§15). [intent] is the in-process `SEND` it binds. */
        data class Single(val intent: Intent) : Screen
        data class Review(val names: List<String>, val sizes: List<Long?>, val availability: ShareIntake.Availability, val notSent: String? = null) : Screen
        data class Running(val rows: List<ShareManyRow>, val mac: String) : Screen
    }

    private val _screen = MutableStateFlow<Screen>(Screen.Starting)
    val screen: StateFlow<Screen> = _screen.asStateFlow()
    var bound = false
        private set

    private val app get() = getApplication<Application>()
    private var uris: List<Uri> = emptyList()
    private var mimes: List<String> = emptyList()
    private var names: List<String> = emptyList()
    private var sizes: List<Long?> = emptyList()
    private var queue: ShareManyQueue? = null
    private val triggers = Channel<Unit>(Channel.CONFLATED)
    /** The row last drawn for each offer id: kept when the offer ages out of `ShareFeature.views`. */
    private val offerRows: MutableMap<String, ShareManyRow.After> = HashMap()
    private val selectionKey = "selection-" + ShareStaging.newAttemptId()
    private var jobs = mutableListOf<Job>()

    fun bind(intent: Intent) {
        bound = true
        if ((app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            // Two fences: this class is in the debug source set only, and it refuses outside a debuggable build.
            _screen.value = Screen.Refused(ShareSelection.Refusal.NOT_A_SEND_MULTIPLE, 0, null, null)
            return
        }
        val streams: List<Uri?> = ShareSelection.streams(
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java),
            intent.clipData?.let { c -> (0 until c.itemCount).map { c.getItemAt(it).uri } },
        )
        val types = streams.map { u ->
            val resolver = u?.takeIf { it.scheme.equals("content", ignoreCase = true) }?.let {
                runCatching { app.contentResolver.getType(it) }.getOrElse { e ->
                    LinkLog.w("share", "selection: getType failed: ${e.javaClass.name} — the intent's type is used instead"); null
                }
            }
            ShareNames.mimeOf(resolver, intent.type)
        }
        val decision = ShareSelection.decide(intent.action, streams.zip(types) { u, t -> ShareSelection.Item(u?.scheme, t) }, ShareToMacModel.live.isNotEmpty())
        if (decision is ShareSelection.Decision.Refuse) {
            LinkLog.i("share", "selection refused: ${decision.reason} (${streams.size} items)")
            _screen.value = Screen.Refused(decision.reason, streams.size, decision.index, connectedMac())
            return
        }
        // Taken: every item is a content: URI, so none is null.
        val taken = streams.requireNoNulls()
        if (taken.size == 1) {
            // §15: one file is a single-file share at any version — the single-file model, bound in this same
            // activity (no new grant, no second activity), with a SEND carrying the same stream.
            LinkLog.i("share", "selection of one file: handled as a single-file share")
            _screen.value = Screen.Single(Intent(Intent.ACTION_SEND).apply {
                putExtra(Intent.EXTRA_STREAM, taken[0])
                type = intent.type
                clipData = intent.clipData
            })
            return
        }
        uris = taken
        mimes = types
        val stamp = SimpleDateFormat("yyyy-MM-dd HHmmss", Locale.US).format(Date())
        val described = taken.mapIndexed { i, u ->
            val (n, s) = describe(u)
            ShareNames.displayName(providerName = n, lastPathSegment = u.lastPathSegment, mime = types[i],
                timestamp = "$stamp-${i + 1}", extensionFor = { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }) to s
        }
        names = described.map { it.first }
        sizes = described.map { it.second }
        LinkLog.i("share", "selection of ${taken.size} files for review: ${sizes.count { it == null }} sizes not reported; nothing copied")
        _screen.value = Screen.Review(names, sizes, availability())
        jobs += viewModelScope.launch {
            LinkController.get(app).state.collect {
                _screen.update { s -> if (s is Screen.Review) s.copy(availability = availability()) else s }
                if (queue != null && LinkController.get(app).anyLiveSession() == null) end(ShareManyQueue.NotSentWhy.Disconnected)
            }
        }
    }

    /** **Send N files**: only from Review, only to a Mac that asks a person, only at version 3 for several. */
    fun send() {
        val review = _screen.value as? Screen.Review ?: return
        val mac = (review.availability as? ShareIntake.Availability.Available)?.macName ?: return
        val version = ShareFeature.stagingContext().first
        ShareSelection.atSend(uris.size, version)?.let { r ->
            LinkLog.i("share", "selection of ${uris.size} not started: $r (share.file $version negotiated)")
            _screen.value = review.copy(notSent = ShareManyCopy.refusal(r, uris.size, null, mac))
            return
        }
        if (ShareToMacModel.live.isNotEmpty()) {
            _screen.value = review.copy(notSent = ShareManyCopy.refusal(ShareSelection.Refusal.ANOTHER_IN_PROGRESS, uris.size, null, mac))
            return
        }
        val dir = ShareStaging.stagingDir(app.cacheDir) ?: run {
            _screen.value = review.copy(notSent = ShareManyCopy.notSent(ShareManyQueue.NotSentWhy.WriteFailed, mac))
            return
        }
        ShareToMacModel.live += selectionKey
        val q = ShareManyQueue(dir, sizes, env(dir))
        queue = q
        LinkLog.i("share", "selection of ${uris.size} started at share.file $version; one copy at a time")
        publish(mac)
        jobs += viewModelScope.launch(Dispatchers.IO) {
            for (t in triggers) {
                val ran = q.evaluate()
                publish(mac)
                if (!q.unfinished()) ShareToMacModel.live -= selectionKey
                if (ran > 0) LinkLog.i("share", "selection: $ran copies ran this evaluation — ${tally()}")
            }
        }
        // Trigger 1: any offer on the session ending (it releases Σ and a slot). Also redraws offered rows.
        jobs += viewModelScope.launch {
            var liveBefore = ShareFeature.liveOfferIds()
            ShareFeature.views.collect { views ->
                val live = ShareFeature.liveOfferIds()
                if ((liveBefore - live).isNotEmpty()) triggers.trySend(Unit)
                liveBefore = live
                publish(mac, views)
            }
        }
        // Trigger 3: every 5 s while any file waits.
        jobs += viewModelScope.launch {
            while (isActive) {
                delay(TICK_MS)
                if (q.anyWaiting()) triggers.trySend(Unit)
            }
        }
        triggers.trySend(Unit)
    }

    /** The screen is going away (§11): every file not yet offered is not sent; offered ones are untouched. */
    fun screenClosed() = end(ShareManyQueue.NotSentWhy.ScreenClosed)

    private var endedOnce = false

    private fun end(why: ShareManyQueue.NotSentWhy) {
        val q = queue ?: return
        // Close, onStop and onCleared can all arrive for one screen; the queue keeps the first reason.
        if (endedOnce) return
        endedOnce = true
        val removed = q.end(why)
        ShareToMacModel.live -= selectionKey
        LinkLog.i("share", "selection ended ($why): $removed unoffered file(s) deleted; offered files continue — ${tally()}")
        publish(connectedMac() ?: "your Mac")
    }

    override fun onCleared() {
        screenClosed()
    }

    /** Called from the queue's thread (progress) and the main thread (offer states); one at a time. */
    @Synchronized
    private fun publish(mac: String, views: Map<String, ShareOffer.Offer> = ShareFeature.views.value) {
        val q = queue ?: return
        val rows = q.states().mapIndexed { i, p ->
            val offered = p as? ShareManyQueue.Prep.Offered
            val after = offered?.let { o ->
                ShareManyCopy.after(names[i], o.bytes, mac, offerRows[o.offerId], views[o.offerId]?.state)?.also { offerRows[o.offerId] = it }
            }
            after ?: ShareManyRow.Before(names[i], p, sizes[i])
        }
        _screen.value = Screen.Running(rows, mac)
    }

    private fun env(dir: File) = object : ShareManyQueue.Env {
        override fun context() = ShareFeature.stagingContext()
        override fun liveOffers() = ShareFeature.liveOfferIds().size
        override fun inProgress() = ShareFeature.inProgress()
        override fun monotonicMs() = SystemClock.elapsedRealtime()
        override fun free() = dir.usableSpace
        override fun concurrent(): ShareAdmission.Concurrent? = ShareBudgetReadings.concurrent(app, dir)
        override fun open(index: Int): InputStream = app.contentResolver.openInputStream(uris[index]) ?: error("openInputStream returned null")
        override fun offer(index: Int, attemptId: String, bytes: Long, sha256: String): ShareFeature.OfferOutcome =
            ShareFeature.offerStaged(attemptId, bytes, sha256, names[index], mimes[index], requireAsk = true).also {
                if (it is ShareFeature.OfferOutcome.Offered) offeredCount.incrementAndGet() else notOfferedCount.incrementAndGet()
                LinkLog.i("share", "selection item ${index + 1}/${uris.size} attempt=$attemptId bytes=$bytes: ${it::class.simpleName} — ${tally()}")
            }
        override fun nowMs() = System.currentTimeMillis()
        override fun attempt(attemptId: String, running: Boolean) {
            if (running) ShareToMacModel.live += attemptId else ShareToMacModel.live -= attemptId
        }
        override fun notPrepared(index: Int, attemptId: String?, why: ShareManyQueue.NotSentWhy, cause: String?) {
            notOfferedCount.incrementAndGet()
            LinkLog.w("share", ShareManyQueue.notPreparedLine(index, uris.size, attemptId, why, cause) + " — ${tally()}")
        }
        override fun progress(index: Int, copied: Long) {
            // Throttled by the copy's own 64 KiB buffer; a redraw per buffer is what the single-file sheet does too.
            publish(connectedMac() ?: "your Mac")
        }
    }

    private fun describe(source: Uri): Pair<String?, Long?> = runCatching {
        app.contentResolver.query(source, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (!c.moveToFirst()) return@use null to null
            val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val si = c.getColumnIndex(OpenableColumns.SIZE)
            (if (ni >= 0 && !c.isNull(ni)) c.getString(ni) else null) to (if (si >= 0 && !c.isNull(si)) c.getLong(si).takeIf { it >= 0 } else null)
        } ?: (null to null)
    }.getOrElse { e ->
        LinkLog.w("share", "selection: name/size query failed: ${e.javaClass.name} — the size is treated as unknown")
        null to null
    }

    private fun connectedMac(): String? = LinkController.get(app).anyLiveSession()?.peerName

    private fun availability(): ShareIntake.Availability {
        val s = LinkController.get(app).anyLiveSession()
        return ShareIntake.availability(s?.peerName, s?.negotiated)
    }

    companion object {
        /** §12 trigger 3. Not a storage value: how often a waiting file is looked at again. */
        const val TICK_MS = 5_000L
        private val offeredCount = AtomicInteger()
        private val notOfferedCount = AtomicInteger()
        private fun tally() = "${offeredCount.get()} offered / ${notOfferedCount.get()} not offered from selections since start"
    }
}
