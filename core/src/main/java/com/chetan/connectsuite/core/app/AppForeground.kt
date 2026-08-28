package com.chetan.connectsuite.core.app

import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicInteger

/**
 * Whether this process currently has a visible Activity, and which one.
 *
 * It exists because Android 16 blocks background activity starts outright. A socket handler that
 * calls `startActivity` from the background does not get an exception — the system drops the
 * start, writes `Background activity launch blocked!` to its own log, and returns normally. Any
 * callback waiting on that activity waits forever. So the only safe way to ask for consent is to
 * know, *before* asking, whether there is a foreground Activity to ask from; that is this.
 *
 * A foreground service is not enough. The link runs as `connectedDevice|dataSync`, and those types
 * carry no background-activity-start exemption — the block observed on this project was recorded
 * with `callingUidProcState: FOREGROUND_SERVICE` and blocked anyway.
 *
 * `started` is counted rather than held as a boolean because a rotation stops the old Activity
 * after starting the new one, and a boolean flickers false across that.
 */
object AppForeground {

    private val started = AtomicInteger(0)

    @Volatile
    private var resumed: WeakReference<Activity>? = null

    /** True when at least one Activity of this app is between onStart and onStop. */
    val isForeground: Boolean get() = started.get() > 0

    /**
     * The Activity to launch consent from, or null when there is none.
     *
     * Starting from an Activity context rather than the Application context is what makes the
     * start legal: the system sees a visible Activity in the calling UID and allows it.
     */
    fun visibleActivity(): Activity? =
        resumed?.get()?.takeIf { !it.isFinishing && !it.isDestroyed }

    fun install(application: Application) {
        application.registerActivityLifecycleCallbacks(
            object : Application.ActivityLifecycleCallbacks {
                override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit

                override fun onActivityStarted(activity: Activity) {
                    started.incrementAndGet()
                }

                override fun onActivityResumed(activity: Activity) {
                    // Consent shims and other transparent helpers must not become the Activity we
                    // launch the next consent prompt from: they finish immediately, and a start
                    // issued from a finishing Activity is treated as a background start again.
                    if (activity.javaClass.name in transparentHelpers) return
                    resumed = WeakReference(activity)
                }

                override fun onActivityPaused(activity: Activity) {
                    if (resumed?.get() === activity) resumed = null
                }

                override fun onActivityStopped(activity: Activity) {
                    started.decrementAndGet()
                }

                override fun onActivitySaveInstanceState(activity: Activity, out: Bundle) = Unit

                override fun onActivityDestroyed(activity: Activity) {
                    if (resumed?.get() === activity) resumed = null
                }
            },
        )
    }

    /**
     * Activities that are visible but are not somewhere the user is: they exist only to host a
     * system dialog and finish as soon as it answers.
     *
     * Named rather than referenced because :core cannot depend on the feature modules that
     * declare them. A rename that is not made here costs a failed consent start, which is why
     * `TransparentHelperNameTest` in :mirror-module checks the string against the real class.
     */
    val transparentHelpers: Set<String> = setOf(
        "com.chetan.connectsuite.mirror.v2.MirrorConsentActivity",
    )
}
