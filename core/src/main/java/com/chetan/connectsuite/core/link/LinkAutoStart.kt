package com.chetan.connectsuite.core.link

import android.content.pm.ServiceInfo
import android.os.Build

/**
 * Why `LinkService` was asked to start, and what foreground-service types that permits.
 *
 * This exists as its own file, with no Android context in it, because the interesting decision —
 * *which* foreground types may be claimed — is made by a platform rule that this project cannot
 * reproduce on demand and therefore cannot measure before shipping. A pure function is the only
 * part of it a unit test can reach, so the decision is put somewhere a test can call rather than
 * being inlined into `LinkService.onCreate` where nothing could see it.
 *
 * ### The rule, and exactly how much of it was measured
 *
 * `FGS_BOOT_COMPLETED_RESTRICTIONS` is a real, active compat change on the phone under test, read
 * from the device rather than from a release note:
 *
 * ```
 * $ adb shell dumpsys platform_compat | grep BOOT_COMPLETED
 * ChangeId(296558535; name=FGS_BOOT_COMPLETED_RESTRICTIONS; enableSinceTargetSdk=35; overridable)
 * ```
 *
 * It carries no `disabled` marker and no per-package override for us, and the platform reports our
 * `targetSdk=36`. So the restriction **applies to this app on this device**. That much is a
 * reading.
 *
 * What is **not** a reading is *which* foreground-service types it denies. That set is compiled
 * into the framework's `ForegroundServiceTypePolicy` and is not exposed by any `dumpsys` this
 * project could find; the documented set is `dataSync`, `camera`, `mediaPlayback`, `phoneCall`,
 * `mediaProjection` and `microphone`, and `LinkService` declares `connectedDevice|dataSync` — so
 * the documented answer is that a naive boot start throws.
 *
 * And it cannot be measured here. `BOOT_COMPLETED` is a protected broadcast; on this handset
 * `adb root` is refused (`adbd cannot run as root in production builds`) and
 * `am broadcast -a android.intent.action.BOOT_COMPLETED` is denied outright
 * (`SecurityException: Permission Denial … from uid=2000`). A real reboot is the only stimulus,
 * and a reboot is the user's hands.
 *
 * So this code is written so the unmeasured half does not matter: a boot start claims
 * `connectedDevice` **only**, which is the minimal honest type for a service whose job is holding
 * a link to a connected device, and which is on the documented *allowed* list. If the documented
 * denial set is wrong in either direction, `connectedDevice` is still correct. The `dataSync` type
 * is only ever added on a start the user can see — which is also the only kind of start that has
 * ever had a bulk transfer behind it.
 */
enum class LinkStartReason {
    /** A visible Activity, the notification action, or anything else the user drove. */
    USER,

    /**
     * `ACTION_BOOT_COMPLETED`, or Samsung's `QUICKBOOT_POWERON`, which is the same event on a
     * fast restart and is a **different, unprotected** action on this handset — measured:
     *
     * ```
     * $ adb shell am broadcast -a android.intent.action.QUICKBOOT_POWERON -p …
     * Broadcast completed: result=0          # no SecurityException, unlike BOOT_COMPLETED
     * ```
     *
     * Unprotected means any app could send it, which is why [LinkBootReceiver] stays
     * `exported="false"`: the system may deliver it and nothing else can. The two are folded into
     * one reason because the response is identical and because a device that sends both would
     * otherwise start the service twice — harmless, since a second `startForegroundService` on a
     * live service is a no-op start, but there is no reason to distinguish them.
     */
    BOOT,

    /** `ACTION_MY_PACKAGE_REPLACED` — the `adb install -r` hole, arriving as a broadcast. */
    PACKAGE_REPLACED,

    /** `START_STICKY` handed us back a null intent. We do not know who wanted us. */
    UNKNOWN,
    ;

    companion object {
        const val EXTRA = "com.chetan.connectsuite.link.START_REASON"

        fun fromExtra(value: String?): LinkStartReason =
            entries.firstOrNull { it.name == value } ?: UNKNOWN
    }
}

object LinkAutoStart {

    /** Samsung's fast-restart broadcast. Not in `Intent`, so it is spelled out. */
    const val ACTION_QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"

    /**
     * The reason an incoming broadcast [action] represents, or `null` if this receiver has no
     * business acting on it.
     *
     * Pulled out of the receiver so the mapping is reachable by a test. It is the only part of
     * [LinkBootReceiver] a JVM test can execute at all — the rest needs a `Context`, a Room
     * database and a real broadcast — and it is also the part that a manifest edit can silently
     * desynchronise from, by adding a filter for an action nothing here maps.
     */
    fun reasonFor(action: String?): LinkStartReason? = when (action) {
        "android.intent.action.BOOT_COMPLETED", ACTION_QUICKBOOT_POWERON -> LinkStartReason.BOOT
        "android.intent.action.MY_PACKAGE_REPLACED" -> LinkStartReason.PACKAGE_REPLACED
        else -> null
    }

    /**
     * The foreground-service types to claim for a start made for [reason].
     *
     * Returns `0` below API 34, where `startForeground` takes no type at all and passing one is
     * meaningless rather than merely unnecessary.
     *
     * [UNKNOWN] is treated as [BOOT] deliberately. A null-intent `START_STICKY` restart inherits
     * whatever allowance the original start had, and the original start may well have been the
     * boot one; claiming the smaller set costs nothing and guessing the larger set is the only
     * choice here that can throw.
     */
    fun foregroundTypesFor(reason: LinkStartReason, sdkInt: Int = Build.VERSION.SDK_INT): Int {
        if (sdkInt < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return 0
        return when (reason) {
            LinkStartReason.USER ->
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            LinkStartReason.PACKAGE_REPLACED,
            LinkStartReason.BOOT,
            LinkStartReason.UNKNOWN,
            -> ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        }
    }
}
