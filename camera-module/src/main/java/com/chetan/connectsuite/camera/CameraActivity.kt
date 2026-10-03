package com.chetan.connectsuite.camera

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Bundle
import android.util.Size
import android.view.OrientationEventListener
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cameraswitch
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.ui.ConnectSuiteTheme
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.DestructiveButton
import com.chetan.connectsuite.core.ui.components.FilterSegment
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import com.chetan.connectsuite.core.ui.components.SegmentedFilter
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.StateBlock
import com.chetan.connectsuite.core.ui.components.StateKind
import com.chetan.connectsuite.core.ui.components.StatusKind
import com.chetan.connectsuite.core.ui.components.StatusPill
import kotlinx.coroutines.delay
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Camera v1's phone screen: the request, the owner's answer, and — once approved — the live preview.
 *
 * ### The camera belongs to this screen and to nothing else
 *
 * CameraX is bound to this activity's lifecycle. When the activity stops — Home, another app, the
 * screen locking or timing out — the camera unbinds and [onStop] ends the stream with `left-screen`.
 * That is the whole of v1's foreground rule, and it is why there is no foreground service: capture
 * cannot outlive the screen the owner is looking at. The preview keeps the screen on while live, so a
 * display timeout does not end a stream the owner is watching.
 *
 * ### Two taps, and the order is the privacy rule
 *
 * **Start camera** is the consent. Android's permission dialog, if it appears at all, comes *after*
 * that tap and only when `CAMERA` is not yet granted — so a granted permission skips the dialog and
 * never the tap. Back on the request screen declines; Back while live stops.
 */
class CameraActivity : ComponentActivity(), CameraHost {

    private lateinit var previewView: PreviewView
    private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "camera-analysis").apply { isDaemon = true }
    }

    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var camera: Camera? = null
    private var targetRotation = 0

    /**
     * Open, switch and close, with the stale-callback and release-once rules held in a class a JVM test
     * can run (defect 169). CameraX is only the [CameraBackend] below.
     */
    private val host by lazy {
        CameraHostCore(
            backend = CameraXBackend(),
            isCurrent = CameraEngine::isCurrentCamera,
            failed = CameraEngine::cameraFailed,
            log = { LinkLog.i("camera", it) },
        )
    }

    /** The stream and camera the permission dialog is answering for. */
    private var pendingApproval: Pair<String, CameraFacing>? = null

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val (streamId, facing) = pendingApproval ?: return@registerForActivityResult
        pendingApproval = null
        // Answered for the stream it was asked for, on the clock — the machine refuses a late grant (defect 170).
        if (granted) CameraEngine.approve(streamId, facing) else CameraEngine.permissionDenied(streamId)
    }

    private val orientation by lazy {
        object : OrientationEventListener(this) {
            override fun onOrientationChanged(degrees: Int) {
                if (degrees == ORIENTATION_UNKNOWN) return
                val rotation = CameraMappings.targetRotationFor(degrees)
                if (rotation != targetRotation) {
                    targetRotation = rotation
                    analysis?.targetRotation = rotation
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
            keepScreenOn = true
        }
        CameraEngine.attachHost(this)
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val ui = CameraEngine.ui.value
                    when {
                        ui.phase == CameraPhase.AWAITING -> ui.streamId?.let(CameraEngine::decline)
                        ui.phase.isLive -> CameraEngine.stopFromPhone()
                    }
                    finish()
                }
            },
        )
        setContent {
            ConnectSuiteTheme {
                val ui by CameraEngine.ui.collectAsState()
                CameraScreen(
                    ui = ui,
                    previewView = previewView,
                    onStart = ::startTapped,
                    onDecline = { ui.streamId?.let(CameraEngine::decline) },
                    onStop = CameraEngine::stopFromPhone,
                    onSwitch = CameraEngine::switchFromPhone,
                    onClose = ::finish,
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (orientation.canDetectOrientation()) orientation.enable()
    }

    override fun onStop() {
        super.onStop()
        orientation.disable()
        // v1's foreground rule. A waiting request is left alone — its notification still offers this
        // screen until it expires — and a live stream ends here, whatever stopped the activity.
        CameraEngine.visibilityLost()
    }

    override fun onDestroy() {
        super.onDestroy()
        CameraEngine.detachHost(this)
        // Invalidates any open still waiting for CameraX, and releases a bound camera if the stream's own
        // end has not already — never twice.
        host.close()
        analysisExecutor.shutdown()
    }

    /** **Start camera.** The consent; the permission dialog follows only if it has to. */
    private fun startTapped(streamId: String, facing: CameraFacing) {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            CameraEngine.approve(streamId, facing)
        } else {
            pendingApproval = streamId to facing
            permission.launch(Manifest.permission.CAMERA)
        }
    }

    // ---- CameraHost -----------------------------------------------------------------------------

    override fun openCamera(streamId: String, facing: CameraFacing, epoch: Int) = runOnUiThread { host.open(streamId, facing, epoch) }

    override fun switchCamera(streamId: String, facing: CameraFacing, epoch: Int) = runOnUiThread { host.open(streamId, facing, epoch) }

    override fun closeCamera() = runOnUiThread { host.close() }

    /** CameraX, as [CameraHostCore] sees it. Main thread throughout. */
    private inner class CameraXBackend : CameraBackend {
        override fun whenReady(then: (ready: Boolean) -> Unit) {
            val future = ProcessCameraProvider.getInstance(this@CameraActivity)
            future.addListener(
                {
                    val ready = runCatching { future.get() }
                        .onSuccess { provider = it }
                        .onFailure { LinkLog.w("camera", "Camera provider did not come up (${it.javaClass.simpleName}: ${it.message})") }
                        .isSuccess
                    then(ready)
                },
                ContextCompat.getMainExecutor(this@CameraActivity),
            )
        }

        override fun hasCamera(facing: CameraFacing): Boolean =
            provider?.hasCamera(selectorFor(facing)) == true

        override fun bind(streamId: String, facing: CameraFacing, epoch: Int) {
            val cameraProvider = checkNotNull(provider) { "no camera provider" }
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val imageAnalysis = ImageAnalysis.Builder()
                .setResolutionSelector(
                    ResolutionSelector.Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(
                                Size(TARGET_WIDTH, TARGET_HEIGHT),
                                ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                            ),
                        )
                        .build(),
                )
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                .build()
            imageAnalysis.targetRotation = targetRotation
            imageAnalysis.setAnalyzer(analysisExecutor, Analyzer(streamId, epoch))

            unbind()
            analysis = imageAnalysis
            val bound = cameraProvider.bindToLifecycle(this@CameraActivity, selectorFor(facing), preview, imageAnalysis)
            camera = bound
            bound.cameraInfo.cameraState.observe(this@CameraActivity) { state ->
                val reason = state.error?.code?.let(CameraMappings::stopReasonFor) ?: return@observe
                CameraEngine.cameraFailed(streamId, reason)
            }
        }

        override fun unbind() {
            camera?.cameraInfo?.cameraState?.removeObservers(this@CameraActivity)
            camera = null
            analysis?.clearAnalyzer()
            analysis = null
            runCatching { provider?.unbindAll() }
        }

        private fun selectorFor(facing: CameraFacing): CameraSelector =
            if (facing == CameraFacing.FRONT) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
    }

    /**
     * One camera's frames for one stream. Paced to the cap, gated per frame by the machine, encoded as
     * one JPEG each, and offered to a two-deep queue that never blocks this thread.
     */
    private class Analyzer(private val streamId: String, private val epoch: Int) : ImageAnalysis.Analyzer {
        private val pacer = FramePacer(CameraSessionMachine.FRAME_RATE_CAP)
        private var nv21: ByteArray? = null
        private var consecutiveFailures = 0

        override fun analyze(image: ImageProxy) {
            image.use {
                val capturedNanos = System.nanoTime()
                if (!pacer.admit(capturedNanos)) return
                val width = image.width and 1.inv()
                val height = image.height and 1.inv()
                val ticket = CameraEngine.frameProduced(streamId, epoch, width, height) ?: return
                try {
                    val planes = image.planes
                    val buffer = Nv21.fromYuv420(
                        width,
                        height,
                        y = Nv21.Plane(planes[0].buffer, planes[0].rowStride, planes[0].pixelStride),
                        u = Nv21.Plane(planes[1].buffer, planes[1].rowStride, planes[1].pixelStride),
                        v = Nv21.Plane(planes[2].buffer, planes[2].rowStride, planes[2].pixelStride),
                        out = nv21,
                    )
                    nv21 = buffer
                    val jpeg = ByteArrayOutputStream(96 * 1024).also {
                        YuvImage(buffer, ImageFormat.NV21, width, height, null)
                            .compressToJpeg(Rect(0, 0, width, height), JPEG_QUALITY, it)
                    }.toByteArray()
                    val meta = CameraFrameCodec.Meta(
                        facing = ticket.facing,
                        rotationQuarterTurns = CameraFrameCodec.quarterTurns(image.imageInfo.rotationDegrees),
                        mirrored = ticket.facing == CameraFacing.FRONT,
                        epoch = ticket.epoch,
                        width = width,
                        height = height,
                        sequence = CameraEngine.nextSequence() and 0xFFFF_FFFFL,
                    )
                    val frame = CameraFrameCodec.encode(meta, capturedNanos / 1_000, jpeg)
                    if (frame == null) CameraEngine.countOversize() else CameraEngine.offerFrame(streamId, frame)
                    consecutiveFailures = 0
                } catch (e: Exception) {
                    CameraEngine.countEncodeFailure()
                    consecutiveFailures++
                    if (consecutiveFailures == 1) LinkLog.w("camera", "Frame encode failed: ${e.javaClass.simpleName}: ${e.message}")
                    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                        CameraEngine.cameraFailed(streamId, CameraStopReason.CAPTURE_FAILED)
                    }
                }
            }
        }
    }

    companion object {
        /** The modest target the contract names; CameraX picks the closest size the camera offers. */
        const val TARGET_WIDTH = 1280
        const val TARGET_HEIGHT = 720
        const val JPEG_QUALITY = 70

        /** A second of failures at the cap ends the stream as `capture-failed` instead of sending nothing. */
        const val MAX_CONSECUTIVE_FAILURES = 15
    }
}

@Composable
private fun CameraScreen(
    ui: CameraUi,
    previewView: PreviewView,
    onStart: (String, CameraFacing) -> Unit,
    onDecline: () -> Unit,
    onStop: () -> Unit,
    onSwitch: () -> Unit,
    onClose: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(SidekickColors.canvas),
    ) {
        when (ui.phase) {
            CameraPhase.AWAITING -> RequestCard(ui, onStart, onDecline)
            CameraPhase.STARTING, CameraPhase.RUNNING -> LiveView(ui, previewView, onStop, onSwitch)
            CameraPhase.IDLE -> EndedView(ui, onClose)
        }
    }
}

@Composable
private fun RequestCard(ui: CameraUi, onStart: (String, CameraFacing) -> Unit, onDecline: () -> Unit) {
    val streamId = ui.streamId ?: return
    var facing by rememberSaveable(streamId) { mutableStateOf(ui.facing) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(streamId) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val secondsLeft = ui.deadlineMillis?.let { ((it - now) / 1_000).coerceAtLeast(0) }
    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.lg),
    ) {
        Text("Camera request", style = SidekickType.title, color = SidekickColors.textPrimary)
        SidekickCard {
            Text(
                "${ui.peerName ?: "Your Mac"} wants to see this phone's camera",
                style = SidekickType.section,
                color = SidekickColors.textPrimary,
            )
            Text(
                "The camera stays off until you tap Start camera. The picture appears only in Sidekick " +
                    "on that Mac, only while this screen stays open. Nothing is recorded or saved, and " +
                    "there is no sound.",
                style = SidekickType.caption,
                color = SidekickColors.textBody,
                modifier = Modifier.padding(top = Space.sm),
            )
        }
        Text("Camera", style = SidekickType.overline, color = SidekickColors.textMeta)
        SegmentedFilter(
            segments = listOf(FilterSegment("Back"), FilterSegment("Front")),
            selectedIndex = if (facing == CameraFacing.BACK) 0 else 1,
            onSelect = { facing = if (it == 0) CameraFacing.BACK else CameraFacing.FRONT },
        )
        secondsLeft?.let {
            Text(
                "This request expires in $it s.",
                style = SidekickType.meta,
                color = SidekickColors.textMeta,
            )
        }
        PrimaryButton(
            text = "Start camera",
            onClick = { onStart(streamId, facing) },
            icon = Icons.Outlined.PhotoCamera,
            modifier = Modifier.fillMaxWidth().testTag("camera-start"),
        )
        SecondaryButton(
            text = "Decline",
            onClick = onDecline,
            modifier = Modifier.fillMaxWidth().testTag("camera-decline"),
        )
    }
}

@Composable
private fun LiveView(ui: CameraUi, previewView: PreviewView, onStop: () -> Unit, onSwitch: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
        Row(
            Modifier
                .align(Alignment.TopStart)
                .statusBarsPadding()
                .padding(Space.lg),
        ) {
            if (ui.phase == CameraPhase.RUNNING) {
                StatusPill("Live to ${ui.peerName ?: "your Mac"}", StatusKind.Connected)
            } else {
                StatusPill("Starting…", StatusKind.Neutral)
            }
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(Space.lg)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Space.sm),
        ) {
            SecondaryButton(
                text = if (ui.facing == CameraFacing.BACK) "Switch to front camera" else "Switch to back camera",
                onClick = onSwitch,
                icon = Icons.Outlined.Cameraswitch,
                modifier = Modifier.fillMaxWidth().testTag("camera-switch"),
            )
            DestructiveButton(
                text = "Stop camera",
                onClick = onStop,
                icon = Icons.Outlined.Stop,
                modifier = Modifier.fillMaxWidth().testTag("camera-stop"),
            )
        }
    }
}

@Composable
private fun EndedView(ui: CameraUi, onClose: () -> Unit) {
    val reason = ui.lastStop
    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(Space.lg),
        verticalArrangement = Arrangement.Center,
    ) {
        if (reason == null) {
            StateBlock(
                kind = StateKind.Empty,
                headline = "No camera request is waiting",
                body = "A Mac asks from Sidekick's Camera pane. The camera opens only after you allow it here.",
                actionLabel = "Close",
                onAction = onClose,
            )
        } else {
            StateBlock(
                kind = if (reason == CameraStopReason.PERMISSION_DENIED) StateKind.Permission else StateKind.Empty,
                headline = "Camera off",
                body = listOfNotNull(reason.message, reason.fixHint).joinToString(" "),
                actionLabel = "Close",
                onAction = onClose,
            )
        }
    }
}
