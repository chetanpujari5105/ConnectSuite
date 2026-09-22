package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/**
 * One segment of a filter strip.
 *
 * [count] is nullable and it matters: a segment with no count renders none, rather than `0`. The
 * denominator rule from `CLAUDE.md` applies to a chip as much as to a log line — *"Unread 0"* and
 * *"Unread"* say different things, and a chip that invents a zero while the real count is still
 * loading is a number that is not real.
 */
data class FilterSegment(val label: String, val count: Int? = null)

/** A pill-shaped filter row. One segment lime-filled, the rest ghosted. */
@Composable
fun SegmentedFilter(
    segments: List<FilterSegment>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        segments.forEachIndexed { index, segment ->
            val selected = index == selectedIndex
            Row(
                modifier = Modifier
                    .clip(Radius.pillShape)
                    .background(if (selected) SidekickColors.accent else SidekickColors.cardRaised)
                    .border(
                        BorderStroke(
                            Size.hairline,
                            if (selected) SidekickColors.accent else SidekickColors.border,
                        ),
                        Radius.pillShape,
                    )
                    .clickable { onSelect(index) }
                    .defaultMinSize(minHeight = 36.dp)
                    .padding(horizontal = Space.md, vertical = Space.sm),
                horizontalArrangement = Arrangement.spacedBy(Space.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    segment.label,
                    style = SidekickType.control,
                    color = if (selected) SidekickColors.onAccent else SidekickColors.onControl,
                )
                if (segment.count != null) {
                    Text(
                        segment.count.toString(),
                        style = SidekickType.meta,
                        color = if (selected) SidekickColors.onAccent else SidekickColors.textMeta,
                    )
                }
            }
        }
    }
}

