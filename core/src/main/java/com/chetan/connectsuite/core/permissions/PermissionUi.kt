package com.chetan.connectsuite.core.permissions

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect

/**
 * Remembers a launcher for a [PermissionGroup] plus its current granted state, re-checked every
 * time the screen resumes so returning from the system Settings page updates the UI.
 */
@Composable
fun rememberPermissionState(group: PermissionGroup): PermissionState {
    val context = LocalContext.current
    var granted by remember(group) { mutableStateOf(group.isGranted(context)) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted = group.isGranted(context) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { granted = group.isGranted(context) }

    return remember(group, granted) {
        PermissionState(
            group = group,
            isGranted = granted,
            request = {
                val missing = group.permissions
                if (missing.isEmpty()) granted = true else launcher.launch(missing.toTypedArray())
            },
        )
    }
}

class PermissionState(
    val group: PermissionGroup,
    val isGranted: Boolean,
    val request: () -> Unit,
)

/** A single row describing one permission or special-access item and its current state. */
@Composable
fun PermissionCard(
    title: String,
    rationale: String,
    granted: Boolean,
    actionLabel: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
    optional: Boolean = false,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (granted) {
                MaterialTheme.colorScheme.surfaceVariant
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = if (granted) Icons.Default.CheckCircle else Icons.Default.ErrorOutline,
                    contentDescription = null,
                    tint = if (granted) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.outline
                    },
                )
                Spacer(Modifier.fillMaxWidth(0.04f))
                Text(
                    text = if (optional) "$title (optional)" else title,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = rationale,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (!granted) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(onClick = onAction) { Text(actionLabel) }
                }
            }
        }
    }
}

/** Convenience for launching a Settings screen from a composable callback. */
fun Context.openSettings(intent: android.content.Intent) = startActivity(intent)
