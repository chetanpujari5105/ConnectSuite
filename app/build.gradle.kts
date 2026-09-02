import java.io.File
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Release signing, and **where the secret lives is part of the design rather than an afterthought.**
 *
 * Resolution order, first hit wins:
 *
 *  1. `$CONNECTSUITE_KEYSTORE_PROPERTIES` — an explicit path, which is how CI would pass one.
 *  2. `~/.android-keystores/connectsuite.properties` — **the default, and deliberately outside the
 *     repository.** That directory is `chmod 700` and carries its own `.gitignore` of `*`, so the
 *     properties file and the keystore it points at cannot be committed by any repo that happens to
 *     enclose them — which matters more than it sounds, because this machine has a stray `git init`
 *     at `~` with no remote and no tracked files.
 *  3. `<repo>/keystore.properties` — the original location. Still honoured so an existing checkout
 *     keeps working, still `.gitignore`d, and no longer where anything is put by default.
 *
 * **Why 2 rather than 3.** `.gitignore` is one layer and it is the only layer a repo-root file has:
 * a `git add -f`, an edited ignore file, or a `tar` of the working tree all defeat it. A file that
 * is not in the tree at all is defeated by none of them. The build tells you which one it used, so
 * a signed build is never a mystery.
 *
 * Without any of the three the release build still assembles, **unsigned** — a clear failure at
 * install time (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`, measured on hardware 2026-09-02) rather than
 * a silently debug-signed APK shipped to users.
 */
val keystorePropertiesFile: File? = listOfNotNull(
    System.getenv("CONNECTSUITE_KEYSTORE_PROPERTIES")?.let(::File),
    File(System.getProperty("user.home"), ".android-keystores/connectsuite.properties"),
    rootProject.file("keystore.properties"),
).firstOrNull { it.isFile }

val keystoreProperties = Properties().apply {
    keystorePropertiesFile?.inputStream()?.use(::load)
}
val hasReleaseKeystore = keystoreProperties.getProperty("storeFile") != null

if (hasReleaseKeystore) {
    logger.lifecycle("Release signing config: $keystorePropertiesFile")
}

android {
    namespace = "com.chetan.connectsuite"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.chetan.connectsuite"
        minSdk = 29
        targetSdk = 36
        /*
         * The version scheme, which is one scheme for two apps. See `docs/versioning.md`.
         *
         * `versionName` is the **product** version and must equal `desktop/package.json`'s
         * `version` — `scripts/check-versions.mjs` fails a commit where they disagree, which they
         * did until 2026-09-02: this app said 1.0.0 while the Mac said 2.0.0, and nothing in the
         * repo said which was the version of ConnectSuite.
         *
         * `versionCode` is Android's own monotonic integer and is deliberately **not derived** from
         * the name. Deriving it is the classic trap: any `major*10000 + minor*100 + patch` scheme
         * breaks the first time a minor or patch reaches 100, and Play refuses a versionCode that
         * has ever gone down. It is bumped by hand, once per release, and nothing else may read it.
         */
        versionCode = 1
        versionName = "2.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                // An absolute path is used as-is; a relative one is resolved against the
                // properties file's own directory, not the repo — so a properties file living
                // beside its keystore can name it without an absolute path.
                storeFile = keystoreProperties.getProperty("storeFile").let { configured ->
                    val asGiven = File(configured.replaceFirst("~", System.getProperty("user.home")))
                    when {
                        asGiven.isAbsolute -> asGiven
                        else -> File(keystorePropertiesFile!!.parentFile, configured)
                    }
                }
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                // v1 is still needed for API < 24 installs; harmless above that.
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (hasReleaseKeystore) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                logger.warn(
                    "No keystore.properties found - the release build will be unsigned. " +
                        "See README.md for how to create one.",
                )
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":sync-module"))
    implementation(project(":mirror-module"))
    implementation(project(":input-module"))

    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)

    // QR pairing: CameraX preview plus ML Kit's bundled barcode model, so a first scan works
    // with no Play Services model download and no network.
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode.scanning)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
