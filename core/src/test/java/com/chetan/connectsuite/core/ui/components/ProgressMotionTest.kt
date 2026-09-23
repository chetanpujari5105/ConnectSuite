package com.chetan.connectsuite.core.ui.components

import com.chetan.connectsuite.core.ui.components.ProgressMotion.Step
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The Transfers bar's motion rule. What this does not reach: the `Animatable` that runs a [Step],
 * and Android's animator scale — those were checked on a device (`docs/testing.md`).
 */
class ProgressMotionTest {

    @Test
    fun `unknown stays neutral`() {
        assertEquals(Step.Hide, ProgressMotion.step(null, null))
        assertEquals(Step.Hide, ProgressMotion.step(0.4f, null))
    }

    @Test
    fun `the first known reading is drawn at once, never eased in from empty`() {
        assertEquals(Step.Snap(0.37f), ProgressMotion.step(null, 0.37f))
    }

    @Test
    fun `a higher reading eases, and only to that reading`() {
        assertEquals(Step.Ease(0.5f), ProgressMotion.step(0.25f, 0.5f))
    }

    @Test
    fun `the bar never eases into full`() {
        assertEquals(Step.Snap(1f), ProgressMotion.step(0.9f, 1f))
        assertEquals(Step.Snap(1f), ProgressMotion.step(0.9f, 1.3f))
    }

    @Test
    fun `a lower reading is drawn at once, not eased backwards`() {
        assertEquals(Step.Snap(0.1f), ProgressMotion.step(0.6f, 0.1f))
        assertEquals(Step.Snap(0.6f), ProgressMotion.step(0.6f, 0.6f))
    }
}
