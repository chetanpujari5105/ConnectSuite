package com.chetan.connectsuite.input.ui

import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.provider.Settings
import android.text.TextUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.TouchApp
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.input.ConnectSuiteInputService

/**
 * The Mirror tab's card for the one thing the user has to do by hand.
 *
 * An accessibility service cannot be requested the way MediaProjection can — there is no prompt,
 * no callback, and no way to ask from code. `ACTION_ACCESSIBILITY_SETTINGS` is a deep link into
 * Settings and nothing more. So this card explains what the grant is for, says plainly what it
 * does not do, and opens the right Settings page; the rest is the user's.
 *
 * It watches the secure setting rather than polling, so walking back from Settings with the
 * service enabled updates this card and the Mac's `input` chip at the same moment.
 */
@Composable
fun InputOnboardingCard() {
    val context = LocalContext.current
    var enabled by remember { mutableStateOf(isInputServiceEnabled(context)) }

    DisposableEffect(context) {
        val resolver = context.contentResolver
        val observer = object : ContentObserver(null) {
            override fun onChange(selfChange: Boolean) {
                enabled = isInputServiceEnabled(context)
                // The service itself refreshes capabilities when it is bound and unbound. This is
                // the belt to that braces: a user who toggles the switch while this screen is open
                // sees the card change even if the bind is slow.
                runCatching { LinkController.get(context).refreshCapabilities() }
            }
        }
        resolver.registerContentObserver(
            Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
            false,
            observer,
        )
        onDispose { resolver.unregisterContentObserver(observer) }
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (enabled) {
                MaterialTheme.colorScheme.surfaceVariant
            } else {
                // Not an error colour: nothing has failed, and mirroring works without this. It is
                // an offer, so it looks like one.
                MaterialTheme.colorScheme.secondaryContainer
            },
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                if (enabled) "Your Mac can control this phone" else "Let your Mac control this phone",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                if (enabled) {
                    "Clicking the mirrored screen on the Mac taps here, dragging swipes, and " +
                        "typing goes into the selected text field."
                } else {
                    "Mirroring shows the screen. To click and type on it from the Mac, turn on " +
                        "ConnectSuite Input under Accessibility — Android has no other way to " +
                        "grant this, and it cannot be done from inside the app."
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "The power and volume buttons stay out of reach either way. No app can press " +
                    "them, ours included.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = { context.startActivity(accessibilitySettings()) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.TouchApp, contentDescription = null)
                Text(
                    if (enabled) "Accessibility settings" else "Open Accessibility settings",
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}

private fun accessibilitySettings(): Intent =
    Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

/**
 * Whether our service is on, asked two ways.
 *
 * The bound instance is the stronger answer — it means gestures have somewhere to go — but it is
 * null for a moment after the user flips the switch, while the system is starting us. The secure
 * setting flips first, so checking both means the card never shows "off" over a service the user
 * has just enabled.
 */
private fun isInputServiceEnabled(context: Context): Boolean {
    if (ConnectSuiteInputService.isConnected()) return true
    val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabled)
    val prefix = context.packageName + "/"
    return splitter.any { it.startsWith(prefix) }
}
