package com.chetan.connectsuite.sync

import java.io.File

/**
 * The module's own `src/main`, for the handful of guards whose property is about *where a name
 * appears* — something a source scan can see and a runtime test cannot.
 *
 * One home for the walk, because two copies of "find the sources" is two things to get wrong when
 * Gradle's working directory changes. It throws rather than returning empty: a scan that silently
 * finds nothing passes every "appears at most once" assertion, which is the shape `CLAUDE.md` calls
 * a test that reads as evidence and is not.
 */
object SourceTree {

    fun mainSources(): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            if (dir.name == "sync-module") {
                val here = File(dir, "src/main/java")
                if (here.isDirectory) return here
            }
            val candidate = File(dir, "sync-module/src/main/java")
            if (candidate.isDirectory) return candidate
            dir = dir.parentFile
        }
        throw AssertionError(
            "could not locate sync-module/src/main/java from ${System.getProperty("user.dir")} — " +
                "a guard that cannot see the sources it guards would pass in silence",
        )
    }

    fun kotlinFiles(): List<File> =
        mainSources().walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
}
