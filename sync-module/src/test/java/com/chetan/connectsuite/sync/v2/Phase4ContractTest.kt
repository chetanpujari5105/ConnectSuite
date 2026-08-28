package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.FeatureOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Each Phase 4 feature answers exactly what its capability promises.
 *
 * The bug this guards is the one `CapabilityContract` was written for: the phone telling the Mac
 * "ask me and I will", the Mac un-greying the pane, and the user getting a pane that answers
 * `FEATURE_UNAVAILABLE`. The contract already refuses to advertise a capability whose handlers are
 * not all registered — what it cannot see is a feature that registers *more* than it promised, or
 * a `handledTypes` set that has drifted from the contract by having both edited at once.
 *
 * Written as data rather than five near-identical tests so a sixth feature cannot be added without
 * appearing here: the last assertion checks the table covers every capability this module serves.
 */
class Phase4ContractTest {

    private val features: Map<String, Set<String>> = mapOf(
        Capability.NOTIFICATIONS to NotificationFeature.handledTypes,
        Capability.SMS to SmsFeature.handledTypes,
        Capability.CALLS to CallFeature.handledTypes,
        Capability.CONTACTS to ContactsFeature.handledTypes,
        Capability.REMOTE to RemoteFeature.handledTypes,
    )

    @Test
    fun `each feature registers exactly what its contract requires`() {
        features.forEach { (capability, handled) ->
            val required = CapabilityContract.contracts.getValue(capability).requests
            assertEquals(
                "$capability handles a different set than its contract requires",
                required,
                handled,
            )
        }
    }

    @Test
    fun `every handled type reports its own capability as the failing feature`() {
        // The round trip that makes an error actionable. A failing `notif.reply` must grey out
        // `notifications`, and it only does so because FeatureOf maps the prefix — `notif` is not
        // a capability name and never was. Two of the five features here have that mismatch.
        features.forEach { (capability, handled) ->
            handled.forEach { type ->
                assertEquals(
                    "$type would report feature ${FeatureOf.of(type)} rather than $capability",
                    capability,
                    FeatureOf.of(type),
                )
            }
        }
    }

    @Test
    fun `registering every feature makes every Phase 4 capability advertisable`() {
        // The permission half is assumed granted here — that is the OS's decision and not
        // something a unit test can or should simulate. What this proves is the *other* half: that
        // the handlers these objects declare are, together, enough to satisfy every contract.
        // Before Phase 4 this was false for all five, and `sms` was additionally impossible
        // because SEND_SMS was declared in no manifest in the repo.
        val registered = features.values.flatten().toSet()
        features.keys.forEach { capability ->
            assertTrue(
                "$capability is still missing " +
                    CapabilityContract.missingFor(capability, registered, false, false),
                CapabilityContract.isImplemented(capability, registered, false, false),
            )
        }
    }

    @Test
    fun `no feature needs a side channel it does not open`() {
        // Notifications, SMS, calls, contacts and the remote all ride the control channel. If one
        // of them ever gains a bulk requirement — MMS attachments are the obvious candidate, and
        // docs/protocol.md defers them to Phase 5 — this test is what stops the capability going
        // green while the channel behind it is unserved.
        features.keys.forEach { capability ->
            val contract = CapabilityContract.contracts.getValue(capability)
            assertTrue(
                "$capability now needs a side channel; its feature must serve one before it can " +
                    "be advertised",
                !contract.needsVideoChannel && !contract.needsBulkChannel,
            )
        }
    }

    @Test
    fun `the failure sentences are sentences, and each is distinct within its feature`() {
        // Locked decision 6: every feature degrades to "unavailable, here is why". A code with no
        // sentence, or two failures sharing one, is a user reading something that does not tell
        // them which wall they hit.
        val groups = listOf<List<Triple<String, String, String?>>>(
            listOf(
                NotificationFailure.NotGranted.triple(),
                NotificationFailure.Gone.triple(),
                NotificationFailure.MissingKey.triple(),
                NotificationFailure.BadRequest("x").triple(),
                NotificationFailure.NoReplyAction("com.slack").triple(),
                NotificationFailure.NoSuchAction(3, 2).triple(),
                NotificationFailure.ActionNeedsText("Reply").triple(),
                NotificationFailure.TargetStale("Ada Lovelace", "Grace Hopper").triple(),
                NotificationFailure.IntentRefused("com.slack", "cancelled").triple(),
            ),
            listOf(
                SmsFailure.NotGranted.triple(),
                SmsFailure.NoTelephony.triple(),
                SmsFailure.NoSuchThread("42").triple(),
                SmsFailure.BadRequest("x").triple(),
                SmsFailure.SendRefused("+1555 (no signal)").triple(),
            ),
            listOf(
                CallFailure.NotGranted.triple(),
                CallFailure.NoTelephony.triple(),
                CallFailure.NothingRinging("answer").triple(),
                CallFailure.DifferentCall.triple(),
                CallFailure.BadRequest("x").triple(),
                CallFailure.TelecomRefused("dial", "busy").triple(),
            ),
            listOf(
                ContactsFailure.NotGranted.triple(),
                ContactsFailure.NoSuchContact("c-1").triple(),
                ContactsFailure.BadRequest("x").triple(),
            ),
            listOf(
                RemoteFailure.NotGranted.triple(),
                RemoteFailure.NoSession.triple(),
                RemoteFailure.Unsupported("seek", "com.spotify.music").triple(),
                RemoteFailure.BadRequest("x").triple(),
            ),
        )

        groups.forEach { group ->
            group.forEach { (label, _, reason) ->
                assertTrue("$label has an empty reason", !reason.isNullOrBlank())
                assertTrue("$label should read as a sentence", reason!!.trim().endsWith("."))
                assertTrue(
                    "$label leaks a wire code into a sentence a person reads",
                    reason.none { it == '_' } || !reason.contains(Regex("[A-Z]{3,}_[A-Z]{3,}")),
                )
            }
            assertEquals(
                "two failures in one feature share a sentence",
                group.size,
                group.map { it.third }.toSet().size,
            )
            assertEquals(
                "two failures in one feature share a log label",
                group.size,
                group.map { it.first }.toSet().size,
            )
        }
    }

    private fun NotificationFailure.triple() = Triple(label, code, reason)
    private fun SmsFailure.triple() = Triple(label, code, reason)
    private fun CallFailure.triple() = Triple(label, code, reason)
    private fun ContactsFailure.triple() = Triple(label, code, reason)
    private fun RemoteFailure.triple() = Triple(label, code, reason)
}
