package com.chetan.connectsuite.setup

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 140: Set up Sidekick is reachable from the Devices gear, and is never shown on launch.
 *
 * **What this reaches, and what it does not.** It reads the wiring in the sources — which call
 * passes the route to which screen — because the rendered path needs an emulator or a device, and
 * none was available when it was written (the Mac had 436 MB free). It proves the calls are
 * connected; it does not prove the card draws or that a tap lands. Those were left as on-device
 * checks in `docs/testing.md`.
 */
class SetupReachabilityTest {

    private fun source(path: String) = File("src/main/java/com/chetan/connectsuite/$path").readText()

    /** The argument list of the first call to [name] that is not its declaration. */
    private fun callArgs(text: String, name: String): String {
        val start = Regex("(?<!fun )\\b$name\\(").find(text)?.range?.last
            ?: error("no call to $name")
        var depth = 1
        var i = start + 1
        while (depth > 0) {
            when (text[i]) { '(' -> depth++; ')' -> depth-- }
            i++
        }
        return text.substring(start + 1, i - 1)
    }

    @Test
    fun `the helper reads a nested call's arguments and not its declaration`() {
        val fixture = "fun Foo(a: Int) {}\nval x = Foo(bar(1), b = { go(2) })\n"
        assertEquals("bar(1), b = { go(2) }", callArgs(fixture, "Foo"))
    }

    @Test
    fun `the Devices gear's destination pushes the checklist`() {
        val nav = source("AppNavigation.kt")
        val args = callArgs(nav, "LinkRoute")
        assertTrue("LinkRoute is not handed a route to the checklist:\n$args",
            args.contains("onOpenSetup = { navController.navigate(ROUTE_SETUP) }"))
    }

    @Test
    fun `both states of Mac settings receive it`() {
        val route = source("link/LinkRoute.kt")
        assertTrue("the pairing screen does not receive onOpenSetup",
            callArgs(route, "ConnectMacScreen").contains("onOpenSetup = onOpenSetup"))
        assertTrue("Mac management does not receive onOpenSetup",
            callArgs(route, "MacManagementSection").contains("onOpenSetup = onOpenSetup"))
    }

    @Test
    fun `both states draw the entry`() {
        assertTrue(source("link/ConnectMacScreen.kt").contains("SetupEntryCard(onClick = onOpenSetup)"))
        assertTrue(source("link/LinkRoute.kt").contains("SetupEntryCard(onClick = onOpenSetup)"))
    }

    @Test
    fun `the checklist is landed on only when onboarding completes, never on launch`() {
        val nav = source("AppNavigation.kt")
        val landings = Regex("landingTab = ROUTE_SETUP").findAll(nav).count()
        assertEquals("the checklist is landed on from $landings places", 1, landings)
        val onboarding = callArgs(nav, "OnboardingScreen")
        assertTrue("the one landing is not inside onboarding's completion", onboarding.contains("landingTab = ROUTE_SETUP"))
    }

    @Test
    fun `the checklist's second action opens this app's page in Settings`() {
        val args = callArgs(source("setup/SetupScreen.kt"), "SetupRow")
        val secondary = args.substringAfter("onSecondary =").substringBefore("onNotNow =")
        assertTrue("SetupRow is handed an onSecondary", args.contains("onSecondary ="))
        assertTrue("it opens the app details page", secondary.contains("SpecialAccess.appDetailsIntent(context)"))
    }
}
