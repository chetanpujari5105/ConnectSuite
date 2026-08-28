package com.chetan.connectsuite

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * A destination whose backend has not been built yet.
 *
 * The rule this exists to enforce: no control in either app may throw, and none may do nothing
 * silently. Where a feature is genuinely absent, the tab stays visible and says so in one line —
 * a missing tab reads as a bug, while a tab that explains itself reads as a roadmap.
 *
 * [reason] is the short user-facing line. [detail] is the "why", for the user who wants it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeatureUnavailableScreen(
    title: String,
    reason: String,
    detail: String,
) {
    Scaffold(topBar = { TopAppBar(title = { Text(title) }) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(reason, style = MaterialTheme.typography.titleMedium)
                    Text(
                        detail,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
