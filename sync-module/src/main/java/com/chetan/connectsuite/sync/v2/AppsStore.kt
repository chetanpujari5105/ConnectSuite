package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import com.chetan.connectsuite.core.link.LinkLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream

/**
 * The half of `apps.*` that touches `PackageManager`. Everything with a rule in it is
 * [AppsPayloads]; this reads the platform and renders pixels.
 *
 * ### The enumeration is the one the probe measured, not a fresh query
 *
 * [launcherPackages] issues `queryIntentActivities(MAIN/LAUNCHER)` and deduplicates to distinct
 * packages — reading **R2** in `docs/phase-7-apps-proposal.md` §2.4, which returned **122 of 122**
 * against the platform's own count. Its control is the reading that makes it evidence: with the
 * `<queries>` block removed from the manifest, the same call returns **15**. So the declaration is
 * doing the work and this is not an OEM being permissive.
 *
 * **R2 rather than R1, and the twelve entries between them are the argument.** R1 —
 * `getInstalledApplications` filtered by `getLaunchIntentForPackage != null`, which is what
 * `SyncSettingsViewModel` already does — returned **134**. Its extra twelve are non-system packages
 * with no launcher activity at all: Samsung Pass, InCallUI, Traceur, accessibility services. They
 * are admitted by that filter's `!SYSTEM || hasLaunchIntent` shape, they are not apps a person
 * launches, and listing them would put twelve tiles on the Mac that do nothing when clicked.
 *
 * ### Why the launch intent is resolved again at the moment of asking
 *
 * [launchIntentFor] is called by `AppsFeature` when the request arrives, never cached from the list.
 * An app can be uninstalled between the Mac drawing a grid and somebody clicking a tile, and the
 * honest answer then is `NOT_FOUND` rather than a notification offering to open something that is
 * gone. This is the same rule as `fs.delete`'s compare-and-delete: the phone holds the truth and
 * re-checks it at the moment of acting.
 */
object AppsStore {

    /**
     * Every package with a launcher activity, as one entry each, labels resolved.
     *
     * Both counters are published on one line because a count with no denominator is not evidence:
     * `resolved / fell back` is the number that tells "twelve apps have odd names" from "the
     * `<queries>` block is gone and every name is a package id".
     */
    fun apps(context: Context): List<AppsPayloads.App> {
        val pm = context.packageManager
        val packages = launcherPackages(pm)
        var fallbacks = 0

        val apps = packages.mapNotNull { packageName ->
            val info = runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
                } else {
                    @Suppress("DEPRECATION")
                    pm.getPackageInfo(packageName, 0)
                }
            }.getOrNull()

            // Resolution goes through AppLabels always, including when it fails — that is where
            // the fallback is *counted*. A raw package id interpolated here would be defect 28
            // again, in the namespace that meets package ids more often than any other.
            val label = AppLabels.of(context, packageName)
            val isFallback = label == packageName
            if (isFallback) fallbacks += 1

            AppsPayloads.App(
                packageName = packageName,
                label = label,
                updatedMs = info?.lastUpdateTime ?: 0L,
                versionName = info?.versionName,
                labelIsFallback = isFallback,
            )
        }

        LinkLog.i(
            "apps",
            "Enumerated ${apps.size} launcher packages — ${apps.size - fallbacks} labelled / " +
                "$fallbacks fell back to the package id. This counts PACKAGES; `adb shell cmd " +
                "package query-activities` counts ACTIVITIES and is a larger number for the same phone.",
        )
        return apps
    }

    /**
     * Reading R2: distinct packages resolving `MAIN`/`LAUNCHER`.
     *
     * `distinct()` is load-bearing and is the units fix. `queryIntentActivities` returns one
     * `ResolveInfo` per *activity*, and a package publishing two launcher entries appears twice —
     * which is precisely how a ground truth of 244 activities came to be compared against 122
     * packages and would have reported a visibility gap that does not exist.
     */
    fun launcherPackages(pm: PackageManager): List<String> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(intent, 0)
            }
        }.getOrElse {
            LinkLog.e("apps", "queryIntentActivities(MAIN/LAUNCHER) threw — no reading", it)
            emptyList()
        }
        return resolved.map { it.activityInfo.packageName }.distinct()
    }

    /** The intent that opens [packageName], or null when it has none — resolved at the moment of asking. */
    fun launchIntentFor(context: Context, packageName: String): Intent? =
        runCatching { context.packageManager.getLaunchIntentForPackage(packageName) }.getOrNull()

    /**
     * Launcher icons as base64 PNG, one entry per package **in request order**, errors per item.
     *
     * PNG rather than JPEG, and that is not a default. Launcher icons have transparency and most on
     * this device are adaptive, so a JPEG would composite every one onto an opaque background — a
     * different picture from the one on the phone's home screen, silently, for every tile.
     *
     * A failure is one entry's `error`, never the batch's, exactly as `media.thumb` does it: an app
     * uninstalled between the list and the icon request must not cost the other 31 their pictures.
     */
    fun icons(context: Context, packages: List<String>, edge: Int): List<JsonObject> {
        val pm = context.packageManager
        var made = 0
        var failed = 0

        val icons = packages.map { packageName ->
            val drawable = runCatching { pm.getApplicationIcon(packageName) }.getOrNull()
            if (drawable == null) {
                failed += 1
                return@map buildJsonObject {
                    put("package", packageName)
                    put("error", "NOT_FOUND")
                }
            }
            val bytes = runCatching { encode(drawable, edge) }.getOrNull()
            if (bytes == null) {
                failed += 1
                return@map buildJsonObject {
                    put("package", packageName)
                    put("error", "RENDER_FAILED")
                }
            }
            made += 1
            buildJsonObject {
                put("package", packageName)
                put("mime", "image/png")
                put("width", edge)
                put("height", edge)
                put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            }
        }

        LinkLog.i("apps", "apps.icon → $made made / $failed failed of ${packages.size} asked, edge=$edge")
        return icons
    }

    /**
     * A `Drawable` at [edge]×[edge], as PNG bytes.
     *
     * The `BitmapDrawable` shortcut is a real optimisation and not premature: a legacy icon is
     * already a bitmap and re-drawing it through a `Canvas` at its own size is a copy for nothing.
     * Everything else — every adaptive icon on this device, which is most of them — has no
     * intrinsic bitmap and *must* go through the canvas, because `AdaptiveIconDrawable` composites
     * a background and a foreground layer and only `draw()` knows how.
     */
    private fun encode(drawable: Drawable, edge: Int): ByteArray {
        val bitmap = if (drawable is BitmapDrawable && drawable.bitmap != null) {
            drawable.bitmap.scale(edge)
        } else {
            Bitmap.createBitmap(edge, edge, Bitmap.Config.ARGB_8888).also { target ->
                val canvas = Canvas(target)
                drawable.setBounds(0, 0, edge, edge)
                drawable.draw(canvas)
            }
        }
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
    }

    private fun Bitmap.scale(edge: Int): Bitmap =
        if (width == edge && height == edge) this else Bitmap.createScaledBitmap(this, edge, edge, true)
}
