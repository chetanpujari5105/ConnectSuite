package com.chetan.connectsuite.core.link

import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * Maps the session tokens handed out in `hello.ack` to the control connection that owns them.
 *
 * The video and bulk sockets carry no identity of their own beyond TLS, so the token is what ties
 * them to a specific authenticated control session — and revoking it when that session dies is
 * what stops a stale Mac from holding a video socket open forever.
 */
class SessionRegistry {

    private val random = SecureRandom()
    private val sessions = ConcurrentHashMap<String, ControlSession>()

    fun issue(session: ControlSession): String {
        val bytes = ByteArray(32).also(random::nextBytes)
        val token = bytes.joinToString("") { "%02x".format(it) }
        sessions[token] = session
        return token
    }

    fun resolve(token: String): ControlSession? = sessions[token]

    fun revoke(token: String?) {
        if (token != null) sessions.remove(token)
    }

    fun activeCount(): Int = sessions.size
}
