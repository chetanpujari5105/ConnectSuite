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
    var status by remember { mutableStateOf("Point the camera at the QR code on your Mac") }
    // One scan per visit: the analyzer keeps firing while the camera unbinds, and pairing twice
    // from one code would consume the one-time token on the wrong connection.
    var consumed by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasCamera = granted
        if (!granted) status = "Camera access is needed to scan the pairing code."
    }

    LaunchedEffect(Unit) {
        if (!hasCamera) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Pair with your Mac", style = MaterialTheme.typography.headlineSmall)
        Text(status, style = MaterialTheme.typography.bodyMedium)

        Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            if (hasCamera) {
                CameraPreview(
                    onBarcode = { raw ->
                        if (consumed) return@CameraPreview
                        val payload = PairingQrPayload.parse(raw)
                        if (payload == null) {
                            status = "That code is not a ConnectSuite pairing code."
                            return@CameraPreview
                        }
                        consumed = true
                        status = "Pairing with ${payload.name}…"
                        onScanned(payload)
                    },
                )
            } else {
                Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                    Text("Allow camera")
                }
            }
        }

        Button(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
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
