package com.chetan.connectsuite.sync.v2

import android.app.usage.StorageStatsManager
import android.content.Context
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import android.os.storage.StorageManager
import com.chetan.connectsuite.core.link.LinkLog
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * **The live readings for the version-3 per-copy budget** (docs/feature-a-multi-offer-proposal.md §4),
 * read by code running as this app, on the volume that holds [dir] — the same calls as the debug
 * `StorageQuotaProbeActivity` (`a18f45d`). Every call reads afresh: nothing is cached, so a reading is
 * never older than the moment [ShareAdmission] asks for it, and the 5 s bound is a bound on this call.
 *
 * A reading that fails is `null` in [ShareConcurrentBudget.Readings] — which refuses **only the extra
 * copy** — and its exception **class** reaches `link.log` with a running tally, never discarded
 * (CLAUDE.md → *an exception's name is a claim about the platform's world*). No path, name or content.
 *
 * `readAtMs` and [ShareAdmission.Concurrent.nowMs] are both `SystemClock.elapsedRealtime`, so a
 * wall-clock change cannot make a reading look fresh or stale.
 */
object ShareBudgetReadings {

    private val reads = AtomicInteger()
    private val failedReadings = AtomicInteger()

    fun concurrent(context: Context, dir: File): ShareAdmission.Concurrent {
        val app = context.applicationContext
        return ShareAdmission.Concurrent(read = { held -> read(app, dir, held) }, nowMs = { SystemClock.elapsedRealtime() })
    }

    private fun read(app: Context, dir: File, held: Long): ShareConcurrentBudget.Readings {
        val n = reads.incrementAndGet()
        val sm = app.getSystemService(StorageManager::class.java)
        val uuid = reading("volume") { sm.getUuidForPath(dir) }
        val r = ShareConcurrentBudget.Readings(
            quotaBytes = uuid?.let { u -> reading("cache quota") { sm.getCacheQuotaBytes(u) } },
            ownCacheBytes = uuid?.let { u ->
                // This app's own package: no permission is needed to ask about yourself.
                reading("own cache") {
                    app.getSystemService(StorageStatsManager::class.java).queryStatsForPackage(u, app.packageName, Process.myUserHandle()).cacheBytes
                }
            },
            heldBytes = held,
            usableBytes = reading("usable") { dir.usableSpace },
            totalBytes = reading("total") { StatFs(dir.path).totalBytes },
            readAtMs = SystemClock.elapsedRealtime(),
        )
        LinkLog.i("share", "budget readings #$n: quota=${r.quotaBytes} ownCache=${r.ownCacheBytes} held=$held " +
            "usable=${r.usableBytes} total=${r.totalBytes} — ${failedReadings.get()} failed readings in $n reads since start")
        return r
    }

    private fun <T> reading(what: String, block: () -> T): T? = runCatching(block).getOrElse { e ->
        val failed = failedReadings.incrementAndGet()
        LinkLog.w("share", "budget reading '$what' failed: ${e.javaClass.name} — refused as unreadable; $failed failed readings in ${reads.get()} reads since start")
        null
    }
}
