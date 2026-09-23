package com.chetan.connectsuite.sync.ui.devices

import com.chetan.connectsuite.sync.SourceTree
import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 145: the Devices screen reads the Mac from the v2 link, never from the v1 device list.
 *
 * `MacLinkViewTest` (core) holds the projection across connect, drop and reconnect. This holds the
 * wiring the projection cannot see: that the screen asks it rather than `Device.isConnected`, and
 * that Send files is gated on whether a send can work. The rendered screen was checked on the
 * SM-S938B; this cannot draw it.
 */
class DevicesMacSourceTest {

    private val screen: String =
        File(SourceTree.mainSources(), "com/chetan/connectsuite/sync/ui/devices/DevicesScreen.kt").readText()

    /** The shape the defect had: the Mac picked out of `state.devices`, which v1 fills. */
    private val macFromV1List = Regex("""devices\.firstOrNull\s*\{[^}]*DeviceType\.DESKTOP""")

    @Test
    fun `control - the matcher sees the line that caused the defect`() {
        val defect = "val mac = state.devices.firstOrNull { it.type == DeviceType.DESKTOP && it.isConnected }"
        assertTrue(macFromV1List.containsMatchIn(defect))
    }

    @Test
    fun `the Mac is not taken from the v1 device list`() {
        assertFalse(macFromV1List.containsMatchIn(screen))
    }

    @Test
    fun `the header, hero and card read the projection`() {
        assertTrue(screen.contains("val connected = macLink.connected"))
        assertFalse("no Mac-specific read of Device.isConnected", Regex("""\bmac\??\.isConnected""").containsMatchIn(screen))
        assertTrue(screen.contains("YourMacCard(macLink = macLink"))
    }

    @Test
    fun `send files is gated on whether a send can work, and says why when it cannot`() {
        assertTrue(screen.contains("enabled = macLink.canSendFiles"))
        assertTrue(screen.contains("MacLinkView.SEND_FILES_REASON"))
    }
}
