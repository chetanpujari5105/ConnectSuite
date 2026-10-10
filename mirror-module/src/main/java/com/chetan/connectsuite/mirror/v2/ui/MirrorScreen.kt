package com.chetan.connectsuite.mirror.v2.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.mutableStateOf
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.delay
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.ScreenShare
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkState
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.DestructiveButton
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.StatusKind
import com.chetan.connectsuite.core.ui.components.StatusPill
import com.chetan.connectsuite.mirror.v2.MirrorEngine
import com.chetan.connectsuite.mirror.v2.MirrorPhase
import com.chetan.connectsuite.mirror.v2.MirrorStatus

/**
 * Mirror — reference `15_android_mirror.png`.
 *
 * ### This screen was already honest; the pass is a restyle
 *
 * Unlike the other references, 15 claims almost nothing the app cannot do. Its one overreach is the
 * heading **"Your Mac can control this phone"**, stated as fact — the accessibility service it
 * depends on may never have been granted, and `InputOnboardingCard` has always made that heading
 * conditional (*"Let your Mac control this phone"* when it is off). That stays.
 *
 * Its most interesting line is one to keep exactly: *"The power and volume buttons stay out of
 * reach either way. No app can press them, ours included."* That is the locked platform wall —
 * `INJECT_EVENTS` is signature-level and no `AccessibilityService` can synthesise a `KeyEvent` —
 * written as a reassurance rather than an apology.
 *
 * ### Not a status page
 *
 * Android 16 will not let a backgrounded app raise the capture prompt, so the Start button here is
 * the **primary consent path** and not a convenience. `MirrorPhase.AWAITING_FOREGROUND` is the
 * state where a Mac has asked and only a tap on this phone can finish it, which is why that phase
 * is the one drawn in the accent rather than in the neutral every other line uses.
 */
@Composable
fun MirrorScreen(extraCards: @Composable () -> Unit = {}) {
    val context = LocalContext.current
    val status by MirrorEngine.status.collectAsStateWithLifecycle()
    // get() rather than peek(): the tab can be composed before anything else has touched the
    // link, and a null here would silently disable the Start button forever.
    val link by remember(context) { LinkController.get(context).state }.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(vertical = Space.md)) {
            Text("Mirror", style = SidekickType.display, color = SidekickColors.textPrimary)
        }

        // Motion item 4 (RequestCardMotion): the request card arrives and resolves as one swap
        // with the state card, which always draws the phase the engine reported.
        val risePx = with(LocalDensity.current) { RequestCardMotion.RISE_DP.dp.roundToPx() }
        AnimatedContent(
            targetState = status.phase == MirrorPhase.AWAITING_FOREGROUND,
            transitionSpec = { with(RequestCardMotion) { transition(risePx) } },
            label = "mirror-request",
        ) { awaiting ->
            Column(verticalArrangement = Arrangement.spacedBy(Space.sm)) {
                if (awaiting) {
                    // A Mac asked while Sidekick was in the background. This screen — not Android's
                    // prompt — is the first thing the person sees, so it says who asked and what
                    // sharing means before anything is requested. Android's own prompt follows
                    // Continue.
                    MirrorRequestCard(
                        status = status,
                        onContinue = { MirrorEngine.startFromPhone(context) },
                        onDecline = { MirrorEngine.declineFromPhone(context) },
                    )
                    Spacer(Modifier.height(Space.xl))
                } else {
                StateCard(status = status, link = link)

                extraCards()

                Spacer(Modifier.height(Space.xs))

                if (status.phase == MirrorPhase.RUNNING) {
                    DestructiveButton(
                        text = "Stop mirroring",
                        onClick = { MirrorEngine.stopFromPhone(context) },
                        icon = Icons.Outlined.StopCircle,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                    )
                } else {
                    PrimaryButton(
                        text = "Start mirroring",
                        onClick = { MirrorEngine.startFromPhone(context) },
                        icon = Icons.Outlined.Cast,
                        enabled = link.isConnected,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                    )
                }

                // A disabled button with no explanation is the silent failure this project keeps ruling
                // out, so the one reason it can be disabled is written next to it.
                if (!link.isConnected && status.phase != MirrorPhase.RUNNING) {
                    Text(
                        "No Mac is connected. Connect one first — mirroring needs somewhere to send the " +
                            "screen.",
                        style = SidekickType.caption,
                        color = SidekickColors.textMeta,
                    )
                }

                Spacer(Modifier.height(Space.sm))

                SidekickCard(padding = Space.md, container = SidekickColors.canvas) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Space.md),
                    ) {
                        IconBadge(Icons.Outlined.Info, tint = SidekickColors.textMeta)
                        Text(
                            "Android asks you to allow screen sharing each time you start. That is " +
                                "Android's rule, and it can't be remembered.",
                            style = SidekickType.caption,
                            color = SidekickColors.textMeta,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                Spacer(Modifier.height(Space.xl))
                }
            }
        }
    }
}

/** The live phase, its explanation, and the last failure if the session ended in one. */
@Composable
private fun StateCard(status: MirrorStatus, link: LinkState) {
    val headline = when (status.phase) {
        MirrorPhase.IDLE -> if (link.isConnected) "Ready to mirror" else "Not mirroring"
        MirrorPhase.AWAITING_FOREGROUND -> "${status.peerName ?: "Your Mac"} is waiting for you"
        MirrorPhase.REQUESTING_CONSENT -> "Asking for permission"
        MirrorPhase.STARTING -> "Starting capture"
        MirrorPhase.RUNNING -> "Mirroring to ${status.peerName ?: "your Mac"}"
        MirrorPhase.STOPPED -> "Mirroring stopped"
    }

    // The waiting state is the one the user has been sent here to act on, so it is the one that
    // does not look like every other line on the screen.
    val awaiting = status.phase == MirrorPhase.AWAITING_FOREGROUND
    val live = status.phase == MirrorPhase.RUNNING
    val tone: Color = when {
        awaiting || live -> SidekickColors.accent
        else -> SidekickColors.textBody
    }
    val icon: ImageVector = when (status.phase) {
        MirrorPhase.AWAITING_FOREGROUND -> Icons.Outlined.HourglassEmpty
        MirrorPhase.RUNNING -> Icons.Outlined.ScreenShare
        else -> Icons.Outlined.Cast
    }

    SidekickCard(
        container = if (awaiting) SidekickColors.accentTint else SidekickColors.card,
        border = if (awaiting || live) SidekickColors.accentBorder else SidekickColors.border,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(
                icon = icon,
                tint = tone,
                container = if (awaiting || live) SidekickColors.accentTint else SidekickColors.cardRaised,
                border = if (awaiting || live) SidekickColors.accentBorder else SidekickColors.border,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    headline,
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                status.message?.let {
                    Text(it, style = SidekickType.caption, color = SidekickColors.textBody)
                }
            }
            if (live) StatusPill("Live", StatusKind.Connected)
        }

        status.fixHint?.let {
            Spacer(Modifier.height(Space.sm))
            Text(it, style = SidekickType.caption, color = SidekickColors.textBody)
        }

        // Real numbers from a real capture, and only while there is one.
        status.geometry?.let {
            Spacer(Modifier.height(Space.sm))
            Text(
                "Capturing ${it.width}×${it.height} at ${it.dpi} dpi.",
                style = SidekickType.meta,
                color = SidekickColors.textMeta,
            )
        }

        // Kept after the session ends: "it stopped" without "because consent timed out" is
        // exactly the answer this screen exists to stop giving.
        if (status.phase != MirrorPhase.RUNNING && status.lastError != null &&
            status.lastError != status.message
        ) {
            Spacer(Modifier.height(Space.sm))
            Text(
                "Last error: ${status.lastError}",
                style = SidekickType.caption,
                color = SidekickColors.destructive,
            )
        }
    }
}

/**
 * **A Mac is asking to see this phone's screen** — Feature F, 2026-09-23.
 *
 * Reached by tapping the request notification (a user gesture, which is what lets the app come
 * forward on Android 10+). It explains, in Sidekick's words, what Android's own prompt is about to
 * ask; it never imitates that prompt, and never quotes its buttons — Android and the phone's maker
 * word them, and this Samsung says "Next" then "Share screen".
 *
 * The countdown is computed from `askedAtMillis`, set in the same breath as the consent timer, so it
 * ends when the request does. After it ends the phase leaves `AWAITING_FOREGROUND` and this card is
 * replaced by the ordinary state card carrying the timeout's own sentence.
 */
@Composable
fun MirrorRequestCard(status: MirrorStatus, onContinue: () -> Unit, onDecline: () -> Unit) {
    val peer = status.peerName ?: "Your Mac"
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(status.askedAtMillis) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val left = status.askedAtMillis?.let {
        ((it + MirrorEngine.CONSENT_TIMEOUT_MS - now) / 1_000).coerceAtLeast(0)
    }

    SidekickCard(
        container = SidekickColors.accentTint,
        border = SidekickColors.accentBorder,
        modifier = Modifier.testTag("mirror-request"),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.md)) {
            IconBadge(
                Icons.Outlined.ScreenShare,
                tint = SidekickColors.accent,
                container = SidekickColors.accentTint,
                border = SidekickColors.accentBorder,
            )
            Column(Modifier.weight(1f)) {
                Text(
                    "$peer wants to see this phone's screen",
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                if (left != null) {
                    Text(
                        if (left > 0) "This request ends in ${left}s" else "This request has ended",
                        style = SidekickType.meta,
                        color = SidekickColors.textMeta,
                    )
                }
            }
        }
        Spacer(Modifier.height(Space.md))
        for (line in listOf(
            "$peer will see everything on this screen until you stop sharing — including " +
                "notifications that appear while it is on.",
            "With Sidekick Input turned on, $peer can also tap and type here.",
            "Android will ask next, in its own words. That prompt is Android's; Sidekick cannot " +
                "answer it for you.",
            "Your lock screen, banking apps and protected video stay black on the Mac.",
        )) {
            Text(
                "·  $line",
                style = SidekickType.caption,
                color = SidekickColors.textBody,
                modifier = Modifier.padding(bottom = Space.xs),
            )
        }
    }
    Spacer(Modifier.height(Space.sm))
    // One answer per request, taken in the tap (OneTap): the engine is called at once, and a second
    // tap — on either button, in the same frame or during the swap — does nothing.
    val gate = remember(status.askedAtMillis) { OneTap() }
    var answered by remember(status.askedAtMillis) { mutableStateOf(false) }
    PrimaryButton(
        text = "Continue",
        onClick = { if (gate.take()) { answered = true; onContinue() } },
        icon = Icons.Outlined.Cast,
        enabled = !answered,
        modifier = Modifier.fillMaxWidth().height(56.dp).testTag("mirror-request-continue"),
    )
    SecondaryButton(
        text = "Decline",
        onClick = { if (gate.take()) { answered = true; onDecline() } },
        enabled = !answered,
        modifier = Modifier.fillMaxWidth().height(52.dp).testTag("mirror-request-decline"),
    )
}
