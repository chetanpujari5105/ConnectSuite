package com.chetan.connectsuite.core.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import com.chetan.connectsuite.core.ui.Motion
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.Size

/**
 * The only progress indicator in this product: a thin linear bar.
 *
 * There are no rings. A ring reads as a decorative gauge and this app's numbers are all real ones —
 * bytes moved, percent charged, percent free — which are lengths, not arcs.
 *
 * [tone] is passed by the caller because the colour is a claim: lime means healthy, amber means a
 * real warning (a nearly-full disk), grey means *not yet meaningful*. Grey is the honest default for
 * a transfer that has been accepted and has not started, and it is why this takes a nullable
 * [progress] rather than defaulting to `0f` — zero and unknown are different states and drawing them
 * the same way is the empty-versus-failed mistake in a 6dp bar.
 */
@Composable
fun SidekickProgress(
    progress: Float?,
    modifier: Modifier = Modifier,
    tone: Color = SidekickColors.accent,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(Size.progressHeight)
            .clip(Radius.pillShape)
            .background(SidekickColors.track),
    ) {
        if (progress != null) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(progress.coerceIn(0f, 1f))
                    .clip(Radius.pillShape)
                    .background(tone),
            )
        }
    }
}

/**
 * The indeterminate form, for [StateBlock]'s Loading kind.
 *
 * A travelling segment rather than a spinner, for the same reason as above. One cycle is deliberately
 * slow — this says *something is happening*, and a fast sweep says *something is wrong*.
 */
@Composable
fun SidekickProgressIndeterminate(
    modifier: Modifier = Modifier,
    tone: Color = SidekickColors.accent,
) {
    val transition = rememberInfiniteTransition(label = "indeterminate")
    val head by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1_200, easing = Motion.easeInOut),
            repeatMode = RepeatMode.Restart,
        ),
        label = "head",
    )
    Box(
        modifier
            .fillMaxWidth()
            .height(Size.progressHeight)
            .clip(Radius.pillShape)
            .background(SidekickColors.track),
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(0.35f)
                .layout { measurable, constraints ->
                    val placeable = measurable.measure(constraints)
                    val travel = (constraints.maxWidth - placeable.width).coerceAtLeast(0)
                    layout(constraints.maxWidth, placeable.height) {
                        placeable.placeRelative((travel * head).toInt(), 0)
                    }
                }
                .clip(Radius.pillShape)
                .background(tone),
        )
    }
}
