package com.chetan.connectsuite

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.SyncAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.chetan.connectsuite.link.LinkRoute
import com.chetan.connectsuite.input.ui.InputOnboardingCard
import com.chetan.connectsuite.mirror.v2.ui.MirrorScreen
import com.chetan.connectsuite.sync.ui.SyncRoute
import com.chetan.connectsuite.onboarding.OnboardingScreen
import com.chetan.connectsuite.sync.ui.settings.SyncSettingsScreen

private enum class TopLevelTab(
    val route: String,
    val label: String,
    val icon: ImageVector,
) {
    Sync("sync", "Sync", Icons.Outlined.SyncAlt),
    Mirror("mirror", "Mirror", Icons.Outlined.Cast),
    Mac("mac", "Mac", Icons.Outlined.Laptop),
}

private const val ROUTE_SYNC_SETTINGS = "sync/settings"
private const val KEY_ONBOARDING_DONE = "onboarding_complete"

/**
 * [requestedTab] is a tab something outside the UI has asked to open — today only the mirroring
 * notification, which on Android 16 is the route to the one screen where capture consent can be
 * given. [onTabOpened] fires once it has been honoured, so returning to the app later does not
 * yank the user back to it.
 */
@Composable
fun ConnectSuiteRoot(
    requestedTab: String? = null,
    onTabOpened: () -> Unit = {},
) {
    val context = LocalContext.current
    val onboardingPrefs = remember {
        context.getSharedPreferences("connectsuite_onboarding", android.content.Context.MODE_PRIVATE)
    }
    var onboardingDone by rememberSaveable {
        mutableStateOf(onboardingPrefs.getBoolean(KEY_ONBOARDING_DONE, false))
    }

    if (!onboardingDone) {
        OnboardingScreen(
            onFinished = {
                onboardingPrefs.edit().putBoolean(KEY_ONBOARDING_DONE, true).apply()
                onboardingDone = true
            },
        )
        return
    }

    val navController = rememberNavController()

    LaunchedEffect(requestedTab) {
        val target = TopLevelTab.entries.firstOrNull { it.route == requestedTab } ?: return@LaunchedEffect
        navController.navigate(target.route) {
            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
        onTabOpened()
    }

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination
    // The bottom bar belongs to the two top-level tabs only; detail screens take the full height.
    val showBottomBar = currentDestination?.route in TopLevelTab.entries.map { it.route }

    Scaffold(
        bottomBar = {
            if (!showBottomBar) return@Scaffold
            NavigationBar {
                TopLevelTab.entries.forEach { tab ->
                    val selected = currentDestination?.hierarchy?.any { it.route == tab.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        // Only the bottom bar's inset is consumed here. Each destination hosts its own Scaffold
        // with a top app bar, and letting those apply the status-bar inset themselves avoids
        // padding the top twice.
        NavHost(
            navController = navController,
            startDestination = TopLevelTab.Sync.route,
            modifier = Modifier.padding(bottom = innerPadding.calculateBottomPadding()),
        ) {
            composable(TopLevelTab.Sync.route) {
                SyncRoute(onOpenSettings = { navController.navigate(ROUTE_SYNC_SETTINGS) })
            }
            composable(TopLevelTab.Mirror.route) {
                // Not a status page: Android 16 will not let a backgrounded app raise the capture
                // prompt, so the Start button here is the primary way consent is ever given.
                //
                // The input card rides along because enabling the accessibility service is the
                // other thing only the user can do, and this is the screen showing the picture it
                // makes clickable. It is passed in rather than referenced from mirror-module,
                // which must not know input-module exists.
                MirrorScreen(extraCards = { InputOnboardingCard() })
            }
            composable(TopLevelTab.Mac.route) { LinkRoute() }
            composable(ROUTE_SYNC_SETTINGS) {
                SyncSettingsScreen(onBack = { navController.popBackStack() })
            }
        }
    }
}
