package com.chetan.connectsuite.setup

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.components.ListRow
import com.chetan.connectsuite.core.ui.components.SidekickCard

/**
 * The way back to **Set up Sidekick** from the Devices screen's gear (defect 140).
 *
 * After first run the checklist was reachable only through Transfers → Manage folders → Sync
 * settings, so someone who said *Not now* to Texts had no visible route back to the switch. The
 * gear on Devices opens Mac settings in both of its states — the pairing screen while nothing is
 * paired, Mac management once something is — and both carry this card. It is a link, never a
 * prompt: the checklist is not re-shown on launch.
 */
@Composable
fun SetupEntryCard(onClick: () -> Unit, modifier: Modifier = Modifier) {
    SidekickCard(padding = 4.dp, onClick = onClick, modifier = modifier.testTag("setup-entry")) {
        ListRow(
            title = SetupPlan.ENTRY_TITLE,
            subtitle = SetupPlan.ENTRY_SUBTITLE,
            showChevron = true,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
    }
}
