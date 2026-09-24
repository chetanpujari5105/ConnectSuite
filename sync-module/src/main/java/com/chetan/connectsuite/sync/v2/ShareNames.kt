package com.chetan.connectsuite.sync.v2

import java.text.Normalizer

/**
 * The name and type a shared file is offered under — `docs/phase-7-share-proposal.md` rev 2 §5, the
 * *Filename*, *Mac-side name* and *MIME* rows. Pure: every Android lookup (`OpenableColumns`,
 * `MimeTypeMap`, `ContentResolver.getType`) is done by the caller and passed in.
 *
 * The phone applies the same sanitiser the Mac will, so the name the sheet shows is the name that
 * would be offered. The Mac re-sanitises regardless and never trusts the phone's name. Both sides'
 * tests read one fixture, `docs/fixtures/share-names.json`, so the two implementations cannot drift
 * apart unnoticed (plan G7).
 */
object ShareNames {

    const val EMPTY_NAME = "Shared file"
    const val OCTET_STREAM = "application/octet-stream"
    private const val MAX_NAME_BYTES = 255

    /** A type that names a folder rather than a file. Refused before anything is read. */
    private val DIRECTORY_TYPES = setOf("vnd.android.document/directory", "inode/directory")

    /**
     * The first usable candidate: the provider's `DISPLAY_NAME`, then the URI's last path segment,
     * then `Shared file <timestamp>`. If the chosen name has no extension, one is added from the
     * MIME type through [extensionFor] (`MimeTypeMap` on the phone). The result is sanitised.
     */
    fun displayName(
        providerName: String?,
        lastPathSegment: String?,
        mime: String,
        timestamp: String,
        extensionFor: (String) -> String?,
    ): String {
        val raw = listOf(providerName, lastPathSegment).firstOrNull { !it.isNullOrBlank() }
            ?: "$EMPTY_NAME $timestamp"
        val named = if (hasExtension(raw)) raw else extensionFor(mime)?.takeIf { it.isNotBlank() }?.let { "$raw.$it" } ?: raw
        return sanitize(named)
    }

    /**
     * The proposal's rules, in this order: NFC; drop control characters **and Unicode format
     * characters** (the category holding bidirectional overrides such as U+202E, which can make
     * `txt.exe` display as `exe.txt` — an addition to the proposal, recorded in slice 1's commit);
     * `/` and `:` become `-`; surrounding whitespace is trimmed; a leading `.` becomes `_`; the result
     * is capped at 255 UTF-8 bytes keeping the extension; an empty result becomes [EMPTY_NAME].
     */
    fun sanitize(name: String): String {
        val cleaned = buildString {
            Normalizer.normalize(name, Normalizer.Form.NFC).codePoints().forEach { cp ->
                when {
                    Character.getType(cp) == Character.CONTROL.toInt() -> Unit
                    Character.getType(cp) == Character.FORMAT.toInt() -> Unit
                    cp == '/'.code || cp == ':'.code -> append('-')
                    else -> appendCodePoint(cp)
                }
            }
        }.trim()
        if (cleaned.isEmpty()) return EMPTY_NAME
        val dotted = if (cleaned.startsWith(".")) "_" + cleaned.substring(1) else cleaned
        return capBytes(dotted)
    }

    /**
     * `ContentResolver.getType`, then the intent's type if it is not a wildcard, then
     * `application/octet-stream`. Display only — nothing chooses a handler from it.
     */
    fun mimeOf(resolverType: String?, intentType: String?): String =
        listOf(resolverType, intentType)
            .map { it?.trim()?.lowercase() }
            .firstOrNull { it != null && isConcrete(it) }
            ?: OCTET_STREAM

    fun isDirectory(mime: String): Boolean = mime.lowercase() in DIRECTORY_TYPES

    private fun isConcrete(mime: String): Boolean {
        val slash = mime.indexOf('/')
        return slash > 0 && slash < mime.length - 1 && '*' !in mime && ' ' !in mime
    }

    private fun hasExtension(name: String): Boolean {
        val dot = name.lastIndexOf('.')
        return dot > 0 && dot < name.length - 1
    }

    /** Cap at [MAX_NAME_BYTES] of UTF-8, cutting whole code points and keeping a short extension. */
    private fun capBytes(name: String): String {
        if (name.toByteArray(Charsets.UTF_8).size <= MAX_NAME_BYTES) return name
        val dot = name.lastIndexOf('.')
        val ext = if (dot > 0 && name.length - dot <= 16) name.substring(dot) else ""
        val budget = MAX_NAME_BYTES - ext.toByteArray(Charsets.UTF_8).size
        val stem = name.substring(0, name.length - ext.length)
        val kept = StringBuilder()
        var used = 0
        for (cp in stem.codePoints().toArray()) {
            val size = String(Character.toChars(cp)).toByteArray(Charsets.UTF_8).size
            if (used + size > budget) break
            kept.appendCodePoint(cp)
            used += size
        }
        return kept.toString() + ext
    }
}
