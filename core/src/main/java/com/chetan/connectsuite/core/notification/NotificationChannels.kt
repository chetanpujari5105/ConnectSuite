package com.chetan.connectsuite.core.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.content.getSystemService

/** Every notification channel the app posts to, created once at process start. */
object NotificationChannels {

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
                    description = "Progress for files being sent or received."
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
            ),
        )
    }
}
