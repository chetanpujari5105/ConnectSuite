package com.chetan.connectsuite.probe

import android.app.usage.StorageStatsManager
import android.os.Bundle
import android.os.Process
import android.os.StatFs
import android.os.storage.StorageManager
import android.util.Log
import androidx.activity.ComponentActivity
import com.chetan.connectsuite.sync.v2.ShareStaging
import java.io.File

/**
 * What Sidekick itself can read about its cache quota and its storage, **once** — **debug-only,
 * read-only**. The concurrent-staging rule (docs/feature-a-multi-offer-proposal.md §4) needs the
 * quota, and on the SM-S938B no system view exposes it; only code running as this app can call
 * [StorageManager.getCacheQuotaBytes].
 *
 * It writes nothing, deletes nothing, creates nothing (the staging folder is inspected as it is — see
 * [StorageQuotaReading.staged]; [ShareStaging.stagingDir] would create it), opens no socket, touches no
 * link state, and draws nothing. One logcat line, tag `StorageQuotaProbe`: byte counts, a timestamp
 * and exception classes only ([StorageQuotaReading.line]).
 *
 * **The reading can change what it reads.** On stock Android the quota is recomputed from foreground
 * use, and starting this activity is foreground use. Read it once and record the time; repeated
 * probing can raise later quotas (AOSP behaviour; not verified on One UI).
 *
 * Run: `adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.StorageQuotaProbeActivity`
 * Read: `adb logcat -d -s StorageQuotaProbe:V`
 */
class StorageQuotaProbeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = applicationContext
        Log.i(TAG, "BEGIN")
        Thread {
            val cache = app.cacheDir
            val sm = app.getSystemService(StorageManager::class.java)
            val uuid = runCatching { sm.getUuidForPath(cache) }
            val onVolume = { f: (java.util.UUID) -> Long ->
                StorageQuotaReading.read { f(uuid.getOrThrow()) }
            }
            val line = StorageQuotaReading.line(
                readAtMs = System.currentTimeMillis(),
                volumeIsDefault = onVolume { if (it == StorageManager.UUID_DEFAULT) 1L else 0L },
                quotaBytes = onVolume { sm.getCacheQuotaBytes(it) },
                usableBytes = StorageQuotaReading.read { cache.usableSpace },
                totalBytes = StorageQuotaReading.read { StatFs(cache.path).totalBytes },
                allocatableBytesNotFreeSpace = onVolume { sm.getAllocatableBytes(it) },
                // This app's own package: no permission is needed to ask about yourself.
                ownCacheBytes = onVolume {
                    app.getSystemService(StorageStatsManager::class.java)
                        .queryStatsForPackage(it, app.packageName, Process.myUserHandle()).cacheBytes
                },
                staged = StorageQuotaReading.staged(File(cache, ShareStaging.DIR_NAME)),
            )
            Log.i(TAG, line)
            Log.i(TAG, "END")
        }.start()
        finish()
    }

    private companion object {
        const val TAG = "StorageQuotaProbe"
    }
}
