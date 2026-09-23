package com.chetan.connectsuite

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.ScreenShare
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.components.NavItem
import com.chetan.connectsuite.core.ui.components.SidekickBottomNav
import com.chetan.connectsuite.input.ui.InputOnboardingCard
import com.chetan.connectsuite.link.LinkRoute
import com.chetan.connectsuite.mirror.v2.MirrorEngine
import com.chetan.connectsuite.mirror.v2.ui.MirrorScreen
import com.chetan.connectsuite.onboarding.OnboardingOutcome
import com.chetan.connectsuite.onboarding.OnboardingScreen
import com.chetan.connectsuite.setup.SetupScreen
import com.chetan.connectsuite.sync.ui.SyncRoute
import com.chetan.connectsuite.sync.ui.SyncSection
import com.chetan.connectsuite.sync.ui.settings.SyncSettingsScreen
import com.chetan.connectsuite.sync.v2.ReceivedFileNotifications

/**
 * The routes. **These strings are a contract with things outside the UI and did not change.**
 *
 * `MirrorNotifications.TAB_MIRROR` is the literal `"mirror"`, and onboarding lands a freshly paired
 * user on `"mac"`. Flattening the bar from three tabs to five is a presentation change; renaming a
 * route would have been a functional one, and would have broken the mirroring notification silently
 * — it navigates by string and a miss is a no-op, not an error.
 */
private enum class TopLevelTab(val route: String) {
    Sync("sync"),
    Mirror("mirror"),
    Mac("mac"),
}

/**
 * The five bottom-nav destinations: Devices, Transfers, Clip, Feed, Mirror.
 *
 * Four of them are sections of the one `SyncRoute` host and the fifth is its own route. That
 * asymmetry is deliberate and is the whole reason the bar is modelled here rather than as five
 * `NavHost` destinations: `SyncRoute` owns the ViewModels, both activity-result launchers, the
 * snackbar and two dialogs, and it hands files from the picker to the Transfers section. Split
 * across five back-stack entries, each entry gets its **own** `ViewModelStore` — so Devices and
 * Transfers would hold different `TransfersViewModel` instances, and the "resume transfers when a
 * device reconnects" effect would be watching a list the sending screen never writes to.
 *
 * So the host stays mounted once, exactly as it is today, and the bar selects a section inside it.
 * Switching among those four never touched the back stack before this change either — they were a
 * `TabRow` over an `Int` — so the back behaviour a user already had is unchanged.
 */
private data class BarDestination(
    val item: NavItem,
    /** The Sync section this opens, or null when it is a route of its own. */
    val section: SyncSection?,
    val route: String,
)

private val BAR = listOf(
    BarDestination(NavItem("Devices", Icons.Outlined.Devices), SyncSection.Devices, "sync"),
    BarDestination(NavItem("Transfers", Icons.Outlined.SwapVert), SyncSection.Transfers, "sync"),
    BarDestination(NavItem("Clip", Icons.Outlined.ContentCopy), SyncSection.Clipboard, "sync"),
    BarDestination(NavItem("Feed", Icons.Outlined.Notifications), SyncSection.Notifications, "sync"),
    BarDestination(NavItem("Mirror", Icons.Outlined.ScreenShare), null, "mirror"),
)

private const val ROUTE_SYNC_SETTINGS = "sync/settings"

/**
 * **Set up Sidekick** (Feature E / defect 134): after onboarding, from Sync settings, and — defect
 * 140 — from the Devices gear, which opens Mac settings in either of its states. Never on launch.
 */
private const val ROUTE_SETUP = "setup"
private const val KEY_ONBOARDING_DONE = "onboarding_complete"

/**
 * [requestedTab] is a tab something outside the UI has asked to open — the mirroring notification,
 * which on Android 16 is the route to the one screen where capture consent can be given, and since
 * 2026-09-23 the received-file notification (`"transfers"`). [onTabOpened] fires once it has been honoured, so returning to the app later does not
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
    // Where onboarding asked us to open. Null on every launch after the first, which is why the
    // fallback below is the ordinary start destination rather than anything conditional.
    var landingTab by rememberSaveable { mutableStateOf<String?>(null) }
    // Where Done on the first-run checklist goes. Null when the checklist was opened from Settings,
    // in which case Done is Back.
    var setupReturnsTo by rememberSaveable { mutableStateOf<String?>(null) }

    if (!onboardingDone) {
        OnboardingScreen(
            onFinished = { outcome ->
                onboardingPrefs.edit().putBoolean(KEY_ONBOARDING_DONE, true).apply()
                // Somebody who has just paired should land on the thing they paired, not on the
                // device list — which is the v1 Android-to-Android feature and has nothing to do
                // with a Mac.
                // The checklist comes next either way: onboarding asks for the one grant the link
                // needs, and every feature's grant is asked there, one at a time, on a tap.
                setupReturnsTo = when (outcome) {
                    OnboardingOutcome.PAIRED -> TopLevelTab.Mac.route
                    OnboardingOutcome.NOT_PAIRED -> TopLevelTab.Sync.route
                }
                landingTab = ROUTE_SETUP
                onboardingDone = true
            },
        )
        return
    }

    // Created only after onboarding has finished — the early return above guarantees it — so the
    // start destination is evaluated once, with `landingTab` already set. No navigation effect is
    // needed to get there, and none is used: a second route change racing the first is exactly the
    // failure `CLAUDE.md` records against the Files pane.
    val navController = rememberNavController()

    // Which section of the Sync host is showing. Survives rotation; deliberately not part of the
    // back stack, because it was not part of it when this was a TabRow either.
    var section by rememberSaveable { mutableStateOf(SyncSection.Devices) }

    val link by remember { LinkController.get(context).state }.collectAsStateWithLifecycle()

    LaunchedEffect(requestedTab) {
        // A received-file notification asks for Transfers, which is a *section* of the Sync host
        // rather than a route of its own — so it selects the section, then opens the host.
        if (requestedTab == ReceivedFileNotifications.TAB_TRANSFERS) {
            section = SyncSection.Transfers
            navController.navigate(TopLevelTab.Sync.route) {
                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
            onTabOpened()
            return@LaunchedEffect
        }
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
    val currentRoute = currentDestination?.route

    // Sync settings takes the whole screen; everything else keeps the bar, including Mac
    // management — which shows the bar with *nothing* lit, because it is a settings-tier screen
    // rather than a tab.
    val showBottomBar = currentRoute != ROUTE_SYNC_SETTINGS && currentRoute != ROUTE_SETUP

    /**
     * -1 means no tab is lit. Folders deliberately maps to Transfers: it is a drill-down from that
     * screen's header, and a bar that went dark when you opened it would read as having left the
     * tab you are still in.
     */
    val selectedIndex = when {
        currentRoute == TopLevelTab.Mirror.route -> BAR.indexOfFirst { it.section == null }
        currentRoute == TopLevelTab.Sync.route -> when (section) {
            SyncSection.Folders -> BAR.indexOfFirst { it.section == SyncSection.Transfers }
            else -> BAR.indexOfFirst { it.section == section }
        }
        else -> -1
    }

    val openRoute: (String) -> Unit = { route ->
        navController.navigate(route) {
            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    Scaffold(
        containerColor = SidekickColors.canvas,
        bottomBar = {
            if (!showBottomBar) return@Scaffold
            SidekickBottomNav(
                items = BAR.map { it.item },
                selectedIndex = selectedIndex,
                onSelect = { index ->
                    val destination = BAR[index]
                    destination.section?.let { section = it }
                    if (currentRoute != destination.route) openRoute(destination.route)
                },
            )
        },
    ) { innerPadding ->
        // Only the bottom bar's inset is consumed here. Each destination applies the status-bar
        // inset itself, which avoids padding the top twice.
        NavHost(
            navController = navController,
            startDestination = landingTab ?: TopLevelTab.Sync.route,
            modifier = Modifier.padding(bottom = innerPadding.calculateBottomPadding()),
        ) {
            composable(TopLevelTab.Sync.route) {
                SyncRoute(
                    section = section,
                    onSelectSection = { section = it },
                    // The same condition the Mirror screen's own Start button uses. Read here so
                    // the hero can say *why* it is disabled instead of just being grey.
                    mirroringAvailable = link.isConnected,
                    // The same call the Mirror screen makes. Not a copy of it, and not a navigation
                    // that pretends to be one — "Start mirroring" starts mirroring.
                    onStartMirroring = { MirrorEngine.startFromPhone(context) },
                    onOpenMirror = { openRoute(TopLevelTab.Mirror.route) },
                    onOpenMac = { openRoute(TopLevelTab.Mac.route) },
                    onOpenSettings = { navController.navigate(ROUTE_SYNC_SETTINGS) },
                )
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
            composable(TopLevelTab.Mac.route) {
                // "Go to Devices" on the success stage lands on the Devices tab with it lit,
                // rather than dropping the user back on a management screen they have not asked
                // for yet. It is the same `openRoute` the bar uses, so the two cannot disagree
                // about what "go to Devices" means.
                LinkRoute(
                    onDone = {
                        section = SyncSection.Devices
                        openRoute(TopLevelTab.Sync.route)
                    },
                    // Pushed, not `openRoute`: Back and Done both pop to these Mac settings.
                    onOpenSetup = { navController.navigate(ROUTE_SETUP) },
                )
            }
            composable(ROUTE_SYNC_SETTINGS) {
                SyncSettingsScreen(
                    onBack = { navController.popBackStack() },
                    onOpenSetup = { navController.navigate(ROUTE_SETUP) },
                )
            }
            composable(ROUTE_SETUP) {
                SetupScreen(
                    onOpenFolders = {
                        section = SyncSection.Folders
                        openRoute(TopLevelTab.Sync.route)
                    },
                    onDone = {
                        val next = setupReturnsTo
                        setupReturnsTo = null
                        if (next != null) openRoute(next) else navController.popBackStack()
                    },
                )
            }
        }
    }
}
