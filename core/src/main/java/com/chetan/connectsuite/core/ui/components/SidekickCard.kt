package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/**
 * The calm charcoal card every screen is built out of.
 *
 * There is exactly one gradient surface in this product — [HeroCard] — and this is everything else.
 * It exists so that "a card" is one decision made once: `#161616`, a 14dp radius, an 8% hairline.
 * Material's own `Card` would have been fine if it drew those three things, and the reason it is not
 * used is `tonalElevation`: M3 lightens a surface as it rises, which on a near-black canvas reads as
 * a colour change nobody asked for and differs card to card by container.
 */
@Composable
fun SidekickCard(
    modifier: Modifier = Modifier,
    padding: Dp = Space.lg,
    container: Color = SidekickColors.card,
    border: Color = SidekickColors.border,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(Radius.cardShape)
            .background(container)
            .border(BorderStroke(Size.hairline, border), Radius.cardShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}
