package com.chetan.connectsuite.setup

/**
 * **Set up Sidekick** — every grant a feature needs, its reason, and how it is asked for. Pure: no
 * Android in this file, so `SetupPlanTest` runs the sentences the screen draws.
 *
 * ### Why this exists (defect 134)
 *
 * Onboarding asks for exactly one permission and says the rest *"are asked for from the Sync tab,
 * when you turn them on"*. Nothing does that. Read from the code on 2026-09-23: outside onboarding
 * (notifications) and the QR screen (camera) **no shipped screen requests Texts, Calls, Contacts or
 * Photos** — on the test phone those three were granted without the `USER_SET` flag, i.e. by `adb`
 * during testing, never through the app. A stranger installing Sidekick had no way inside it to turn
 * on four of its features.
 *
 * ### The rules the list keeps
 *
 * - **One item per feature, asked when tapped** — never a wall of prompts. Every feature item has a
 *   **Not now**; nothing here is required except what the link itself needs.
 * - **Only what is needed.** `NEARBY_DEVICES` is absent on purpose: the Mac link was measured to
 *   work without it (defect 69) and it belongs to Sync, which asks for it there.
 * - **The camera is not requested here.** It is asked by the QR screen at the moment of scanning,
 *   which is the rule; this list only reports whether it has been given.
 * - **Special access is never claimed on intent.** The row reads the OS setting when the screen
 *   resumes, so a person who opens Settings and backs out sees *Off*, not *On*.
 */
object SetupPlan {

    enum class Mechanism {
        /** A runtime permission group, asked through the platform's own dialog. */
        Runtime,
        /** A switch only the person can flip in Settings; we deep-link and re-read on return. */
        SpecialAccess,
        /** A picker or another screen of this app (SAF folders). */
        InApp,
        /** Reported only; asked for elsewhere at the moment it is needed (the camera). */
        ReportOnly,
    }

    enum class Section(val title: String) {
        Link("To connect"),
        Features("What your Mac can do"),
        Reliability("Staying connected"),
    }

    data class Item(
        val id: String,
        val section: Section,
        val title: String,
        val why: String,
        val mechanism: Mechanism,
        /** Whether "Not now" is offered. False only where the link itself depends on it. */
        val optional: Boolean = true,
    )

    const val NOTIFICATIONS = "notifications"
    const val CAMERA = "camera"
    const val MIRROR_NOTIFICATIONS = "notification-access"
    const val TEXTS = "texts"
    const val CALLS = "calls"
    const val CONTACTS = "contacts"
    const val PHOTOS = "photos"
    const val FOLDERS = "folders"
    const val CONTROL = "control"
    const val BATTERY = "battery"

    val items: List<Item> = listOf(
        Item(
            NOTIFICATIONS, Section.Link, "Sidekick's own notifications",
            "So this phone can tell you what the link is doing, show files as they arrive, and " +
                "ask before mirroring starts.",
            Mechanism.Runtime, optional = false,
        ),
        Item(
            CAMERA, Section.Link, "Camera",
            "Used once, to scan the code your Mac shows. Android asks when you open the scanner.",
            Mechanism.ReportOnly,
        ),
        Item(
            MIRROR_NOTIFICATIONS, Section.Features, "Show notifications on your Mac",
            "Lets Sidekick read this phone's notifications so your Mac can show them and you can " +
                "reply. Android calls this notification access and it is a switch in Settings.",
            Mechanism.SpecialAccess,
        ),
        Item(
            TEXTS, Section.Features, "Texts",
            "Read your conversations and send replies from your Mac.",
            Mechanism.Runtime,
        ),
        Item(
            CALLS, Section.Features, "Calls",
            "See recent and missed calls, and dial, answer or decline from your Mac. Call audio " +
                "stays on the phone.",
            Mechanism.Runtime,
        ),
        Item(
            CONTACTS, Section.Features, "Contacts",
            "Names and photos on your texts and calls instead of bare numbers.",
            Mechanism.Runtime,
        ),
        Item(
            PHOTOS, Section.Features, "Photos and videos",
            "Browse this phone's photos and videos on your Mac and save the ones you want.",
            Mechanism.Runtime,
        ),
        Item(
            FOLDERS, Section.Features, "Folders",
            "Choose folders your Mac may browse. Files your Mac sends need nothing — they land in " +
                "Download › ConnectSuite either way.",
            Mechanism.InApp,
        ),
        Item(
            CONTROL, Section.Features, "Control from your Mac",
            "Tap, type and scroll on this phone from your Mac while mirroring. Android calls this " +
                "an accessibility service — turn on Sidekick Input in Settings.",
            Mechanism.SpecialAccess,
        ),
        Item(
            BATTERY, Section.Reliability, "Keep running in the background",
            "Without this, Android stops Sidekick soon after you leave it and your Mac loses the " +
                "phone until you open the app again.",
            Mechanism.SpecialAccess,
        ),
    )

    /** What a row can be. Worked out by the screen from the OS; worded here. */
    enum class Status { On, Off, NotNow, NeedsSettings, NotAskedYet }

    fun statusLabel(item: Item, status: Status, folderCount: Int = 0): String = when (status) {
        Status.On -> if (item.id == FOLDERS) {
            if (folderCount == 1) "1 folder shared" else "$folderCount folders shared"
        } else {
            "On"
        }
        Status.Off -> "Off"
        Status.NotNow -> "Not now"
        // The platform stops showing its dialog after two refusals; only Settings can grant it now.
        Status.NeedsSettings -> "Turned off in Settings"
        Status.NotAskedYet -> "Asked when you scan"
    }

    /** The action a row offers, or null when there is nothing to do. */
    fun actionLabel(item: Item, status: Status): String? = when {
        status == Status.On && item.id == FOLDERS -> "Manage"
        status == Status.On -> null
        item.mechanism == Mechanism.ReportOnly -> null
        status == Status.NeedsSettings -> "Open Settings"
        // The battery exemption is asked by a system dialog on this screen, not a Settings page —
        // measured on the emulator: "Let app always run in background? Deny / Allow".
        item.id == BATTERY -> "Allow"
        item.mechanism == Mechanism.SpecialAccess -> "Open Settings"
        item.mechanism == Mechanism.InApp -> "Choose"
        else -> "Allow"
    }

    /**
     * What a screen reader hears for a row's button: the button's words and the feature they act on.
     * The visible labels repeat down the list ("Allow", "Not now"), so the words alone name no row.
     */
    fun buttonDescription(item: Item, buttonLabel: String): String = "$buttonLabel: ${item.title}"

    /** The header line: a count with its denominator, never a percentage. */
    fun summary(statuses: Map<String, Status>): String {
        val counted = items.filter { it.mechanism != Mechanism.ReportOnly }
        val on = counted.count { statuses[it.id] == Status.On }
        return "$on of ${counted.size} turned on"
    }

    /** Every sentence on the screen, for the copy guard shared with onboarding. */
    val allText: List<String>
        get() = items.flatMap { listOf(it.title, it.why) } + Section.entries.map { it.title } +
            listOf(TITLE, SUBTITLE, NOT_NOW, DONE)

    const val TITLE = "Set up Sidekick"
    const val SUBTITLE = "Turn on what you want, when you want it. Each switch asks only for what " +
        "that feature needs, and you can change any of them later."
    const val NOT_NOW = "Not now"
    const val DONE = "Done"
}
