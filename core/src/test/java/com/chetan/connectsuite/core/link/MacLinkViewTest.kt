package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import com.chetan.connectsuite.core.model.DeviceType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 145: the phone's Mac screens read one projection of the v2 link.
 *
 * Every state here is reached through [LinkState]'s own transitions — the ones [LinkServer] calls —
 * rather than built by hand, so a drop or a reconnect that the server writes wrongly is a drop or
 * reconnect this test sees wrongly too. What it does not reach: the Compose collection that
 * redraws Devices when the flow emits. That was checked on the SM-S938B.
 */
class MacLinkViewTest {

    private val mac = TrustedDeviceEntity(
        deviceId = "mac-1",
        name = "Chetans-MacBook-Pro",
        type = DeviceType.DESKTOP,
        certificate = "",
        fingerprint = "fp",
        pairedAtMillis = 1L,
        lastSeenAtMillis = 1L,
        lastAddress = "10.0.0.5",
    )
    private val otherPhone = mac.copy(deviceId = "phone-2", name = "Pixel", type = DeviceType.PHONE)

    private val listening = LinkState().afterListeningStarted(nowMillis = 1_000)

    @Test
    fun `paired and waiting is paired, not connected`() {
        val view = MacLinkView.of(listening, listOf(mac))
        assertTrue(view.paired)
        assertFalse(view.connected)
        assertEquals("Chetans-MacBook-Pro", view.name)
    }

    @Test
    fun `connect, drop and reconnect each change the view, through the server's own transitions`() {
        val up = listening.afterSessionReady("Chetans-MacBook-Pro")
        assertTrue("connect", MacLinkView.of(up, listOf(mac)).connected)

        val down = up.afterSessionEnded("Chetans-MacBook-Pro", closeReason = "socket closed", nowMillis = 2_000)
        assertFalse("drop", MacLinkView.of(down, listOf(mac)).connected)

        val again = down.afterSessionReady("Chetans-MacBook-Pro")
        assertTrue("reconnect", MacLinkView.of(again, listOf(mac)).connected)
    }

    @Test
    fun `the live session's name wins over the stored one`() {
        val up = listening.afterSessionReady("Renamed Mac")
        assertEquals("Renamed Mac", MacLinkView.of(up, listOf(mac)).name)
        assertEquals("10.0.0.5", MacLinkView.of(up, listOf(mac)).address)
    }

    @Test
    fun `only a desktop row is the Mac, and nothing paired and nothing live is not paired`() {
        assertFalse(MacLinkView.of(listening, listOf(otherPhone)).paired)
        assertEquals(null, MacLinkView.of(listening, listOf(otherPhone)).name)
        assertFalse(MacLinkView.of(listening, emptyList()).paired)
    }

    @Test
    fun `send files stays unavailable on a live link, and says why`() {
        val up = listening.afterSessionReady("Chetans-MacBook-Pro")
        val view = MacLinkView.of(up, listOf(mac))
        // Control: the link really is up, so the refusal is about the send path, not the link.
        assertTrue(view.connected)
        assertFalse(view.canSendFiles)
        assertTrue(MacLinkView.SEND_FILES_REASON.contains("Files pane on your Mac"))
    }
}
