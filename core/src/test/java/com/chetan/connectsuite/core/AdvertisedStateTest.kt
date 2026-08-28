package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.AdvertisedState
import com.chetan.connectsuite.core.link.advertisementChanged
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 27: a reason that changed while the capability name set did not was invisible on the wire.
 *
 * Revoking notification access left the Mac showing "granted in Settings, but Android has not
 * started the service — turn the switch off and on again to rebind it" for a grant that had just
 * been taken away, and it stood for as long as the grant stayed off. The recompute that would have
 * corrected it ran 255ms later and decided nothing had changed, because it compared names.
 */
class AdvertisedStateTest {

    private val advertised = setOf("mirror", "notifications", "remote")

    @Test
    fun `a reason changing on its own counts as a change`() {
        val before = AdvertisedState(
            names = setOf("mirror"),
            reasons = mapOf(
                "notifications" to
                    "granted in Settings, but Android has not started the service",
            ),
        )
        val after = before.copy(
            reasons = mapOf("notifications" to "missing Notification access"),
        )

        assertTrue(
            "the name set is identical and the remedy is now the opposite one — the Mac must be told",
            advertisementChanged(before, after),
        )
    }

    @Test
    fun `the name set changing still counts as a change`() {
        val before = AdvertisedState(advertised, emptyMap())
        val after = AdvertisedState(setOf("mirror"), mapOf("notifications" to "missing Notification access"))

        assertTrue(advertisementChanged(before, after))
    }

    @Test
    fun `nothing changing is not a change`() {
        val state = AdvertisedState(advertised, mapOf("sms" to "missing SMS"))

        assertFalse(
            "a refresh that found the same thing must not wake every connected client",
            advertisementChanged(state, state.copy()),
        )
    }

    @Test
    fun `the first refresh is always a change`() {
        assertTrue(advertisementChanged(null, AdvertisedState(advertised, emptyMap())))
    }

    /**
     * A capability gaining a reason where it had none is the shape every remaining feature will hit
     * — a permission granted while the component behind it is still down. Same absent name, new
     * remedy.
     */
    @Test
    fun `a reason appearing or disappearing counts`() {
        val without = AdvertisedState(setOf("mirror"), emptyMap())
        val with = AdvertisedState(setOf("mirror"), mapOf("input" to "missing Accessibility"))

        assertTrue(advertisementChanged(without, with))
        assertTrue(advertisementChanged(with, without))
    }
}
