package com.chetan.connectsuite.core.link

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

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
     * `exported="false"`: the system may deliver it and nothing else can.
     *
     * **These used to be one reason and that was defect 77.** The argument for folding them was that
     * the *response* is identical — which is true, and is an argument about `ensureRunning`, not
     * about the log. What it cost: a `BOOT:` line could be produced by `QUICKBOOT_POWERON`, which is
     * unprotected here, so the line could not be told from a real restart. Two such lines sit in this
     * project's log at `2026-09-03T02:13` over a kernel that had been up for twenty-two hours, and a
     * verdict script read them as boots.
     *
     * The correction is defect 60's corollary applied one layer down: it was applied to the three
     * *reasons* and not to the two *actions* sharing this name. Same response, different names.
     */
    BOOT,

    /**
     * Samsung's `QUICKBOOT_POWERON`.
     *
     * Handled **identically** to [BOOT] everywhere a decision is made — same start, same foreground
     * types. It exists as a separate constant for one purpose: so a log line says which action
     * arrived, because this one is **not a protected broadcast on this handset** and [BOOT] is.
     *
     * Whether One UI actually sends it in place of `BOOT_COMPLETED` is still unverified; listening
     * costs nothing and a duplicate delivery is a no-op start on a live service.
     */
    QUICKBOOT,

    /** `ACTION_MY_PACKAGE_REPLACED` — the `adb install -r` hole, arriving as a broadcast. */
    PACKAGE_REPLACED,

    /**
     * The platform rebinding `NotificationMirrorService` after the process died.
     *
     * Defect 62's route, and the one that needs no laptop: a kill whose reason is `(adj 0): crash`
     * does **not** get a `START_STICKY` restart, so the process returns for the listener alone and
     * the phone sits granted and serverless. Measured 2026-09-02.
     */
    LISTENER_REBIND,

    /**
     * The platform binding [ConnectSuiteInputService] — the accessibility service.
     *
     * **Defect 80, and it is the route with no broadcast behind it.** This is the third way this
     * process comes up, and it was invisible until defect 64's closing run removed the other two
     * and left it standing alone: with the notification listener revoked, all eight features
     * installed at 11:54:16 into a process with **no listening socket**, five seconds before
     * `BOOT` arrived behind it.
     *
     * At boot those five seconds close on their own. The cases that matter are the ones where
     * nothing follows — a low-memory kill, the service being toggled off and on, or a crash
     * `START_STICKY` did not catch (defect 62's second measured outcome). In each the accessibility
     * service is rebound, this process returns feature-complete and granted, **and no broadcast is
     * ever sent**. Before this reason existed the app sat serverless for as long as nobody opened
     * it.
     *
     * A fourth start route was argued against while defect 64 was open, because each one is another
     * competitor in the race that had to be stripped down to get a reading. That objection is spent:
     * the race only ever obstructed *proving* the boot branch, 64 is closed, and [ensureRunning] is
     * idempotent and names its own no-op.
     */
    ACCESSIBILITY_BIND,

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
    /** How long the trust-store read may take before the gate gives up and starts anyway. */
    const val TRUST_READ_TIMEOUT_MS = 3_000L

    /**
     * Starts `LinkService` if this phone has something to serve, from any of the automatic routes.
     *
     * **One home for the rule, because there are three callers and there were nearly three copies.**
     * The boot broadcast, the package-replaced broadcast and the notification-listener rebind all
     * want the identical decision — *is there a paired device, and is the link already up* — and a
     * decision written out three times is three things to get wrong.
     *
     * The gate itself: a foreground service means a permanent notification, and posting one on a
     * phone that has never been paired is a notification about nothing. So the trust store is read
     * first and nothing starts when it is empty.
     *
     * It **fails open**. A read that throws or exceeds [TRUST_READ_TIMEOUT_MS] starts the service
     * anyway, because an error is not evidence of an unpaired phone and the two mistakes do not
     * cost the same: a spurious notification is a nuisance, a link that never comes back is the
     * defect all three callers exist for.
     *
     * [onFinished] is run on every path, including the failure ones — a `BroadcastReceiver` using
     * `goAsync()` must call `finish()` or the system holds the process and eventually complains.
     */
    fun ensureRunning(
        context: Context,
        reason: LinkStartReason,
        scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
        onFinished: () -> Unit = {},
    ) {
        val appContext = context.applicationContext
        LinkLog.init(appContext)

        // Cheap, in-process, and the reason this is safe to call from a path that may fire while
        // the link is perfectly healthy: the listener rebinds on an ordinary grant toggle too.
        if (LinkController.peek()?.state?.value?.running == true) {
            LinkLog.i("autostart", "$reason: already listening — nothing to do")
            onFinished()
            return
        }

        scope.launch {
            try {
                val paired = withTimeoutOrNull(TRUST_READ_TIMEOUT_MS) {
                    TrustStore(appContext).let { store ->
                        store.reload()
                        store.trustedCount()
                    }
                }
                when {
                    paired == null -> {
                        LinkLog.w(
                            "autostart",
                            "$reason: trust store did not answer in ${TRUST_READ_TIMEOUT_MS}ms — " +
                                "starting anyway (fail-open)",
                        )
                        startOrLog(appContext, reason)
                    }
                    paired == 0 -> LinkLog.i(
                        "autostart",
                        "$reason: 0 paired device(s) — not starting; nothing would connect and " +
                            "the notification would be about nothing",
                    )
                    else -> {
                        LinkLog.i(
                            "autostart",
                            "$reason: $paired paired device(s), link not running — starting LinkService",
                        )
                        startOrLog(appContext, reason)
                    }
                }
            } catch (e: Exception) {
                LinkLog.w("autostart", "$reason: trust store read failed — starting anyway", e)
                startOrLog(appContext, reason)
            } finally {
                onFinished()
            }
        }
    }

    private fun startOrLog(context: Context, reason: LinkStartReason) {
        runCatching { LinkService.start(context, reason) }
            .onFailure {
                // Android 12+ can refuse a background foreground-service start outright. It will not
                // on this handset — the start measured on 2026-09-02 was granted under
                // PROC_STATE_BFGS — which is exactly why the refusal is logged rather than assumed
                // impossible: the device that proves this code is not the device that will break it.
                LinkLog.e("autostart", "$reason: LinkService.start was refused", it)
            }
    }

    fun reasonFor(action: String?): LinkStartReason? = when (action) {
        "android.intent.action.BOOT_COMPLETED" -> LinkStartReason.BOOT
        ACTION_QUICKBOOT_POWERON -> LinkStartReason.QUICKBOOT
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
            LinkStartReason.LISTENER_REBIND,
            LinkStartReason.ACCESSIBILITY_BIND,
            LinkStartReason.BOOT,
            LinkStartReason.QUICKBOOT,
            LinkStartReason.UNKNOWN,
            -> ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        }
    }
}
