package com.chetan.connectsuite.probe

import android.app.Activity
import android.content.ComponentName
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import com.chetan.connectsuite.core.link.LinkLog

/**
 * **Turns one of the two disabled `SEND_MULTIPLE` components on, or back to its manifest default.**
 * Development only, debug source set, exported without a filter and gated by `android.permission.DUMP`,
 * refused outside a debuggable build — the same fences as [ShareDevV3Activity].
 *
 * It exists because the runbook's `pm enable` was **refused by the shell on the Pixel 10 emulator
 * (SDK 37), 2026-09-28**: `SecurityException: Shell cannot change component state`. An app may always
 * change its **own** components, so this is the route that does not depend on the shell's rights. Whether
 * the SM-S938B's shell refuses too is **not measured**.
 *
 * ```
 * scripts/adb-pinned.sh <label> shell am start -n \
 *   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareManyComponentsActivity \
 *   --es component probe --ez on true      # or: component many; on false restores the manifest default
 * ```
 *
 * `on false` sets `COMPONENT_ENABLED_STATE_DEFAULT` — back to the manifest's `enabled="false"`, not an
 * explicit disable — and the line reads back the state the package manager reports afterwards.
 */
class ShareManyComponentsActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val plan = ShareManyComponents.plan(
            debuggable, intent.getStringExtra(EXTRA_COMPONENT),
            if (intent.hasExtra(EXTRA_ON)) intent.getBooleanExtra(EXTRA_ON, false) else null,
        )
        val line = when (plan) {
            is ShareManyComponents.Plan.Refuse -> "component change refused: ${plan.why}"
            is ShareManyComponents.Plan.Set -> {
                val name = ComponentName(this, plan.className)
                val before = packageManager.getComponentEnabledSetting(name)
                packageManager.setComponentEnabledSetting(name, plan.state, PackageManager.DONT_KILL_APP)
                val after = packageManager.getComponentEnabledSetting(name)
                "component ${plan.label}: ${ShareManyComponents.stateName(before)} → ${ShareManyComponents.stateName(after)} " +
                    "(asked ${ShareManyComponents.stateName(plan.state)})"
            }
        }
        Log.i(TAG, line)
        LinkLog.i("share", line)
        finish()
    }

    companion object {
        const val TAG = "ShareManyComponents"
        const val EXTRA_COMPONENT = "component"
        const val EXTRA_ON = "on"
    }
}

/** The rule, with nothing Android in it: exactly two components, two states, and nothing implied. */
internal object ShareManyComponents {

    /** The only components this harness may touch. */
    val ALLOWED = mapOf(
        "many" to "com.chetan.connectsuite.ShareManyToMacActivity",
        "probe" to "com.chetan.connectsuite.probe.ShareManyGrantProbeActivity",
    )

    // PackageManager's values, restated so the rule is JVM-testable; ShareManyComponentsTest pins them.
    const val DEFAULT = 0
    const val ENABLED = 1

    sealed interface Plan {
        data class Set(val label: String, val className: String, val state: Int) : Plan
        data class Refuse(val why: String) : Plan
    }

    fun plan(debuggable: Boolean, component: String?, on: Boolean?): Plan {
        if (!debuggable) return Plan.Refuse("not a debuggable build")
        val cls = ALLOWED[component] ?: return Plan.Refuse("component must be one of ${ALLOWED.keys.joinToString("|")}, got ${component ?: "none"}")
        on ?: return Plan.Refuse("--ez on true|false is required; nothing is implied")
        return Plan.Set(component!!, cls, if (on) ENABLED else DEFAULT)
    }

    fun stateName(s: Int) = when (s) {
        0 -> "default"
        1 -> "enabled"
        2 -> "disabled"
        3 -> "disabled-user"
        4 -> "disabled-until-used"
        else -> "unknown($s)"
    }
}
