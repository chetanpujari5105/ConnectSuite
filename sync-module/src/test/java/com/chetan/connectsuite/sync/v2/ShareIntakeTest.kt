package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.sync.v2.ShareIntake.Availability
import com.chetan.connectsuite.sync.v2.ShareIntake.Decision
import com.chetan.connectsuite.sync.v2.ShareIntake.Refusal
import org.junit.Assert.assertEquals
import org.junit.Test

/** Intent routing and URI handling for the one-file share: one test per refusal, each with its control. */
class ShareIntakeTest {

    private fun decide(
        action: String? = ShareIntake.ACTION_SEND, scheme: String? = "content", clipItems: Int = 0,
        mime: String = "image/png", live: Boolean = false,
    ) = ShareIntake.decide(action, scheme, clipItems, mime, live)

    @Test fun `one content stream is taken, from EXTRA_STREAM or a single ClipData item`() {
        assertEquals(Decision.Take, decide())
        assertEquals(Decision.Take, decide(clipItems = 1))
        assertEquals(Decision.Take, decide(scheme = "CONTENT"))
        assertEquals(Decision.Take, decide(mime = "application/octet-stream"))
    }

    @Test fun `anything but SEND is refused`() {
        assertEquals(Decision.Refuse(Refusal.NOT_A_SEND), decide(action = "android.intent.action.SEND_MULTIPLE"))
        assertEquals(Decision.Refuse(Refusal.NOT_A_SEND), decide(action = null))
    }

    @Test fun `more than one item is refused even when a stream is present`() {
        assertEquals(Decision.Refuse(Refusal.MORE_THAN_ONE), decide(clipItems = 2))
    }

    @Test fun `no stream is refused`() {
        assertEquals(Decision.Refuse(Refusal.NO_FILE), decide(scheme = null))
    }

    @Test fun `a file or other non-content scheme is refused`() {
        assertEquals(Decision.Refuse(Refusal.NOT_CONTENT), decide(scheme = "file"))
        assertEquals(Decision.Refuse(Refusal.NOT_CONTENT), decide(scheme = "http"))
    }

    @Test fun `a folder is refused`() {
        assertEquals(Decision.Refuse(Refusal.FOLDER), decide(mime = "vnd.android.document/directory"))
    }

    @Test fun `a second share while one is live is refused`() {
        assertEquals(Decision.Refuse(Refusal.ANOTHER_IN_PROGRESS), decide(live = true))
    }

    @Test fun `with no Mac connected, or one that cannot receive files yet, nothing is available`() {
        assertEquals(Availability.NotConnected, ShareIntake.availability(null))
        assertEquals(Availability.NotConnected, ShareIntake.availability(""))
        assertEquals(Availability.NotSupported("Chetan's MacBook Pro"), ShareIntake.availability("Chetan's MacBook Pro"))
    }

    @Test fun `Send is available only against a Mac that negotiated share-file 2 and share-ask - the shared fixture`() {
        val mac = "Chetan's MacBook Pro"
        val v1 = mapOf(Extensions.SHARE_FILE to 1)
        val synthetic = mapOf(Extensions.SHARE_FILE to 2)
        val production = mapOf(Extensions.SHARE_FILE to 2, Extensions.SHARE_ASK to 1)
        assertEquals(Availability.NotConnected, ShareIntake.availability(null, production))
        assertEquals("old Mac", Availability.NotSupported(mac), ShareIntake.availability(mac, emptyMap()))
        assertEquals("version 1", Availability.NotSupported(mac), ShareIntake.availability(mac, v1))
        assertEquals("the synthetic-only development Mac", Availability.NotSupported(mac), ShareIntake.availability(mac, synthetic))
        assertEquals("control: the production pairing", Availability.Available(mac), ShareIntake.availability(mac, production))
    }
}
