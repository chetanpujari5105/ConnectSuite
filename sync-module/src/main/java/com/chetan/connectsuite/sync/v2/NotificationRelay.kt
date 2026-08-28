package com.chetan.connectsuite.sync.v2

import android.app.Notification
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.chetan.connectsuite.core.link.LinkLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The one place the v2 link can reach the notification listener.
 *
 * There is exactly one [NotificationListenerService] in this app and there can only be one that
 * matters: Android binds the component the user enabled in Settings, and a second service would
 * need a second grant from the same screen for the same feature. So the v1 mirror's service is not
 * replaced — it attaches itself here, and this is what `NotificationFeature` talks to.
 *
 * That split is the whole design. The service owns the Android lifecycle and nothing else; this
 * owns the translation to the wire; [NotificationFeature] owns the link. A `notif.reply` that
 * arrives while the service is unbound is refused with a sentence about turning it on, rather than
 * reaching a null and vanishing.
 */
object NotificationRelay {

    /**
     * The bound service, or null while notification access is off.
     *
     * Held rather than looked up because there is no API to fetch a live
     * `NotificationListenerService` instance: it exists only between `onListenerConnected` and
     * `onListenerDisconnected`, and only the service itself knows when that is.
     */
    @Volatile
    private var service: NotificationListenerService? = null

    /** Set by [NotificationFeature]; called for every posted and removed notification. */
    @Volatile
    var onPosted: ((JsonObject) -> Unit)? = null

    @Volatile
    var onRemoved: ((String) -> Unit)? = null

    fun attach(listener: NotificationListenerService) {
        service = listener
        LinkLog.i("notif", "Notification listener attached to the link")
    }

    fun detach() {
        service = null
        LinkLog.i("notif", "Notification listener detached; notifications capability is off")
    }

    /** True while Android has the listener bound, which is the permission half of the contract. */
    fun isListening(): Boolean = service != null

    /**
     * Every notification currently on the phone, as wire payloads.
     *
     * Empty rather than null when the listener is unbound, because a caller that has already
     * checked [isListening] should not have to check twice — and a Mac replaying an empty list is
     * correct for a phone with nothing on its shade.
     */
    fun active(context: Context): List<JsonObject> {
        val live = service ?: return emptyList()
        val notifications = runCatching { live.activeNotifications }
            .onFailure { LinkLog.w("notif", "Could not read active notifications: ${it.message}") }
            .getOrNull() ?: return emptyList()
        return notifications.mapNotNull { sbn -> runCatching { payloadFor(context, sbn) }.getOrNull() }
    }

    /** What went wrong, or null on success. The sentence is composed by the caller. */
    fun dismiss(key: String): Boolean {
        val live = service ?: return false
        return runCatching { live.cancelNotification(key) }
            .onFailure { LinkLog.w("notif", "Dismiss of $key failed: ${it.message}") }
            .isSuccess
    }

    fun find(key: String): StatusBarNotification? {
        val live = service ?: return null
        return runCatching { live.activeNotifications?.firstOrNull { it.key == key } }.getOrNull()
    }

    // ---- wire payload -------------------------------------------------------------------------

    /**
     * One `notif.posted` payload.
     *
     * No icon. `docs/protocol.md` says so in as many words and it is worth restating where the
     * temptation lives: the v1 mirror base64s a 64px PNG into every notification packet, which is
     * a few hundred bytes of JSON per notification and was fine for a phone-to-phone link that
     * showed a feed. The v2 Mac has an app name and will have `apps.icon` in a later phase; a
     * control channel is not an image transport, and one that becomes one gets slow in a way that
     * is very hard to attribute afterwards.
     */
    fun payloadFor(context: Context, sbn: StatusBarNotification): JsonObject {
        val notification = sbn.notification
        val extras: Bundle = notification.extras
        val reply = replyActionOf(notification)

        return buildJsonObject {
            put("key", sbn.key)
            put("package", sbn.packageName)
            put("appName", appNameFor(context, sbn.packageName))
            extras.text(Notification.EXTRA_TITLE)?.let { put("title", it) }
            // BIG_TEXT is the expanded form and is what the user actually reads when they pull a
            // notification down. Preferring it means a mirrored message is the whole message
            // rather than the one-line preview, which is the difference between reading a text on
            // the Mac and having to pick the phone up.
            (extras.text(Notification.EXTRA_BIG_TEXT) ?: extras.text(Notification.EXTRA_TEXT))
                ?.let { put("text", it) }
            extras.text(Notification.EXTRA_SUB_TEXT)?.let { put("subText", it) }
            put("whenMs", if (notification.`when` > 0) notification.`when` else sbn.postTime)
            notification.category?.let { put("category", it) }
            put("ongoing", notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
            put("clearable", sbn.isClearable)
            sbn.groupKey?.let { put("groupKey", it) }
            // The platform's own collapse header. It has no title and no text, so a Mac that draws
            // it draws an empty row; sent rather than filtered because the phone reports the shade
            // and the Mac decides what to show. See docs/protocol.md.
            put("isGroupSummary", notification.flags and Notification.FLAG_GROUP_SUMMARY != 0)
            put("canReply", reply != null)
            reply?.let { put("replyLabel", it.second) }
            put("actions", actionsOf(notification))
        }
    }

    private fun actionsOf(notification: Notification) = buildJsonArray {
        notification.actions?.forEachIndexed { index, action ->
            add(
                buildJsonObject {
                    put("index", index)
                    put("title", action.title?.toString().orEmpty())
                    if (remoteInputOf(action) != null) put("isReply", true)
                },
            )
        }
    }

    /**
     * The action carrying an inline `RemoteInput`, with its label, or null.
     *
     * **Most notifications do not have one.** That is not a bug and it is not something the phone
     * can work around: an inline reply exists only because the app that posted the notification
     * built one, and there is no way to synthesise it. `canReply` on the wire is this being null
     * or not, and the Mac is required to hide its reply box accordingly — showing a box that
     * always fails is the single most common way a companion app lies about notifications.
     */
    fun replyActionOf(notification: Notification): Pair<Notification.Action, String>? {
        notification.actions?.forEach { action ->
            val input = remoteInputOf(action) ?: return@forEach
            return action to (input.label?.toString() ?: action.title?.toString() ?: "Reply")
        }
        return null
    }

    /** Every free-form input an action declares, which is what a reply has to fill in. */
    fun freeFormInputs(action: Notification.Action): List<android.app.RemoteInput> =
        action.remoteInputs?.filter { it.allowFreeFormInput }.orEmpty()

    /**
     * The free-form `RemoteInput` of an action, or null.
     *
     * `allowFreeFormInput` is the discriminator rather than merely "has a RemoteInput": an action
     * can carry choice-only inputs — a list of canned replies with no keyboard — and filling one
     * with arbitrary text produces a reply the app will reject or, worse, silently mangle.
     */
    private fun remoteInputOf(action: Notification.Action): android.app.RemoteInput? =
        action.remoteInputs?.firstOrNull { it.allowFreeFormInput }

    private fun Bundle.text(key: String): String? =
        getCharSequence(key)?.toString()?.takeIf { it.isNotBlank() }

    private fun appNameFor(context: Context, packageName: String): String = runCatching {
        val packages = context.packageManager
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packages.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            packages.getApplicationInfo(packageName, 0)
        }
        packages.getApplicationLabel(info).toString()
    }.getOrDefault(packageName)
}
