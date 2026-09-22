package com.chetan.connectsuite.core.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.content.getSystemService

/** Every notification channel the app posts to, created once at process start. */
object NotificationChannels {

    /**
     * Extra on the launcher Intent asking the app to open a named tab — `"mirror"`, `"transfers"`.
     *
     * Here, in `core`, because two modules post notifications that deep-link and neither can see the
     * other: the mirroring request (`mirror-module`) and a received file (`sync-module`). It lived
     * in `MirrorNotifications` while that was the only one, and a second module copying the string
     * would be two homes for one key — a miss navigates nowhere and throws nothing.
     */
    const val EXTRA_OPEN_TAB = "com.chetan.connectsuite.OPEN_TAB"

    /** Persistent low-priority channel for the always-on connection service. */
    const val CONNECTION = "connection_status"

    /** Pairing requests — must be high importance so trust-on-first-use is never missed. */
    const val PAIRING = "pairing_requests"

    /** Ongoing file transfer progress. */
    const val TRANSFER = "file_transfer"

    /** Screen-mirroring session state. */
    const val MIRROR = "screen_mirror"

    /**
     * "Your Mac is waiting for you to start mirroring" — high importance on purpose.
     *
     * On Android 16 a backgrounded app cannot show the screen-capture prompt itself, so this
     * notification is the only thing that can get the user to the screen where they can. A quiet
     * one would leave the Mac waiting on a tap nobody knew to make.
     */
    const val MIRROR_REQUEST = "screen_mirror_request"

    /**
     * A clipboard entry has arrived from the Mac and is being **offered**.
     *
     * Default importance rather than high: it is an offer, not a demand, and it competes with
     * whatever the person is actually doing. It is the phone's only offer surface, though — the
     * Mac's entry is never written to the clipboard without a tap, so a person with this channel
     * muted has an entry sitting in the app rather than one silently applied.
     */
    const val CLIPBOARD = "clipboard_offer"

    /**
     * "Open Instagram?" — the whole of `apps.open.ask`, and high importance for a specific reason.
     *
     * There is somebody at a Mac who has just clicked a tile and is watching their phone. The tap
     * on this notification is not a fallback for a launch that failed; it **is** the launch, because
     * a backgrounded app on this platform may not start another one (see the Apps section of
     * docs/protocol.md). A quiet notification would make the feature look broken for exactly as
     * long as it took them to open the shade.
     *
     * Contrast [CLIPBOARD], which is IMPORTANCE_DEFAULT for the opposite reason: an arriving clip
     * is an offer nobody is waiting on.
     */
    const val APP_OPEN_REQUEST = "app_open_request"

    fun createAll(context: Context) {
        val manager = context.getSystemService<NotificationManager>() ?: return
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(
                    CONNECTION,
                    "Connection status",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Shown while ConnectSuite is listening for paired devices."
                    setShowBadge(false)
                },
                NotificationChannel(
                    CLIPBOARD,
                    "Clipboard from your Mac",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Offers text copied on your Mac. Nothing is put on your " +
                        "clipboard until you tap Copy."
                },
                NotificationChannel(
                    PAIRING,
                    "Pairing requests",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Asks you to confirm when a new device wants to pair."
                },
                NotificationChannel(
                    TRANSFER,
                    "File transfers",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Files your Mac sends to this phone, once they have arrived."
                    setShowBadge(false)
                },
                NotificationChannel(
                    MIRROR,
                    "Screen mirroring",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Shown while a screen-mirroring session is active."
                    setShowBadge(false)
                },
                NotificationChannel(
                    MIRROR_REQUEST,
                    "Mirroring requests",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Asks you to start mirroring when your Mac requests it."
                },
                NotificationChannel(
                    APP_OPEN_REQUEST,
                    "App open requests",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Asks you to open an app when your Mac requests it. Tapping is " +
                        "what opens it — the Mac cannot open apps on its own."
                },
            ),
        )
    }
}
