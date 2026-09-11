package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.FeatureOf
import com.chetan.connectsuite.core.protocol.MessageType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Every feature message must be able to name the capability it belongs to.
 *
 * The bug this exists for is quiet by construction. An `error` names a feature, the Mac greys out
 * the pane with that name, and a name matching no capability greys out nothing — so a feature that
 * is failing on every request looks, on the Mac, exactly like a feature that is fine. Nobody sees
 * it until someone asks why a pane that says it works does not.
 *
 * It has not bitten yet only because `mirror` and `input` spell their prefix and their capability
 * identically. Five of the features still to be built do not: `notif`/`notifications`,
 * `call`/`calls`, `clip`/`clipboard`, `fs`/`files` and `media`/`photos`. The last two were missed
 * when the mapping was first written by eye and were found by this test, which is why it is
 * exhaustive over `MessageType` rather than a list of the cases someone remembered.
 */
class ProtocolNamespaceTest {

    /** Every declared message type, read off MessageType so a new one cannot skip this test. */
    private val allTypes: List<String> = MessageType::class.java.declaredFields
        .filter { it.type == String::class.java }
        .map {
            it.isAccessible = true
            it.get(MessageType) as String
        }

    @Test
    fun `every feature message names a real capability`() {
        // System messages are not a feature and must say so; naming one would grey out a pane
        // because the heartbeat hiccuped.
        val system = setOf(
            MessageType.HELLO, MessageType.HELLO_ACK, MessageType.ACK, MessageType.ERROR,
            MessageType.PING, MessageType.PONG, MessageType.CAPABILITIES_CHANGED,
            MessageType.BATTERY_STATE, MessageType.NET_STATE,
            // `storage.state` sits beside `battery.state` for the same reason and was missed when
            // O4's Device status card added it: it is pushed by the phone, has no inbound verb,
            // and there is no `storage` pane to grey out. **This test was red on `main` from the
            // moment that type landed** — the commit that added it ran the Mac suite and not the
            // phone's, which is the module-blindness of `CLAUDE.md`'s defect-65 entry with the
            // modules the other way round.
            MessageType.STORAGE_STATE,
            // `pair.rejected` is a handshake message and belongs here for the same reason
            // `hello.ack` does: it is emitted *before* the session exists, so there are no
            // capabilities yet and no pane that could be greyed out. Its `pair` prefix is not a
            // capability and must never become one — the Mac keys its copy on the `reason` field.
            //
            // This entry is not the guard being widened to fit new code. It answers the same
            // question the set already asks — "does this message belong to a feature?" — and the
            // answer is no, for a reason the test below asserts rather than merely assuming.
            MessageType.PAIR_REJECTED,
        )

        val unmapped = allTypes.filter { it !in system && FeatureOf.of(it) == null }
        assertEquals("these message types map to no capability: $unmapped", emptyList<String>(), unmapped)

        val misnamed = allTypes.mapNotNull { FeatureOf.of(it) }.filter { it !in Capability.all }
        assertEquals("FeatureOf returned names that are not capabilities: $misnamed", emptyList<String>(), misnamed)
    }

    @Test
    fun `system messages belong to no feature`() {
        assertNull(FeatureOf.of(MessageType.PING))
        assertNull(FeatureOf.of(MessageType.HELLO))
        assertNull(FeatureOf.of(MessageType.ERROR))
        assertNull(FeatureOf.of(MessageType.CAPABILITIES_CHANGED))
        assertNull(FeatureOf.of(MessageType.STORAGE_STATE))
        // The exemption above is asserted here rather than taken on trust. If someone ever teaches
        // `FeatureOf` that `pair` is a capability, the set membership would silently hide it.
        assertNull(FeatureOf.of(MessageType.PAIR_REJECTED))
        // battery.state and net.state have a dot and a prefix that is not a capability. They are
        // system state, not a feature, and must not invent one.
        assertNull(FeatureOf.of(MessageType.BATTERY_STATE))
        assertNull(FeatureOf.of(MessageType.NET_STATE))
    }

    @Test
    fun `the five prefixes that do not spell their capability are mapped anyway`() {
        // The whole reason FeatureOf exists rather than substringBefore('.').
        assertEquals(Capability.NOTIFICATIONS, FeatureOf.of(MessageType.NOTIF_REPLY))
        assertEquals(Capability.CALLS, FeatureOf.of(MessageType.CALL_DIAL))
        assertEquals(Capability.PHOTOS, FeatureOf.of(MessageType.MEDIA_THUMB))
        assertEquals(Capability.CLIPBOARD, FeatureOf.of(MessageType.CLIP_PUSH))
        assertEquals(Capability.FILES, FeatureOf.of(MessageType.FS_LIST))

        // And the ones that do spell it are not broken by the exception table.
        assertEquals(Capability.MIRROR, FeatureOf.of(MessageType.MIRROR_START))
        assertEquals(Capability.INPUT, FeatureOf.of(MessageType.INPUT_TAP))
        assertEquals(Capability.SMS, FeatureOf.of(MessageType.SMS_SEND))
        assertEquals(Capability.CONTACTS, FeatureOf.of(MessageType.CONTACTS_LIST))
        assertEquals(Capability.REMOTE, FeatureOf.of(MessageType.REMOTE_COMMAND))
        assertEquals(Capability.APPS, FeatureOf.of(MessageType.APPS_LIST))
    }

    @Test
    fun `a two-dot type reports the capability its first segment names`() {
        // `apps.open.ask` is the first type in this protocol with two dots, and it is the one place
        // `substringBefore` could plausibly have been written as `substringBeforeLast`. It resolves
        // to `apps` and must: an error on it greys the Apps pane, and nothing is named `open`.
        assertEquals(Capability.APPS, FeatureOf.of(MessageType.APPS_OPEN_ASK))
        assertEquals("apps.open.ask", MessageType.APPS_OPEN_ASK)
    }

    @Test
    fun `every message a capability contract requires maps back to that capability`() {
        // The round trip that matters: the contract says "notifications needs notif.reply", so a
        // failing notif.reply must grey out notifications and nothing else. A mismatch here is the
        // bug in its exact operational form.
        CapabilityContract.contracts.forEach { (capability, contract) ->
            contract.requests.forEach { type ->
                assertEquals(
                    "$type is required by $capability but reports feature ${FeatureOf.of(type)}",
                    capability,
                    FeatureOf.of(type),
                )
            }
        }
    }

    @Test
    fun `Capability all lists every declared capability constant`() {
        val declared = Capability::class.java.declaredFields
            .filter { it.type == String::class.java }
            .map {
                it.isAccessible = true
                it.get(Capability) as String
            }
            .toSet()
        assertEquals("Capability.all must list every constant", declared, Capability.all)
        assertNotNull(CapabilityContract.contracts[Capability.MIC])
        assertEquals(
            "CapabilityContract must have an entry per capability",
            Capability.all,
            CapabilityContract.contracts.keys,
        )
    }
}
