package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.MessageType

/**
 * What must be true before a capability may be advertised to the Mac.
 *
 * A capability is a promise. `hello.ack` carrying `"mirror"` tells the Mac "ask me to mirror and I
 * will"; the Mac then un-greys that pane. Deriving that promise from permission grants alone —
 * which is what this code used to do — advertises features that have no implementation behind
 * them, and the user finds out only when the pane they just enabled answers `FEATURE_UNAVAILABLE`.
 *
 * So a capability now requires both halves:
 *  1. the OS permission it depends on is granted, and
 *  2. every inbound control message it needs has a registered handler (plus a side-channel sink
 *     where the feature streams bytes).
 *
 * Only *inbound* requests are listed. Events the phone pushes on its own — `notif.posted`,
 * `sms.received`, `call.incoming`, `battery.state` — are deliberately absent: the phone sends
 * those, it never handles them, so requiring a handler for one could never be satisfied.
 *
 * ### Both halves live here now, and that is the point
 *
 * They did not used to. This object owned the handler half and `CapabilityDetector` owned the
 * permission half in a hand-written `when` block, and the two had no way to disagree *visibly*.
 * They disagreed anyway: `calls` was gated on `READ_CALL_LOG` and `READ_PHONE_STATE` while its
 * contract requires `call.dial`, `call.answer` and `call.reject`, which need `CALL_PHONE` and
 * `ANSWER_PHONE_CALLS`. The capability would have gone green on the Mac with three of its four
 * verbs unable to work — a promise broken by the OS rather than by a missing handler, which is the
 * one failure mode the handler check cannot see.
 *
 * So [Contract] now names the permissions too, [CapabilityDetector] derives its answer from here
 * rather than from its own list, and `CapabilityContractTest` checks every permission named below
 * is actually declared in the manifest — which is what would have caught `SEND_SMS` being required
 * by `sms` and declared nowhere in the repo.
 *
 * This object is pure Kotlin on purpose. It holds the rule that stops the bug, and it has to be
 * testable without an Android device — see CapabilityContractTest.
 */
object CapabilityContract {

    /**
     * Access the user grants somewhere other than a runtime permission dialog.
     *
     * Neither of these is a `Manifest.permission`, neither can be requested programmatically, and
     * both are toggled by hand in Settings. They are modelled separately because the check for
     * them is a different kind of thing — a secure setting rather than a package-manager grant —
     * and folding them into [Contract.permissions] would make that check impossible to write.
     */
    enum class SpecialAccess(
        /**
         * What the user's own phone calls this, for the sentence in [missingPermissionsFor].
         *
         * The enum constant is an internal name and was going straight onto the Mac's capability
         * chip: `missing NOTIFICATION_LISTENER`. Nothing on an Android device is called that, so
         * it tells someone their feature is off without telling them what to turn on — which is
         * the failure the "name the permission" rule exists to prevent, reintroduced by the
         * naming rather than by the logic.
         */
        val label: String,
    ) {
        /** `Settings.Secure.enabled_notification_listeners`. Gates notifications and the media remote. */
        NOTIFICATION_LISTENER("Notification access"),

        /** `Settings.Secure.enabled_accessibility_services`. Gates input and background clipboard. */
        ACCESSIBILITY_SERVICE("Accessibility"),
    }

    /**
     * What each runtime permission is called on the screen the user has to open.
     *
     * Android grants runtime permissions by **group**, and the group is what Settings shows and
     * what the prompt asks for. `calls` names four permissions, but the user sees two switches —
     * Phone and Call logs — so listing four raw strings describes a screen that does not exist.
     * Mapping to the group and de-duplicating is what makes the sentence match what they will
     * actually find; it is not a summary, because every switch they must touch is still named.
     *
     * `CapabilityPermissionTest` asserts every permission any contract names appears here, so the
     * fallback in [label] is a backstop for a permission added without a label rather than
     * something the user is expected to meet.
     */
    private val permissionLabels: Map<String, String> = mapOf(
        "android.permission.READ_SMS" to "SMS",
        "android.permission.RECEIVE_SMS" to "SMS",
        "android.permission.SEND_SMS" to "SMS",
        "android.permission.READ_CALL_LOG" to "Call logs",
        "android.permission.READ_PHONE_STATE" to "Phone",
        "android.permission.CALL_PHONE" to "Phone",
        "android.permission.ANSWER_PHONE_CALLS" to "Phone",
        "android.permission.READ_CONTACTS" to "Contacts",
        "android.permission.READ_MEDIA_IMAGES" to "Photos",
        "android.permission.READ_EXTERNAL_STORAGE" to "Photos",
        "android.permission.RECORD_AUDIO" to "Microphone",
    )

    /** [permission]'s Settings name. Falls back to the bare constant, never the full path. */
    fun label(permission: String): String =
        permissionLabels[permission] ?: permission.substringAfterLast('.')

    /**
     * @param requests inbound control messages that must all have handlers. An **empty** set means
     *   no wire protocol has been designed for this capability yet, and is treated as
     *   *never advertisable* rather than as "nothing required" — see [isImplemented].
     * @param permissions runtime permissions that must **all** be granted. Every verb in
     *   [requests] must be covered here: a capability advertised on a subset of the permissions
     *   its own messages need is a promise the OS will break.
     * @param permissionsAnyOf permissions where **one** is enough, because the platform offers
     *   different names for the same access at different API levels. Photos is the only case:
     *   `READ_MEDIA_IMAGES` on API 33+ and `READ_EXTERNAL_STORAGE` below it, of which exactly one
     *   can ever be granted on a given device. Modelled as any-of rather than with a version check
     *   so this object stays free of `Build.VERSION` and testable on a plain JVM.
     * @param specialAccess access granted in Settings rather than by a permission dialog.
     */
    data class Contract(
        val requests: Set<String>,
        val permissions: Set<String> = emptySet(),
        val permissionsAnyOf: Set<String> = emptySet(),
        val specialAccess: SpecialAccess? = null,
        val needsVideoChannel: Boolean = false,
        val needsBulkChannel: Boolean = false,
    )

    /**
     * Required handlers per capability.
     *
     * Where a feature has both core verbs and refinements, only the core verbs are required:
     * `mirror.config`/`keyframe`/`rotate` tune a running mirror and their absence does not make
     * mirroring a lie, whereas `mirror.start` without `mirror.stop` would leave the user no way
     * to end a session.
     */
    val contracts: Map<String, Contract> = mapOf(
        Capability.MIRROR to Contract(
            requests = setOf(MessageType.MIRROR_START, MessageType.MIRROR_STOP),
            // No permission and no special access on purpose: MediaProjection consent is asked
            // per session, so the gate is open and the *start* is what can fail with
            // DEVICE_LOCKED or a denied prompt.
            // Mirroring without the video socket served is a control channel that says "started"
            // and then never delivers a frame.
            needsVideoChannel = true,
        ),
        Capability.INPUT to Contract(
            requests = setOf(
                MessageType.INPUT_TAP,
                MessageType.INPUT_SWIPE,
                MessageType.INPUT_SCROLL,
                MessageType.INPUT_KEY,
                MessageType.INPUT_TEXT,
                MessageType.INPUT_GLOBAL,
            ),
            specialAccess = SpecialAccess.ACCESSIBILITY_SERVICE,
        ),
        Capability.NOTIFICATIONS to Contract(
            requests = setOf(
                MessageType.NOTIF_REPLY,
                MessageType.NOTIF_ACTION,
                MessageType.NOTIF_DISMISS,
            ),
            specialAccess = SpecialAccess.NOTIFICATION_LISTENER,
        ),
        Capability.SMS to Contract(
            requests = setOf(
                MessageType.SMS_THREADS,
                MessageType.SMS_MESSAGES,
                MessageType.SMS_SEND,
            ),
            // All three, one per verb. SEND_SMS is here because `sms.send` is in the requests
            // above, and it was required by the old hand-written gate while being declared in no
            // manifest in the repo — so `sms` could never be advertised no matter what the user
            // tapped. The manifest check in CapabilityContractTest is what now catches that.
            permissions = setOf(
                "android.permission.READ_SMS",
                "android.permission.RECEIVE_SMS",
                "android.permission.SEND_SMS",
            ),
        ),
        Capability.CALLS to Contract(
            requests = setOf(
                MessageType.CALL_LOG,
                MessageType.CALL_DIAL,
                MessageType.CALL_ANSWER,
                MessageType.CALL_REJECT,
            ),
            // Four verbs, four permissions, and the reason this whole mechanism was extended:
            // `call.log` needs the first two, `call.dial` needs CALL_PHONE, and
            // `call.answer`/`call.reject` need ANSWER_PHONE_CALLS. Gating on the read permissions
            // alone turned the chip green with three verbs dead.
            permissions = setOf(
                "android.permission.READ_CALL_LOG",
                "android.permission.READ_PHONE_STATE",
                "android.permission.CALL_PHONE",
                "android.permission.ANSWER_PHONE_CALLS",
            ),
        ),
        Capability.CONTACTS to Contract(
            requests = setOf(MessageType.CONTACTS_LIST, MessageType.CONTACTS_GET),
            permissions = setOf("android.permission.READ_CONTACTS"),
        ),
        Capability.FILES to Contract(
            requests = setOf(
                MessageType.FS_LIST,
                MessageType.FS_STAT,
                MessageType.FS_MKDIR,
                MessageType.FS_DELETE,
                MessageType.FS_TRANSFER_BEGIN,
                MessageType.FS_TRANSFER_CANCEL,
            ),
            needsBulkChannel = true,
        ),
        Capability.PHOTOS to Contract(
            requests = setOf(
                MessageType.MEDIA_BUCKETS,
                MessageType.MEDIA_LIST,
                MessageType.MEDIA_THUMB,
                MessageType.MEDIA_ORIGINAL,
            ),
            // Any-of, not all-of: exactly one of these can be granted on a given device, and which
            // one depends on the API level. Neither is declared in the manifest yet, so photos is
            // still permanently un-permitted — that belongs to Phase 5, and the manifest test
            // knows about it by name rather than by silence.
            permissionsAnyOf = setOf(
                "android.permission.READ_MEDIA_IMAGES",
                "android.permission.READ_EXTERNAL_STORAGE",
            ),
        ),
        Capability.CLIPBOARD to Contract(
            requests = setOf(
                MessageType.CLIP_PUSH,
                MessageType.CLIP_REQUEST,
                MessageType.CLIP_HISTORY,
            ),
            // Reading the clipboard in the background is only legal for us through the
            // accessibility service; without it clipboard is foreground-only, so it is not
            // advertised at all rather than half-working.
            specialAccess = SpecialAccess.ACCESSIBILITY_SERVICE,
        ),
        Capability.REMOTE to Contract(
            requests = setOf(MessageType.REMOTE_STATE, MessageType.REMOTE_COMMAND),
            // The same grant as notifications, because `MediaSessionManager.getActiveSessions`
            // requires a notification-listener component to name itself with. This is the whole
            // reason the media remote sits in Phase 4 next to notifications.
            specialAccess = SpecialAccess.NOTIFICATION_LISTENER,
        ),
        Capability.APPS to Contract(
            requests = setOf(
                MessageType.APPS_LIST,
                MessageType.APPS_LAUNCH,
                MessageType.APPS_ICON,
            ),
        ),
        // docs/protocol.md defines no `mic.*` messages at all. The capability name exists on both
        // sides but there is no wire protocol to carry it, so it can never be honestly advertised
        // until one is designed.
        Capability.MIC to Contract(
            requests = emptySet(),
            permissions = setOf("android.permission.RECORD_AUDIO"),
        ),
    )

    /** Every capability name the protocol knows about. */
    val allCapabilities: Set<String> = contracts.keys

    /**
     * True when everything [capability] promises is actually wired up.
     *
     * An unknown capability is never implemented: a name with no contract is a name nobody has
     * decided the meaning of, and guessing "yes" is how the original bug happened.
     */
    fun isImplemented(
        capability: String,
        registeredTypes: Set<String>,
        videoServed: Boolean,
        bulkServed: Boolean,
    ): Boolean {
        val contract = contracts[capability] ?: return false
        // No protocol designed yet — vacuous truth would otherwise advertise it.
        if (contract.requests.isEmpty()) return false
        if (contract.needsVideoChannel && !videoServed) return false
        if (contract.needsBulkChannel && !bulkServed) return false
        return registeredTypes.containsAll(contract.requests)
    }

    /**
     * True when the OS would let [capability]'s handlers actually do their work.
     *
     * The half that used to live in a hand-written `when` in `CapabilityDetector`, moved here so
     * it sits beside the [Contract.requests] it has to cover. An unknown capability is never
     * permitted, for the same reason it is never implemented.
     */
    fun isPermitted(
        capability: String,
        grantedPermissions: Set<String>,
        specialAccessHeld: Set<SpecialAccess>,
    ): Boolean {
        val contract = contracts[capability] ?: return false
        if (!grantedPermissions.containsAll(contract.permissions)) return false
        if (contract.permissionsAnyOf.isNotEmpty() &&
            contract.permissionsAnyOf.none { it in grantedPermissions }
        ) {
            return false
        }
        val special = contract.specialAccess
        return special == null || special in specialAccessHeld
    }

    /**
     * Every permission [capability] needs and does not have, for the sentence a user reads.
     *
     * Returns **Settings names**, not permission constants — see [permissionLabels]. Nothing
     * requests permissions from this list; the grant check reads [allDeclaredPermissions].
     */
    fun missingPermissionsFor(
        capability: String,
        grantedPermissions: Set<String>,
        specialAccessHeld: Set<SpecialAccess>,
    ): List<String> {
        val contract = contracts[capability] ?: return listOf("no contract defined")
        return buildList {
            addAll((contract.permissions - grantedPermissions).map(::label).distinct().sorted())
            if (contract.permissionsAnyOf.isNotEmpty() &&
                contract.permissionsAnyOf.none { it in grantedPermissions }
            ) {
                // Photos is the only any-of case and both of its permissions are the same switch
                // at different API levels, so "one of Photos or Photos" — and even "one of
                // Photos" — would be noise. One label means one thing to turn on.
                val names = contract.permissionsAnyOf.map(::label).distinct().sorted()
                add(if (names.size == 1) names.single() else "one of ${names.joinToString(" or ")}")
            }
            contract.specialAccess?.let { if (it !in specialAccessHeld) add(it.label) }
        }
    }

    /** What [capability] is still waiting on, for logs and the diagnostics screen. */
    fun missingFor(
        capability: String,
        registeredTypes: Set<String>,
        videoServed: Boolean,
        bulkServed: Boolean,
    ): List<String> {
        val contract = contracts[capability] ?: return listOf("no contract defined")
        if (contract.requests.isEmpty()) return listOf("no wire protocol defined yet")
        return buildList {
            addAll((contract.requests - registeredTypes).sorted())
            if (contract.needsVideoChannel && !videoServed) add("video channel unserved")
            if (contract.needsBulkChannel && !bulkServed) add("bulk channel unserved")
        }
    }

    /**
     * The set that may be sent in `hello.ack`: permitted by the OS **and** implemented here.
     *
     * Both halves are computed from [contracts] now. They used to come from two places — this
     * object and a `when` block in `CapabilityDetector` — which is how `calls` came to be gated on
     * two of the four permissions its own messages need.
     */
    fun advertisable(
        grantedPermissions: Set<String>,
        specialAccessHeld: Set<SpecialAccess>,
        registeredTypes: Set<String>,
        videoServed: Boolean,
        bulkServed: Boolean,
    ): Set<String> = contracts.keys
        .filter { isPermitted(it, grantedPermissions, specialAccessHeld) }
        .filter { isImplemented(it, registeredTypes, videoServed, bulkServed) }
        .toSet()

    /**
     * Every runtime permission any capability names, for the manifest check in the test.
     *
     * `permissionsAnyOf` is included: photos names two, neither is declared yet, and the test
     * knows that by name rather than by silence.
     */
    fun allDeclaredPermissions(): Set<String> =
        contracts.values.flatMapTo(mutableSetOf()) { it.permissions + it.permissionsAnyOf }
}
