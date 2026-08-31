package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.CapabilityContract.SpecialAccess
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.MessageType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * A capability may only be advertised when the OS will let its handlers actually work.
 *
 * The handler half of the contract has been checked since Phase 1. This is the other half, and it
 * closes a gap that had already produced two live defects:
 *
 * 1. **`calls` was gated on two of the four permissions its own messages need.** `call.log` needs
 *    `READ_CALL_LOG` and `READ_PHONE_STATE`; `call.dial` needs `CALL_PHONE`; `call.answer` and
 *    `call.reject` need `ANSWER_PHONE_CALLS`. The chip would have gone green on the Mac with three
 *    of four verbs unable to work — a promise broken by the OS rather than by a missing handler,
 *    which is precisely what the handler check cannot see.
 * 2. **`sms` required `SEND_SMS`, which was declared in no manifest in the repo.** An undeclared
 *    runtime permission can never be granted, so the capability was permanently grey and no amount
 *    of tapping in Settings would have changed it. It read as "the capability system is broken".
 *
 * Both are the same shape: a permission named in one place and a message named in another, with
 * nothing checking that the first covers the second. The contract now owns both lists, and this
 * checks them against the manifest — the only artefact that decides what can be granted.
 */
class CapabilityPermissionTest {

    /**
     * The app manifest, read as text.
     *
     * A unit test runs with the module directory as its working directory, so `:core`'s tests
     * reach the app manifest by relative path. Reading the XML as text rather than parsing it is
     * deliberate: the question is only "does this string appear as a declared permission", and a
     * parser would add a dependency for no extra confidence.
     */
    private val manifest: String by lazy {
        val file = File("../app/src/main/AndroidManifest.xml")
        assertTrue("app manifest not found at ${file.absolutePath}", file.exists())
        file.readText()
    }

    private fun declared(permission: String): Boolean =
        manifest.contains("android:name=\"$permission\"")

    /**
     * True when [permission] is declared **and not capped below the devices this app runs on**.
     *
     * `maxSdkVersion` is the subtlety this test found on its first run, and it is worth spelling
     * out because "declared" and "grantable" are not the same question. `READ_EXTERNAL_STORAGE` is
     * declared — with `android:maxSdkVersion="32"`, which is correct, because Android 13 replaced
     * it with `READ_MEDIA_IMAGES`. On the phone this project targets (API 35) that declaration
     * grants nothing at all, so a naive substring check would report the photos capability as
     * satisfiable when it is permanently grey.
     *
     * The cap is read out of the manifest rather than assumed, so raising or removing one is
     * picked up without editing this test.
     */
    private fun grantableToday(permission: String): Boolean {
        val entry = Regex(
            """<uses-permission[^>]*android:name="""" + Regex.escape(permission) + """"[^>]*>""",
            RegexOption.DOT_MATCHES_ALL,
        ).find(manifest) ?: return false
        val cap = Regex("""android:maxSdkVersion="(\d+)"""").find(entry.value)
            ?.groupValues?.get(1)?.toIntOrNull()
            ?: return true
        return cap >= MIN_USEFUL_SDK
    }

    /**
     * Capabilities whose permissions are knowingly not grantable yet, with the reason.
     *
     * An allow-list rather than silence, so "not declared" is a decision someone wrote down rather
     * than an omission nobody noticed. Removing an entry here is part of building that phase.
     */
    private val notYetDeclared = mapOf(
        // Photos left this list on 2026-08-31, in the same commit that declared READ_MEDIA_IMAGES
        // and READ_MEDIA_VIDEO — Phase 5 slice 2. The exemption and the declaration move together
        // on purpose: an entry that outlives its reason is an exemption nobody re-reads, and the
        // test above would stop asking the question this file exists to ask.
        Capability.MIC to "no phase; docs/protocol.md defines no mic.* messages at all",
    )

    /**
     * The API level a declaration has to reach to be worth anything here.
     *
     * 33, because that is where Android split storage into the granular media permissions and is
     * therefore the only cap that appears in this manifest. Not `targetSdk`: a permission capped
     * at 34 would still be grantable on plenty of real phones, and calling it undeclared would be
     * wrong.
     */
    private val MIN_USEFUL_SDK = 33

    @Test
    fun `every permission a capability requires is declared in the manifest`() {
        val undeclared = mutableListOf<String>()
        CapabilityContract.contracts.forEach { (capability, contract) ->
            if (capability in notYetDeclared) return@forEach
            contract.permissions.forEach { permission ->
                if (!grantableToday(permission)) undeclared.add("$capability needs $permission")
            }
            if (contract.permissionAlternatives.isNotEmpty() &&
                contract.permissionAlternatives.none { alt -> alt.all { grantableToday(it) } }
            ) {
                // `all`, not `any`: an alternative is satisfied only when every permission in it is
                // declared. Photos' modern alternative needs images *and* video, and a check that
                // accepted one of them would pass over exactly the gap this shape was introduced
                // to close.
                undeclared.add("$capability needs one of ${contract.permissionAlternatives}")
            }
        }
        assertEquals(
            "these permissions are required by a capability and declared in no manifest, so that " +
                "capability can never be granted no matter what the user does: $undeclared",
            emptyList<String>(),
            undeclared,
        )
    }

    @Test
    fun `the not-yet-declared list is accurate in both directions`() {
        // An entry that has become declared is a stale exemption, and a stale exemption is how a
        // capability stays quietly disabled after the work to enable it has landed.
        notYetDeclared.forEach { (capability, why) ->
            val contract = CapabilityContract.contracts.getValue(capability)
            val allOfSatisfied = contract.permissions.all { grantableToday(it) }
            val anyOfSatisfied = contract.permissionAlternatives.isEmpty() ||
                contract.permissionAlternatives.any { alt -> alt.all { grantableToday(it) } }
            assertFalse(
                "$capability is exempted as \"$why\" but its permissions are now grantable — " +
                    "remove it from notYetDeclared",
                allOfSatisfied && anyOfSatisfied,
            )
        }
    }

    @Test
    fun `a declaration capped below Android 13 does not count as grantable`() {
        // The distinction the previous test turns on, asserted directly so it cannot rot into a
        // substring check by accident. READ_EXTERNAL_STORAGE is in the manifest and grants nothing
        // on this phone; SEND_SMS is in the manifest with no cap and grants what it says.
        assertTrue(declared("android.permission.READ_EXTERNAL_STORAGE"))
        assertFalse(
            "capped at maxSdkVersion=32, so it is not grantable on the device this targets",
            grantableToday("android.permission.READ_EXTERNAL_STORAGE"),
        )
        assertTrue(grantableToday("android.permission.SEND_SMS"))
        assertFalse(grantableToday("android.permission.RECORD_AUDIO"))
    }

    // ---- the gap itself ------------------------------------------------------------------------

    @Test
    fun `calls needs all four of its permissions, not just the two it can read with`() {
        val read = setOf(
            "android.permission.READ_CALL_LOG",
            "android.permission.READ_PHONE_STATE",
        )
        assertFalse(
            "the read permissions alone must not permit calls — call.dial, call.answer and " +
                "call.reject would all be dead behind a green chip",
            CapabilityContract.isPermitted(Capability.CALLS, read, emptySet()),
        )

        val all = read + setOf(
            "android.permission.CALL_PHONE",
            "android.permission.ANSWER_PHONE_CALLS",
        )
        assertTrue(CapabilityContract.isPermitted(Capability.CALLS, all, emptySet()))

        // And each one is genuinely load-bearing: dropping any single permission must turn it off.
        all.forEach { dropped ->
            assertFalse(
                "calls was still permitted without $dropped",
                CapabilityContract.isPermitted(Capability.CALLS, all - dropped, emptySet()),
            )
        }
    }

    @Test
    fun `sms needs send as well as read`() {
        val readOnly = setOf(
            "android.permission.READ_SMS",
            "android.permission.RECEIVE_SMS",
        )
        assertFalse(
            "a read-only grant must not advertise a messaging pane whose compose box always fails",
            CapabilityContract.isPermitted(Capability.SMS, readOnly, emptySet()),
        )
        assertTrue(
            CapabilityContract.isPermitted(
                Capability.SMS,
                readOnly + "android.permission.SEND_SMS",
                emptySet(),
            ),
        )
    }

    @Test
    fun `advertising needs both halves, and either one alone is not enough`() {
        val contract = CapabilityContract.contracts.getValue(Capability.CONTACTS)
        val permission = setOf("android.permission.READ_CONTACTS")

        assertEquals(
            "permitted but unimplemented must stay off",
            emptySet<String>(),
            CapabilityContract.advertisable(permission, emptySet(), emptySet(), false, false),
        )
        assertEquals(
            "implemented but unpermitted must stay off — this is the half that was missing",
            emptySet<String>(),
            CapabilityContract.advertisable(emptySet(), emptySet(), contract.requests, false, false),
        )
        assertEquals(
            setOf(Capability.CONTACTS),
            CapabilityContract.advertisable(permission, emptySet(), contract.requests, false, false),
        )
    }

    @Test
    fun `the two Settings toggles gate the capabilities that ride them`() {
        val input = CapabilityContract.contracts.getValue(Capability.INPUT).requests
        val notifications = CapabilityContract.contracts.getValue(Capability.NOTIFICATIONS).requests
        val remote = CapabilityContract.contracts.getValue(Capability.REMOTE).requests

        assertFalse(
            "input without the accessibility toggle must stay off",
            CapabilityContract.isPermitted(Capability.INPUT, emptySet(), emptySet()),
        )
        assertTrue(
            CapabilityContract.isPermitted(
                Capability.INPUT,
                emptySet(),
                setOf(SpecialAccess.ACCESSIBILITY_SERVICE),
            ),
        )

        // One grant, two capabilities — the whole reason the media remote is in Phase 4 beside
        // notifications rather than somewhere later.
        assertEquals(
            setOf(Capability.NOTIFICATIONS, Capability.REMOTE),
            CapabilityContract.advertisable(
                grantedPermissions = emptySet(),
                specialAccessHeld = setOf(SpecialAccess.NOTIFICATION_LISTENER),
                registeredTypes = notifications + remote + input,
                videoServed = false,
                bulkServed = false,
            ),
        )
    }

    @Test
    fun `photos accepts either era's grant, because only one can exist per device`() {
        val modern = setOf(
            "android.permission.READ_MEDIA_IMAGES",
            "android.permission.READ_MEDIA_VIDEO",
        )
        val legacy = setOf("android.permission.READ_EXTERNAL_STORAGE")
        assertTrue(CapabilityContract.isPermitted(Capability.PHOTOS, modern, emptySet()))
        assertTrue(CapabilityContract.isPermitted(Capability.PHOTOS, legacy, emptySet()))
        assertFalse(CapabilityContract.isPermitted(Capability.PHOTOS, emptySet(), emptySet()))

        // Still never advertisable: photos has no handlers. Both halves, always.
        assertTrue(
            CapabilityContract.advertisable(modern, emptySet(), emptySet(), false, false).isEmpty(),
        )
    }

    @Test
    fun `images alone does not permit photos, because the videos would be invisible`() {
        // The gap the flat any-of had. `media.list` returns images and videos through one list —
        // items carry `kind` and `durationMs` — so a grant that covers only half of it is a photo
        // browser with every video unreadable, behind a chip that says the feature works. This is
        // the calls-contract mistake, which is why it gets its own test rather than an assertion
        // inside the one above: the two are different claims and only this one can fail alone.
        val imagesOnly = setOf("android.permission.READ_MEDIA_IMAGES")
        val videoOnly = setOf("android.permission.READ_MEDIA_VIDEO")
        assertFalse(CapabilityContract.isPermitted(Capability.PHOTOS, imagesOnly, emptySet()))
        assertFalse(CapabilityContract.isPermitted(Capability.PHOTOS, videoOnly, emptySet()))

        // And the sentence a half-granted user reads names one switch, not two permissions.
        assertEquals(
            listOf("Photos and videos"),
            CapabilityContract.missingPermissionsFor(Capability.PHOTOS, imagesOnly, emptySet()),
        )
    }

    @Test
    fun `photos is not implemented while the bulk channel is unserved`() {
        // Defect 54. `media.original` resolves a MediaStore id to a transfer that runs on the bulk
        // socket, so photos depends on that socket exactly as files does — and the contract did not
        // say so. With all four handlers registered and nothing serving 42503, this returned true:
        // the capability advertised, and `media.original` would have handed back a transferId for a
        // socket nobody serves.
        val allFour = setOf(
            MessageType.MEDIA_BUCKETS,
            MessageType.MEDIA_LIST,
            MessageType.MEDIA_THUMB,
            MessageType.MEDIA_ORIGINAL,
        )
        assertFalse(
            "photos may not be advertised while nothing serves the bulk channel",
            CapabilityContract.isImplemented(
                Capability.PHOTOS,
                registeredTypes = allFour,
                videoServed = false,
                bulkServed = false,
            ),
        )
        assertTrue(
            "with the bulk channel served and every handler registered, photos is implemented",
            CapabilityContract.isImplemented(
                Capability.PHOTOS,
                registeredTypes = allFour,
                videoServed = false,
                bulkServed = true,
            ),
        )
    }

    @Test
    fun `slice 2 leaves photos unavailable, and that is the expected state`() {
        // Stated positively so it reads as a decision rather than as an unfinished job: the three
        // read verbs are the slice, `media.original` is slice 3, and `isImplemented` requires all
        // four. The chip stays grey until the fourth verb and the bulk channel land together.
        //
        // The wrong fix, named here because it is the tempting one: loosening `containsAll` to a
        // subset check to make the chip green. That is the one mechanism preventing a capability
        // being advertised over dead verbs, and it exists because `calls` did exactly that.
        val sliceTwo = setOf(
            MessageType.MEDIA_BUCKETS,
            MessageType.MEDIA_LIST,
            MessageType.MEDIA_THUMB,
        )
        assertFalse(
            CapabilityContract.isImplemented(
                Capability.PHOTOS,
                registeredTypes = sliceTwo,
                videoServed = false,
                bulkServed = true,
            ),
        )
        assertEquals(
            listOf(MessageType.MEDIA_ORIGINAL),
            CapabilityContract.missingFor(
                Capability.PHOTOS,
                registeredTypes = sliceTwo,
                videoServed = false,
                bulkServed = true,
            ),
        )
    }

    @Test
    fun `a missing permission is named, not summarised`() {
        // A user told that calls needs "a permission" goes looking for one and finds four. The
        // diagnostics line has to say which — as the switches Settings actually shows, which for
        // these four permissions is two: Phone and Call logs.
        assertEquals(
            listOf("Call logs", "Phone"),
            CapabilityContract.missingPermissionsFor(Capability.CALLS, emptySet(), emptySet()),
        )

        val missing = CapabilityContract.missingPermissionsFor(
            Capability.CALLS,
            setOf("android.permission.READ_CALL_LOG"),
            emptySet(),
        )
        // The other three permissions are all one switch, named once rather than three times.
        assertEquals(listOf("Phone"), missing)
        assertFalse("a granted permission must not be reported missing", missing.contains("Call logs"))

        assertEquals(
            listOf(SpecialAccess.NOTIFICATION_LISTENER.label),
            CapabilityContract.missingPermissionsFor(Capability.NOTIFICATIONS, emptySet(), emptySet()),
        )
    }

    @Test
    fun `nothing a user reads is a permission constant or an enum name`() {
        // The bug this guards is a regression by naming rather than by logic: the sentence was
        // "missing NOTIFICATION_LISTENER", which names nothing on the device.
        for (capability in CapabilityContract.allCapabilities) {
            for (name in CapabilityContract.missingPermissionsFor(capability, emptySet(), emptySet())) {
                assertFalse("$capability leaks a permission path: $name", name.contains("android.permission."))
                assertFalse("$capability leaks an enum name: $name", name.any { it == '_' })
            }
        }
    }

    @Test
    fun `every permission a contract names has a Settings label`() {
        // Without this the fallback in label() ships a bare constant to a user the first time a
        // capability gains a permission, which is the same defect in a new place.
        for (permission in CapabilityContract.allDeclaredPermissions()) {
            assertNotEquals(
                "no Settings label for $permission",
                permission.substringAfterLast('.'),
                CapabilityContract.label(permission),
            )
        }
    }

    @Test
    fun `an unknown capability is never permitted`() {
        assertFalse(CapabilityContract.isPermitted("teleport", CapabilityContract.allDeclaredPermissions(), emptySet()))
    }
}
