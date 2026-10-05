package com.chetan.connectsuite.sync.v2

/**
 * The line logged when a content-provider query fails, with every `content://` URI cut to its
 * authority and first path segment.
 *
 * A contact lookup's URI is `content://com.android.contacts/phone_lookup/<the number>`, and the
 * platform repeats the URI in its own exception text (`Permission Denial: reading … uri …`), so
 * `"Query on $uri failed: ${it.message}"` wrote a phone number to the rotating log on exactly the
 * path a revoked permission takes. Everything after the first segment — further segments and any
 * query string — becomes `…`, in the URI **and** in the message. The exception's type is kept: the
 * reason a query failed is the diagnosis, and only the address in it is private.
 *
 * Takes the URI as a string so a JVM test can call it (`android.net.Uri` is a stub there).
 */
object ProviderLog {
    private val contentUri = Regex("""content://([^/?\s]+)(/[^/?\s]+)?([/?][^\s,;)\]]*)?""")

    fun redact(text: String): String = contentUri.replace(text) { match ->
        val (authority, first, rest) = match.destructured
        "content://$authority$first${if (rest.isNotEmpty()) "/…" else ""}"
    }

    fun queryFailed(uri: String, error: Throwable): String =
        "Query on ${redact(uri)} failed: ${error.javaClass.simpleName}: ${redact(error.message ?: "no message")}"
}
