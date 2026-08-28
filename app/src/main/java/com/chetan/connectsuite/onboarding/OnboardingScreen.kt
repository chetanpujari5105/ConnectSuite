package com.chetan.connectsuite.onboarding

import android.os.Build
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.SyncAlt
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.chetan.connectsuite.core.permissions.PermissionCard
import com.chetan.connectsuite.core.permissions.PermissionGroup
import com.chetan.connectsuite.core.permissions.SpecialAccess
import com.chetan.connectsuite.core.permissions.rememberPermissionState

/**
 * First-run introduction.
 *
 * Permissions are asked for in stages tied to the feature that needs them, rather than in one
 * burst on launch. A user who has just been shown what Sync does will grant nearby-devices access;
 * the same user asked for SMS access before seeing anything will not, and Android only gives you
 * two refusals before the permission is denied permanently.
 */
@Composable
fun OnboardingScreen(onFinished: () -> Unit) {
    var page by remember { mutableIntStateOf(0) }
    val lastPage = 3

    AnimatedContent(targetState = page, label = "onboarding") { current ->
        when (current) {
            0 -> WelcomePage(onNext = { page = 1 })
            1 -> SyncPage(onNext = { page = 2 }, onSkip = { page = 2 })
            2 -> MirrorPage(onNext = { page = 3 })
            else -> ReliabilityPage(onFinish = onFinished)
        }
    }

    // Nothing to do with `lastPage` beyond documenting the range; kept for readability.
    check(lastPage == 3)
}

@Composable
private fun PageScaffold(
    title: String,
    subtitle: String,
    primaryLabel: String,
    onPrimary: () -> Unit,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    // The activity draws edge to edge, and this screen has no Scaffold to inset it for us.
    Column(
        Modifier
            .fillMaxSize()
            .systemBarsPadding(),
    ) {
        LazyColumn(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column {
                    Text(title, style = MaterialTheme.typography.headlineMedium)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            content()
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (secondaryLabel != null && onSecondary != null) {
                TextButton(onClick = onSecondary) { Text(secondaryLabel) }
                Spacer(Modifier.size(8.dp))
            }
            Button(onClick = onPrimary) { Text(primaryLabel) }
        }
    }
}

@Composable
private fun WelcomePage(onNext: () -> Unit) {
    PageScaffold(
        title = "ConnectSuite",
        subtitle = "Two things, both over your own network. Nothing goes through a server, " +
            "and nothing uses mobile data.",
        primaryLabel = "Get started",
        onPrimary = onNext,
    ) {
        item {
            FeatureCard(
                icon = { Icon(Icons.Outlined.SyncAlt, contentDescription = null) },
                title = "Sync",
                body = "Send files between devices at Wi-Fi speed, and see your phone's " +
                    "notifications and texts on the other device.",
            )
        }
        item {
            FeatureCard(
                icon = { Icon(Icons.Outlined.Cast, contentDescription = null) },
                title = "Mirror",
                body = "See and control another Android device's screen from here. " +
                    "No root; the target needs debugging enabled once.",
            )
        }
        item {
            Card(
                Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
            ) {
                Text(
                    "Devices are paired by confirming a key on both screens, and every " +
                        "connection after that is checked against it. An unpaired device is " +
                        "refused without asking you anything.",
                    Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun SyncPage(onNext: () -> Unit, onSkip: () -> Unit) {
    val nearby = rememberPermissionState(PermissionGroup.NEARBY_DEVICES)
    val notifications = rememberPermissionState(PermissionGroup.NOTIFICATIONS)

    PageScaffold(
        title = "Finding your devices",
        subtitle = "Sync needs two permissions to see other devices and tell you what it is " +
            "doing. Neither is used for anything else.",
        primaryLabel = if (nearby.isGranted) "Next" else "Continue",
        onPrimary = onNext,
        secondaryLabel = "Skip for now",
        onSecondary = onSkip,
    ) {
        item {
            PermissionCard(
                title = PermissionGroup.NEARBY_DEVICES.title,
                rationale = PermissionGroup.NEARBY_DEVICES.rationale,
                granted = nearby.isGranted,
                actionLabel = "Allow",
                onAction = nearby.request,
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            item {
                PermissionCard(
                    title = PermissionGroup.NOTIFICATIONS.title,
                    rationale = PermissionGroup.NOTIFICATIONS.rationale,
                    granted = notifications.isGranted,
                    actionLabel = "Allow",
                    onAction = notifications.request,
                )
            }
        }
        item {
            Text(
                "Notification mirroring and SMS need extra access. Those are asked for from " +
                    "the Sync tab, when you turn them on — not now.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun MirrorPage(onNext: () -> Unit) {
    PageScaffold(
        title = "Before you can mirror",
        subtitle = "Screen mirroring needs no permission on this device — but the device you " +
            "want to mirror has to have debugging turned on. That is a one-time setup that " +
            "only a person at that device can do.",
        primaryLabel = "Next",
        onPrimary = onNext,
    ) {
        item {
            NumberedNote(
                1,
                "On the target device: Settings → About phone → tap Build number seven times.",
            )
        }
        item {
            NumberedNote(
                2,
                "Settings → System → Developer options → turn on Wireless debugging.",
            )
        }
        item {
            NumberedNote(
                3,
                "Plug it into a computer once and run \"adb tcpip 5555\". You can unplug " +
                    "immediately afterwards.",
            )
        }
        item {
            Text(
                "The full walkthrough is always available from the Mirror tab.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ReliabilityPage(onFinish: () -> Unit) {
    val context = LocalContext.current
    var exempt by remember { androidx.compose.runtime.mutableStateOf(false) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        exempt = SpecialAccess.isIgnoringBatteryOptimizations(context)
    }

    PageScaffold(
        title = "Keeping it running",
        subtitle = "Android stops background apps aggressively. For notifications to keep " +
            "arriving while ConnectSuite is not open, it needs to be exempt from battery " +
            "optimisation.",
        primaryLabel = "Done",
        onPrimary = onFinish,
    ) {
        item {
            PermissionCard(
                title = "Ignore battery optimisation",
                rationale = "Without this, the connection is dropped within minutes of " +
                    "leaving the app and notifications stop arriving.",
                granted = exempt,
                actionLabel = "Allow",
                onAction = {
                    runCatching {
                        context.startActivity(SpecialAccess.batteryOptimizationIntent(context))
                    }
                },
            )
        }
        item {
            Card(
                Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                ),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        "Some manufacturers need more",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Xiaomi, Samsung, OnePlus, Oppo and Vivo run their own app killers on " +
                            "top of Android's. The Android setting above does not disable " +
                            "those. If notifications stop arriving after a while, look for " +
                            "\"Autostart\", \"Battery saver\" or \"Protected apps\" in your " +
                            "system settings and allow ConnectSuite there too.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(
                            onClick = {
                                runCatching {
                                    context.startActivity(
                                        SpecialAccess.appDetailsIntent(context),
                                    )
                                }
                            },
                        ) { Text("Open app settings") }
                    }
                }
            }
        }
    }
}

@Composable
private fun FeatureCard(
    icon: @Composable () -> Unit,
    title: String,
    body: String,
) {
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp)) {
            icon()
            Spacer(Modifier.size(14.dp))
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun NumberedNote(number: Int, text: String) {
    Row(Modifier.fillMaxWidth()) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(26.dp),
        ) {
            Row(
                Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    number.toString(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            }
        }
        Spacer(Modifier.size(12.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}
