package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.notification.NotificationChannels

/**
 * The phone's half of **Mac → phone**: a file the Mac sent has arrived, and here is where it is.
 *
 * Before the 2026-09-23 feature pass a push landed silently — recorded for the Transfers screen and
 * visible to someone who went looking, and told to nobody. The words are [ReceivedFiles]'s; this
 * only posts them.
 *
 * Low importance (the existing `file_transfer` channel): the person who sent the file is at the Mac
 * and already watched it arrive there. This is the phone saying *where* it went, not an alarm.
 * Tapping opens the Transfers tab, where the file is listed with its folder and outcome.
 *
 * With notifications refused this says so in the log and does nothing else — the Mac's card is the
 * sender's confirmation either way.
 */
object ReceivedFileNotifications {

    private const val ID = 3101
    const val TAB_TRANSFERS = "transfers"

    private val tally = ReceivedFiles()

    fun arrived(
        context: Context,
        name: String,
        sizeBytes: Long,
        folderLabel: String,
        peerName: String,
        verified: Boolean,
    ) {
        val summary = tally.arrived(name, sizeBytes, folderLabel, peerName, verified)
        val manager = context.getSystemService<NotificationManager>() ?: return
        if (!canPost(context)) {
            LinkLog.i("bulk", "received ${summary.count} file(s); notifications are off, so only the Transfers screen shows it")
            return
        }
        val notification = Notification.Builder(context, NotificationChannels.TRANSFER)
            .setContentTitle(summary.title)
            .setContentText(summary.text)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setCategory(Notification.CATEGORY_STATUS)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(openTransfers(context))
            .build()
        runCatching { manager.notify(ID, notification) }
            .onFailure { LinkLog.w("bulk", "could not post the received-file notification", it) }
    }

    private fun openTransfers(context: Context): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.putExtra(NotificationChannels.EXTRA_OPEN_TAB, TAB_TRANSFERS)
            ?.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP,
            ) ?: return null
        return PendingIntent.getActivity(
            context,
            ID,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
}
