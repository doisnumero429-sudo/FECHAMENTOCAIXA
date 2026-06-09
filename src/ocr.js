import { state, activeForms } from './state.js'
import { toast, parseMoney, norm } from './ui.js'

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

export async function attemptOcr(dataUrl) {
  const T = await loadTesseract()
  if (!T) {
    state.current.ocrStatus = 'erro'
    toast('OCR não carregou. Verifique a conexão.')
    return
  }
  try {
    toast('Tentando ler OCR da foto...')
    const res = await T.recognize(dataUrl, 'por')
    state.current.ocrText = res?.data?.text || ''
    const ok = applyOcrText(state.current.ocrText)
    state.current.ocrStatus = ok ? 'ok' : 'erro'
    toast(ok ? 'OCR preencheu valores possíveis. Confira.' : 'OCR não encontrou valores claros.')
  } catch (e) {
    state.current.ocrStatus = 'erro'
    toast('Falha no OCR. Preencha manualmente.')
  }
}

export function retryOcr() {
  if (!state.current.fotoPreview) return toast('Envie uma foto primeiro.')
  state.current.ocrStatus = 'lendo'
  const { render } = window.__appRender || {}
  render && render()
  setTimeout(() => attemptOcr(state.current.fotoPreview).then(() => render && render()), 50)
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
