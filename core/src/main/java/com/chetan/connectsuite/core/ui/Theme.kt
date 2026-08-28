package com.chetan.connectsuite.core.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
    primary = Color(0xFF00629E),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCFE5FF),
    onPrimaryContainer = Color(0xFF001D33),
    secondary = Color(0xFF51606F),
    tertiary = Color(0xFF695779),
    error = Color(0xFFBA1A1A),
    background = Color(0xFFFCFCFF),
    surface = Color(0xFFFCFCFF),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF98CBFF),
    onPrimary = Color(0xFF003354),
    primaryContainer = Color(0xFF004A78),
    onPrimaryContainer = Color(0xFFCFE5FF),
    secondary = Color(0xFFB9C8DA),
    tertiary = Color(0xFFD4BEE6),
    error = Color(0xFFFFB4AB),
    background = Color(0xFF1A1C1E),
    surface = Color(0xFF1A1C1E),
)

/**
 * Shared Material 3 theme for every ConnectSuite module. Uses the platform dynamic palette
 * on Android 12+ so the app blends with the OEM skin, and falls back to a fixed blue scheme.
 */
@Composable
fun ConnectSuiteTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}
