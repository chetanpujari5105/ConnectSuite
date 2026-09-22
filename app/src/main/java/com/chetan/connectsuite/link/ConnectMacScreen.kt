package com.chetan.connectsuite.link

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PriorityHigh
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SignalWifiOff
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chetan.connectsuite.core.link.ConnectStage
import com.chetan.connectsuite.core.link.PairRejectReason
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.SidekickHeader
import com.chetan.connectsuite.core.ui.components.SidekickProgress
import com.chetan.connectsuite.core.ui.components.StatusKind
import com.chetan.connectsuite.core.ui.components.StatusPill

/**
 * Connect a Mac — references `02`, `04`-`09`.
 *
 * ### Which reference states exist here, and which do not
 *
 * | Reference | Here | Why |
 * |---|---|---|
 * | 02 Entry | [EntryStage] | as drawn, with one honest substitution (see below) |
 * | 03 QR scan | `QrScanScreen` | real camera, ML Kit, unchanged behaviour |
 * | 04 Searching | **no** | the phone does not search. Locked decision #2: it binds and waits |
 * | *Verifying* | **no** | not observable — TLS and the token check both happen inside `accept()` |
 * | 05 Connecting | [WaitingStage] | one honest state, with the token's real deadline |
 * | 06 Success | [ConnectedStage] | as drawn |
 * | 07 Confirm this Mac | **elsewhere** | that is the v1 Sync dialog; in the QR flow the QR *is* the confirmation |
 * | 08 Declined | [RefusedStage] / [ExpiredStage] | two real failures, both amber |
 * | 09 No network | [NoNetworkStage] | real, read from the interface list |
 *
 * The three omissions are the `CLAUDE.md` rule about unreachable states: a stage nobody can tell
 * from a bug in its neighbour must not be drawn beside stages that can.
 *
 * ### "Enter address manually" points the wrong way
 *
 * Reference 02's second button is a real affordance on the **Mac** — discovery order #4 is manual
 * IP entry, and it is the Mac that dials. A phone has nothing to type an address *into*; it binds
 * and waits. What the user in that situation actually needs is the number to type on the other
 * machine, so the button is **"Show this phone's address"** and it prints the real endpoint from
 * `PhoneAddress`. Same journey, opposite direction, and it is the direction the architecture runs.
 */
@Composable
fun ConnectMacScreen(
    stage: ConnectStage,
    nowMillis: Long,
    localEndpoint: String?,
    onScan: () -> Unit,
    onShowAddress: () -> Unit,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
    onOpenWifiSettings: () -> Unit,
    onOpenDevices: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        // Reference 02 puts a "?" here and reference 03 a "Having trouble?" row. Neither has a
        // destination in this app — there is no help screen, and inventing one that says "check
        // your Wi-Fi" duplicates the card already on this screen. So the slot carries the one
        // thing that is real: whether a Mac is connected.
        SidekickHeader {
            if (stage is ConnectStage.Connected) StatusPill("Connected", StatusKind.Connected)
        }

        when (stage) {
            is ConnectStage.Entry -> EntryStage(onScan, onShowAddress, localEndpoint)
            is ConnectStage.Waiting -> WaitingStage(stage, nowMillis, onCancel)
            is ConnectStage.Connected -> ConnectedStage(stage, onOpenDevices)
            is ConnectStage.Expired -> ExpiredStage(stage, onRetry, onCancel)
            is ConnectStage.Rejected -> RejectedStage(stage, onRetry, onCancel)
            is ConnectStage.Refused -> RefusedStage(stage, onRetry, onCancel)
            is ConnectStage.NoNetwork -> NoNetworkStage(onOpenWifiSettings)
        }

        Spacer(Modifier.height(Space.xl))
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 02 — Entry
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun EntryStage(
    onScan: () -> Unit,
    onShowAddress: () -> Unit,
    localEndpoint: String?,
) {
    LinkArt(tone = LinkArtTone.Brand)

    Text(
        buildAnnotatedString {
            append("Link your ")
            withStyle(SpanStyle(color = SidekickColors.accent)) { append("Mac") }
        },
        style = SidekickType.display.copy(fontSize = 34.sp, lineHeight = 40.sp),
        color = SidekickColors.textPrimary,
    )
    Text(
        "Pair this phone with your Mac over your own network. No cloud, no account, " +
            "no relay in the middle.",
        style = SidekickType.body,
        color = SidekickColors.textBody,
    )

    Spacer(Modifier.height(Space.xs))

    PrimaryButton(
        text = "Scan QR code",
        onClick = onScan,
        icon = Icons.Outlined.QrCodeScanner,
        trailingIcon = Icons.Outlined.ChevronRight,
        modifier = Modifier.fillMaxWidth().height(56.dp),
    )
    SecondaryButton(
        text = "Show this phone's address",
        onClick = onShowAddress,
        icon = Icons.Outlined.Dns,
        // Disabled with its reason stated below rather than hidden: a control that vanishes when
        // the network drops teaches nothing, and this is the one screen where a missing address is
        // the whole problem.
        enabled = localEndpoint != null,
        modifier = Modifier.fillMaxWidth().height(52.dp),
    )

    Spacer(Modifier.height(Space.sm))

    TrustRow()

    SidekickCard {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(Icons.Outlined.Wifi, shape = CircleShape)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "Your Mac and this phone have to be on the same network.",
                    style = SidekickType.caption,
                    color = SidekickColors.textBody,
                )
                Text(
                    localEndpoint?.let { "This phone is reachable at $it" }
                        ?: "This phone has no local address right now.",
                    style = SidekickType.meta,
                    color = if (localEndpoint != null) SidekickColors.accentText else SidekickColors.warning,
                )
            }
        }
    }
}

/**
 * Secure / Fast / Private.
 *
 * The third column's reference copy is *"No cloud, no account, no data stored"* and the last third
 * of that is **false**: this app keeps a trust store, a transfer history and mirrored notifications
 * in Room. What is true is that none of it leaves the local network, so that is what it says. A
 * privacy claim is the worst possible place to round a sentence up.
 */
@Composable
private fun TrustRow() {
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        TrustColumn(
            Icons.Outlined.Lock,
            "Secure",
            "TLS 1.3, pinned to the key in the QR",
            Modifier.weight(1f),
        )
        TrustColumn(
            Icons.Outlined.Bolt,
            "Fast",
            "Straight across your network",
            Modifier.weight(1f),
        )
        TrustColumn(
            Icons.Outlined.CloudOff,
            "Private",
            "No cloud, no account, nothing leaves your network",
            Modifier.weight(1f),
        )
    }
}

@Composable
private fun TrustColumn(icon: ImageVector, title: String, body: String, modifier: Modifier) {
    Column(
        modifier
            .fillMaxHeight()
            .clip(Radius.cardShape)
            .background(SidekickColors.card)
            .border(BorderStroke(Size.hairline, SidekickColors.border), Radius.cardShape)
            .padding(horizontal = Space.sm, vertical = Space.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        Icon(icon, null, tint = SidekickColors.textBody, modifier = Modifier.size(Size.iconLarge))
        Text(
            title,
            style = SidekickType.caption.copy(fontWeight = FontWeight.Medium),
            color = SidekickColors.textPrimary,
        )
        Text(
            body,
            style = SidekickType.meta,
            color = SidekickColors.textMeta,
            textAlign = TextAlign.Center,
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 05 — Waiting (the honest form of "Searching" and "Connecting")
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun WaitingStage(stage: ConnectStage.Waiting, nowMillis: Long, onCancel: () -> Unit) {
    LinkArt(tone = LinkArtTone.Live)

    SidekickCard(padding = Space.xl) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            Box(
                Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(SidekickColors.accentTint)
                    .border(BorderStroke(Size.hairline, SidekickColors.accentBorder), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(16.dp).clip(CircleShape).background(SidekickColors.accent))
            }

            Text(
                "Waiting for ${stage.macName}",
                style = SidekickType.title,
                color = SidekickColors.textPrimary,
                textAlign = TextAlign.Center,
            )
            // The reference says "Looking for your Mac". The phone is not looking: it has written
            // the trust row, armed the token and is listening. Saying so is also the instruction —
            // the next move is on the Mac, and the user needs to know that.
            Text(
                "This phone is listening. Your Mac connects to it — keep Sidekick open on the Mac.",
                style = SidekickType.body,
                color = SidekickColors.textBody,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(Space.xs))

            SidekickProgress(
                progress = stage.fractionLeft(nowMillis),
                tone = if (stage.fractionLeft(nowMillis) < 0.2f) {
                    SidekickColors.warning
                } else {
                    SidekickColors.accent
                },
            )
            Text(
                "Pairing code valid for ${formatCountdown(stage.millisLeft(nowMillis))}",
                style = SidekickType.meta,
                color = SidekickColors.textMeta,
            )
        }
    }

    SecondaryButton("Cancel", onCancel, Modifier.fillMaxWidth().height(52.dp))
}

/** `4:58`. Seconds matter here — this is a countdown somebody is watching. */
internal fun formatCountdown(millis: Long): String {
    val total = millis / 1000
    return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 06 — Connected
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ConnectedStage(stage: ConnectStage.Connected, onOpenDevices: () -> Unit) {
    Spacer(Modifier.height(Space.xl))
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Space.lg),
    ) {
        Box(
            Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(SidekickColors.accentTint)
                .border(BorderStroke(1.dp, SidekickColors.accentBorder), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = null,
                tint = SidekickColors.accent,
                modifier = Modifier.size(64.dp),
            )
        }

        Text("Connected", style = SidekickType.display, color = SidekickColors.textPrimary)
        Text(
            "This phone and ${stage.macName} are linked. Everything you turn on is available now.",
            style = SidekickType.body,
            color = SidekickColors.textBody,
            textAlign = TextAlign.Center,
        )
    }

    Spacer(Modifier.height(Space.sm))

    SidekickCard {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(Icons.Outlined.Laptop, size = 48.dp, tint = SidekickColors.accent)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.xs)) {
                Text(
                    stage.macName,
                    style = SidekickType.section,
                    color = SidekickColors.textPrimary,
                )
                Text(
                    "Local network · TLS 1.3",
                    style = SidekickType.meta,
                    color = SidekickColors.textMeta,
                )
            }
            StatusPill("Connected", StatusKind.Connected)
        }
    }

    PrimaryButton(
        text = "Go to Devices",
        onClick = onOpenDevices,
        trailingIcon = Icons.Outlined.ChevronRight,
        modifier = Modifier.fillMaxWidth().height(56.dp),
    )
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 08 — the two real failures. Amber, never red: nothing is broken in either.
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ExpiredStage(stage: ConnectStage.Expired, onRetry: () -> Unit, onCancel: () -> Unit) {
    FailureStage(
        headline = "Pairing code expired",
        body = "Sidekick on ${stage.macName} did not connect in time. Show a fresh code on the " +
            "Mac and scan it again.",
        hintTitle = "The code is good for five minutes.",
        hintBody = "It expires on purpose, so a screenshot of an old one cannot be used later.",
        onRetry = onRetry,
        onCancel = onCancel,
        retryLabel = "Scan again",
    )
}

/**
 * The server said why. [PairRejectReason.message] is that sentence, written once in `core/` and
 * rendered here — not paraphrased, because the Mac shows its own copy keyed on the same reason and
 * two machines describing one event differently is worse than either wording.
 */
@Composable
private fun RejectedStage(stage: ConnectStage.Rejected, onRetry: () -> Unit, onCancel: () -> Unit) {
    FailureStage(
        headline = when (stage.reason) {
            PairRejectReason.TOKEN_EXPIRED -> "Pairing code expired"
            PairRejectReason.TOKEN_MISMATCH -> "That was a different code"
            PairRejectReason.TOKEN_MISSING -> "The Mac sent no code"
        },
        body = stage.reason.message,
        hintTitle = "${stage.macName} did reach this phone.",
        hintBody = "The connection worked and the code did not, so this is not a network problem " +
            "— a fresh code on the Mac is all it needs.",
        onRetry = onRetry,
        onCancel = onCancel,
        retryLabel = "Scan again",
    )
}

@Composable
private fun RefusedStage(stage: ConnectStage.Refused, onRetry: () -> Unit, onCancel: () -> Unit) {
    FailureStage(
        headline = "A Mac was turned away",
        body = buildString {
            append("Something tried to connect")
            stage.address?.let { append(" from $it") }
            append(" and is not paired with this phone.")
        },
        hintTitle = "Key ${stage.fingerprintPrefix}…",
        hintBody = "If that is your Mac, its key has changed — show a fresh code on it and scan " +
            "again. If you do not recognise it, it was refused and nothing was shared.",
        monospaceHint = true,
        onRetry = onRetry,
        onCancel = onCancel,
        retryLabel = "Scan a code",
    )
}

@Composable
private fun FailureStage(
    headline: String,
    body: String,
    hintTitle: String,
    hintBody: String,
    retryLabel: String,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
    monospaceHint: Boolean = false,
) {
    LinkArt(tone = LinkArtTone.Warning, centreIcon = Icons.Outlined.PriorityHigh)

    Text(
        headline,
        style = SidekickType.display.copy(fontSize = 28.sp, lineHeight = 34.sp),
        color = SidekickColors.warning,
    )
    Text(body, style = SidekickType.body, color = SidekickColors.textBody)

    Spacer(Modifier.height(Space.xs))

    PrimaryButton(
        text = retryLabel,
        onClick = onRetry,
        icon = Icons.Outlined.Refresh,
        modifier = Modifier.fillMaxWidth().height(56.dp),
    )
    SecondaryButton("Cancel", onCancel, Modifier.fillMaxWidth().height(52.dp))

    Spacer(Modifier.height(Space.sm))

    SidekickCard {
        Row(
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(
                Icons.Outlined.PriorityHigh,
                tint = SidekickColors.warning,
                container = SidekickColors.warningTint,
                border = SidekickColors.warningBorder,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.xs)) {
                Text(
                    hintTitle,
                    style = if (monospaceHint) {
                        SidekickType.body.copy(fontFamily = FontFamily.Monospace)
                    } else {
                        SidekickType.body.copy(fontWeight = FontWeight.Medium)
                    },
                    color = SidekickColors.textPrimary,
                )
                Text(hintBody, style = SidekickType.caption, color = SidekickColors.textBody)
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 09 — No network
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun NoNetworkStage(onOpenWifiSettings: () -> Unit) {
    LinkArt(tone = LinkArtTone.Offline, centreIcon = Icons.Outlined.SignalWifiOff)

    Text(
        "No network connection",
        style = SidekickType.display.copy(fontSize = 28.sp, lineHeight = 34.sp),
        color = SidekickColors.textPrimary,
    )
    // The reference says a pairing code cannot be *shown* until there is a network. The Mac shows
    // the code; this phone scans it. What a missing network actually costs here is the thing that
    // comes after the scan — the Mac has no address to dial.
    Text(
        "Your Mac reaches this phone over the local network, and this phone does not have an " +
            "address on one right now. Scanning a code would work and nothing could connect to it.",
        style = SidekickType.body,
        color = SidekickColors.textBody,
    )

    Spacer(Modifier.height(Space.xs))

    SecondaryButton(
        text = "Check Wi-Fi settings",
        onClick = onOpenWifiSettings,
        icon = Icons.Outlined.Settings,
        modifier = Modifier.fillMaxWidth().height(52.dp),
    )
}
