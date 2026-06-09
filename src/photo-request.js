// Sistema de pedido de foto: PWA cria pedido → Android tira foto → PWA recebe
import { state, uid } from './state.js'
import { createPedidoFoto, pollPedidoFoto, cancelPedidoFoto } from './supabase.js'
import { attemptOcr } from './ocr.js'
import { toast, parseMoney } from './ui.js'

const POLL_INTERVAL_MS = 3000

export async function startPhotoRequest() {
  // Limpar intervalo anterior se existir
  stopPhotoRequest()

  if (!state.sb) {
    updateRequestUI('offline', 'Nuvem indisponível. Use o envio manual abaixo.')
    return
  }

  const pedidoId = uid('pedido')
  state.currentPedidoId = pedidoId

  try {
    await createPedidoFoto({
      id: pedidoId,
      fechamento_id: state.current.id,
      terminal: state.current.terminal || 'CAIXA'
    })
  } catch (e) {
    updateRequestUI('erro', 'Não consegui criar o pedido de foto. Use o envio manual abaixo.')
    return
  }

  updateRequestUI('aguardando', null)

  state.photoPollInterval = setInterval(async () => {
    try {
      const row = await pollPedidoFoto(pedidoId)
      if (!row) return
      if (row.status === 'foto_recebida') {
        stopPhotoRequest()
        await handlePhotoArrived(row)
      } else if (row.status === 'erro') {
        stopPhotoRequest()
        updateRequestUI('erro', 'O aplicativo Meu Caixa reportou um erro. Use o envio manual abaixo.')
      }
    } catch (e) {
      // silêncio — rede instável, vai tentar novamente
    }
  }, POLL_INTERVAL_MS)
}

export function stopPhotoRequest() {
  if (state.photoPollInterval) {
    clearInterval(state.photoPollInterval)
    state.photoPollInterval = null
  }
}

export async function handleManualAdvance() {
  stopPhotoRequest()
  if (state.currentPedidoId) {
    await cancelPedidoFoto(state.currentPedidoId).catch(() => {})
    state.currentPedidoId = null
  }
  state.current.alertas = state.current.alertas || []
  state.current.alertas.push({
    nivel: 'warn',
    texto: 'Operador avançou sem foto do relatório (app Meu Caixa indisponível ou rede ruim).'
  })
  toast('Continuando sem foto. Alerta registrado.')
  const { next } = window.__appRender || {}
  next && next()
}

export async function handleFallbackUpload(event) {
  const file = event.target?.files?.[0]
  if (!file) return
  stopPhotoRequest()
  if (state.currentPedidoId) {
    await cancelPedidoFoto(state.currentPedidoId).catch(() => {})
    state.currentPedidoId = null
  }

  state.photoFile = file
  state.current.fotoNome = file.name
  state.current.ocrStatus = 'lendo'
  state.current.ocrText = ''

  const reader = new FileReader()
  reader.onload = ev => {
    state.current.fotoPreview = ev.target.result
    updateRequestUI('foto_local', 'Foto carregada do dispositivo. OCR em andamento...')
    const { render } = window.__appRender || {}
    render && render()
    setTimeout(() => {
      attemptOcr(state.current.fotoPreview).then(() => {
        render && render()
      })
    }, 50)
  }
  reader.readAsDataURL(file)
}

async function handlePhotoArrived(row) {
  state.current.fotoUrl = row.foto_url || ''
  state.current.fotoNome = row.foto_url ? row.foto_url.split('/').pop() : 'foto-maquininha.jpg'
  state.currentPedidoId = null

  updateRequestUI('recebida', 'Foto recebida! OCR em andamento...')

  const { render } = window.__appRender || {}

  if (row.foto_url) {
    // Baixar imagem para dataURL para o OCR processar localmente
    try {
      const resp = await fetch(row.foto_url)
      const blob = await resp.blob()
      const reader = new FileReader()
      reader.onload = ev => {
        state.current.fotoPreview = ev.target.result
        state.current.ocrStatus = 'lendo'
        render && render()
        setTimeout(() => {
          attemptOcr(state.current.fotoPreview).then(() => render && render())
        }, 50)
      }
      reader.readAsDataURL(blob)
    } catch (e) {
      state.current.ocrStatus = 'erro'
      render && render()
    }
  } else {
    state.current.ocrStatus = 'erro'
    render && render()
  }
}

function updateRequestUI(status, msg) {
  const box = document.getElementById('photoRequestStatus')
  if (!box) return

  const messages = {
    aguardando: `
      <div class="alert blue photo-request-waiting">
        <div class="photo-request-spinner"></div>
        <div>
          <b>Aguardando foto...</b><br>
          Tire a foto do relatório da maquininha no <b>aplicativo Meu Caixa</b> no celular da empresa.<br>
          <small style="color:#6b7280">Esta tela atualiza automaticamente ao receber a foto.</small>
        </div>
      </div>
      <div style="margin-top:10px;text-align:center">
        <button class="btn light small" onclick="window.__photoRequest.handleManualAdvance()">Continuar sem foto →</button>
      </div>`,
    recebida: `<div class="alert ok"><b>Foto recebida!</b> ${msg || 'OCR em andamento...'}</div>`,
    foto_local: `<div class="alert ok"><b>Foto carregada.</b> ${msg || ''}</div>`,
    offline: `<div class="alert warn"><b>Nuvem indisponível.</b> ${msg || ''}</div>`,
    erro: `<div class="alert bad"><b>Erro:</b> ${msg || 'Tente o envio manual.'}</div>`,
    cancelado: `<div class="alert hint">Pedido cancelado.</div>`
  }

  box.innerHTML = messages[status] || ''
}
