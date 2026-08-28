package com.chetan.connectsuite.input

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * What became of one dispatched gesture.
 *
 * Two states, **neither of which is null**, and that is the entire reason this type exists.
 * Defect 18 was `withTimeoutOrNull` wrapped around a block whose success value was `InputFailure?`
 * — where `null` meant "the gesture worked". `withTimeoutOrNull` signals a timeout by returning
 * `null` too, the two meanings collapsed onto one value, and every successful gesture came back to
 * the Mac as "it did not finish within 2100ms". It failed 100% of the time, structurally, for two
 * days, while the platform did exactly what it was asked.
 *
 * So: success is [Completed]. It is an object, it is not null, and no amount of nesting inside a
 * nullable helper can make it look like one.
 */
internal sealed interface GestureOutcome {

    /** The system performed the gesture and said so. */
    data object Completed : GestureOutcome

    /** The system refused it, cancelled it part-way, threw, or never answered at all. */
    data class Failed(val failure: InputFailure) : GestureOutcome
}

/**
 * Dispatches one gesture and waits [budgetMs] for the platform's verdict.
 *
 * [dispatch] stands in for `AccessibilityService.dispatchGesture`: it returns whether the system
 * accepted the gesture for dispatch, and calls exactly one of [GestureSink.completed] or
 * [GestureSink.cancelled] once it knows what became of it. Passing it in rather than calling the
 * service directly is what lets `GestureDispatchTest` drive all four outcomes — completed,
 * cancelled, refused at dispatch, and never answered — with no phone and no Robolectric.
 *
 * Waiting is the point. `dispatchGesture` returns true for "accepted for dispatch", not for
 * "happened", so answering on the return value would tell the Mac a tap landed when the system had
 * cancelled it a frame later. The callback is the only thing that knows.
 */
internal suspend fun awaitGestureResult(
    budgetMs: Long,
    dispatch: (GestureSink) -> Boolean,
): GestureOutcome {
    val outcome = withTimeoutOrNull(budgetMs) {
        suspendCancellableCoroutine<GestureOutcome> { continuation ->
            // The callback and the false return are two paths to the same resume, and on at least
            // one Android version both can happen. Resuming twice crashes the coroutine machinery,
            // so the first answer wins and the second is dropped.
            val answered = AtomicBoolean(false)
            fun answer(outcome: GestureOutcome) {
                if (answered.compareAndSet(false, true)) continuation.resume(outcome)
            }

            val sink = object : GestureSink {
                override fun completed() = answer(GestureOutcome.Completed)
                override fun cancelled() = answer(
                    GestureOutcome.Failed(
                        InputFailure.GestureRefused("the system cancelled it"),
                    ),
                )
            }

            val accepted = try {
                dispatch(sink)
            } catch (e: Exception) {
                answer(
                    GestureOutcome.Failed(
                        InputFailure.GestureRefused(e.message ?: e.javaClass.simpleName),
                    ),
                )
                return@suspendCancellableCoroutine
            }
            if (!accepted) {
                answer(
                    GestureOutcome.Failed(
                        InputFailure.GestureRefused(
                            "the accessibility service would not accept it — the screen may be " +
                                "off, or another gesture may be in progress",
                        ),
                    ),
                )
            }
        }
    }
    // `outcome` is null here for exactly one reason, and the type system now guarantees it: the
    // block never finished. A completed gesture cannot reach this line as null.
    return outcome ?: GestureOutcome.Failed(
        InputFailure.GestureRefused("it did not finish within ${budgetMs}ms"),
    )
}

/** The two things the platform can tell us about a gesture in flight. */
internal interface GestureSink {
    fun completed()
    fun cancelled()
}

/**
 * Whether a gesture aimed at [aimedAt] may still be dispatched now that [nowInFront] is the app in
 * front, or the refusal explaining why not.
 *
 * Defect 20. A gesture is aimed at what the user could see when they made it; the wait behind other
 * gestures is exactly the window in which that stops being true. The coordinates stay perfectly
 * valid for whatever is now in front — which is what makes a late one dangerous rather than merely
 * useless, because nothing else in the chain would notice it landing in the wrong app.
 *
 * Both nulls mean "no opinion" and are allowed through on purpose. A caller that did not capture a
 * package, or a phone that will not say what is in front, is a reason to lose the guard — never a
 * reason to refuse a gesture the user did make.
 */
internal fun foregroundGuard(aimedAt: String?, nowInFront: String?): InputFailure? = when {
    aimedAt == null || nowInFront == null -> null
    aimedAt == nowInFront -> null
    else -> InputFailure.ForegroundChanged(from = aimedAt, to = nowInFront)
}
