package com.chetan.connectsuite.input

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The four things that can become of a gesture, and the one that used to be unreachable.
 *
 * **This class exists because of defect 18.** Eighty-five unit tests passed while every single
 * gesture on hardware came back as a refusal, because not one of them followed a *successful*
 * dispatch all the way out to the value the Mac would be sent. The geometry was tested, the action
 * lists were tested, the capability contract was tested — and the seam between `withTimeoutOrNull`
 * and a nullable success type, where the bug actually lived, was tested by nothing.
 *
 * So the first test below is the regression guard, and it is deliberately the dullest one here:
 * a gesture that completes must not be reported as a timeout.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GestureDispatchTest {

    @Test
    fun `a gesture that completes is not reported as a timeout`() = runTest {
        val outcome = awaitGestureResult(budgetMs = 2_060) { sink ->
            sink.completed()
            true
        }

        // The whole of defect 18 in one assertion. Before the fix the production code reached this
        // point holding `null` and could not tell whether that meant "it worked" or "it never came
        // back", so it guessed the second and was wrong every time.
        assertEquals(GestureOutcome.Completed, outcome)
    }

    @Test
    fun `a completed gesture becomes an ack, not an error`() = runTest {
        // One step further out than the test above: the value the Mac actually receives. `null`
        // here is `InputFeature.answer`'s signal to ack, and it is the only route to a successful
        // tap in the entire feature.
        val failure = resolve { sink -> sink.completed(); true }
        assertNull("a completed gesture must ack, not refuse", failure)
    }

    @Test
    fun `a gesture that never answers is reported as a timeout`() = runTest {
        // The other half of the discriminator: silence must still time out. A fix that made
        // success work by making the timeout unreachable would pass the test above and fail here.
        val failure = resolve(budgetMs = 50) { true } // accepted, then never calls back

        assertNotNull(failure)
        assertTrue(failure is InputFailure.GestureRefused)
        assertTrue(
            "the refusal should name the budget it exceeded, got: ${failure?.reason}",
            failure?.reason?.contains("50ms") == true,
        )
    }

    @Test
    fun `a cancelled gesture says the system cancelled it`() = runTest {
        val failure = resolve { sink -> sink.cancelled(); true }

        assertTrue(failure is InputFailure.GestureRefused)
        assertTrue(failure?.reason?.contains("cancelled") == true)
    }

    @Test
    fun `a gesture the system will not accept says so, and does not wait out the budget`() =
        runTest {
            val failure = resolve(budgetMs = 60_000) { false }

            assertTrue(failure is InputFailure.GestureRefused)
            assertTrue(failure?.reason?.contains("would not accept it") == true)
            // If this ever starts hanging for the full budget, the `!accepted` branch has stopped
            // answering and every refused gesture will block the one behind it for a minute.
        }

    @Test
    fun `a dispatch that throws is reported with the exception's own words`() = runTest {
        val failure = resolve { throw IllegalStateException("service not connected") }

        assertTrue(failure is InputFailure.GestureRefused)
        assertTrue(
            "the refusal should carry the exception's message, got: ${failure?.reason}",
            failure?.reason?.contains("service not connected") == true,
        )
    }

    @Test
    fun `the first answer wins when the platform both refuses and calls back`() = runTest {
        // Documented behaviour on at least one Android version: the callback fires *and* the
        // return value is false. Resuming twice would crash the coroutine machinery, so the
        // second answer has to be dropped rather than merely ignored.
        val outcome = awaitGestureResult(budgetMs = 2_000) { sink ->
            sink.completed()
            false
        }

        assertEquals(GestureOutcome.Completed, outcome)
    }

    @Test
    fun `success is not representable as null`() = runTest {
        // The structural guarantee, pinned so that nobody re-introduces defect 18 by "simplifying"
        // GestureOutcome back down to a nullable InputFailure. If this file stops compiling
        // because GestureOutcome became a typealias for InputFailure?, that is the bug returning.
        val completed: GestureOutcome = GestureOutcome.Completed
        assertNotNull(completed)
        assertTrue(completed !is GestureOutcome.Failed)
    }

    // ---- defect 20: the app in front changed while the gesture waited ------------------------

    @Test
    fun `a gesture whose app is still in front is dispatched`() {
        assertNull(foregroundGuard("com.android.settings", "com.android.settings"))
    }

    @Test
    fun `a gesture aimed at an app that is no longer in front is refused, by name`() {
        val failure = foregroundGuard("com.android.settings", "com.sec.android.app.launcher")

        assertTrue(failure is InputFailure.ForegroundChanged)
        // Both names in the sentence: the user needs to know what they aimed at as well as what
        // caught it, or the refusal reads as the phone being arbitrary.
        assertTrue(failure!!.reason.contains("com.android.settings"))
        assertTrue(failure.reason.contains("com.sec.android.app.launcher"))
        assertEquals("foreground-changed", failure.label)
    }

    @Test
    fun `not knowing what is in front loses the guard rather than refusing the gesture`() {
        // A phone that will not say, or a caller that did not capture, must not turn every gesture
        // into a refusal. Ignorance is a reason to stop guarding, never a reason to say no.
        assertNull(foregroundGuard("com.android.settings", null))
        assertNull(foregroundGuard(null, "com.android.settings"))
        assertNull(foregroundGuard(null, null))
    }

    /** What [InputFeature] would end up sending: null to ack, an [InputFailure] to refuse. */
    private suspend fun resolve(
        budgetMs: Long = 2_060,
        dispatch: (GestureSink) -> Boolean,
    ): InputFailure? = when (val outcome = awaitGestureResult(budgetMs, dispatch)) {
        GestureOutcome.Completed -> null
        is GestureOutcome.Failed -> outcome.failure
    }
}
