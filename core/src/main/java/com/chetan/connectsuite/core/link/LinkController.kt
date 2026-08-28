package com.chetan.connectsuite.core.link

import android.content.Context

/**
 * Process-wide handle on the link server.
 *
 * The server outlives any one Activity and is needed from the service, the QR scanner, and the
 * settings UI, so it lives here rather than being passed down a navigation graph. This matches
 * how the rest of v1 is wired (see PairingManager, ConnectionManager) — introducing Hilt for one
 * object would leave the codebase half-injected.
 */
object LinkController {

    @Volatile
    private var server: LinkServer? = null

    fun get(context: Context, appVersion: String = "2.0.0"): LinkServer =
        server ?: synchronized(this) {
            server ?: LinkServer(context.applicationContext, appVersion).also { server = it }
        }

    fun peek(): LinkServer? = server
}
