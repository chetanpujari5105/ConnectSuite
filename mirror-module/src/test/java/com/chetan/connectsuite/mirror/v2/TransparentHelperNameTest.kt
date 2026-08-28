package com.chetan.connectsuite.mirror.v2

import com.chetan.connectsuite.core.app.AppForeground
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [AppForeground] names [MirrorConsentActivity] as a string because :core cannot depend on
 * :mirror-module. This is the check that stops that string rotting.
 *
 * The cost of it rotting is specific and silent: the consent shim would be recorded as the screen
 * the user is on, the next consent request would be launched from an Activity that is already
 * finishing, and Android 16 would treat that as a background start and drop it — putting the mirror
 * back to exactly the hang this test's neighbours were written for.
 */
class TransparentHelperNameTest {

    @Test
    fun `AppForeground knows the real name of the consent shim`() {
        val real = MirrorConsentActivity::class.java.name
        assertTrue(
            "AppForeground.transparentHelpers must contain $real; it has " +
                "${AppForeground.transparentHelpers}. Did MirrorConsentActivity move or get renamed?",
            real in AppForeground.transparentHelpers,
        )
    }
}
