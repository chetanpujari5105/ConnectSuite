package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.chetan.connectsuite.core.link.LinkLog
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * One place that turns a package name into the name a person calls that app. Defect 28.
 *
 * ### Why this exists as a file
 *
 * There were **three** of these. Two were byte for byte identical, in [NotificationRelay] and
 * [RemoteFeature], and a third sat on the v1 Android-to-Android path in `NotificationMirrorService`.
 * All three fell back to the raw package name and all three did it silently, so
 * `com.google.android.apps.messaging` reached the Mac where `Messages` was meant to, in two panes,
 * from one bug — and the third would have kept doing it to v1 peers after the other two were fixed.
 *
 * Finding the third only after fixing the first two is the argument for this file existing rather
 * than for two careful edits: a duplicated helper is fixed as many times as somebody happens to
 * grep, and the count is never obviously complete.
 *
 * ### Why the label failed to resolve
 *
 * `targetSdk` is 36, and under Android 11+ package visibility `getApplicationInfo` throws
 * `NameNotFoundException` for any package the app cannot *see* — visibility is not a permission
 * that is granted or denied, it is a filter, and by default an app sees almost nothing. No
 * manifest in this repo declared a `<queries>` element, so the lookup failed for exactly the apps
 * whose notifications are worth mirroring.
 *
 * The fix is the `<queries>` element in `sync-module`'s manifest, matching apps that have a
 * launcher icon. That is deliberately **not** `QUERY_ALL_PACKAGES`: the permission would also work
 * and is flagged by Play policy for apps that are not launchers or security tools, which this is
 * not. An app with a launcher icon is precisely the set that posts notifications and holds media
 * sessions, so the narrower filter is not a compromise here — it is the right set.
 *
 * ### The fallback is kept, and now says so
 *
 * A package with no launcher icon still will not resolve — a system component posting through a
 * headless package, for instance — and the package name remains the honest answer for those. What
 * changed is that it is no longer silent. `getOrDefault(packageName)` turned a visibility problem
 * into a cosmetic one and logged nothing, which is why defect 28 survived until somebody happened
 * to read the same list twice. Per CLAUDE.md the counter is published beside the one that gives it
 * meaning: resolved beside fell-back, so "12 fallbacks" can be told from "12 of 12 fallbacks".
 */
object AppLabels {

    /**
     * Successful lookups only.
     *
     * A failure is never cached. Visibility can change under this app — a package is installed, or
     * the launcher-icon query starts matching something it did not — and a cached failure would
     * pin the raw package name into the pane for the life of the process, which is the defect
     * again with a longer fuse.
     */
    private val cache = ConcurrentHashMap<String, String>()

    private val resolved = AtomicLong(0)
    private val fellBack = AtomicLong(0)

    /**
     * The label for a package, or the package name if this app genuinely cannot see it.
     *
     * A notification's own `EXTRA_SUBSTITUTE_APP_NAME` was tried here first and removed: the
     * constant is not in the public SDK, and setting it needs `SUBSTITUTE_NOTIFICATION_APP_NAME`,
     * which is signature-or-privileged. No ordinary app — none of the ones whose notifications
     * this mirrors — can set it, so reading it would have been a hidden-API dependency bought for
     * nothing. The `<queries>` element is the fix; this is only the fallback path.
     */
    fun of(context: Context, packageName: String): String {
        cache[packageName]?.let { return it }

        val label = runCatching {
            val packages = context.packageManager
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packages.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packages.getApplicationInfo(packageName, 0)
            }
            packages.getApplicationLabel(info).toString().takeIf { it.isNotBlank() }
        }.getOrNull()

        if (label == null) {
            fellBack.incrementAndGet()
            // At warning level, with the ratio on the line. The whole of defect 28 is that this
            // path was reached constantly and said nothing at all.
            LinkLog.w(
                "applabel",
                "No label for $packageName; showing the package name — ${tally()}",
            )
            return packageName
        }

        cache[packageName] = label
        resolved.incrementAndGet()
        LinkLog.i("applabel", "$packageName resolves to \"$label\" — ${tally()}")
        return label
    }

    private fun tally(): String =
        "${resolved.get()} resolved / ${fellBack.get()} fell back since start"

    /** Test seam, and the way to re-check visibility after an install. Never called by the app. */
    fun clearCacheForTests() {
        cache.clear()
    }
}
