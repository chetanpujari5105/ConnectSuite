package com.chetan.connectsuite.core.link

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import android.text.TextUtils
import androidx.core.content.ContextCompat
import com.chetan.connectsuite.core.protocol.Capability
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** One capability's full story, for logs, the Mac tab, and the diagnostics screen. */
data class CapabilityStatus(
    val name: String,
    /** The OS permission this needs is granted. */
    val permitted: Boolean,
    /** Handlers (and side channels) for its protocol messages are registered. */
    val implemented: Boolean,
    /** What implementation is still missing; empty when [implemented]. */
    val missing: List<String>,
    /** Which permissions or Settings toggles are still missing; empty when [permitted]. */
    val missingPermissions: List<String> = emptyList(),
    /**
     * The component behind this capability is actually running.
     *
     * **The third gate**, and the one that was missing. It is only ever false for the two
     * capabilities backed by a Settings toggle rather than a permission dialog — a
     * `NotificationListenerService` or an `AccessibilityService` — because those are the only ones
     * where the grant and the running component are separate facts that can disagree.
     *
     * They disagree routinely, and not for a moment — **for the notification listener.**
     * Reinstalling the APK tears the bound components down, and the listener does not come back
     * on its own while the secure setting goes on naming it, so the grant reads as granted
     * forever with nothing behind it. Observed on hardware 2026-08-27 with
     * `dumpsys activity services` showing `app=null` on the listener's ServiceRecord while
     * `enabled_notification_listeners` still named it.
     *
     * **The accessibility service is not known to behave that way, and this comment used to say
     * it did.** Across both reinstalls tested on 2026-08-27 (23:13:15 and 23:19:02) it reconnected
     * by itself within 30ms of process start — `Accessibility service connected`, `input` green,
     * no user action. The gate is still right to cover it, because it *asks* the owning module
     * rather than assuming either way. The claim was the thing that was wrong, and wrong in the
     * direction that costs somebody time: it points a user at a switch that has already rebound.
     *
     * **A force-stop is not a reinstall, and is worse.** After `am force-stop` on 2026-08-27
     * 00:19:43 the accessibility service did not rebind, and by the next morning
     * `enabled_accessibility_services` read `null` — the grant itself was gone, not merely the
     * binding. That is gate 1 failing, not gate 2, and it cannot be repaired from here: an
     * `AccessibilityService` cannot be granted programmatically (see the platform walls in
     * CLAUDE.md), so the user has to turn it back on by hand. The notification listener grant
     * survived the same event. Three distinct behaviours, so none of them should be stated as a
     * rule about "the Settings-toggle capabilities" in general.
     */
    val running: Boolean = true,
) {
    val advertised: Boolean get() = permitted && running && implemented

    /** One line explaining why this is not on offer, or null when it is. */
    val reason: String?
        get() = when {
            advertised -> null
            !permitted && !implemented ->
                "not built yet, and missing ${missingPermissions.joinToString(", ")}"
            // Names *which* switch rather than saying "permission not granted", and names it as
            // Settings does. A user told that `calls` needs "a permission" goes looking for one
            // and finds two — Phone and Call logs — which is what this says. The four underlying
            // constants are deliberately not listed: they describe a screen that does not exist.
            !permitted -> "missing ${missingPermissions.joinToString(", ")}"
            // The sentence that matters most, because the obvious advice is wrong here: the switch
            // in Settings is already on, and telling someone to turn it on sends them in a circle.
            !running ->
                "granted in Settings, but Android has not started the service — this happens " +
                    "after the app is reinstalled or force-stopped; turn the switch off and on " +
                    "again to rebind it"
            else -> "not built yet — waiting on ${missing.joinToString(", ")}"
        }
}

/**
 * What this phone can do for the Mac right now.
 *
 * **Three** gates, all of which must pass:
 *
 *  1. the OS permission or Settings toggle is granted,
 *  2. for the two Settings-toggle capabilities, the component behind it is actually **running**,
 *  3. every message it promises has a registered handler.
 *
 * Gate 2 is the newest and was added after it broke a test rather than in anticipation. Gates 1
 * and 3 were both passing for `notifications` and `remote` while nothing was behind either: a
 * reinstall tears down the bound `NotificationListenerService`, it does not come back on its own,
 * and the secure setting goes on naming the component forever. The Mac was told to expect
 * features that would refuse every request, with a fix hint telling the user to turn on a switch
 * that was already on.
 *
 * `input` was listed here as a third case and should not have been — its `AccessibilityService`
 * rebound unaided on both reinstalls tested. Gate 2 covers it because a component that *can* be
 * down has to be asked, not because it is known to stay down. See [CapabilityStatus.running].
 *
 * A grant is a statement about what the user has allowed. It is not a statement about what is
 * running, and for these two it never was — that is the whole lesson, and it is why gate 2 is
 * supplied by the feature modules through [requireRunning] rather than inferred here. Only the
 * module that owns a component knows whether it is alive.
 *
 * The permission half is re-checked live rather than cached, because the user can revoke any of
 * them from Settings while we are connected. The implementation half is read from the live handler
 * registry, so a feature module registering its handlers is what turns its capability on.
 *
 * [refresh] is called at handshake time, whenever the app resumes, whenever a handler is
 * registered or unregistered, and whenever one of those components binds or unbinds; a change
 * emits `capabilities.changed` on every live session.
 */
class CapabilityDetector(
    private val context: Context,
    /** Message types with a live handler. Supplied by [LinkServer]. */
    private val registeredTypes: () -> Set<String> = { emptySet() },
    private val videoChannelServed: () -> Boolean = { false },
    private val bulkChannelServed: () -> Boolean = { false },
) {

    /**
     * Liveness checks for the Settings-toggle capabilities, registered by their feature modules.
     *
     * Defaults to **absent means not running**, which is the safe direction: a module that has not
     * said its component is alive has not said it is alive. The opposite default is exactly the
     * bug this exists to fix — trusting a grant and finding nothing behind it — so it is not
     * available even as a convenience.
     */
    private val runningChecks =
        java.util.concurrent.ConcurrentHashMap<CapabilityContract.SpecialAccess, () -> Boolean>()

    /**
     * Declares how to tell whether the component behind [access] is running.
     *
     * Called by the feature module that owns the component, at install time. Core cannot ask this
     * question itself — `:core` does not depend on `:sync-module` or `:input-module`, and it
     * should not: only the module holding a bound service reference knows whether it is bound.
     */
    fun requireRunning(access: CapabilityContract.SpecialAccess, isRunning: () -> Boolean) {
        runningChecks[access] = isRunning
    }

    // Starts empty and is filled by the first refresh(). Computing it in the constructor would
    // read LinkServer fields that are not initialised yet, and "advertise nothing until we have
    // actually looked" is the safe direction to be wrong in.
    private val _capabilities = MutableStateFlow<Set<String>>(emptySet())
    val capabilities: StateFlow<Set<String>> = _capabilities.asStateFlow()

    /** The last thing the Mac was told, both halves of it. Null until the first refresh. */
    private var lastAdvertised: AdvertisedState? = null

    /**
     * Why each capability that is not on offer is not on offer.
     *
     * The single source of this map: `refresh()` compares it and `ControlSession` puts it on the
     * wire, so the change the phone notices and the payload it sends cannot disagree.
     */
    fun unavailable(): Map<String, String> {
        val advertised = _capabilities.value
        return diagnostics()
            .filterNot { it.name in advertised }
            .associate { it.name to (it.reason ?: "unavailable") }
    }

    /**
     * Returns true when anything the Mac renders changed, which is the signal to notify clients.
     *
     * **Names or reasons** — see [advertisementChanged] and defect 27. It used to be names alone,
     * which made a correction to a reason invisible: the wrong sentence stood for as long as the
     * grant stayed off, telling the user to toggle a switch that was already off.
     */
    fun refresh(): Boolean {
        val fresh = detect()
        // Order matters: `unavailable()` reads `_capabilities.value` to decide what is absent, so
        // the names go in first and the reasons are computed against them.
        val previous = lastAdvertised
        _capabilities.value = fresh
        val next = AdvertisedState(fresh, unavailable())
        if (!advertisementChanged(previous, next)) return false
        lastAdvertised = next

        val namesChanged = previous?.names != next.names
        LinkLog.i(
            "caps",
            when {
                namesChanged && fresh.isEmpty() ->
                    "Capabilities now: none — " +
                        diagnostics().filter { it.permitted && !it.implemented }
                            .joinToString("; ") { "${it.name} ${it.reason}" }
                            .ifEmpty { "no permissions granted" }
                namesChanged -> "Capabilities now: ${fresh.sorted().joinToString(",")}"
                // The case that used to be silent, and the whole of defect 27. Logged at the same
                // volume as a name change, with the sentence that replaced the old one, because a
                // reason is what the user acts on.
                else -> "Capabilities unchanged (${fresh.sorted().joinToString(",").ifEmpty { "none" }}); " +
                    "reason changed: " + next.reasons.entries
                        .filter { previous?.reasons?.get(it.key) != it.value }
                        .joinToString("; ") { "${it.key} — ${it.value}" }
            },
        )
        return true
    }

    fun current(): Set<String> = _capabilities.value

    // ---- watching the two Settings toggles ----------------------------------------------------

    private var settingsObserver: android.database.ContentObserver? = null

    /**
     * Notices a grant being given or taken away in Settings, without anything else having to fire.
     *
     * **Why this is not redundant with the service callbacks.** Both Settings-toggle capabilities
     * already refresh from their component's lifecycle: `onListenerConnected`/`onListenerDisconnected`
     * for the notification listener, `onServiceConnected`/`onDestroy` for the accessibility
     * service. That is the primary signal and it is the better one, because it reports what is
     * actually running rather than what is allowed.
     *
     * It is also the *only* signal, which is the problem. Everything downstream — the chip on the
     * Mac, `capabilities.changed`, whether a request is even sent — depends on a callback the
     * platform is under no obligation to deliver promptly, or at all, on every OEM. When it does
     * not arrive the capability stays lit indefinitely over a feature that will refuse every
     * request. There is no timer, no poll and no backstop: the state simply never updates again.
     *
     * The only prior observer on either setting lived inside a Compose card in `input-module`
     * (`InputOnboardingCard`), so it watched only while the user happened to be looking at the
     * input onboarding screen, and its own comment called itself "the belt to that braces".
     * Notifications had neither. This is that belt, made durable and moved to where both
     * capabilities can share it.
     *
     * Cheap to the point of being free: two URIs, no polling, and [refresh] already does nothing
     * when the computed set has not changed.
     */
    fun startWatching(onChanged: () -> Unit) {
        if (settingsObserver != null) return
        val resolver = context.contentResolver
        val observer = object : android.database.ContentObserver(null) {
            override fun onChange(selfChange: Boolean) {
                LinkLog.i("caps", "A Settings toggle changed; re-checking capabilities")
                runCatching { onChanged() }
                    .onFailure { LinkLog.w("caps", "Capability refresh failed: ${it.message}") }
            }
        }
        settingsObserver = observer
        runCatching {
            resolver.registerContentObserver(
                Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
                false,
                observer,
            )
            resolver.registerContentObserver(
                Settings.Secure.getUriFor("enabled_notification_listeners"),
                false,
                observer,
            )
        }.onFailure { LinkLog.w("caps", "Could not watch the Settings toggles: ${it.message}") }
    }

    fun stopWatching() {
        val observer = settingsObserver ?: return
        settingsObserver = null
        runCatching { context.contentResolver.unregisterContentObserver(observer) }
    }

    /** Per-capability breakdown: granted, implemented, and what is missing. */
    fun diagnostics(): List<CapabilityStatus> {
        val registered = registeredTypes()
        val video = videoChannelServed()
        val bulk = bulkChannelServed()
        val granted = grantedPermissions()
        val grantedSpecial = specialAccessGranted()
        val liveSpecial = specialAccessRunning()
        return CapabilityContract.allCapabilities.sorted().map { name ->
            val needs = CapabilityContract.contracts[name]?.specialAccess
            CapabilityStatus(
                name = name,
                // Reported against the *grant* alone, so the diagnostics screen can say "you have
                // allowed this, and it still is not running" rather than collapsing both into
                // "not permitted" and sending the user back to a switch they already turned on.
                permitted = CapabilityContract.isPermitted(name, granted, grantedSpecial),
                running = needs == null || needs in liveSpecial,
                implemented = CapabilityContract.isImplemented(name, registered, video, bulk),
                missing = CapabilityContract.missingFor(name, registered, video, bulk),
                missingPermissions =
                    CapabilityContract.missingPermissionsFor(name, granted, grantedSpecial),
            )
        }
    }

    private fun detect(): Set<String> = CapabilityContract.advertisable(
        grantedPermissions = grantedPermissions(),
        // Granted **and** running. This intersection is the fix: everything downstream already
        // treats this set as "special access we actually have", and it was reporting a grant.
        specialAccessHeld = specialAccessGranted() intersect specialAccessRunning(),
        registeredTypes = registeredTypes(),
        videoServed = videoChannelServed(),
        bulkServed = bulkChannelServed(),
    )

    /**
     * Which of the permissions any capability names are actually granted right now.
     *
     * Asks the contract what to check rather than deciding for itself. That inversion is the fix
     * for a real defect: this used to be a hand-written `when` block listing a permission set per
     * capability, and it had drifted from what those capabilities' own messages need — `calls` was
     * gated on `READ_CALL_LOG` and `READ_PHONE_STATE` while `call.dial` needs `CALL_PHONE` and
     * `call.answer`/`call.reject` need `ANSWER_PHONE_CALLS`. The chip would have gone green with
     * three of four verbs dead, and nothing could have noticed, because the list of permissions
     * and the list of messages lived in different files with no relationship between them.
     *
     * Re-read live rather than cached, because the user can revoke any of them from Settings while
     * we are connected.
     */
    private fun grantedPermissions(): Set<String> =
        CapabilityContract.allDeclaredPermissions().filterTo(mutableSetOf()) { granted(it) }

    /** The two Settings toggles, which are not runtime permissions and cannot be requested. */
    private fun specialAccessGranted(): Set<CapabilityContract.SpecialAccess> = buildSet {
        if (isAccessibilityServiceEnabled()) add(CapabilityContract.SpecialAccess.ACCESSIBILITY_SERVICE)
        if (isNotificationListenerEnabled()) add(CapabilityContract.SpecialAccess.NOTIFICATION_LISTENER)
    }

    /** The same two, but actually bound. See [requireRunning] and the class comment. */
    private fun specialAccessRunning(): Set<CapabilityContract.SpecialAccess> =
        CapabilityContract.SpecialAccess.entries
            .filterTo(mutableSetOf()) { runningChecks[it]?.invoke() == true }

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * There is no API to ask "is my accessibility service on"; the enabled list is a
     * colon-separated secure setting of `package/class` entries.
     */
    private fun isAccessibilityServiceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        val prefix = context.packageName + "/"
        return splitter.any { it.startsWith(prefix) }
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ) ?: return false
        return enabled.split(':').any { it.startsWith(context.packageName + "/") }
    }
}
