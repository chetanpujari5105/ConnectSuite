plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Camera v1 (docs/protocol.md → Camera, docs/camera-v1.md). A live preview of the phone's camera
// for the Mac's Camera pane — foreground-only, per-stream consent, development builds only.
android {
    namespace = "com.chetan.connectsuite.camera"
    compileSdk = 36

    defaultConfig {
        minSdk = 29
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
}

dependencies {
    api(project(":core"))
    implementation(libs.androidx.activity.compose)

    // The project's existing capture stack — the same CameraX the QR pairing scanner ships in :app.
    // No second camera architecture: Preview for the phone's own screen, ImageAnalysis for the Mac.
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
}

// CameraFrameCodecTest reads the cross-language golden vector from docs/fixtures, which is not
// otherwise an input of the unit test task — without this a fixture-only edit would leave an old
// green in place (the ShareManifestTest lesson in :app).
tasks.withType<Test>().configureEach {
    inputs.file("../docs/fixtures/camera-frame-v1.hex").withPropertyName("cameraFrameGoldenVector")
    // Camera v2's fixtures, read in place by the webcam tests — the same lesson: a fixture-only edit
    // must not leave an old green behind.
    inputs.file("../docs/fixtures/webcam-au-v1.hex").withPropertyName("webcamAuGoldenVector")
    inputs.file("../docs/fixtures/webcam-vocabulary-v1.json").withPropertyName("webcamVocabulary")
    inputs.file("../docs/fixtures/webcam-mediacodec-sample-v1.txt").withPropertyName("webcamMediaCodecSample")
    inputs.file("../docs/fixtures/webcam-phone-stream-v1.hex").withPropertyName("webcamPhoneStream")
}
