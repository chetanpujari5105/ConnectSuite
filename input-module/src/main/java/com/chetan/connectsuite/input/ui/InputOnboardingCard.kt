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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.ui.Alignment
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.testTag
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.StatusKind
import com.chetan.connectsuite.core.ui.components.StatusPill
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
    val openSettings = rememberInputSettingsOpener()

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

    // Not an error colour when it is off: nothing has failed, and mirroring works without this.
    // It is an offer, so it looks like one — and the heading is conditional for the same reason.
    // The reference draws "Your Mac can control this phone" unconditionally, which is a statement
    // of fact about a permission the user may never have granted.
    SidekickCard(
        container = if (enabled) SidekickColors.card else SidekickColors.cardRaised,
        border = if (enabled) SidekickColors.accentBorder else SidekickColors.border,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(
                icon = Icons.Outlined.TouchApp,
                tint = if (enabled) SidekickColors.accent else SidekickColors.textBody,
                container = if (enabled) SidekickColors.accentTint else SidekickColors.card,
                border = if (enabled) SidekickColors.accentBorder else SidekickColors.border,
            )
            Text(
                if (enabled) "Your Mac can control this phone" else "Let your Mac control this phone",
                style = SidekickType.section,
                color = SidekickColors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            if (enabled) StatusPill("On", StatusKind.Connected)
        }

        Spacer(Modifier.height(Space.md))

        Text(
            if (enabled) {
                "Clicking the mirrored screen on the Mac taps here, dragging swipes, and " +
                    "typing goes into the selected text field."
            } else {
                "Mirroring shows the screen. To click and type on it from the Mac, turn on " +
                    "Sidekick Input under Accessibility — Android has no other way to " +
                    "grant this, and it cannot be done from inside the app."
            },
            style = SidekickType.body,
            color = SidekickColors.textBody,
        )

        Spacer(Modifier.height(Space.sm))

        Text(
            "The power and volume buttons stay out of reach either way. No app can press " +
                "them, ours included.",
            style = SidekickType.caption,
            color = SidekickColors.textMeta,
        )

        Spacer(Modifier.height(Space.md))

        SecondaryButton(
            text = if (enabled) "Accessibility settings" else "Open Accessibility settings",
            onClick = openSettings,
            icon = Icons.Outlined.TouchApp,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * The only way into Android's Accessibility settings from this app, and it goes through
 * [InputDisclosure] whenever the service is off.
 *
 * Returns the action to bind to a button. While the service is off, the action shows the
 * disclosure, and Settings opens only on **Agree**: *Not now*, back, or a tap outside the dialog
 * all leave the person where they were. While the service is on, it opens Settings directly,
 * because turning a grant off needs no consent.
 *
 * [accessibilitySettings] is private to this file, so no other screen can skip the dialog. The
 * Mirror tab's card and the Setup screen's *Control from your Mac* row both call this.
 */
@Composable
fun rememberInputSettingsOpener(): () -> Unit {
    val context = LocalContext.current
    var asking by remember { mutableStateOf(false) }

    if (asking) {
        InputDisclosureDialog(
            onAgree = {
                asking = false
                runCatching { context.startActivity(accessibilitySettings()) }
            },
            onNotNow = { asking = false },
        )
    }

    return {
        if (isInputServiceEnabled(context)) {
            runCatching { context.startActivity(accessibilitySettings()) }
        } else {
            asking = true
        }
    }
}

@Composable
private fun InputDisclosureDialog(onAgree: () -> Unit, onNotNow: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onNotNow,
        containerColor = SidekickColors.card,
        titleContentColor = SidekickColors.textPrimary,
        textContentColor = SidekickColors.textBody,
        title = { Text(InputDisclosure.TITLE, style = SidekickType.title) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Space.md),
            ) {
                InputDisclosure.body.forEach { Text(it, style = SidekickType.body) }
            }
        },
        confirmButton = {
            PrimaryButton(
                text = InputDisclosure.AGREE,
                onClick = onAgree,
                modifier = Modifier.testTag("input-disclosure-agree"),
            )
        },
        dismissButton = {
            TextButton(onClick = onNotNow, modifier = Modifier.testTag("input-disclosure-not-now")) {
                Text(InputDisclosure.NOT_NOW, style = SidekickType.control, color = SidekickColors.textBody)
            }
        },
    )
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
fun isInputServiceEnabled(context: Context): Boolean {
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
