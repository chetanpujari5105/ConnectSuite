package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.protocol.MessageType
import com.chetan.connectsuite.sync.v2.BulkClaim.Decision
import com.chetan.connectsuite.sync.v2.ShareRoot.Route
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The share root's routing for every `fs.*` verb — enumerated from `MessageType` itself, so a verb
 * added later is covered without anyone remembering to add it — and the bulk-claim rule.
 */
class ShareRootTest {

    private val root = "share:s-Q3v9aP0kT7mR2xW8yB4nZc"

    /** Every `fs.*` wire type, read from MessageType by reflection. */
    private val fsTypes: List<String> = MessageType::class.java.declaredFields
        .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && it.type == String::class.java }
        .map { it.isAccessible = true; it.get(null) as String }
        .filter { it.startsWith("fs.") }

    @Test fun `the enumeration found the fs verbs (control)`() {
        assertTrue(fsTypes.containsAll(listOf(MessageType.FS_LIST, MessageType.FS_STAT, MessageType.FS_THUMB,
            MessageType.FS_MKDIR, MessageType.FS_DELETE, MessageType.FS_TRANSFER_BEGIN, MessageType.FS_TRANSFER_CANCEL)))
    }

    @Test fun `on a share root, only a pull begin is routed to Share — every other fs verb is refused`() {
        fsTypes.forEach { type ->
            val expected = if (type == MessageType.FS_TRANSFER_BEGIN) Route.SharePull("s-Q3v9aP0kT7mR2xW8yB4nZc") else Route.Refuse
            assertEquals(type, expected, ShareRoot.route(type, root, null))
        }
    }

    @Test fun `one refusal test per verb, by name`() {
        assertEquals(Route.Refuse, ShareRoot.route(MessageType.FS_LIST, root, null))
        assertEquals(Route.Refuse, ShareRoot.route(MessageType.FS_STAT, root, null))
        assertEquals(Route.Refuse, ShareRoot.route(MessageType.FS_THUMB, root, null))
        assertEquals(Route.Refuse, ShareRoot.route(MessageType.FS_MKDIR, root, null))
        assertEquals(Route.Refuse, ShareRoot.route(MessageType.FS_DELETE, root, null))
        assertEquals(Route.Refuse, ShareRoot.route(MessageType.FS_TRANSFER_BEGIN, root, "push"))
        assertEquals(Route.Refuse, ShareRoot.route(MessageType.FS_TRANSFER_BEGIN, root, "sideways"))
    }

    @Test fun `a pull with no direction is a pull`() {
        assertEquals(Route.SharePull("s-Q3v9aP0kT7mR2xW8yB4nZc"), ShareRoot.route(MessageType.FS_TRANSFER_BEGIN, root, "pull"))
        assertEquals(Route.SharePull("s-Q3v9aP0kT7mR2xW8yB4nZc"), ShareRoot.route(MessageType.FS_TRANSFER_BEGIN, root, null))
    }

    @Test fun `Files roots and the root listing are untouched (control)`() {
        fsTypes.forEach { type ->
            assertEquals(type, Route.NotShare, ShareRoot.route(type, "saf:primary%3ADCIM", null))
            assertEquals(type, Route.NotShare, ShareRoot.route(type, null, null))
            assertEquals(type, Route.NotShare, ShareRoot.route(type, "downloads:connectsuite", null))
        }
    }

    @Test fun `share transfer ids are 128-bit random, distinct, and never look like a Files id`() {
        val ids = List(2_000) { ShareRoot.newTransferId() }
        assertEquals(ids.size, ids.toSet().size)
        assertTrue(ids.all { ShareRoot.isShareTransfer(it) && it.length == 25 })
        assertFalse(ShareRoot.isShareTransfer("t-7-12345"))
        assertFalse(ShareRoot.isShareTransfer(null))
    }

    // ---- bulk claim -----------------------------------------------------------------------------

    @Test fun `a share pull is claimed only by its own session, at offset 0`() {
        assertEquals(Decision.Claim, BulkClaim.decide(true, "token-A", true, "token-A", 0))
        assertEquals(Decision.WrongSession, BulkClaim.decide(true, "token-A", true, "token-B", 0))
        assertEquals(Decision.WrongSession, BulkClaim.decide(true, "token-A", true, null, 0))
        assertEquals(Decision.WrongOffset, BulkClaim.decide(true, "token-A", true, "token-A", 4096))
    }

    @Test fun `a wrong session is refused even at the wrong offset — session first`() {
        assertEquals(Decision.WrongSession, BulkClaim.decide(true, "token-A", true, "token-B", 4096))
    }

    @Test fun `an unbound pull (Files and Photos today) is claimed exactly as before — defect 148 is separate`() {
        assertEquals(Decision.Claim, BulkClaim.decide(true, null, false, "token-B", 0))
        assertEquals(Decision.Claim, BulkClaim.decide(true, null, false, "token-B", 4096))
        assertEquals(Decision.Unknown, BulkClaim.decide(false, null, false, "token-A", 0))
    }
}
