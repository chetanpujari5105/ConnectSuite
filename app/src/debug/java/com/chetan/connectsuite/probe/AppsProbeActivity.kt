package com.chetan.connectsuite.probe

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.activity.ComponentActivity

/**
 * The instrument for `docs/phase-7-apps-proposal.md` §2 — **debug-only**, in `src/debug/` so it
 * cannot reach a release build, and written before a line of `apps.*` exists.
 *
 * ### Two questions, and only one of them is about counting
 *
 * **Q1 — what can this app enumerate?** Ground truth from the platform, measured 2026-09-02:
 * 615 packages installed, 112 third-party, **244 launcher-resolvable**. The last is the number the
 * app must be compared against, and the gap between what `adb` sees and what we see is the reading.
 *
 * **Q2 — may we launch an app while backgrounded?** Four BAL compat changes are live for this
 * package and `targetSdk` is 36, so all of them apply. `MirrorScreen` already records that a
 * backgrounded app cannot raise the capture prompt. **There is no prior art for launching a
 * third-party app** — both `getLaunchIntentForPackage` calls in the tree open *our own* app from a
 * notification a person taps.
 *
 * ### The failure this is built to catch
 *
 * Not a crash. **`startActivity` returning normally and nothing coming to the front.** That is the
 * fourth row of the proposal's decision table, it is the outcome every automated check calls a pass,
 * and it fails only in a user's hand. So a launch reading is never one value:
 *
 *  - did `startActivity` throw?
 *  - did the target **actually come to the front**, read from `ActivityManager`/`dumpsys`?
 *  - what did logcat say?
 *
 * **`dumpsys` is the only witness that counts for the second question, and logcat silence is not an
 * answer in either direction.** A blocked background start is often logged by the system with no
 * exception at all; an unlogged failure is still a failure, and an unlogged success is still a
 * success. The probe therefore reports the front-of-stack reading as the verdict and logcat as
 * context, never the reverse.
 *
 * ### Running it
 *
 * ```
 * adb -s "$(scripts/target-device.sh)" shell am start -n \
 *   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.AppsProbeActivity
 * adb -s "$(scripts/target-device.sh)" logcat -s AppsProbe
 * ```
 *
 * Q1 runs immediately and needs nothing. Q2 needs the operator: the probe schedules a launch for
 * [BACKGROUND_DELAY_MS] and prints an instruction to press **home** before it fires, because the
 * state under test is *backgrounded*, and a reading taken in the foreground answers a different
 * question. It re-reads its own process state at the moment of the attempt and **refuses the
 * reading** if the app is still foreground — the precondition rule from `CLAUDE.md`: the check that
 * decides whether to act is evaluated at the moment of acting.
 */
class AppsProbeActivity : ComponentActivity() {

    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.i(TAG, "=== apps probe: Q1 enumeration ===")
        runQ1()

        Log.i(TAG, "")
        Log.i(TAG, "=== apps probe: Q2 background launch ===")
        Log.i(TAG, "PRESS HOME NOW. The launch fires in ${BACKGROUND_DELAY_MS / 1000}s.")
        Log.i(TAG, "A reading taken in the foreground answers a different question and is refused.")
        handler.postDelayed({ runQ2() }, BACKGROUND_DELAY_MS)
    }

    // ---- Q1 -------------------------------------------------------------------------------------

    /**
     * Deliberately the **same** expression the product uses — `SyncSettingsViewModel`'s filter —
     * rather than a fresh query written for the probe. Defect 50's rule: a hand probe that reaches
     * the platform by a path the app never takes has verified a different mechanism.
     */
    private fun launcherVisible(pm: PackageManager): List<String> {
        val installed = if (android.os.Build.VERSION.SDK_INT >= 33) {
            pm.getInstalledApplications(PackageManager.ApplicationInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.getInstalledApplications(0)
        }
        return installed
            .filter {
                it.flags and ApplicationInfo.FLAG_SYSTEM == 0 ||
                    pm.getLaunchIntentForPackage(it.packageName) != null
            }
            .map { it.packageName }
    }

    private fun runQ1() {
        val pm = packageManager

        // R1 — the product's own enumeration.
        val r1 = runCatching { launcherVisible(pm) }.getOrElse {
            Log.e(TAG, "R1 threw — no reading", it); emptyList()
        }

        // R2 — the other route to the same set. Two clients, one question; if they disagree that is
        // a finding in itself and a third query decides, rather than one being declared correct.
        val r2 = runCatching {
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(intent, 0)
            }.map { it.activityInfo.packageName }.distinct()
        }.getOrElse { Log.e(TAG, "R2 threw", it); emptyList() }

        Log.i(TAG, "R1 getInstalledApplications+launchIntent : ${r1.size}")
        Log.i(TAG, "R2 queryIntentActivities(MAIN/LAUNCHER)  : ${r2.size}")
        Log.i(TAG, "ground truth from adb (2026-09-02)       : 244 launcher-resolvable, 615 installed")

        // The control: a set we already know is present. If these are missing, the enumeration is
        // broken and neither count above is a reading about visibility.
        val mustSee = listOf(packageName, "com.android.settings", "com.android.systemui")
        val seen = mustSee.filter { p -> r1.contains(p) || r2.contains(p) }
        Log.i(TAG, "CONTROL known-present packages visible    : ${seen.size} of ${mustSee.size} $seen")
        if (seen.size < mustSee.size) {
            Log.e(TAG, "CONTROL FAILED — the counts above are not readings about package visibility")
        }

        // Name the misses rather than counting them. "12 fewer" and "the 12 that happen to be
        // Samsung's" are different findings, and only the second one is actionable.
        val union = (r1 + r2).distinct()
        val onlyR1 = r1 - r2.toSet()
        val onlyR2 = r2 - r1.toSet()
        Log.i(TAG, "union                                     : ${union.size}")
        Log.i(TAG, "in R1 only (${onlyR1.size}): ${onlyR1.sorted().joinToString().take(600)}")
        Log.i(TAG, "in R2 only (${onlyR2.size}): ${onlyR2.sorted().joinToString().take(600)}")
        Log.i(
            TAG,
            "R3 CONTROL is NOT run here: it needs the <queries> block removed from " +
                "sync-module/src/main/AndroidManifest.xml and a rebuild. Until it runs, a healthy " +
                "count may be this OEM being permissive rather than the manifest working.",
        )
    }

    // ---- Q2 -------------------------------------------------------------------------------------

    private fun runQ2() {
        val pm = packageManager

        // A target that is certainly present and certainly not us. Chosen at runtime rather than
        // hardcoded, so the probe does not fail on a phone without some particular app.
        val target = listOf("com.android.settings", "com.sec.android.app.launcher")
            .firstOrNull { pm.getLaunchIntentForPackage(it) != null }
            ?: launcherVisible(pm).firstOrNull { it != packageName }
        if (target == null) {
            Log.e(TAG, "Q2: no launchable target found — no reading")
            return
        }

        // The premise, re-checked at the moment of acting rather than assumed from the delay.
        val importance = foregroundImportance()
        val backgrounded = importance > ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
        Log.i(TAG, "Q2 target      : $target")
        Log.i(TAG, "Q2 importance  : $importance (backgrounded=$backgrounded)")
        if (!backgrounded) {
            Log.e(
                TAG,
                "Q2 REFUSED — this process is still foreground, so a launch here answers the " +
                    "foreground question (R4) and says nothing about R5/R6. Re-run and press home.",
            )
            return
        }

        val before = topPackage()
        var threw: String? = null
        runCatching {
            val intent = pm.getLaunchIntentForPackage(target)!!
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        }.onFailure { threw = "${it.javaClass.simpleName}: ${it.message}" }

        Log.i(TAG, "Q2 startActivity threw : ${threw ?: "no"}")

        // The verdict, and it is NOT whether startActivity threw. `dumpsys`/ActivityManager is the
        // only witness for "did it come to the front", and the disagreement between the two is the
        // entire finding this probe exists for.
        handler.postDelayed({
            val after = topPackage()
            Log.i(TAG, "Q2 top before  : $before")
            Log.i(TAG, "Q2 top after   : $after")
            val cameToFront = after == target
            Log.i(TAG, "Q2 came to front (dumpsys witness): $cameToFront")
            when {
                threw != null && !cameToFront ->
                    Log.i(TAG, "VERDICT: refused loudly — an exception. Honest, and mappable to a reason.")
                threw == null && cameToFront ->
                    Log.i(TAG, "VERDICT: launched. Table row 1 or 2 — check R6 with the screen off.")
                threw == null && !cameToFront ->
                    Log.e(
                        TAG,
                        "VERDICT: THE FOURTH ROW — startActivity returned normally and nothing " +
                            "came to the front. A verb built on this would report success and do " +
                            "nothing. Do not ship apps.launch on this evidence.",
                    )
                else ->
                    Log.i(TAG, "VERDICT: threw AND came to front — inspect; the exception may be unrelated.")
            }
            Log.i(
                TAG,
                "NOTE: logcat silence is not an answer either way. A blocked background start is " +
                    "often logged with no exception; an unlogged failure is still a failure. The " +
                    "front-of-stack reading above is the verdict, logcat is context.",
            )
        }, FRONT_CHECK_DELAY_MS)
    }

    private fun foregroundImportance(): Int {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mine = android.os.Process.myPid()
        return am.runningAppProcesses
            ?.firstOrNull { it.pid == mine }
            ?.importance
            ?: Int.MAX_VALUE
    }

    /**
     * The front-of-stack package, as this process can see it.
     *
     * `getRunningTasks` is restricted to our own tasks since Android 5, so this reads null for a
     * foreign app — which is why the run instruction pairs it with `dumpsys activity activities`
     * from the shell. Both are printed; the shell reading is authoritative and this one is the
     * in-process cross-check. Saying that here rather than letting a null be read as "nothing
     * launched" — an absence with an entirely ordinary other cause.
     */
    private fun topPackage(): String? {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        @Suppress("DEPRECATION")
        return runCatching { am.getRunningTasks(1).firstOrNull()?.topActivity?.packageName }
            .getOrNull()
    }

    private companion object {
        const val TAG = "AppsProbe"
        const val BACKGROUND_DELAY_MS = 8_000L
        const val FRONT_CHECK_DELAY_MS = 2_500L
    }
}
