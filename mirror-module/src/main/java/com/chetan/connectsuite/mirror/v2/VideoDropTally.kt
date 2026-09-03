package com.chetan.connectsuite.mirror.v2

import java.util.concurrent.atomic.AtomicInteger

/**
 * Why a video frame did not reach the Mac, counted per reason.
 *
 * ### Defect 52
 *
 * `VideoChannel` dropped frames for **three** reasons behind **one** counter, and the third never
 * reached it at all:
 *
 * | Reason | What it means | Was |
 * |---|---|---|
 * | [staleEvicted] | a stale P-frame made way for a newer one — **the queue working** | `dropped++` |
 * | [newestShed] | nothing sheddable was left, so the newcomer went — **the mirror visibly stalling** | `dropped++` |
 * | [oversize] | the encoder produced a frame past `Link.MAX_FRAME` — **a correctness fault** | *nothing* |
 *
 * A run of 120 of the first and a run of 120 of the second are the same number and want opposite
 * responses. The third was worse than conflated: it was invisible in `droppedCount()` and therefore
 * in the `droppedFrames` field `mirror.stats` puts on the wire, so **the only channel-level
 * correctness fault the mirror has did not appear in the mirror's own statistics.**
 *
 * ### The reporting rule this also fixes
 *
 * The old warning read `Dropped N frames; the Mac is behind` — a sentence asserting a cause the
 * counter did not decide. It is a fair guess for the first reason, an understatement for the second,
 * and simply **wrong** for the third, where the Mac is not behind and never saw the frame. Counting
 * by reason is what lets the line say what happened instead of guessing why.
 */
class VideoDropTally {

    private val stale = AtomicInteger(0)
    private val newest = AtomicInteger(0)
    private val over = AtomicInteger(0)

    /**
     * Frames that made it into the queue.
     *
     * The denominator lives here rather than being fetched from the encoder, because a count and
     * the number that gives it meaning drifting apart is the failure this class exists under. The
     * encoder's `encodedFrames` is a different question — how much the encoder produced — and using
     * it here would compare two units, which this repo has a rule about.
     */
    private val accepted = AtomicInteger(0)

    /** A stale P-frame evicted to make room. The queue doing its job. */
    fun staleEvicted(): Int = stale.incrementAndGet()

    /** Only keyframes and config left, so the arriving frame was shed. The link is badly behind. */
    fun newestShed(): Int = newest.incrementAndGet()

    /** The encoder produced a frame larger than the wire allows. Not congestion — a fault. */
    fun oversize(): Int = over.incrementAndGet()

    /** A frame reached the queue. */
    fun acceptedNow(): Int = accepted.incrementAndGet()

    fun acceptedCount(): Int = accepted.get()
    fun staleCount(): Int = stale.get()
    fun newestCount(): Int = newest.get()
    fun oversizeCount(): Int = over.get()

    /**
     * Every frame that did not reach the Mac, for the `droppedFrames` field on the wire.
     *
     * Includes [oversize], which the old count did not — so this number can now go up for a reason
     * that is not congestion, which is the point.
     */
    fun total(): Int = stale.get() + newest.get() + over.get()

    /**
     * The three reasons named, never summed into one word.
     *
     * The denominator is carried, not assumed. Without it "120 dropped" reads as whichever story
     * the reader already believes, which is the rule this class exists under.
     */
    fun summary(): String =
        "${stale.get()} stale evicted / ${newest.get()} newest shed / ${over.get()} oversize " +
            "of ${accepted.get() + total()} offered"

    /**
     * What to say about the drops so far, choosing the *worst* thing that is true.
     *
     * Never asserts a cause the counters do not support: an oversize frame is a fault regardless of
     * how the link is doing, and it outranks congestion because it is ours rather than the network's.
     */
    fun headline(): String = when {
        over.get() > 0 ->
            "the encoder produced ${over.get()} frame(s) larger than the wire allows — a fault here, not congestion"
        newest.get() > 0 -> "the Mac is badly behind; the newest frames are being shed"
        stale.get() > 0 -> "the Mac is briefly behind; stale frames are being evicted"
        else -> "nothing dropped"
    }
}
