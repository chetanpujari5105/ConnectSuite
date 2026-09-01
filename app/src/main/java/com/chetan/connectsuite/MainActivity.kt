package com.chetan.connectsuite

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.LinkService
import com.chetan.connectsuite.sync.v2.ClipFeature
import com.chetan.connectsuite.core.ui.ConnectSuiteTheme
import com.chetan.connectsuite.mirror.v2.MirrorNotifications

class MainActivity : ComponentActivity() {

    /**
     * A tab another part of the app has asked to open, or null.
     *
     * The mirroring notification is the only thing that sets it today, and it matters: on Android
     * 16 that notification is how a backgrounded app gets the user to the one screen where consent
     * can be given, so landing them on the wrong tab wastes the whole round trip.
     */
    private var requestedTab by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        requestedTab = intent?.getStringExtra(MirrorNotifications.EXTRA_OPEN_TAB)
        setContent {
            ConnectSuiteTheme {
                ConnectSuiteRoot(
                    requestedTab = requestedTab,
                    onTabOpened = { requestedTab = null },
                )
            }
        }
    }

    /** Reached instead of onCreate when the notification is tapped with the app already running. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        requestedTab = intent.getStringExtra(MirrorNotifications.EXTRA_OPEN_TAB)
    }

    override fun onStart() {
        super.onStart()
        // Starting from a visible activity is the only reliable way in: a foreground service
        // started from the background is refused on Android 12+.
        LinkService.start(this)
    }

    override fun onResume() {
        super.onResume()
        // The user may have just come back from Settings after granting - or revoking - a
        // permission, and every connected Mac needs to hear about it.
        LinkService.refreshCapabilities(this)
    }

    /**
     * The only place in this app that knows whether a clipboard read is legal.
     *
     * Window focus is the platform's own criterion for `ClipboardManager` — measured on this
     * handset, not inherited: a read from an unfocused app is refused with
     * *"application is not in focus nor is it a system service"*, and neither an enabled
     * AccessibilityService nor a foreground service changes it. There is no lifecycle callback for
     * focus, so the Activity is the only thing that can report it, and `ClipFeature` answers
     * `PHONE_NOT_FOREGROUND` on the strength of this flag rather than guessing from `onStart`.
     *
     * It is also the moment the clipboard becomes readable, which is the whole phone-to-Mac path:
     * a person copies in another app, comes back here, and this is when we may look.
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        AppForeground.reportWindowFocus(hasFocus)
        if (hasFocus) ClipFeature.onWindowFocused(this)
    }
}
