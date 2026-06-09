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
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import br.com.aracaresto.meucaixa.data.PedidoFoto
import br.com.aracaresto.meucaixa.data.PedidoFotoRepository
import br.com.aracaresto.meucaixa.ui.CameraScreen
import kotlinx.coroutines.delay

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
        var erroPolling by remember { mutableStateOf<String?>(null) }
        var tentativas by remember { mutableStateOf(0) }

        LaunchedEffect(isPolling) {
            while (isPolling) {
                if (pedidoPendente == null) {
                    try {
                        val pedidos = repository.buscarPedidosPendentes()
                        erroPolling = null
                        tentativas++
                        if (pedidos.isNotEmpty()) {
                            pedidoPendente = pedidos.first()
                        }
                    } catch (e: Exception) {
                        erroPolling = e.message ?: e.javaClass.simpleName
                        tentativas++
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
                    try {
                        Result.success(repository.enviarFoto(id, bytes))
                    } catch (e: Exception) {
                        Result.failure(e)
                    }
                },
                onVoltarEspera = {
                    pedidoPendente = null
                }
            )
        } else {
            Box(
                Modifier.fillMaxSize().background(Color(0xFF08090D)),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    modifier = Modifier.padding(32.dp)
                ) {
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

                    Text("Meu Caixa",
                        style = MaterialTheme.typography.titleLarge,
                        color = Color.White)

                    Text("Araçá Grill",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.Gray)

                    Spacer(Modifier.height(16.dp))

                    if (erroPolling != null) {
                        // Erro visível: ajuda a diagnosticar problemas de conexão
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text("⚠ Erro de conexão",
                                color = Color(0xFFF87171),
                                style = MaterialTheme.typography.bodyMedium)
                            Text(erroPolling ?: "",
                                color = Color(0xFF9CA3AF),
                                style = MaterialTheme.typography.bodySmall,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                            Text("Verifique a internet e aguarde...",
                                color = Color(0xFF6B7280),
                                style = MaterialTheme.typography.bodySmall,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        }
                    } else {
                        CircularProgressIndicator(
                            color = Color(0xFFF7A51C),
                            modifier = Modifier.size(32.dp))

                        Text("Aguardando pedido de foto...",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF9CA3AF))

                        Text("Quando o caixa precisar da foto da maquininha,\nesta tela ficará ativa automaticamente.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF6B7280),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }

                    // Status discreto de conexão no rodapé
                    if (tentativas > 0) {
                        Text(
                            if (erroPolling == null) "✓ Conectado ao Supabase (verificação #$tentativas)"
                            else "✗ Falha #$tentativas",
                            color = if (erroPolling == null) Color(0xFF374151) else Color(0xFF7F1D1D),
                            fontSize = 10.sp
                        )
                    }
                }
            }
        }
    }
}
