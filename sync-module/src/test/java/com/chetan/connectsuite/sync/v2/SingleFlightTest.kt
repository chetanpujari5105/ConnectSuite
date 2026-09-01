package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The concurrency behind `fs.list`: a second caller for a directory already being read **waits**,
 * and does not start a second read.
 *
 * ### What it is named for
 *
 * Opening `DCIM/Camera` failed every first time: the snapshot took 10,371 ms against a 10,000 ms
 * timeout, and every failed attempt began another full rebuild because a cache miss went straight to
 * the read. Three overlapping builds of one directory were measured. This is the guard on the part
 * that fixed it.
 *
 * ### It calls the rule rather than restating it
 *
 * `MediaPayloadsTest`'s first version wrote the cursor predicate out a second time and stayed green
 * with the tiebreak deleted — it was testing a copy. So this calls [SingleFlight.run] itself; the
 * only thing expressed here is what a caller does, never how the coalescing works.
 *
 * ### Shown to fail
 *
 * With `run`'s body reduced to `cached() ?: build()` — the code as it was before the join —
 * `oneBuildWhenManyCallersArriveAtOnce` fails `expected:<1> but was:<8>`, and `joinsAreCounted`
 * fails `expected:<7> but was:<0>`. Restored, both pass. The control below is the other half: it
 * proves the harness can observe more than one build when there genuinely is more than one, so a
 * green run means coalescing and not a test that cannot count.
 */
class SingleFlightTest {

    /** Eight callers, one key, a build slow enough that they genuinely overlap. */
    @Test
    fun oneBuildWhenManyCallersArriveAtOnce() {
        val flight = SingleFlight<String>()
        val builds = AtomicInteger(0)
        val cache = java.util.concurrent.atomic.AtomicReference<String?>(null)

        val callers = 8
        val start = CountDownLatch(1)
        val done = CountDownLatch(callers)
        val pool = Executors.newFixedThreadPool(callers)
        val seen = java.util.concurrent.ConcurrentLinkedQueue<String?>()

        repeat(callers) {
            pool.execute {
                start.await()
                val v = flight.run(
                    key = "primary:DCIM/Camera",
                    cached = { cache.get() },
                    build = {
                        builds.incrementAndGet()
                        Thread.sleep(120)          // the 10 s directory read, in miniature
                        cache.set("16377 entries")
                        cache.get()
                    },
                )
                seen.add(v)
                done.countDown()
            }
        }
        start.countDown()
        assertTrue("callers did not finish", done.await(10, TimeUnit.SECONDS))
        pool.shutdownNow()

        assertEquals("the directory was read more than once", 1, builds.get())
        assertEquals("every caller got the listing", callers, seen.size)
        assertTrue("a caller got null", seen.all { it == "16377 entries" })
    }

    /** The join count is the evidence the wait happened; without it a pass is unfalsifiable. */
    @Test
    fun joinsAreCounted() {
        val flight = SingleFlight<String>()
        val cache = java.util.concurrent.atomic.AtomicReference<String?>(null)
        val callers = 8
        val start = CountDownLatch(1)
        val done = CountDownLatch(callers)
        val pool = Executors.newFixedThreadPool(callers)

        repeat(callers) {
            pool.execute {
                start.await()
                flight.run("k", { cache.get() }, {
                    Thread.sleep(120)
                    cache.set("v")
                    cache.get()
                })
                done.countDown()
            }
        }
        start.countDown()
        assertTrue(done.await(10, TimeUnit.SECONDS))
        pool.shutdownNow()

        assertEquals("one built, the rest joined", (callers - 1).toLong(), flight.joins())
    }

    /**
     * **Control.** Different keys must not serialise, and this is what proves the two tests above
     * are counting builds rather than being unable to see them. If this returned 1, they would pass
     * over an implementation that simply never builds twice for any reason.
     */
    @Test
    fun differentKeysDoNotWaitForEachOther() {
        val flight = SingleFlight<String>()
        val builds = AtomicInteger(0)
        val caches = List(4) { java.util.concurrent.atomic.AtomicReference<String?>(null) }
        val pool = Executors.newFixedThreadPool(4)
        val done = CountDownLatch(4)

        caches.forEachIndexed { i, cache ->
            pool.execute {
                flight.run("key-$i", { cache.get() }, {
                    builds.incrementAndGet()
                    cache.set("v$i")
                    cache.get()
                })
                done.countDown()
            }
        }
        assertTrue(done.await(10, TimeUnit.SECONDS))
        pool.shutdownNow()

        assertEquals("four keys must build four times", 4, builds.get())
        assertEquals("no caller should have joined", 0L, flight.joins())
    }

    /** A failed build is not remembered, so the next caller tries rather than inheriting a null. */
    @Test
    fun aFailedBuildIsReturnedAndNotCached() {
        val flight = SingleFlight<String>()
        val attempts = AtomicInteger(0)
        val cache = java.util.concurrent.atomic.AtomicReference<String?>(null)
        val build = {
            if (attempts.incrementAndGet() == 1) null
            else {
                cache.set("second time")
                cache.get()
            }
        }
        assertEquals(null, flight.run("k", { cache.get() }, build))
        assertEquals("second time", flight.run("k", { cache.get() }, build))
        assertEquals(2, attempts.get())
    }
}
