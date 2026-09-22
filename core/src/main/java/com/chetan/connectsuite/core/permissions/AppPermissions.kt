package com.chetan.connectsuite.core.permissions

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.net.toUri

/**
 * A logically grouped set of runtime permissions.
 *
 * Permissions are deliberately grouped by the feature that needs them rather than requested all
 * at once on first launch — asking for SMS access before the user has even paired a device is the
 * fastest way to get denied forever.
 */
enum class PermissionGroup(
    val title: String,
    val rationale: String,
    val required: Boolean,
) {
    /** Needed before Wi-Fi Direct peer discovery returns anything. */
    NEARBY_DEVICES(
        title = "Nearby devices",
        rationale = "Sidekick needs this to find other devices over Wi-Fi Direct. " +
            "On Android 12 and below the system reports nearby Wi-Fi peers through the location " +
            "permission — no location is ever collected or sent anywhere.",
        required = true,
    ),

    /** Posting transfer progress and pairing requests. */
    NOTIFICATIONS(
        title = "Notifications",
        rationale = "Used to show transfer progress, incoming pairing requests, and the " +
            "background connection status.",
        required = true,
    ),

    /**
     * Optional: reading and sending text messages from the Mac.
     *
     * `SEND_SMS` is in here, not because sending is optional-within-optional, but because the
     * `sms` capability requires both `sms.messages` and `sms.send` — half a grant advertises a
     * feature that cannot send, and `CapabilityDetector` refuses to advertise it at all rather
     * than offer a compose box that always fails.
     */
    SMS(
        title = "Text messages",
        rationale = "Optional. Lets you read your conversations and send replies from your Mac. " +
            "Messages only ever travel to devices you have explicitly paired, over the encrypted " +
            "local connection — they never touch a server.",
        required = false,
    ),

    /**
     * Optional: call log, dialling, and answering or rejecting from the Mac.
     *
     * All four permissions in one group on purpose. They are the four verbs of one feature and the
     * `calls` capability needs every one of them, so splitting the prompts would produce a
     * half-granted state that can only be reported as "calls unavailable" anyway — and would ask
     * the user two awkward questions instead of one.
     */
    CALLS(
        title = "Calls",
        rationale = "Optional. Shows recent and missed calls on your Mac, and lets you dial, " +
            "answer and reject from there. Call *audio* stays on the phone — Android does not " +
            "allow an app to route it, so pair the Mac over Bluetooth if you want to talk " +
            "through it.",
        required = false,
    ),

    /**
     * Optional, and the thing that makes the other two legible.
     *
     * `READ_CONTACTS` has been declared in the manifest since v1 and requested nowhere, so it was
     * only ever used to compute a capability that could never be granted. Without it a thread list
     * and a call log are columns of phone numbers.
     */
    CONTACTS(
        title = "Contacts",
        rationale = "Optional. Puts names and photos on your messages and calls instead of bare " +
            "phone numbers, and lets you search contacts from your Mac. Nothing is uploaded.",
        required = false,
    ),
    ;

    /** The concrete manifest permissions for this group on the current API level. */
    val permissions: List<String>
        get() = when (this) {
            NEARBY_DEVICES -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                listOf(Manifest.permission.NEARBY_WIFI_DEVICES)
            } else {
                // Both are requested together: on Android 12 the system otherwise offers only
                // the "precise" choice, and a user picking "approximate" would leave the
                // request half-granted with no way to tell from the result.
                listOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                )
            }

            NOTIFICATIONS -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                listOf(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                emptyList()
            }

            SMS -> listOf(
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_SMS,
                Manifest.permission.SEND_SMS,
            )

            CALLS -> listOf(
                Manifest.permission.READ_CALL_LOG,
                Manifest.permission.READ_PHONE_STATE,
                Manifest.permission.CALL_PHONE,
                Manifest.permission.ANSWER_PHONE_CALLS,
            )

            CONTACTS -> listOf(Manifest.permission.READ_CONTACTS)
        }

    fun isGranted(context: Context): Boolean = when (this) {
        // Wi-Fi P2P discovery works with either precision, so requiring both would leave the UI
        // stuck showing "not granted" for a user who chose approximate location.
        NEARBY_DEVICES -> permissions.any { context.hasPermission(it) }
        else -> permissions.all { context.hasPermission(it) }
    }

    private fun Context.hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
}

/**
 * Special access that cannot be granted through the normal runtime-permission dialog and must be
 * toggled by the user in Settings.
 */
object SpecialAccess {

    /** Notification listener access — the gate for Module 1's notification mirroring. */
    fun isNotificationListenerEnabled(context: Context): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ) ?: return false
        return enabled.split(':').any { it.substringBefore('/') == context.packageName }
    }

    fun notificationListenerSettingsIntent(): Intent =
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * Whether the app is exempt from Doze/App Standby. Xiaomi, OnePlus and Samsung run additional
     * proprietary killers on top of this, which is why the onboarding screen also links out to the
     * OEM-specific settings page.
     */
    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    @Suppress("BatteryLife") // Justified: the notification listener must survive Doze.
    fun batteryOptimizationIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData("package:${context.packageName}".toUri())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun areNotificationsEnabled(context: Context): Boolean {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return nm.areNotificationsEnabled()
    }

    fun appDetailsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData("package:${context.packageName}".toUri())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
