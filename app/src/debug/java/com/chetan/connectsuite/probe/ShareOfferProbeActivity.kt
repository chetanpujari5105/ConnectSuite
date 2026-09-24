package com.chetan.connectsuite.probe

import android.app.Activity
import android.os.Bundle
import android.util.Log
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.sync.v2.ShareFeature
import com.chetan.connectsuite.sync.v2.ShareOffer
import com.chetan.connectsuite.sync.v2.ShareStaging
import java.io.ByteArrayInputStream
import kotlin.random.Random

/**
 * **The only thing that makes a share offer in slice 2** — debug-only, in `src/debug/`, so it cannot
 * reach a release build. An ordinary share from another app stops at *Ready* with Send disabled
 * (`ShareToMacActivity`); this probe exists so the protocol can be exercised without wiring Send.
 *
 * It generates [EXTRA_BYTES] of deterministic synthetic bytes (seeded by [EXTRA_SEED]), stages them
 * through the production [ShareStaging.copy], and hands the staged copy to
 * [ShareFeature.offerStaged]. It reads no user data, shows nothing, and finishes at once.
 *
 * ```
 * scripts/adb-pinned.sh samsung shell am start -n \
 *   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareOfferProbeActivity \
 *   --ei bytes 100000 --ei seed 7 --el ttlSec 600
 * adb logcat -s ShareOfferProbe      # and link.log, tag [share]
 * ```
 *
 * `ttlSec` shortens the offer's life (1..600) so expiry can be observed in minutes rather than ten.
 */
class ShareOfferProbeActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bytes = intent.getIntExtra(EXTRA_BYTES, 100_000).coerceIn(0, 8 * 1024 * 1024)
        val seed = intent.getIntExtra(EXTRA_SEED, 7)
        val ttlMs = (intent.getLongExtra(EXTRA_TTL_SEC, ShareOffer.TTL_MS / 1000) * 1000).coerceIn(1_000, ShareOffer.TTL_MS)
        val cache = applicationContext.cacheDir
        Thread {
            val line = run(cache, bytes, seed, ttlMs)
            Log.i(TAG, line)
            LinkLog.i("share", "debug probe: $line")
        }.start()
        finish()
    }

    private fun run(cache: java.io.File, size: Int, seed: Int, ttlMs: Long): String {
        val dir = ShareStaging.stagingDir(cache) ?: return "refused: staging directory unusable"
        val id = ShareStaging.newAttemptId()
        val data = Random(seed).nextBytes(size)
        val staged = ShareStaging.copy(
            source = ByteArrayInputStream(data), dir = dir, attemptId = id, limit = Long.MAX_VALUE,
            available = { dir.usableSpace }, cancelled = { false }, nowMs = System.currentTimeMillis(),
        )
        if (staged !is ShareStaging.Outcome.Staged) return "not staged: $staged"
        val outcome = ShareFeature.offerStaged(
            offerId = id, bytes = staged.bytes, sha256 = staged.sha256,
            name = "sidekick-offer-probe-$size.bin", mime = "application/octet-stream", ttlMs = ttlMs,
        )
        if (outcome !is ShareFeature.OfferOutcome.Offered) {
            // Not offered, so the staged copy is still ours: delete it rather than leave it for the sweep.
            ShareStaging.discard(dir, id)
        }
        return "synthetic bytes=$size seed=$seed sha256=${staged.sha256} ttl=${ttlMs / 1000}s → $outcome"
    }

    companion object {
        const val TAG = "ShareOfferProbe"
        const val EXTRA_BYTES = "bytes"
        const val EXTRA_SEED = "seed"
        const val EXTRA_TTL_SEC = "ttlSec"
    }
}
