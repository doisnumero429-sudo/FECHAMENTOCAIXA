import { state, activeForms } from './state.js'
import { toast, parseMoney, norm } from './ui.js'
import { analyzePhotoWithAI, aiConfigured, getLearnedAssociations, saveLearnedAssociation } from './ai-ocr.js'

let Tesseract = null

async function loadTesseract() {
  if (Tesseract) return Tesseract
  try {
    const mod = await import('tesseract.js')
    Tesseract = mod.default || mod
    return Tesseract
  } catch (e) {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fluxo principal de OCR — cascata completa:
//   1. IA (Gemini → Mistral → OpenRouter)  ← se alguma chave estiver configurada
//   2. Tesseract.js local                  ← fallback gratuito sempre disponível
// ─────────────────────────────────────────────────────────────────────────────
export async function attemptOcr(dataUrl) {
  // Etapa 1 — IA em cascata
  if (aiConfigured()) {
    try {
      toast('Analisando foto com IA...')
      const ai = await analyzePhotoWithAI(dataUrl)
      if (ai) {
        const ok = applyAiResult(ai.result)
        state.current.ocrStatus = ok ? 'ok' : 'parcial'
        state.current.ocrText = `[${ai.provider}] ${JSON.stringify(ai.result)}`
        toast(ok
          ? `${ai.provider} leu os valores. Confirme cada um.`
          : `${ai.provider} respondeu, mas não encontrou valores. Verifique a foto.`)
        const { render } = window.__appRender || {}
        render && render()
        return
      }
      toast('IA não encontrou valores — usando Tesseract como fallback...')
    } catch (e) {
      console.warn('[OCR] Cascata IA falhou:', e)
    }
  }

  // Etapa 2 — Tesseract.js (fallback local)
  const T = await loadTesseract()
  if (!T) {
    state.current.ocrStatus = 'erro'
    toast('OCR não carregou. Verifique a conexão.')
    return
  }
  try {
    toast('Lendo foto com Tesseract (OCR local)...')
    const res = await T.recognize(dataUrl, 'por')
    state.current.ocrText = res?.data?.text || ''
    const ok = applyOcrText(state.current.ocrText)
    state.current.ocrStatus = ok ? 'ok' : 'erro'
    toast(ok ? 'OCR preencheu valores possíveis. Confira.' : 'OCR não encontrou valores claros.')
  } catch (e) {
    state.current.ocrStatus = 'erro'
    toast('Falha no OCR. Preencha manualmente.')
  }
  const { render } = window.__appRender || {}
  render && render()
}

// Aplica resultado da IA (objeto JSON) às formas de pagamento ativas
export function applyAiResult(obj) {
  let any = false

  // Primeira passagem: comparar chaves do JSON contra id/nome/aliases de cada forma
  activeForms().forEach(f => {
    const keys = [f.id, f.nome, ...(f.aliases || [])].map(norm)
    Object.entries(obj).forEach(([k, v]) => {
      if (norm(k) === 'total' || norm(k) === '_incerto') return
      const val = typeof v === 'number' ? v : parseMoney(String(v))
      if (keys.includes(norm(k)) && val > 0) {
        const p = state.current.pagamentos.find(x => x.formId === f.id)
        if (p) {
          p.iaValue = val
          p.confirmedValue = val
          p.confirmed = false
          p.edited = false
          any = true
        }
      }
    })
  })

  // Segunda passagem: associações aprendidas via localStorage
  const learned = getLearnedAssociations()
  Object.entries(obj).forEach(([k, v]) => {
    if (norm(k) === 'total' || norm(k) === '_incerto') return
    const formId = learned[norm(k)]
    if (!formId) return
    const val = typeof v === 'number' ? v : parseMoney(String(v))
    if (val <= 0) return
    const p = state.current.pagamentos.find(x => x.formId === formId)
    if (p && Number(p.iaValue || 0) === 0) {
      p.iaValue = val
      p.confirmedValue = val
      p.confirmed = false
      p.edited = false
      any = true
    }
  })

  // Armazenar itens incertos para exibição na UI
  state.current.ocrIncerto = (obj._incerto || []).filter(x => x.valor > 0)

  return any
}

export function retryOcr() {
  if (!state.current.fotoPreview) return toast('Envie uma foto primeiro.')
  state.current.ocrStatus = 'lendo'
  const { render } = window.__appRender || {}
  render && render()
  setTimeout(() => attemptOcr(state.current.fotoPreview), 50)
}

export function candidates(line) {
  return (line.match(/(?:R\$\s*)?\d{1,3}(?:[.\s]\d{3})*,\d{2}|(?:R\$\s*)?\d+,\d{2}/g) || [])
    .map(parseMoney)
    .filter(x => x > 0)
}

export function applyOcrText(text) {
  const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)
  let any = false
  activeForms().forEach(f => {
    if (!f.ia) return
    const aliases = [f.id, f.nome, ...(f.aliases || [])].map(norm)
    let found = 0
    for (let i = 0; i < lines.length; i++) {
      if (!aliases.some(a => a && norm(lines[i]).includes(a))) continue
      const arr = [...candidates(lines[i]), ...(lines[i + 1] ? candidates(lines[i + 1]) : [])]
      if (arr.length) { found = arr[arr.length - 1]; break }
    }
    if (found > 0) {
      const p = state.current.pagamentos.find(x => x.formId === f.id)
      if (p) { p.iaValue = found; p.confirmedValue = found; p.confirmed = false; p.edited = false; any = true }
    }
  })
  return any
}

export function applyJson(jsonStr) {
  let data
  try { data = JSON.parse(jsonStr) } catch (e) { return toast('JSON inválido.') }
  activeForms().forEach(f => {
    const keys = [f.id, f.nome, ...(f.aliases || [])].map(norm)
    Object.entries(data).forEach(([k, v]) => {
      if (keys.includes(norm(k))) {
        const p = state.current.pagamentos.find(x => x.formId === f.id)
        if (p) { p.iaValue = parseMoney(v); p.confirmedValue = p.iaValue; p.confirmed = false; p.edited = false }
      }
    })
  })
  toast('Valores aplicados. Confirme um por um.')
  const { render } = window.__appRender || {}
  render && render()
}
