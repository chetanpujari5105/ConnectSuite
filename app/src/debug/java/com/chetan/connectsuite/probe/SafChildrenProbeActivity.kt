package com.chetan.connectsuite.probe

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import com.chetan.connectsuite.sync.v2.FsRoots
import com.chetan.connectsuite.sync.v2.SafTreeStore

/**
 * One bounded children query per granted tree, for defect 137. **Debug-only.**
 *
 * The phone lists 0 entries for every granted tree while `fs.stat` reads the same trees fine. This
 * splits the two remaining layers: did the provider hand back a cursor with no rows, or rows that
 * [SafTreeStore]'s parse then dropped? It calls [SafTreeStore.probeRootChildren] — the product's
 * own URI builder, projection and resolver — on the tree **root** only, at most
 * [SafTreeStore.PROBE_MAX_ROWS] rows, with no recursion and no cache.
 *
 * It requests no grant, writes nothing, and logs counts, column names and failure categories only —
 * no display name, document id or file content. Grants come from [FsRoots.grantedTrees], the one
 * reader of `persistedUriPermissions`.
 *
 * Run: `adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.SafChildrenProbeActivity`
 * Read: `adb logcat -d -s SafChildrenProbe:V`
 */
class SafChildrenProbeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val stores = FsRoots.all(this).filterIsInstance<SafTreeStore>()
        Log.i(TAG, "BEGIN trees=${stores.size} cap=${SafTreeStore.PROBE_MAX_ROWS}")
        Thread {
            stores.forEach { store ->
                val p = runCatching { store.probeRootChildren(SafTreeStore.PROBE_MAX_ROWS) }
                    .getOrElse {
                        Log.w(TAG, "tree=${store.label} probe threw ${it.javaClass.name}")
                        return@forEach
                    }
                Log.i(
                    TAG,
                    "tree=${store.label} uri=${p.uriShape} cursor=${if (p.cursorReturned) "returned" else "NULL"} " +
                        "count=${p.cursorCount} columns=${p.columnNames} examined=${p.rowsExamined}/cap ${p.cap} " +
                        "accepted=${p.accepted} rejected=${p.rejected} extrasKeys=${p.extrasKeys} " +
                        "loading=${p.loading} error=${p.hasError} info=${p.hasInfo} queryFailure=${p.queryFailure}",
                )
            }
            Log.i(TAG, "END")
        }.start()
        finish()
    }

    private companion object {
        const val TAG = "SafChildrenProbe"
    }
}
