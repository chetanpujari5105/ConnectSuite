package com.chetan.connectsuite.camera.webcam

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.OrientationEventListener
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Videocam
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
import com.chetan.connectsuite.camera.CameraFacing
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

/**
 * Camera v2's phone screen: the request, the owner's answer, and — once approved — the capture.
 *
 * ### The capture belongs to this screen and to nothing else
 *
 * The camera and the encoder are opened by [WebcamCaptureCore] for this activity and released when it
 * stops. [onStop] ends a live session `left-screen`: Home, another app, the screen locking or timing out.
 * There is no foreground service and no background-start route. The preview keeps the screen on while
 * live, so a display timeout does not end a session the owner is watching.
 *
 * ### Two taps, and the order is the privacy rule
 *
 * **Start camera** is the consent, for this one session. Android's permission dialog comes after it,
 * only if `CAMERA` is not yet granted — a granted permission skips the dialog and never the tap. A meeting
 * app opening Sidekick Camera on the Mac is not a tap here and the screen says so before it is asked.
 *
 * Built from the same design components as Camera v1's screen; it shares none of its state.
 */
class WebcamActivity : ComponentActivity(), WebcamCaptureHost {

    private lateinit var surfaceView: SurfaceView

    @Volatile private var previewSurface: Surface? = null

    @Volatile private var deviceDegrees = OrientationEventListener.ORIENTATION_UNKNOWN

    private val backend by lazy {
        Camera2WebcamBackend(this, previewSurface = { previewSurface?.takeIf { it.isValid } }, deviceDegrees = { deviceDegrees })
    }

    private val capture by lazy {
        WebcamCaptureCore(
            backend = backend,
            isCurrent = WebcamEngine::isCurrentCapture,
            failed = WebcamEngine::captureFailed,
            log = { LinkLog.i("webcam", it) },
        )
    }

    /** The session and camera the permission dialog is answering for. */
    private var pendingApproval: Pair<String, CameraFacing>? = null

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val (sessionId, facing) = pendingApproval ?: return@registerForActivityResult
        pendingApproval = null
        // Answered for the session it was asked for, on the request's own clock: a late grant opens nothing.
        if (granted) WebcamEngine.approve(sessionId, facing) else WebcamEngine.permissionDenied(sessionId)
    }

    private val orientation by lazy {
        object : OrientationEventListener(this) {
            override fun onOrientationChanged(degrees: Int) {
                deviceDegrees = degrees
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        surfaceView = SurfaceView(this).apply {
            keepScreenOn = true
            holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) {
                    previewSurface = holder.surface
                }

                override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

                override fun surfaceDestroyed(holder: SurfaceHolder) {
                    previewSurface = null
                }
            })
        }
        WebcamEngine.attachHost(this)
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val ui = WebcamEngine.ui.value
                    when {
                        ui.phase == WebcamPhase.AWAITING -> ui.sessionId?.let(WebcamEngine::decline)
                        ui.phase.isLive -> WebcamEngine.stopFromPhone()
                    }
                    finish()
                }
            },
        )
        setContent {
            ConnectSuiteTheme {
                val ui by WebcamEngine.ui.collectAsState()
                WebcamScreen(
                    ui = ui,
                    surfaceView = surfaceView,
                    onStart = ::startTapped,
                    onDecline = { ui.sessionId?.let(WebcamEngine::decline) },
                    onStop = WebcamEngine::stopFromPhone,
                    onSwitch = WebcamEngine::switchFromPhone,
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
        // The foreground rule: a waiting request is left alone, a live session ends here.
        WebcamEngine.visibilityLost()
    }

    override fun onDestroy() {
        super.onDestroy()
        WebcamEngine.detachHost(this)
        // Invalidates any open still waiting on Camera2, and releases a bound capture once.
        capture.close()
        backend.shutdown()
    }

    /** **Start camera.** The consent; the permission dialog follows only if it has to. */
    private fun startTapped(sessionId: String, facing: CameraFacing) {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            WebcamEngine.approve(sessionId, facing)
        } else {
            pendingApproval = sessionId to facing
            permission.launch(Manifest.permission.CAMERA)
        }
    }

    // ---- WebcamCaptureHost --------------------------------------------------------------------------

    override fun openCapture(sessionId: String, facing: CameraFacing, generation: Int) =
        runOnUiThread { capture.open(sessionId, facing, generation) }

    override fun switchCapture(sessionId: String, facing: CameraFacing, generation: Int) =
        runOnUiThread { capture.open(sessionId, facing, generation) }

    override fun closeCapture() = runOnUiThread { capture.close() }

    override fun requestKeyframe() = runOnUiThread { capture.requestKeyframe() }

    override fun requestKeyframeFor(sessionId: String, generation: Int) = runOnUiThread { capture.requestKeyframe(sessionId, generation) }
}

@Composable
private fun WebcamScreen(
    ui: WebcamUi,
    surfaceView: SurfaceView,
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
            WebcamPhase.AWAITING -> RequestCard(ui, onStart, onDecline)
            WebcamPhase.STARTING, WebcamPhase.RUNNING -> LiveView(ui, surfaceView, onStop, onSwitch)
            WebcamPhase.IDLE -> EndedView(ui, onClose)
        }
    }
}

@Composable
private fun RequestCard(ui: WebcamUi, onStart: (String, CameraFacing) -> Unit, onDecline: () -> Unit) {
    val sessionId = ui.sessionId ?: return
    var facing by rememberSaveable(sessionId) { mutableStateOf(ui.facing) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(sessionId) {
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
        Text("Webcam request", style = SidekickType.title, color = SidekickColors.textPrimary)
        SidekickCard {
            Text(
                WebcamCopy.requestTitle(ui.peerName ?: "your Mac", ui.trigger ?: WebcamTrigger.PERSON),
                style = SidekickType.section,
                color = SidekickColors.textPrimary,
            )
            Text(
                WebcamCopy.REQUEST_BODY,
                style = SidekickType.caption,
                color = SidekickColors.textBody,
                modifier = Modifier.padding(top = Space.sm),
            )
        }
        Text("Camera", style = SidekickType.overline, color = SidekickColors.textMeta)
        SegmentedFilter(
            segments = listOf(FilterSegment("Front"), FilterSegment("Back")),
            selectedIndex = if (facing == CameraFacing.FRONT) 0 else 1,
            onSelect = { facing = if (it == 0) CameraFacing.FRONT else CameraFacing.BACK },
        )
        secondsLeft?.let {
            Text("This request expires in $it s.", style = SidekickType.meta, color = SidekickColors.textMeta)
        }
        PrimaryButton(
            text = "Start camera",
            onClick = { onStart(sessionId, facing) },
            icon = Icons.Outlined.Videocam,
            modifier = Modifier.fillMaxWidth().testTag("webcam-start"),
        )
        SecondaryButton(
            text = "Decline",
            onClick = onDecline,
            modifier = Modifier.fillMaxWidth().testTag("webcam-decline"),
        )
    }
}

@Composable
private fun LiveView(ui: WebcamUi, surfaceView: SurfaceView, onStop: () -> Unit, onSwitch: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        AndroidView(factory = { surfaceView }, modifier = Modifier.fillMaxSize())
        Row(
            Modifier
                .align(Alignment.TopStart)
                .statusBarsPadding()
                .padding(Space.lg),
        ) {
            if (ui.phase == WebcamPhase.RUNNING) {
                val size = if (ui.selectedWidth != null && ui.selectedHeight != null) " · ${ui.selectedWidth}×${ui.selectedHeight}" else ""
                StatusPill("Webcam for ${ui.peerName ?: "your Mac"}$size", StatusKind.Connected)
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
                modifier = Modifier.fillMaxWidth().testTag("webcam-switch"),
            )
            DestructiveButton(
                text = "Stop webcam",
                onClick = onStop,
                icon = Icons.Outlined.Stop,
                modifier = Modifier.fillMaxWidth().testTag("webcam-stop"),
            )
        }
    }
}

@Composable
private fun EndedView(ui: WebcamUi, onClose: () -> Unit) {
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
                headline = "No webcam request is waiting",
                body = "A Mac asks when an app there starts Sidekick Camera. The camera opens only after you allow it here.",
                actionLabel = "Close",
                onAction = onClose,
            )
        } else {
            StateBlock(
                kind = if (reason == WebcamStopReason.PERMISSION_DENIED) StateKind.Permission else StateKind.Empty,
                headline = "Webcam off",
                body = listOfNotNull(reason.messageFor(ui.lastDetail), reason.fixHint).joinToString(" "),
                actionLabel = "Close",
                onAction = onClose,
            )
        }
    }
}
