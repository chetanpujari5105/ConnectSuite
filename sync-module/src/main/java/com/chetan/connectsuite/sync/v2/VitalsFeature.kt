package com.chetan.connectsuite.sync.v2

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Environment
import android.os.StatFs
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.MessageType
import java.util.concurrent.atomic.AtomicInteger

/**
 * `battery.state` and `storage.state` — the Overview pane's **Device status** card (O4).
 *
 * ### It handles nothing, and that is the shape
 *
 * There is no request to answer: both are unsolicited pushes, like `remote.state`. The Mac never
 * asks, so `handledTypes` is empty and nothing is registered — this feature only *sends*.
 *
 * ### Why this is a feature at all rather than two lines in the handshake
 *
 * Battery changes while the session is open, which is the entire reason the card is interesting. A
 * value read once at handshake would be a number that is correct for a second and stale for an
 * hour — the stale-artifact failure this repo records against a results XML, in a ring somebody
 * watches.
 *
 * ### Reporting the success case
 *
 * Every send is counted beside its refusals, because a count with no denominator is not evidence.
 * The `storage` reading in particular can fail on its own and the failure is silent at the API —
 * `StatFs` throws rather than returning a sentinel — so the exception's own type reaches the log
 * with it. Defect 57's lesson: a `runCatching` that discards the reason is asserting the reason
 * cannot matter, and on a platform call it almost always can.
 */
object VitalsFeature {

    /** Nothing is registered. The Mac does not ask for these; see the class comment. */
    val handledTypes: Set<String> = emptySet()

    private var link: LinkServer? = null
    private var appContext: Context? = null
    private var receiver: BroadcastReceiver? = null

    /**
     * The last battery reading actually pushed, so an unchanged tick is not a message.
     *
     * **The name matters.** `scripts/check-clip-echo.mjs` refused the first version of this file for
     * holding a field named the way the clipboard echo interlock names its own: that interlock has
     * exactly two declared homes, and a third would be a copy of the rule its tests cannot reach.
     * This is a change filter for a battery percentage and has nothing to do with it, so it takes a
     * name that says so — the guard's own instruction when the state genuinely is not the interlock.
     */
    private var lastBattery: Pair<Int?, Boolean>? = null

    /** When storage last went out. Storage moves slowly; a push per battery tick would be noise. */
    private var lastStorageAtMs = 0L

    private val batterySent = AtomicInteger()
    private val storageSent = AtomicInteger()
    private val storageRefused = AtomicInteger()

    private const val STORAGE_MIN_INTERVAL_MS = 60_000L

    private fun tally(): String =
        "${batterySent.get()} battery / ${storageSent.get()} storage sent / " +
            "${storageRefused.get()} storage refused since start"

    fun install(context: Context, server: LinkServer) {
        link = server
        val app = context.applicationContext
        appContext = app
        // `ACTION_BATTERY_CHANGED` is sticky: registering returns the current value immediately, so
        // there is no separate "read it once at startup" path that could disagree with the receiver.
        // One source, one shape — the same reason `MediaPayloads.cursorOf` has one home.
        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) = onBattery(intent)
        }.also { app.registerReceiver(it, filter) }
        // Replayed to each session as it becomes ready, the same hook `RemoteFeature` uses. A Mac
        // that connects mid-session has never seen these values, however unchanged they are.
        server.addSessionReadyListener { onSessionReady(app) }
        LinkLog.i("vitals", "Device vitals installed; battery.state and storage.state will be pushed — ${tally()}")
    }

    fun uninstall() {
        val held = receiver
        receiver = null
        link = null
        lastBattery = null
        if (held != null) {
            // Unregistering can throw if the receiver was never registered; the type reaches the
            // log rather than being discarded, because "already gone" and "refused" differ.
            runCatching { appContext?.unregisterReceiver(held) }
                .onFailure { LinkLog.w("vitals", "Receiver unregister: ${it.javaClass.simpleName}") }
        }
        LinkLog.i("vitals", "Device vitals uninstalled — ${tally()}")
    }

    /**
     * A session became ready. Both values go out **now**, unconditionally.
     *
     * `lastBattery` is cleared first so the change filter cannot suppress the first push of a new
     * session: the Mac that just connected has never seen this value, however unchanged it is from
     * the previous Mac's point of view. A filter that remembers across sessions is the
     * `seenOngoing`-across-sessions mistake, one feature over.
     */
    fun onSessionReady(context: Context) {
        lastBattery = null
        lastStorageAtMs = 0L
        val app = context.applicationContext
        sendBattery(readBattery(app))
        sendStorage(app)
    }

    fun onLinkDropped() {
        lastBattery = null
        lastStorageAtMs = 0L
    }

    private fun onBattery(intent: Intent) {
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        // Scale is not always 100. Computing a percentage against an assumed denominator is the
        // units rule with a real failure behind it — the two numbers have to be of the same thing.
        val percent = if (level < 0 || scale <= 0) null else (level * 100) / scale
        val charging = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
        sendBattery(percent to charging)
    }

    private fun readBattery(context: Context): Pair<Int?, Boolean> {
        val manager = context.getSystemService(BatteryManager::class.java)
        val capacity = manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val charging = manager?.isCharging ?: false
        // `getIntProperty` answers Integer.MIN_VALUE for "no such property" rather than throwing.
        return (capacity?.takeIf { it in 0..100 }) to charging
    }

    private fun sendBattery(reading: Pair<Int?, Boolean>) {
        val server = link ?: return
        if (server.anyLiveSession() == null) return
        val (level, charging) = reading
        if (!VitalsPayloads.batteryChanged(lastBattery, level, charging)) return
        lastBattery = reading
        batterySent.incrementAndGet()
        val payload = VitalsPayloads.battery(level, charging)
        server.broadcast { session -> session.send(Envelope(type = MessageType.BATTERY_STATE, payload = payload)) }
        LinkLog.i(
            "vitals",
            "battery.state → Mac: ${level ?: "unknown"}%, charging=$charging — ${tally()}",
        )
    }

    private fun sendStorage(context: Context) {
        val server = link ?: return
        if (server.anyLiveSession() == null) return
        val now = System.currentTimeMillis()
        if (now - lastStorageAtMs < STORAGE_MIN_INTERVAL_MS && lastStorageAtMs != 0L) return
        lastStorageAtMs = now

        // The exception's type reaches the log. `StatFs` throws on a path it cannot stat, and
        // "could not read" and "zero free" are different sentences — defect 57.
        val read = runCatching {
            val stat = StatFs(Environment.getExternalStorageDirectory().absolutePath)
            stat.availableBytes to stat.totalBytes
        }
        val (free, total) = read.getOrNull() ?: (null to null)
        if (read.isFailure) {
            storageRefused.incrementAndGet()
            LinkLog.w(
                "vitals",
                "storage.state unreadable: ${read.exceptionOrNull()?.javaClass?.simpleName} — ${tally()}",
            )
        } else {
            storageSent.incrementAndGet()
        }
        val payload = VitalsPayloads.storage(free, total)
        server.broadcast { session -> session.send(Envelope(type = MessageType.STORAGE_STATE, payload = payload)) }
        if (read.isSuccess) {
            LinkLog.i("vitals", "storage.state → Mac: ${free} free of ${total} bytes — ${tally()}")
        }
    }
}
