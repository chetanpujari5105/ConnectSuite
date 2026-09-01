package com.chetan.connectsuite.sync.v2

/**
 * One expensive build per key at a time. Callers who arrive while a build is running **wait for it**
 * rather than starting a second.
 *
 * ### The reading this exists for
 *
 * Opening `DCIM/Camera` (16,377 entries) failed every first time. The phone's per-directory snapshot
 * took 10,371 ms against the Mac's 10,000 ms `fs.list` timeout — and each failed attempt started
 * *another full rebuild*, because a cache miss went straight to the read with nothing serialising
 * it. Three overlapping builds of one directory were measured, 10,371 / 11,352 / 10,082 ms, each
 * making the others slower, while the pane drew its failure card for a folder that reads perfectly
 * well. Raising the timeout alone would have made that worse: a longer window is more time in which
 * to start more builds.
 *
 * ### Why it is a class rather than a few lines inside the cache
 *
 * Because it is the part that needs a test, and the cache is not reachable from one. `SafTreeStore`
 * imports `DocumentsContract` and `Snapshots.put` logs through `LinkLog` into `android.util.Log`, so
 * a JVM test of the cache dies on an Android static — and the answer to that in this repo is never
 * `returnDefaultValues = true`, it is to move the pure part out, as `SmsPayloads` and
 * `CallWatcher.dispositionOf` were for defects 34 and 36.
 *
 * So the decision — *does a second caller build, or wait?* — lives here, in one place, with no
 * Android in it, and `SafTreeStoreJoinTest` calls **this** rather than a second copy of the rule.
 * A test containing its own expression of the rule it checks is testing a copy, and the two
 * disagree eventually.
 *
 * ### What it does not promise
 *
 * Nothing about *correctness* of the cached value — [run] is told how to look and how to build, and
 * has no opinion about either. It serialises, and it counts how often serialising it mattered.
 */
internal class SingleFlight<K : Any> {

    /**
     * One lock per key, access-ordered and bounded.
     *
     * Evicting a lock is safe rather than merely tolerable: the worst it can do is let two callers
     * build one key at once, which is exactly the behaviour this replaced. [MAX_LOCKS] is far past
     * the handful of directories a browsing session touches.
     */
    private val locks = object : LinkedHashMap<K, Any>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, Any>) = size > MAX_LOCKS
    }

    private var joined = 0L

    @Synchronized
    private fun lockFor(key: K): Any = locks.getOrPut(key) { Any() }

    @Synchronized
    private fun countJoin() {
        joined++
    }

    /**
     * How many callers waited for someone else's build instead of starting their own.
     *
     * Published beside the cache's own hits and misses, because a join count with nothing next to it
     * cannot be told from a key nobody ever contends on — and contention is the whole reason this
     * exists.
     */
    @Synchronized
    fun joins(): Long = joined

    /**
     * [cached] first; if it is null, take this key's lock and ask **again** before building.
     *
     * The second [cached] call is the line that turns a duplicate build into a wait: a caller that
     * queued behind a build finds the result already there. A null from [build] is returned as-is
     * and nothing is remembered, so a transient failure does not become a cached one.
     */
    fun <V> run(key: K, cached: () -> V?, build: () -> V?): V? {
        cached()?.let { return it }
        synchronized(lockFor(key)) {
            cached()?.let {
                countJoin()
                return it
            }
            return build()
        }
    }

    companion object {
        const val MAX_LOCKS = 32
    }
}
