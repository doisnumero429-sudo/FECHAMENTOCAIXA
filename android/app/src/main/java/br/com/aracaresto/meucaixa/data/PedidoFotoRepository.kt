package br.com.aracaresto.meucaixa.data

import br.com.aracaresto.meucaixa.BuildConfig
import io.github.jan.supabase.postgrest.from
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

    suspend fun enviarFoto(pedidoId: String, imageBytes: ByteArray): String {
        val storagePath = "pedidos/$pedidoId.jpg"

        sb.storage.from("relatorios-caixa").upload(storagePath, imageBytes)

        val publicUrl = sb.storage.from("relatorios-caixa").publicUrl(storagePath)

        sb.from("caixa_pedidos_foto").update(
            buildJsonObject {
                put("status", "foto_recebida")
                put("foto_storage_path", storagePath)
                put("foto_url", publicUrl)
            }
        ) {
            filter { eq("id", pedidoId) }
        }

        return publicUrl
    }

    suspend fun marcarErro(pedidoId: String) {
        sb.from("caixa_pedidos_foto").update(
            buildJsonObject { put("status", "erro") }
        ) {
            filter { eq("id", pedidoId) }
        }
    }
}
