package com.chetan.connectsuite.setup

import androidx.compose.animation.core.tween
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.Crossfade
import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.chetan.connectsuite.core.permissions.PermissionGroup
import com.chetan.connectsuite.core.permissions.SpecialAccess
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.components.RowDivider
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.input.ui.accessibilitySettings
import com.chetan.connectsuite.input.ui.isInputServiceEnabled
import com.chetan.connectsuite.setup.SetupPlan.Mechanism
import com.chetan.connectsuite.setup.SetupPlan.Status
import com.chetan.connectsuite.sync.v2.MediaFeature

/**
 * **Set up Sidekick** — the checklist `SetupPlan` describes, drawn from what the OS says right now.
 *
 * Every status is **read**, never remembered: runtime grants from `checkSelfPermission`, special
 * access from the secure settings, folders from `persistedUriPermissions`. They are re-read on every
 * resume, which is the moment someone comes back from Settings — so a switch they looked at and
 * left off reads *Off*.
 *
 * Only two things are stored, both conveniences: which items the person said **Not now** to, and
 * which runtime groups have been asked — the second is what separates *"Allow"* from *"Turned off in
 * Settings"* once Android has stopped showing its dialog (it gives up after two refusals and
 * answers every later request instantly, with no dialog at all).
 */
@Composable
fun SetupScreen(onOpenFolders: () -> Unit, onDone: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    var refresh by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { refresh++ }

    var pending by remember { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        pending?.let { id -> prefs.edit().putStringSet(KEY_ASKED, asked(prefs) + id).apply() }
        pending = null
        refresh++
    }

    // Read once per recomposition trigger; cheap — a handful of in-process checks.
    val statuses = remember(refresh) {
        SetupPlan.items.associate { it.id to statusOf(context, it, prefs) }
    }
    val folderCount = remember(refresh) { context.contentResolver.persistedUriPermissions.size }

    fun act(item: SetupPlan.Item) {
        val status = statuses[item.id] ?: Status.Off
        prefs.edit().putStringSet(KEY_NOT_NOW, notNow(prefs) - item.id).apply()
        when {
            item.id == SetupPlan.FOLDERS -> onOpenFolders()
            status == Status.NeedsSettings -> runCatching {
                context.startActivity(SpecialAccess.appDetailsIntent(context))
            }
            item.mechanism == Mechanism.SpecialAccess -> runCatching {
                context.startActivity(
                    when (item.id) {
                        SetupPlan.MIRROR_NOTIFICATIONS -> SpecialAccess.notificationListenerSettingsIntent()
                        SetupPlan.CONTROL -> accessibilitySettings()
                        else -> SpecialAccess.batteryOptimizationIntent(context)
                    },
                )
            }
            item.mechanism == Mechanism.Runtime -> {
                val wanted = runtimePermissions(item.id)
                if (wanted.isEmpty()) {
                    refresh++
                } else {
                    pending = item.id
                    launcher.launch(wanted.toTypedArray())
                }
            }
        }
        refresh++
    }

    Column(
        // Insets before the scroll, so the scrolling region starts below the status bar and ends
        // above the gesture bar — the first capture drew the title under the clock.
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        Spacer(Modifier.height(Space.md))
        Text(SetupPlan.TITLE, style = SidekickType.display, color = SidekickColors.textPrimary)
        Text(SetupPlan.SUBTITLE, style = SidekickType.body, color = SidekickColors.textBody)
        Text(
            SetupPlan.summary(statuses),
            style = SidekickType.meta,
            color = SidekickColors.textMeta,
            modifier = Modifier.testTag("setup-summary"),
        )

        SetupPlan.Section.entries.forEach { section ->
            Text(
                section.title.uppercase(),
                style = SidekickType.overline,
                color = SidekickColors.textMeta,
                modifier = Modifier.padding(top = Space.md),
            )
            SidekickCard(padding = Space.xs) {
                val rows = SetupPlan.items.filter { it.section == section }
                rows.forEachIndexed { index, item ->
                    SetupRow(
                        item = item,
                        status = statuses[item.id] ?: Status.Off,
                        folderCount = folderCount,
                        onAction = { act(item) },
                        onNotNow = {
                            prefs.edit().putStringSet(KEY_NOT_NOW, notNow(prefs) + item.id).apply()
                            refresh++
                        },
                        last = index == rows.lastIndex,
                    )
                }
            }
        }

        Spacer(Modifier.height(Space.sm))
        PrimaryButton(
            text = SetupPlan.DONE,
            onClick = onDone,
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("setup-done"),
        )
        Spacer(Modifier.height(Space.xl))
    }
}

@Composable
private fun SetupRow(
    item: SetupPlan.Item,
    status: Status,
    folderCount: Int,
    onAction: () -> Unit,
    onNotNow: () -> Unit,
    last: Boolean,
) {
    val on = status == Status.On
    Column(
        Modifier
            .fillMaxWidth()
            .padding(Space.md)
            .testTag("setup-row-${item.id}"),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            // Lime only for a switch that is really on — the healthy state, read from the OS. The
            // change eases rather than snaps, because it is the row the person just acted on and they
            // come back from Android's dialog looking for it: colour and a crossfade, no movement,
            // at the Mac's --dur-state and --ease so both apps share one timing.
            // Each glyph wears its own state's colours; the crossfade alone carries the change. An
            // earlier version animated shared colours under both children, so for ~180 ms the
            // outgoing Off circle was drawn lime — a frame claiming a grant the OS had not reported.
            Crossfade(targetState = on, animationSpec = tween(STATE_MS, easing = STATE_EASE), label = "badge") { isOn ->
                IconBadge(
                    icon = if (isOn) Icons.Outlined.Check else Icons.Outlined.Circle,
                    tint = if (isOn) SidekickColors.accent else SidekickColors.textMeta,
                    container = if (isOn) SidekickColors.accentTint else SidekickColors.cardRaised,
                    border = if (isOn) SidekickColors.accentBorder else SidekickColors.border,
                )
            }
            Column(Modifier.weight(1f)) {
                Text(
                    item.title,
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                Text(
                    SetupPlan.statusLabel(item, status, folderCount),
                    style = SidekickType.meta,
                    // Amber only where Android has closed the easy route; never for "Not now".
                    color = if (status == Status.NeedsSettings) SidekickColors.warning else SidekickColors.textMeta,
                    modifier = Modifier.testTag("setup-status-${item.id}"),
                )
            }
        }
        Text(item.why, style = SidekickType.caption, color = SidekickColors.textBody)
        val action = SetupPlan.actionLabel(item, status)
        if (action != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm), verticalAlignment = Alignment.CenterVertically) {
                SecondaryButton(
                    text = action,
                    onClick = onAction,
                    modifier = Modifier.testTag("setup-action-${item.id}"),
                )
                if (item.optional && status != Status.NotNow && !on) {
                    TextButton(onClick = onNotNow, modifier = Modifier.testTag("setup-notnow-${item.id}")) {
                        Text(SetupPlan.NOT_NOW, style = SidekickType.control, color = SidekickColors.textBody)
                    }
                }
            }
        }
    }
    if (!last) RowDivider(inset = false)
}

/** The Mac's `--dur-state` (180 ms) on its `--ease` curve — one timing for a state change, both apps. */
private const val STATE_MS = 180
private val STATE_EASE = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

private const val PREFS = "sidekick_setup"
private const val KEY_NOT_NOW = "not_now"
private const val KEY_ASKED = "asked"

private fun notNow(prefs: android.content.SharedPreferences): Set<String> =
    prefs.getStringSet(KEY_NOT_NOW, emptySet()).orEmpty()

private fun asked(prefs: android.content.SharedPreferences): Set<String> =
    prefs.getStringSet(KEY_ASKED, emptySet()).orEmpty()

/** The platform permissions behind a runtime item — the same lists the features check. */
private fun runtimePermissions(id: String): List<String> = when (id) {
    SetupPlan.NOTIFICATIONS -> PermissionGroup.NOTIFICATIONS.permissions
    SetupPlan.TEXTS -> PermissionGroup.SMS.permissions
    SetupPlan.CALLS -> PermissionGroup.CALLS.permissions
    SetupPlan.CONTACTS -> PermissionGroup.CONTACTS.permissions
    SetupPlan.PHOTOS -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        listOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
    } else {
        listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    SetupPlan.CAMERA -> listOf(Manifest.permission.CAMERA)
    else -> emptyList()
}

private fun statusOf(context: Context, item: SetupPlan.Item, prefs: android.content.SharedPreferences): Status {
    val granted = when (item.id) {
        SetupPlan.NOTIFICATIONS -> PermissionGroup.NOTIFICATIONS.isGranted(context)
        SetupPlan.CAMERA -> has(context, Manifest.permission.CAMERA)
        SetupPlan.MIRROR_NOTIFICATIONS -> SpecialAccess.isNotificationListenerEnabled(context)
        SetupPlan.TEXTS -> PermissionGroup.SMS.isGranted(context)
        SetupPlan.CALLS -> PermissionGroup.CALLS.isGranted(context)
        SetupPlan.CONTACTS -> PermissionGroup.CONTACTS.isGranted(context)
        // The feature's own test, so this row and the Mac's `photos` capability cannot disagree.
        SetupPlan.PHOTOS -> MediaFeature.granted(context)
        SetupPlan.FOLDERS -> context.contentResolver.persistedUriPermissions.isNotEmpty()
        SetupPlan.CONTROL -> isInputServiceEnabled(context)
        SetupPlan.BATTERY -> SpecialAccess.isIgnoringBatteryOptimizations(context)
        else -> false
    }
    if (granted) return Status.On
    if (item.mechanism == Mechanism.ReportOnly) {
        // The camera is asked by the scanner, which also owns its refusal state (and its Settings
        // link). "Not granted, no rationale" describes a never-asked permission too, so this list
        // cannot tell a refusal from a first run and does not try.
        return Status.NotAskedYet
    }
    if (item.mechanism == Mechanism.Runtime && item.id in asked(prefs) &&
        blocked(context, runtimePermissions(item.id))
    ) {
        return Status.NeedsSettings
    }
    return if (item.id in notNow(prefs)) Status.NotNow else Status.Off
}

private fun has(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

/**
 * Whether Android will no longer show its dialog for these: not granted, and no rationale to
 * show. That pair also describes a permission that has **never** been asked, which is why the
 * runtime rows only consult it after an ask this screen recorded.
 */
private fun blocked(context: Context, permissions: List<String>): Boolean {
    val activity = context.findActivity() ?: return false
    return permissions.any { !has(context, it) && !activity.shouldShowRequestPermissionRationale(it) } &&
        permissions.none { has(context, it) }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
