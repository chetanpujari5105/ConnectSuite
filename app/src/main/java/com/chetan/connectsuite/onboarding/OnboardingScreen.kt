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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.SyncAlt
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkService
import com.chetan.connectsuite.core.permissions.PermissionCard
import com.chetan.connectsuite.core.permissions.PermissionGroup
import com.chetan.connectsuite.core.permissions.SpecialAccess
import com.chetan.connectsuite.core.permissions.rememberPermissionState
import com.chetan.connectsuite.link.QrScanScreen
import kotlinx.coroutines.launch

/**
 * How onboarding ended, which decides where the app opens.
 *
 * The flow used to finish on the Sync tab unconditionally — the v1 Android-to-Android feature,
 * which has nothing to do with the Mac the previous four pages were about. A person who has just
 * paired should land on the thing they paired.
 */
enum class OnboardingOutcome { PAIRED, NOT_PAIRED }

/**
 * First-run introduction.
 *
 * Permissions are asked for in stages tied to the feature that needs them, rather than in one
 * burst on launch. A user who has just been shown what Sync does will grant nearby-devices access;
 * the same user asked for SMS access before seeing anything will not, and Android only gives you
 * two refusals before the permission is denied permanently.
 *
 * **Every string on these pages comes from [OnboardingCopy] and none is written here.** That is
 * load-bearing rather than tidy: `OnboardingCopyTest` checks the copy against the mechanisms this
 * app actually has, and a sentence written inline would be invisible to it. The test enforces the
 * separation both ways.
 *
 * The flow ends on **pairing** — F1 in `docs/phase-7-pairing-flow.md`. Everything before it is
 * setup for a link that, until 2026-09-02, onboarding never once mentioned.
 */
@Composable
fun OnboardingScreen(onFinished: (OnboardingOutcome) -> Unit) {
    var page by remember { mutableIntStateOf(0) }

    // Derived from the enumeration, never a literal. A sixth page must not need an edit here.
    val lastPage = OnboardingCopy.pages.lastIndex
    val next = { page = (page + 1).coerceAtMost(lastPage) }

    AnimatedContent(targetState = page, label = "onboarding") { current ->
        when (OnboardingCopy.pages[current].id) {
            OnboardingCopy.WELCOME -> WelcomePage(onNext = next)
            OnboardingCopy.PERMISSIONS -> PermissionsPage(onNext = next, onSkip = next)
            OnboardingCopy.MIRROR -> MirrorPage(onNext = next)
            OnboardingCopy.RELIABILITY -> ReliabilityPage(onNext = next)
            else -> PairPage(onFinished = onFinished)
        }
    }
}

@Composable
private fun PageScaffold(
    page: OnboardingCopy.Page,
    onPrimary: () -> Unit,
    title: String = page.title,
    subtitle: String = page.subtitle,
    primaryLabel: String = page.primaryLabel,
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
            val secondary = page.secondaryLabel
            if (secondary != null && onSecondary != null) {
                TextButton(onClick = onSecondary) { Text(secondary) }
                Spacer(Modifier.size(8.dp))
            }
            Button(onClick = onPrimary) { Text(primaryLabel) }
        }
    }
}

@Composable
private fun WelcomePage(onNext: () -> Unit) {
    val copy = OnboardingCopy.welcome
    PageScaffold(page = copy, onPrimary = onNext) {
        item {
            FeatureCard(
                icon = { Icon(Icons.Outlined.SyncAlt, contentDescription = null) },
                title = copy.body[0],
                body = copy.body[1],
            )
        }
        item {
            FeatureCard(
                icon = { Icon(Icons.Outlined.Cast, contentDescription = null) },
                title = copy.body[2],
                body = copy.body[3],
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
                    copy.body[4],
                    Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun PermissionsPage(onNext: () -> Unit, onSkip: () -> Unit) {
    val copy = OnboardingCopy.permissions
    val nearby = rememberPermissionState(PermissionGroup.NEARBY_DEVICES)
    val notifications = rememberPermissionState(PermissionGroup.NOTIFICATIONS)

    PageScaffold(
        page = copy,
        onPrimary = onNext,
        primaryLabel = if (nearby.isGranted) {
            OnboardingCopy.PERMISSIONS_PRIMARY_GRANTED
        } else {
            copy.primaryLabel
        },
        onSecondary = onSkip,
    ) {
        item {
            PermissionCard(
                title = PermissionGroup.NEARBY_DEVICES.title,
                rationale = PermissionGroup.NEARBY_DEVICES.rationale,
                granted = nearby.isGranted,
                actionLabel = OnboardingCopy.ALLOW,
                onAction = nearby.request,
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            item {
                PermissionCard(
                    title = PermissionGroup.NOTIFICATIONS.title,
                    rationale = PermissionGroup.NOTIFICATIONS.rationale,
                    granted = notifications.isGranted,
                    actionLabel = OnboardingCopy.ALLOW,
                    onAction = notifications.request,
                )
            }
        }
        item {
            Text(
                copy.body[0],
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * What this page used to be is worth remembering: three numbered steps walking the user through
 * enabling developer options and running a shell command, to set up a mirroring implementation
 * deleted on 2026-08-26. Mirror v2 needs none of it. What is left is the two things about it that
 * genuinely surprise people, both of which are platform walls rather than product choices.
 */
@Composable
private fun MirrorPage(onNext: () -> Unit) {
    val copy = OnboardingCopy.mirror
    PageScaffold(page = copy, onPrimary = onNext) {
        item { NoteCard(title = copy.body[0], body = copy.body[1]) }
        item { NoteCard(title = copy.body[2], body = copy.body[3]) }
    }
}

@Composable
private fun ReliabilityPage(onNext: () -> Unit) {
    val copy = OnboardingCopy.reliability
    val context = LocalContext.current
    var exempt by remember { mutableStateOf(false) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        exempt = SpecialAccess.isIgnoringBatteryOptimizations(context)
    }

    PageScaffold(page = copy, onPrimary = onNext) {
        item {
            PermissionCard(
                title = copy.body[0],
                rationale = copy.body[1],
                granted = exempt,
                actionLabel = OnboardingCopy.ALLOW,
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
                    Text(copy.body[2], style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(6.dp))
                    Text(copy.body[3], style = MaterialTheme.typography.bodySmall)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(
                            onClick = {
                                runCatching {
                                    context.startActivity(SpecialAccess.appDetailsIntent(context))
                                }
                            },
                        ) { Text(copy.body[4]) }
                    }
                }
            }
        }
    }
}

/**
 * Page five — the one the whole flow now exists to reach.
 *
 * It deliberately reuses `QrScanScreen` and `completePairing` rather than reimplementing either:
 * the trust decision has one home in `LinkRoute` and a second copy of it made here would be a
 * second thing to get wrong, in the security-critical path of the two.
 *
 * The secondary is *"I'll do this later"*, not *"Skip"*. Somebody who has not installed the Mac app
 * yet is in an ordinary situation and the label should name it — the two are not the same, and
 * `docs/phase-7-pairing-flow.md` §5 leaves the decision to skip *at all* open on exactly that
 * ground.
 */
@Composable
private fun PairPage(onFinished: (OnboardingOutcome) -> Unit) {
    val copy = OnboardingCopy.pair
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val server = remember { LinkController.get(context) }

    var scanning by remember { mutableStateOf(false) }
    var pairedWith by remember { mutableStateOf<String?>(null) }

    if (scanning) {
        QrScanScreen(
            onScanned = { payload ->
                scope.launch {
                    server.completePairing(payload)
                    LinkService.start(context)
                    pairedWith = payload.name
                    scanning = false
                }
            },
            onCancel = { scanning = false },
        )
        return
    }

    val paired = pairedWith
    if (paired != null) {
        PageScaffold(
            page = copy,
            title = OnboardingCopy.PAIR_SUCCESS_TITLE.format(paired),
            subtitle = OnboardingCopy.PAIR_SUCCESS_SUBTITLE,
            primaryLabel = OnboardingCopy.PAIR_SUCCESS_PRIMARY,
            onPrimary = { onFinished(OnboardingOutcome.PAIRED) },
            // No secondary in the success state: there is nothing left to defer.
            onSecondary = null,
        ) {
            item {
                Card(
                    Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    ),
                ) {
                    Row(Modifier.padding(16.dp)) {
                        Icon(Icons.Outlined.CheckCircle, contentDescription = null)
                        Spacer(Modifier.size(14.dp))
                        Text(
                            OnboardingCopy.PAIR_SUCCESS_BODY,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
        }
        return
    }

    PageScaffold(
        page = copy,
        onPrimary = { scanning = true },
        onSecondary = { onFinished(OnboardingOutcome.NOT_PAIRED) },
    ) {
        item {
            Text(
                copy.body[0],
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
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
private fun NoteCard(title: String, body: String) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(6.dp))
            Text(body, style = MaterialTheme.typography.bodySmall)
        }
    }
}
