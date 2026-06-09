package br.com.aracaresto.meucaixa.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

enum class CameraState { PREVIEW, CONFIRMANDO, ENVIANDO, SUCESSO, ERRO }

@Composable
fun CameraScreen(
    pedidoId: String,
    onEnviarFoto: suspend (String, ByteArray) -> Result<String>,
    onVoltarEspera: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var cameraState by remember { mutableStateOf(CameraState.PREVIEW) }
    var capturedBytes by remember { mutableStateOf<ByteArray?>(null) }
    var capturedBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var erroMsg by remember { mutableStateOf("") }

    val imageCapture = remember { ImageCapture.Builder().build() }
    val executor = remember { Executors.newSingleThreadExecutor() }

    when (cameraState) {
        CameraState.PREVIEW -> {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                // Preview da câmera
                AndroidView(
                    factory = { ctx ->
                        val previewView = PreviewView(ctx)
                        val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                        cameraProviderFuture.addListener({
                            val cameraProvider = cameraProviderFuture.get()
                            val preview = Preview.Builder().build().also {
                                it.setSurfaceProvider(previewView.surfaceProvider)
                            }
                            try {
                                cameraProvider.unbindAll()
                                cameraProvider.bindToLifecycle(
                                    lifecycleOwner,
                                    CameraSelector.DEFAULT_BACK_CAMERA,
                                    preview,
                                    imageCapture
                                )
                            } catch (e: Exception) { /* ignorar */ }
                        }, executor)
                        previewView
                    },
                    modifier = Modifier.fillMaxSize()
                )

                Column(
                    Modifier.align(Alignment.BottomCenter).padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text("Aponte para o relatório da maquininha",
                        color = Color.White, style = MaterialTheme.typography.bodyMedium)
                    Button(
                        onClick = {
                            val outputOptions = ImageCapture.OutputFileOptions.Builder(
                                java.io.File(context.cacheDir, "foto_temp.jpg")
                            ).build()
                            imageCapture.takePicture(outputOptions, executor,
                                object : ImageCapture.OnImageSavedCallback {
                                    override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                        val file = java.io.File(context.cacheDir, "foto_temp.jpg")
                                        val bmp = BitmapFactory.decodeFile(file.absolutePath)
                                        val baos = ByteArrayOutputStream()
                                        // Comprimir para reduzir upload
                                        bmp.compress(Bitmap.CompressFormat.JPEG, 85, baos)
                                        capturedBytes = baos.toByteArray()
                                        capturedBitmap = bmp
                                        cameraState = CameraState.CONFIRMANDO
                                    }
                                    override fun onError(exc: ImageCaptureException) {
                                        erroMsg = "Erro ao tirar foto: ${exc.message}"
                                        cameraState = CameraState.ERRO
                                    }
                                })
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF7A51C))
                    ) {
                        Text("Tirar foto do relatório", color = Color.Black)
                    }
                }
            }
        }

        CameraState.CONFIRMANDO -> {
            val bmp = capturedBitmap
            Column(
                Modifier.fillMaxSize().background(Color.Black).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Os números estão nítidos?",
                    color = Color.White, style = MaterialTheme.typography.titleMedium)
                if (bmp != null) {
                    Image(bmp.asImageBitmap(), null,
                        modifier = Modifier.fillMaxWidth().weight(1f))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(
                        onClick = { cameraState = CameraState.PREVIEW },
                        modifier = Modifier.weight(1f)
                    ) { Text("Tirar novamente", color = Color.White) }
                    Button(
                        onClick = { cameraState = CameraState.ENVIANDO },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16A34A))
                    ) { Text("Confirmar foto") }
                }
            }
        }

        CameraState.ENVIANDO -> {
            // Envia a foto para o Supabase
            LaunchedEffect(Unit) {
                val bytes = capturedBytes
                if (bytes != null) {
                    val result = onEnviarFoto(pedidoId, bytes)
                    cameraState = if (result.isSuccess) CameraState.SUCESSO else {
                        erroMsg = result.exceptionOrNull()?.message ?: "Erro desconhecido"
                        CameraState.ERRO
                    }
                } else {
                    erroMsg = "Imagem não disponível"
                    cameraState = CameraState.ERRO
                }
            }
            Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Color(0xFFF7A51C))
                    Spacer(Modifier.height(16.dp))
                    Text("Enviando foto...", color = Color.White)
                }
            }
        }

        CameraState.SUCESSO -> {
            Box(Modifier.fillMaxSize().background(Color(0xFF111827)), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("✓", color = Color(0xFF22C55E), style = MaterialTheme.typography.displayLarge)
                    Text("Foto enviada com sucesso!", color = Color.White,
                        style = MaterialTheme.typography.titleMedium)
                    Text("O sistema de caixa já recebeu a imagem.",
                        color = Color.Gray, style = MaterialTheme.typography.bodyMedium)
                    Button(
                        onClick = onVoltarEspera,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF7A51C))
                    ) { Text("Voltar à tela de espera", color = Color.Black) }
                }
            }
        }

        CameraState.ERRO -> {
            Box(Modifier.fillMaxSize().background(Color(0xFF111827)), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.padding(24.dp)) {
                    Text("Ocorreu um erro", color = Color(0xFFEF4444),
                        style = MaterialTheme.typography.titleMedium)
                    Text(erroMsg, color = Color.Gray, style = MaterialTheme.typography.bodySmall)
                    Button(
                        onClick = { cameraState = CameraState.PREVIEW },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF7A51C))
                    ) { Text("Tentar novamente", color = Color.Black) }
                }
            }
        }
    }
}
