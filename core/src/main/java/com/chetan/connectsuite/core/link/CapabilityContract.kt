package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.permissions.MediaAccess
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
        // All three are one switch on the screen the user opens, which is why they share a label.
        // Android 13+ shows "Photos and videos" and covers READ_MEDIA_IMAGES and READ_MEDIA_VIDEO
        // with it; below 13 the same access is READ_EXTERNAL_STORAGE, which some OEMs label
        // "Storage" or "Files and media". Naming the modern switch for all three is a deliberate
        // approximation on the older devices: telling them apart needs Build.VERSION, which this
        // object stays free of so it can be tested on a plain JVM.
        "android.permission.READ_MEDIA_IMAGES" to "Photos and videos",
        "android.permission.READ_MEDIA_VIDEO" to "Photos and videos",
        "android.permission.READ_EXTERNAL_STORAGE" to "Photos and videos",
        // Android 14+'s "Allow limited access" is the same switch on the same screen (defect 139).
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED" to "Photos and videos",
        "android.permission.RECORD_AUDIO" to "Microphone",
        // Android's own switch is called "Notifications" on the app's Settings page. Named here so
        // an `apps` chip that is off says "missing Notifications" rather than "missing
        // POST_NOTIFICATIONS", which is the enum-name mistake SpecialAccess.label already records.
        "android.permission.POST_NOTIFICATIONS" to "Notifications",
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
     * @param permissionAlternatives complete alternative permission sets, of which **one** must be
     *   granted **in full**. The platform offers different names for the same access at different
     *   API levels, and — this is the part a flat any-of could not say — an alternative can need
     *   *more than one* permission. Photos is the case: API 33+ split visual media into
     *   `READ_MEDIA_IMAGES` **and** `READ_MEDIA_VIDEO`, two separate grants, while API 32 and below
     *   have the single `READ_EXTERNAL_STORAGE`. Modelled as alternatives rather than with a
     *   version check so this object stays free of `Build.VERSION` and testable on a plain JVM.
     *
     *   It was a flat `permissionsAnyOf: Set<String>` until 2026-08-31, holding
     *   `{READ_MEDIA_IMAGES, READ_EXTERNAL_STORAGE}` — which is satisfied by images alone, on a
     *   phone where `media.list` returns `kind:"video"` items with a `durationMs`. That is the
     *   calls-contract mistake exactly: the chip goes green with part of the feature dead, this
     *   time by the OS rather than by a missing handler. The type changed rather than the value so
     *   that every call site had to be revisited instead of quietly inheriting the old meaning.
     * @param specialAccess access granted in Settings rather than by a permission dialog.
     */
    data class Contract(
        val requests: Set<String>,
        val permissions: Set<String> = emptySet(),
        val permissionAlternatives: Set<Set<String>> = emptySet(),
        val specialAccess: SpecialAccess? = null,
        val needsVideoChannel: Boolean = false,
        val needsBulkChannel: Boolean = false,
        /**
         * The camera stream claim on 42502 has a consumer (docs/protocol.md → The stream claim on
         * 42502). Separate from [needsVideoChannel] because the two claims have separate consumers: a
         * mirror sink says nothing about whether anything will take a camera socket.
         */
        val needsCameraChannel: Boolean = false,
        /**
         * The **webcam** stream claim on 42502 has a consumer (docs/protocol.md → The webcam stream
         * claim on 42502). Its own flag for the reason [needsCameraChannel] is not [needsVideoChannel]:
         * Camera v1's claim consumer says nothing about whether anything takes a webcam socket.
         */
        val needsWebcamChannel: Boolean = false,
        /**
         * This capability cannot run without a foreground service, so a phone that has been
         * **background-restricted** cannot honour it. See [blockedByBackgroundRestriction].
         */
        val needsForegroundService: Boolean = false,
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
            // From Android 14 a MediaProjection is handed to a foreground service with the
            // `mediaProjection` type, and it is revoked the instant that service loses foreground
            // status. A background-restricted app cannot hold one — measured on this handset on
            // 2026-09-10, where every attempt died 107-116 ms in. See defect 102.
            needsForegroundService = true,
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
            // Two alternatives, and the first one needs *both* of its permissions. API 33 split
            // visual media in two, and this capability's own payload spec sends images and videos
            // through one list — `media.list` items carry `kind` and `durationMs` — so an
            // images-only grant is a photo browser with every video invisible and a green chip
            // over it.
            //
            // Defect 139: the alternatives come from `MediaAccess`, the one home for full /
            // selected / none, and include Android 14's selected-photos grant — with it the verbs
            // answer for the photos the person chose, so the capability is on and carries a
            // `limited` reason (see [limitations]) rather than being off or claiming the library.
            permissionAlternatives = MediaAccess.FULL_ALTERNATIVES + setOf(MediaAccess.SELECTED_ALTERNATIVE),
            // `media.original` resolves a MediaStore id to a transfer that runs on the bulk
            // channel, exactly as `fs.transfer.begin` does — so photos is as dependent on that
            // socket as files is. Defect 54: this line was missing, and without it the capability
            // would have advertised itself with `media.original` handing back a transferId for a
            // socket nobody serves.
            needsBulkChannel = true,
        ),
        Capability.CLIPBOARD to Contract(
            requests = setOf(
                MessageType.CLIP_PUSH,
                MessageType.CLIP_REQUEST,
                MessageType.CLIP_HISTORY,
            ),
            // **No gate, and that is a measured decision rather than a loosening.**
            //
            // This used to require SpecialAccess.ACCESSIBILITY_SERVICE, on the documented rule that
            // background clipboard reads are legal for an app with one. Measured on this handset
            // 2026-09-01 (docs/testing.md, Slice 11): the rule does not operate here. Reads were
            // refused 90 of 90 with our service bound and 60 of 60 with it disabled — identical,
            // over clips proven readable with focus half a second earlier. The discriminator is
            // window focus and nothing else, and no permission grants it.
            //
            // So the old gate was guarding a premise this device does not implement, and — worse —
            // it made that premise untestable: with clipboard never advertised, nothing in the
            // shipping path ever called getPrimaryClip. Only a probe that went around the gate
            // could find out. See docs/phase-5-closeout.md for the sweep that asks which other
            // gates are in that position.
            //
            // What replaces it is not a weaker gate but a different mechanism: the asymmetry lives
            // in the answers. `clip.request` to an unfocused phone is PHONE_NOT_FOREGROUND, which
            // is a live pane and a sentence, not a grey chip and a Settings hunt for a switch that
            // does not exist.
        ),
        Capability.REMOTE to Contract(
            requests = setOf(
                MessageType.REMOTE_STATE,
                MessageType.REMOTE_COMMAND,
                // Added 2026-09-16 with the Now Playing card. It needs no grant of its own — the
                // art comes out of the same `MediaMetadata` the state is already read from, so
                // anything that can answer `remote.state` can answer this.
                MessageType.REMOTE_ARTWORK,
            ),
            // The same grant as notifications, because `MediaSessionManager.getActiveSessions`
            // requires a notification-listener component to name itself with. This is the whole
            // reason the media remote sits in Phase 4 next to notifications.
            specialAccess = SpecialAccess.NOTIFICATION_LISTENER,
        ),
        Capability.APPS to Contract(
            requests = setOf(
                MessageType.APPS_LIST,
                MessageType.APPS_ICON,
                MessageType.APPS_OPEN_ASK,
            ),
            // POST_NOTIFICATIONS, and it is a real gate rather than a tidy one.
            //
            // On this platform a backgrounded app may not start another app's activity — measured
            // 2026-09-03, and refused *silently*, which is why there is no `apps.launch` at all.
            // The only thing that opens an app from here is a person tapping a notification. With
            // notifications off, one of this capability's three verbs cannot be delivered by any
            // route, so advertising `apps` would be promising a launcher that cannot launch.
            //
            // The Mac still draws the grid — `apps.list` and `apps.icon` answer whether or not the
            // chip is green, exactly as the three read verbs of `photos` did through slice 2 — and
            // the pane says which half is missing. An unadvertised capability greys a chip; it does
            // not have to grey a pane.
            permissions = setOf("android.permission.POST_NOTIFICATIONS"),
        ),
        // docs/protocol.md defines no `mic.*` messages at all. The capability name exists on both
        // sides but there is no wire protocol to carry it, so it can never be honestly advertised
        // until one is designed.
        Capability.MIC to Contract(
            requests = emptySet(),
            permissions = setOf("android.permission.RECORD_AUDIO"),
        ),
        // Feature A, slice 2 (docs/protocol.md → Share): the two requests the Mac may send about an
        // offer. No permission — the file was staged from a share grant. No bulk channel in this
        // revision because nothing is transferred; slice 3 adds `needsBulkChannel` with the pull.
        // Being "on" promises only that these two answer; whether an offer can be made at all is the
        // `share.file` negotiation, which a Mac without it never has.
        // Camera v1 (docs/protocol.md → Camera). No permission and that is the point, exactly as for
        // `mirror`: CAMERA is asked per session, in the flow, *after* the owner taps Start camera on the
        // phone, and a permission granted last week is not consent to a session today. So the gate is
        // open and the *request* is what can be declined, expire, or be refused the permission.
        // Without the camera claim served, `camera.request` could be approved into a stream nothing
        // would carry.
        Capability.CAMERA to Contract(
            requests = setOf(MessageType.CAMERA_REQUEST, MessageType.CAMERA_STOP, MessageType.CAMERA_SWITCH),
            needsCameraChannel = true,
        ),
        // Camera v2, Sidekick Camera (docs/protocol.md → Webcam). No permission, for Camera v1's reason:
        // CAMERA is asked in the flow, after the owner's tap for one session. Without the webcam claim
        // served, a session could be approved into a stream nothing would carry. Development builds
        // only — WebcamFeature.install is gated, so a release build never registers these.
        Capability.WEBCAM to Contract(
            requests = setOf(MessageType.WEBCAM_REQUEST, MessageType.WEBCAM_STOP, MessageType.WEBCAM_SWITCH, MessageType.WEBCAM_KEYFRAME),
            needsWebcamChannel = true,
        ),
        Capability.SHARE to Contract(
            // Version 2 (slice 3c): `share.saved`, and the bulk channel the one pull streams over.
            // "On" still promises only that these answer; whether a transfer can happen at all is the
            // negotiated `share.file` version, which stays 1 until the Mac half lands.
            requests = setOf(MessageType.SHARE_RESPOND, MessageType.SHARE_CANCEL, MessageType.SHARE_SAVED),
            needsBulkChannel = true,
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
        cameraServed: Boolean,
        bulkServed: Boolean,
        /** The webcam claim has a consumer. Last, and not defaulted: every caller says it. */
        webcamServed: Boolean,
    ): Boolean {
        val contract = contracts[capability] ?: return false
        // No protocol designed yet — vacuous truth would otherwise advertise it.
        if (contract.requests.isEmpty()) return false
        if (contract.needsVideoChannel && !videoServed) return false
        if (contract.needsCameraChannel && !cameraServed) return false
        if (contract.needsWebcamChannel && !webcamServed) return false
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
        if (contract.permissionAlternatives.isNotEmpty() &&
            contract.permissionAlternatives.none { grantedPermissions.containsAll(it) }
        ) {
            return false
        }
        val special = contract.specialAccess
        return special == null || special in specialAccessHeld
    }

    /**
     * True when [capability] needs a foreground service and this phone will not let the app hold
     * one — the **fourth gate**, and the first that is a fact about the app rather than about one
     * capability's grants.
     *
     * ### Why a device-wide state is asked per capability
     *
     * The restriction is one boolean for the whole package, so the temptation is to advertise
     * nothing at all when it is set. That would be wrong and would be wrong *loudly*: with the op
     * set on this handset on 2026-09-10, `sms`, `contacts`, `notifications` and the rest all went
     * on answering normally for twelve hours. The one thing that failed was the one thing that
     * needs a foreground service. So the restriction is a device fact and [Contract] says which
     * capabilities it reaches — which is the same shape as [Contract.needsVideoChannel], a
     * process-wide resource named by the capabilities that cannot work without it.
     *
     * ### What this is measured on, and what it is not
     *
     * **One handset, one vendor.** The reading behind it is a Samsung SM-S938B on One UI, where
     * `RUN_ANY_IN_BACKGROUND: ignore` stopped the `mediaProjection` foreground service 107-116 ms
     * after every start — *including while the process was `PROC_STATE_TOP`*, which is the part
     * AOSP's documented behaviour does not predict. Whether another skin demotes a restricted
     * app's foreground service while the user is looking at it is **unknown and untested**; see
     * `docs/single-device-audit.md`.
     *
     * The consequence of being wrong here is bounded and recoverable in one direction only, which
     * is why it is written this way round: a capability wrongly withheld says so in a sentence the
     * user can act on, and a capability wrongly advertised is a Start button that dies at 116 ms
     * behind a message about screen capture.
     */
    fun blockedByBackgroundRestriction(capability: String, backgroundRestricted: Boolean): Boolean {
        if (!backgroundRestricted) return false
        return contracts[capability]?.needsForegroundService == true
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
            if (contract.permissionAlternatives.isNotEmpty() &&
                contract.permissionAlternatives.none { grantedPermissions.containsAll(it) }
            ) {
                // Photos is the only case, and all three of its permissions are the same switch at
                // different API levels — so every alternative renders to one label, "one of Photos
                // and videos or Photos and videos" collapses to one name, and the user is told one
                // thing to turn on. The joins are here rather than hardcoded because a future
                // alternative needing two *differently labelled* switches must say both.
                val rendered = contract.permissionAlternatives
                    .map { alt -> alt.map(::label).distinct().sorted().joinToString(" and ") }
                    .distinct()
                    .sorted()
                add(
                    if (rendered.size == 1) rendered.single()
                    else "one of ${rendered.joinToString(" or ")}",
                )
            }
            contract.specialAccess?.let { if (it !in specialAccessHeld) add(it.label) }
        }
    }

    /** What [capability] is still waiting on, for logs and the diagnostics screen. */
    fun missingFor(
        capability: String,
        registeredTypes: Set<String>,
        videoServed: Boolean,
        cameraServed: Boolean,
        bulkServed: Boolean,
        webcamServed: Boolean,
    ): List<String> {
        val contract = contracts[capability] ?: return listOf("no contract defined")
        if (contract.requests.isEmpty()) return listOf("no wire protocol defined yet")
        return buildList {
            addAll((contract.requests - registeredTypes).sorted())
            if (contract.needsVideoChannel && !videoServed) add("video channel unserved")
            if (contract.needsCameraChannel && !cameraServed) add("camera channel unserved")
            if (contract.needsWebcamChannel && !webcamServed) add("webcam channel unserved")
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
        /** The camera claim has a consumer. **Not defaulted**, for the reason [backgroundRestricted] is not. */
        cameraServed: Boolean,
        /** The webcam claim has a consumer. **Not defaulted**, for the same reason. */
        webcamServed: Boolean,
        bulkServed: Boolean,
        /**
         * `ActivityManager.isBackgroundRestricted()`. **Deliberately not defaulted** — the
         * `permissionsAnyOf` change of 2026-08-31 is the precedent: a new gate with a default is a
         * gate every existing call site inherits the old meaning of without anyone reading it.
         */
        backgroundRestricted: Boolean,
    ): Set<String> = contracts.keys
        .filter { isPermitted(it, grantedPermissions, specialAccessHeld) }
        .filter { isImplemented(it, registeredTypes, videoServed, cameraServed, bulkServed, webcamServed) }
        .filterNot { blockedByBackgroundRestriction(it, backgroundRestricted) }
        .toSet()

    /**
     * Every runtime permission any capability names, for the manifest check in the test.
     *
     * [Contract.permissionAlternatives] is flattened in: every permission in every alternative has
     * to be declared, because the device decides which alternative applies and a permission missing
     * from the manifest is one the user can never grant on the device that needs it.
     */
    /**
     * Advertised capabilities that work only in part, each with the phone's sentence — the wire's
     * `limited` list (defect 139). Today that is one case: `photos` on selected-only access, which
     * serves exactly the photos the person chose. Pure, so a JVM test calls what the link sends.
     */
    fun limitations(advertised: Set<String>, grantedPermissions: Set<String>): Map<String, String> =
        buildMap {
            if (Capability.PHOTOS in advertised && MediaAccess.of(grantedPermissions) == MediaAccess.SELECTED) {
                put(Capability.PHOTOS, MediaAccess.SELECTED_REASON)
            }
        }

    fun allDeclaredPermissions(): Set<String> =
        contracts.values.flatMapTo(mutableSetOf()) { it.permissions + it.permissionAlternatives.flatten() }
}
