package br.com.aracaresto.meucaixa.data

import br.com.aracaresto.meucaixa.BuildConfig
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.storage.storage
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class PedidoFoto(
    val id: String,
    val fechamento_id: String,
    val terminal: String,
    val status: String,
    val foto_url: String? = null,
    val foto_storage_path: String? = null
)

class PedidoFotoRepository {

    private val sb = SupabaseClientProvider.client
    private val terminal = BuildConfig.TERMINAL_ID

    // Busca pedidos aguardando foto para este terminal
    suspend fun buscarPedidosPendentes(): List<PedidoFoto> {
        return sb.from("caixa_pedidos_foto")
            .select {
                filter {
                    eq("status", "aguardando")
                    eq("terminal", terminal)
                }
            }
            .decodeList<PedidoFoto>()
    }

    // Envia foto para o Storage e marca pedido como recebido
    suspend fun enviarFoto(pedidoId: String, imageBytes: ByteArray): String {
        val storagePath = "pedidos/$pedidoId.jpg"

        // Upload para o bucket
        sb.storage.from("relatorios-caixa").upload(storagePath, imageBytes) {
            upsert = true
        }

        // URL pública
        val publicUrl = sb.storage.from("relatorios-caixa").publicUrl(storagePath)

        // Atualiza pedido
        sb.from("caixa_pedidos_foto").update({
            set("status", "foto_recebida")
            set("foto_storage_path", storagePath)
            set("foto_url", publicUrl)
            set("atualizado_em", java.time.Instant.now().toString())
        }) {
            filter { eq("id", pedidoId) }
        }

        return publicUrl
    }

    // Cancela pedido em caso de erro
    suspend fun marcarErro(pedidoId: String) {
        sb.from("caixa_pedidos_foto").update({
            set("status", "erro")
        }) {
            filter { eq("id", pedidoId) }
        }
    }
}
