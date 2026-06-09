package br.com.aracaresto.meucaixa

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import br.com.aracaresto.meucaixa.data.PedidoFoto
import br.com.aracaresto.meucaixa.data.PedidoFotoRepository
import br.com.aracaresto.meucaixa.ui.CameraScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val repository = PedidoFotoRepository()

    private val requestPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* permissão tratada pelo estado */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) {
            requestPermission.launch(Manifest.permission.CAMERA)
        }

        setContent {
            MeuCaixaApp()
        }
    }

    @Composable
    fun MeuCaixaApp() {
        var pedidoPendente by remember { mutableStateOf<PedidoFoto?>(null) }
        var isPolling by remember { mutableStateOf(true) }
        val scope = rememberCoroutineScope()

        // Polling: busca pedidos a cada 5 segundos
        LaunchedEffect(isPolling) {
            while (isPolling) {
                if (pedidoPendente == null) {
                    try {
                        val pedidos = repository.buscarPedidosPendentes()
                        if (pedidos.isNotEmpty()) {
                            pedidoPendente = pedidos.first()
                        }
                    } catch (e: Exception) {
                        // Rede instável — tentar novamente
                    }
                }
                delay(5000)
            }
        }

        val pedido = pedidoPendente

        if (pedido != null) {
            CameraScreen(
                pedidoId = pedido.id,
                onEnviarFoto = { id, bytes ->
                    runCatching { repository.enviarFoto(id, bytes) }
                },
                onVoltarEspera = {
                    pedidoPendente = null
                }
            )
        } else {
            // Tela de espera
            Box(
                Modifier.fillMaxSize().background(Color(0xFF08090D)),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    modifier = Modifier.padding(32.dp)
                ) {
                    // Logo AG
                    Box(
                        Modifier.size(80.dp).background(
                            Color(0xFFF7A51C),
                            shape = MaterialTheme.shapes.large
                        ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("AG", style = MaterialTheme.typography.headlineLarge,
                            color = Color(0xFF111827))
                    }

                    Text(
                        "Meu Caixa",
                        style = MaterialTheme.typography.titleLarge,
                        color = Color.White
                    )

                    Text(
                        "Araçá Grill",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.Gray
                    )

                    Spacer(Modifier.height(24.dp))

                    CircularProgressIndicator(
                        color = Color(0xFFF7A51C),
                        modifier = Modifier.size(32.dp)
                    )

                    Text(
                        "Aguardando pedido de foto...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFF9CA3AF)
                    )

                    Text(
                        "Quando o caixa precisar da foto da maquininha,\nesta tela ficará ativa automaticamente.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF6B7280),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                }
            }
        }
    }
}
