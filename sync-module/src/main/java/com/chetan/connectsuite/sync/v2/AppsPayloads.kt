package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The pure half of `apps.*` — everything about the payloads that does not need a `PackageManager`.
 *
 * Split out for the reason `SmsPayloads` and `CallWatcher.dispositionOf` were: a JVM unit test that
 * merely *references* an object holding an Android static in a field initializer dies with
 * `ExceptionInInitializerError`, so the decisions worth testing have to live somewhere a plain JVM
 * can call them. [AppsStore] is the half that touches the platform; this is the half with rules in
 * it.
 *
 * ### The one number this file exists to get right
 *
 * `apps.list` reports **two** counts and they are not the same number:
 *
 *  - `count` — how many entries are in this response.
 *  - `total` — how many the phone enumerated before the cap.
 *
 * They differ only when [MAX_APPS] bites, and the whole point is that the difference is *visible*.
 * `CLAUDE.md`'s rule about instruments reporting their own bounds is usually written about probes;
 * a payload is an instrument too, and a list that silently returns its first thousand rows is the
 * 200-page probe cap wearing a wire format — the Mac would draw the bound and read it as the phone.
 *
 * ### And the units, which cost a fictional defect once already
 *
 * The measurement that produced this feature first compared the app's reading of **122 distinct
 * packages** against a ground truth of **244 launcher-resolvable activities**, and would have
 * reported a 45% visibility gap that does not exist. `query-activities` counts activities; every
 * app-side query here counts *packages*, deduplicated. One package can publish several launcher
 * activities — a browser with a separate incognito entry, a suite with two front doors — so the two
 * numbers are honestly different and neither is wrong. Anything comparing them has to say which it
 * is holding, which is why [MAX_APPS] is documented in packages and [entry] is one per package.
 */
object AppsPayloads {

    /**
     * The hard cap on one `apps.list` response, **in packages**.
     *
     * 122 on the handset this was measured on, with 244 launcher *activities* behind them. A
     * thousand is far above anything a phone plausibly has and is here as a bound on the wire frame
     * rather than as a product decision — the control frame is capped at 16 MB and an icon-free
     * entry is well under 200 bytes, so this cannot be the thing that overruns it. When it does
     * bite, `total` says so.
     */
    const val MAX_APPS = 1000

    /** The phone's cap on `packages` in one `apps.icon` request, mirrored on the Mac. */
    const val MAX_ICON_PACKAGES = 32

    /** Icon edge in px, clamped. 96 is two device-pixel-ratios above the 48pt tile the Mac draws. */
    const val DEFAULT_ICON_EDGE = 96
    const val MIN_ICON_EDGE = 24
    const val MAX_ICON_EDGE = 192

    /**
     * One app, as the Mac reads it.
     *
     * [label] is not nullable and never absent, which is `CLAUDE.md`'s package-id rule expressed in
     * the payload rather than in a review comment: **a package id is a handle, and a handle may not
     * be the only thing a user reads.** `AppLabels.of` returns the package name as its honest
     * fallback for a package it cannot resolve, so [label] is always *something* — and where that
     * something is the handle, [labelIsFallback] says so rather than leaving the Mac to infer it.
     */
    data class App(
        val packageName: String,
        val label: String,
        val updatedMs: Long,
        val versionName: String?,
        /** True when [label] is the package id — the fallback, not a name. Drawn differently. */
        val labelIsFallback: Boolean,
    )

    fun entry(app: App): JsonObject = buildJsonObject {
        put("package", app.packageName)
        put("label", app.label)
        put("updatedMs", app.updatedMs)
        app.versionName?.let { put("versionName", it) }
        // Sent rather than left for the Mac to recompute by comparing two strings. The comparison
        // is cheap and the *reason* is not reconstructable: `label == package` is also true for an
        // app genuinely named after its package, and the phone is the only side that knows whether
        // the lookup actually failed. A Mac that inferred it would be a second expression of a rule
        // that already has a home — the failure `MediaPayloadsTest` was fixed for.
        if (app.labelIsFallback) put("labelIsFallback", true)
    }

    /**
     * The order the grid is drawn in: by label, case-insensitively, then by package to break ties.
     *
     * Sorted on the phone rather than on the Mac because the phone is the side that resolved the
     * labels, and a Mac sorting by a string it did not produce would disagree with the phone's own
     * screens about where an app sits. The package tiebreak is not decorative: two apps genuinely
     * can carry one label — a work-profile clone, an OEM shipping *Internet* twice — and an
     * unstable sort would shuffle them between refreshes for no reason a user could see.
     *
     * `lowercase()` rather than a locale collator on purpose: this object is pure Kotlin so it can
     * be tested on a plain JVM, and a collator would make the order depend on the JVM's default
     * locale, which is a different thing on the phone and in the test.
     */
    fun sorted(apps: List<App>): List<App> =
        apps.sortedWith(compareBy({ it.label.lowercase() }, { it.packageName }))

    /** [MAX_APPS] applied, and the two counts that make the cut visible if it ever happens. */
    data class Page(val apps: List<App>, val count: Int, val total: Int) {
        val truncated: Boolean get() = count < total
    }

    fun page(apps: List<App>): Page {
        val ordered = sorted(apps)
        val kept = ordered.take(MAX_APPS)
        return Page(apps = kept, count = kept.size, total = ordered.size)
    }

    /**
     * The `maxEdge` this phone will render for, or null when the request is out of bounds.
     *
     * Null rather than a clamp, deliberately. Clamping would answer a request for a 4096px icon
     * with a 192px one and call it a success, which is the same shape as an ack that means *asked*
     * being read as *opened*: the caller believes it got what it asked for. A refusal that names
     * the bounds is one round trip and no confusion.
     */
    fun iconEdgeOrNull(maxEdge: Int?): Int? {
        val edge = maxEdge ?: DEFAULT_ICON_EDGE
        return if (edge in MIN_ICON_EDGE..MAX_ICON_EDGE) edge else null
    }

    /** Whether an `apps.icon` request asks for a batch this phone will serve. */
    fun iconBatchIsLegal(size: Int): Boolean = size in 1..MAX_ICON_PACKAGES
}
