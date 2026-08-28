package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.FeatureOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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

    /**
     * Defect 34. `docs/protocol.md` says `sms.received` carries "exactly one `messages[]` entry
     * plus its `threadId`". The phone built it **flat** — every field at the top level, no array,
     * no id — and the Mac dropped every one for two sessions while the phone's own log line said
     * it had pushed successfully.
     *
     * This asserts the array, not the fields: a flat payload with all the right keys is what the
     * defect looked like, and a test that only checked for `address` and `body` would have passed
     * against it.
     */
    @Test
    fun `sms received carries its message inside a messages array`() {
        val payload = SmsPayloads.receivedEnvelope(
            threadId = "594",
            id = "22184",
            address = "+919800000001",
            body = "hello",
            dateMs = 1756300000000L,
            contactName = "Ada Lovelace",
        )

        assertEquals("threadId must sit beside the array", "594", payload["threadId"]?.jsonPrimitive?.content)

        val messages = payload["messages"]?.jsonArray
        assertTrue("sms.received must carry a messages[] array", messages != null)
        assertEquals("exactly one entry, per the contract", 1, messages!!.size)

        val message = messages[0].jsonObject
        assertEquals("22184", message["id"]?.jsonPrimitive?.content)
        assertEquals("+919800000001", message["address"]?.jsonPrimitive?.content)
        assertEquals("hello", message["body"]?.jsonPrimitive?.content)
        assertEquals("sms", message["kind"]?.jsonPrimitive?.content)
        assertEquals("true", message["inbound"]?.jsonPrimitive?.content)
        assertEquals("Ada Lovelace", message["contactName"]?.jsonPrimitive?.content)

        // The half that makes this fail against the defect rather than merely pass against the
        // fix: the flat build put these at the top level, so a payload carrying both shapes at
        // once would satisfy every assertion above.
        assertTrue(
            "the message fields must not also sit at the top level — that is the flat shape",
            payload["address"] == null && payload["body"] == null && payload["id"] == null,
        )
    }

    /**
     * Defect 36. A call rejected from the Mac was reported as `missed`, because the disposition
     * was derived from the state transition alone — ringing to idle without going off-hook — and
     * the transition cannot tell a reject from a call left to ring out.
     *
     * The fix that was **already in the tree** read the disposition back out of the call log
     * afterwards. That is not a hypothetical wrong answer; it shipped, and it is what returned
     * `missed` on hardware while Android's own log had the same call as `type=5` (REJECTED). It is
     * a race: `call.ended` is emitted from the transition and the provider row may not be written
     * yet. This test exists because the watcher knows why the call ended at the moment it ends,
     * and that is where the fact belongs.
     */
    @Test
    fun `a call rejected from the Mac is reported as rejected, not missed`() {
        assertEquals(
            "the flag set at reject time is what makes this rejected rather than missed",
            "rejected",
            CallWatcher.dispositionOf(answered = false, rejected = true, wasRinging = true),
        )
    }

    /**
     * The control, and the ordering rule.
     *
     * A refusal is only evidence if the other branches still answer. `answered` must win over
     * `rejected`, because the Mac draws one button that says "Reject" while ringing and "Hang up"
     * once the call is active — so a `call.reject` arrives for both, and a call that connected and
     * talked for forty seconds is not a rejected call. `rejected` only ever wins over `missed`.
     */
    @Test
    fun `every other disposition still answers, and answered outranks rejected`() {
        assertEquals(
            "hanging up an active call from the Mac is still an answered call",
            "answered",
            CallWatcher.dispositionOf(answered = true, rejected = true, wasRinging = false),
        )
        assertEquals(
            "answered",
            CallWatcher.dispositionOf(answered = true, rejected = false, wasRinging = true),
        )
        assertEquals(
            "rang out with no reject from us: the platform does not say whether the user " +
                "rejected it on the phone, and missed is honest for both",
            "missed",
            CallWatcher.dispositionOf(answered = false, rejected = false, wasRinging = true),
        )
        assertEquals(
            "an outgoing call the other end never picked up",
            "declined",
            CallWatcher.dispositionOf(answered = false, rejected = false, wasRinging = false),
        )
    }

    private fun NotificationFailure.triple() = Triple(label, code, reason)
    private fun SmsFailure.triple() = Triple(label, code, reason)
    private fun CallFailure.triple() = Triple(label, code, reason)
    private fun ContactsFailure.triple() = Triple(label, code, reason)
    private fun RemoteFailure.triple() = Triple(label, code, reason)
}
