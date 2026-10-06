package com.chetan.connectsuite.link

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.chetan.connectsuite.core.link.PairingQrPayload
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.ui.draw.clip
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.HeaderIconButton
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.StateBlock
import com.chetan.connectsuite.core.ui.components.StateKind
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/**
 * Scans the pairing QR the Mac is showing.
 *
 * This screen is the entire trust decision on the phone: whatever fingerprint comes out of the
 * code is what the TLS layer pins from then on, so it only ever reports a payload it could fully
 * parse and validate — a half-read code is discarded rather than guessed at.
 */
@Composable
fun QrScanScreen(
    onScanned: (PairingQrPayload) -> Unit,
    onCancel: () -> Unit,
) {
    val context = LocalContext.current

    var hasCamera by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var status by remember { mutableStateOf<String?>(null) }
    // One scan per visit: the analyzer keeps firing while the camera unbinds, and pairing twice
    // from one code would consume the one-time token on the wrong connection.
    var consumed by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasCamera = granted
    }

    LaunchedEffect(Unit) {
        if (!hasCamera) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    Column(
        // The activity draws edge to edge and this screen hosts no Scaffold, so nothing else
        // insets it. Without this the title renders *under* the status bar — "Pair with your Mac"
        // half-hidden behind the clock, which is what a screenshot showed on 2026-09-02 and what
        // no `uiautomator` dump could have: the text is present, correctly bounded, and painted
        // beneath something else. Every other bare-Column screen in this app already does this.
        modifier = Modifier
            .fillMaxSize()
            .background(SidekickColors.canvas)
            .systemBarsPadding()
            .padding(horizontal = Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = Space.sm),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            HeaderIconButton(Icons.Outlined.ArrowBack, "Back", onCancel)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "Scan the code on your Mac",
                    style = SidekickType.title,
                    color = SidekickColors.textPrimary,
                )
                Text(
                    "Open Sidekick on your Mac and show the pairing code.",
                    style = SidekickType.caption,
                    color = SidekickColors.textBody,
                )
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(Radius.cardShape)
                .background(SidekickColors.card),
            contentAlignment = Alignment.Center,
        ) {
            if (hasCamera) {
                CameraPreview(
                    onBarcode = { raw ->
                        if (consumed) return@CameraPreview
                        // Pairing v2: a v1 Mac's code is refused here, before anything is armed or sent —
                        // docs/protocol.md → Pairing (version 2) → Compatibility. No fallback.
                        val payload = when (val scan = PairingQrPayload.classify(raw)) {
                            is PairingQrPayload.Scan.V2 -> scan.payload
                            PairingQrPayload.Scan.LegacyMac -> {
                                status = PairingQrPayload.LEGACY_MAC_MESSAGE
                                return@CameraPreview
                            }
                            PairingQrPayload.Scan.Invalid -> {
                                status = "That code is not a Sidekick pairing code."
                                return@CameraPreview
                            }
                        }
                        consumed = true
                        status = "Pairing with ${payload.name}…"
                        onScanned(payload)
                    },
                )
                // The viewfinder. Four corner brackets rather than a full rectangle: a closed frame
                // reads as a boundary the code must fit exactly, and it does not have to.
                ScanBrackets()
            } else {
                // The permission state is the shared component, not a bare button. A refusal here
                // is not an error — it is a thing the user chose and can unchoose — so it is the
                // Permission kind, amber, with the reason stated and one action.
                StateBlock(
                    kind = StateKind.Permission,
                    headline = "Camera access is off",
                    body = "Scanning a pairing code is the only thing Sidekick uses the camera " +
                        "for. Nothing is recorded and no image leaves this phone.",
                    actionLabel = "Allow camera",
                    onAction = { permissionLauncher.launch(Manifest.permission.CAMERA) },
                )
            }
        }

        SidekickCard {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.md),
            ) {
                IconBadge(
                    Icons.Outlined.QrCodeScanner,
                    tint = SidekickColors.accent,
                    container = SidekickColors.accentTint,
                    border = SidekickColors.accentBorder,
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        status ?: "The code is detected automatically.",
                        style = SidekickType.body,
                        color = if (status != null) {
                            SidekickColors.accentText
                        } else {
                            SidekickColors.textPrimary
                        },
                    )
                    Text(
                        "Both machines have to be on the same network for the Mac to reach this " +
                            "phone afterwards.",
                        style = SidekickType.caption,
                        color = SidekickColors.textBody,
                    )
                }
            }
        }

        SecondaryButton(
            "Cancel",
            onCancel,
            Modifier.fillMaxWidth().height(52.dp).padding(bottom = Space.xs),
        )
    }
}

/** Four lime corner brackets over the preview. Drawn, because no stock glyph is a viewfinder. */
@Composable
private fun BoxScope.ScanBrackets() {
    val arm = 34.dp
    val thickness = 3.dp
    @Composable
    fun corner(align: Alignment, top: Boolean, start: Boolean) {
        Box(Modifier.align(align).size(arm)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(thickness)
                    .align(if (top) Alignment.TopStart else Alignment.BottomStart)
                    .background(SidekickColors.accent),
            )
            Box(
                Modifier
                    .width(thickness)
                    .fillMaxHeight()
                    .align(if (start) Alignment.TopStart else Alignment.TopEnd)
                    .background(SidekickColors.accent),
            )
        }
    }
    Box(Modifier.fillMaxSize().padding(Space.xl)) {
        corner(Alignment.TopStart, top = true, start = true)
        corner(Alignment.TopEnd, top = true, start = false)
        corner(Alignment.BottomStart, top = false, start = true)
        corner(Alignment.BottomEnd, top = false, start = false)
    }
}

@Composable
private fun CameraPreview(onBarcode: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }

    DisposableEffect(Unit) {
        onDispose {
            analysisExecutor.shutdown()
            scanner.close()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { viewContext ->
            val previewView = PreviewView(viewContext).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }
            val providerFuture = ProcessCameraProvider.getInstance(viewContext)
            providerFuture.addListener({
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().apply {
                    surfaceProvider = previewView.surfaceProvider
                }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .apply {
                        setAnalyzer(analysisExecutor) { proxy ->
                            scanFrame(proxy, scanner, onBarcode)
                        }
                    }
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
            }, ContextCompat.getMainExecutor(viewContext))
            previewView
        },
    )
}

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
private fun scanFrame(
    proxy: ImageProxy,
    scanner: com.google.mlkit.vision.barcode.BarcodeScanner,
    onBarcode: (String) -> Unit,
) {
    val image = proxy.image
    if (image == null) {
        proxy.close()
        return
    }
    val input = InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees)
    scanner.process(input)
        .addOnSuccessListener { barcodes ->
            barcodes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }
                ?.rawValue
                ?.let(onBarcode)
        }
        // The proxy must be closed on every path or the analyzer stops receiving frames after
        // the queue depth is reached, which looks exactly like a dead camera.
        .addOnCompleteListener { proxy.close() }
}
