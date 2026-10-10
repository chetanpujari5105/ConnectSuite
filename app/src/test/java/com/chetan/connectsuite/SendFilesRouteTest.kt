package com.chetan.connectsuite

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Devices' Send files hands a pick to the share flow a Gallery share reaches (UX batch 2026-10-10).
 *
 * The decision is tested by calling it. The wiring — that the picker's result goes to
 * [SendFilesRoute.intentFor], and that the intents name the two existing share activities with a read
 * grant — is read from source, because this module has no Android runtime to build an `Intent` in;
 * the same method `DevicesMacSourceTest` uses, and it says so. The send itself is the share flow's,
 * already proven on hardware (B6, B7).
 */
class SendFilesRouteTest {
    @Test
    fun `nothing picked sends nothing, one file is the single sheet, several are the many sheet`() {
        assertEquals(SendFilesRoute.Target.NOTHING, SendFilesRoute.target(0))
        assertEquals(SendFilesRoute.Target.ONE, SendFilesRoute.target(1))
        assertEquals(SendFilesRoute.Target.MANY, SendFilesRoute.target(2))
        assertEquals("the cap is the many sheet's to refuse, in its own words", SendFilesRoute.Target.MANY, SendFilesRoute.target(500))
    }

    private val src = File("src/main/java/com/chetan/connectsuite").let { dir ->
        listOf("SendFilesRoute.kt", "AppNavigation.kt").associateWith { File(dir, it).readText() }
    }

    @Test
    fun `the intents reach the existing share activities, as a share would, with a read grant`() {
        val route = src.getValue("SendFilesRoute.kt")
        assertTrue(route.contains("Intent(context, ShareToMacActivity::class.java)"))
        assertTrue(route.contains("action = Intent.ACTION_SEND\n"))
        assertTrue(route.contains("Intent(context, ShareManyToMacActivity::class.java)"))
        assertTrue(route.contains("action = Intent.ACTION_SEND_MULTIPLE"))
        assertEquals(2, Regex("addFlags\\(Intent.FLAG_GRANT_READ_URI_PERMISSION\\)").findAll(route).count())
    }

    @Test
    fun `the Devices button opens the picker and its result goes to the route`() {
        val nav = src.getValue("AppNavigation.kt")
        assertTrue(nav.contains("ActivityResultContracts.OpenMultipleDocuments()"))
        assertTrue(nav.contains("SendFilesRoute.intentFor(context, picked)"))
        assertTrue(nav.contains("onSendFiles = { pickFilesToSend.launch(arrayOf(\"*/*\")) }"))
    }
}
