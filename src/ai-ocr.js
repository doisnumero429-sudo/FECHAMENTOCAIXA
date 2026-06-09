import { activeForms } from './state.js'

// ─────────────────────────────────────────────────────────────────────────────
// Aprendizado de associações via localStorage
// ─────────────────────────────────────────────────────────────────────────────
const LEARN_KEY = 'ocr_associations'

export function getLearnedAssociations() {
  try { return JSON.parse(localStorage.getItem(LEARN_KEY) || '{}') } catch { return {} }
}

export function saveLearnedAssociation(texto, formId) {
  const data = getLearnedAssociations()
  data[texto.toLowerCase()] = formId
  localStorage.setItem(LEARN_KEY, JSON.stringify(data))
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt injetado em cada IA.
// Inclui as chaves esperadas dinamicamente, baseadas nas formas cadastradas,
// com nomes e aliases legíveis, e associações já aprendidas via localStorage.
// ─────────────────────────────────────────────────────────────────────────────
function buildPrompt() {
  const forms = activeForms().filter(f => f.ia)
  const formsDesc = forms.map(f => {
    const nomes = [f.nome, ...(f.aliases || [])].filter(Boolean).join(', ')
    return `  "${f.id}": reconhece termos como ${nomes}`
  }).join('\n')
  const learned = getLearnedAssociations()
  const learnedEntries = Object.entries(learned)
  const learnedDesc = learnedEntries.length
    ? `\nAssociações já confirmadas: ${learnedEntries.map(([t, id]) => `"${t}" é "${id}"`).join('; ')}`
    : ''
  const chaves = forms.map(f => `"${f.id}"`).join(', ')
  return `Você é especialista em relatórios de maquininha POS/TEF de restaurantes brasileiros.
Analise a foto do relatório de fechamento de caixa e extraia os VALORES TOTAIS do dia.

Formas de pagamento esperadas:
${formsDesc}
${learnedDesc}

Retorne SOMENTE um JSON com:
- Chaves ${chaves}: valor numérico (0 se não encontrado)
- "total": total geral do relatório
- "_incerto": array [{"texto":"...","valor":0.00}] para itens encontrados mas não categorizáveis com confiança

Exemplo: {"credito":1500.50,"debito":800.00,"pix":200.00,"voucher":0,"total":2500.50,"_incerto":[{"texto":"VISA DEBIT","valor":150.00}]}`
}

function toBase64(dataUrl) {
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
}

function parseJson(text) {
  const clean = (text || '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Sem JSON na resposta')
  return JSON.parse(match[0])
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER 1 — Google Gemini 2.0 Flash (gratuito: 15 req/min, 1500/dia)
// Chave grátis: https://aistudio.google.com/apikey
// ─────────────────────────────────────────────────────────────────────────────
async function gemini(dataUrl) {
  const key = import.meta.env.VITE_GEMINI_API_KEY
  if (!key) return null

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: buildPrompt() },
          { inline_data: { mime_type: 'image/jpeg', data: toBase64(dataUrl) } }
        ]}],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    }
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const d = await res.json()
  if (d.error) throw new Error(d.error.message)
  return parseJson(d.candidates?.[0]?.content?.parts?.[0]?.text)
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER 2 — Mistral Pixtral 12B (gratuito: tier gratuito La Plateforme)
// Chave grátis: https://console.mistral.ai
// ─────────────────────────────────────────────────────────────────────────────
async function mistral(dataUrl) {
  const key = import.meta.env.VITE_MISTRAL_API_KEY
  if (!key) return null

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'pixtral-12b-2409',
      messages: [{ role: 'user', content: [
        { type: 'text', text: buildPrompt() },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]}],
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  })
  if (!res.ok) throw new Error(`Mistral ${res.status}`)
  const d = await res.json()
  if (d.error) throw new Error(d.error.message)
  return parseJson(d.choices?.[0]?.message?.content)
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER 3 — OpenRouter (agrega modelos gratuitos com visão)
// Chave grátis: https://openrouter.ai — conta gratuita
// Tenta até 3 modelos em sequência dentro do OpenRouter
// ─────────────────────────────────────────────────────────────────────────────
const OR_MODELS = [
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.2-11b-vision-instruct:free',
  'qwen/qwen-2-vl-7b-instruct:free'
]

async function openrouter(dataUrl) {
  const key = import.meta.env.VITE_OPENROUTER_API_KEY
  if (!key) return null

  const prompt = buildPrompt()
  for (const model of OR_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'X-Title': 'Fechamento de Caixa — Araçá Grill'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]}],
          temperature: 0
        })
      })
      if (!res.ok) continue
      const d = await res.json()
      const text = d.choices?.[0]?.message?.content
      if (text) return parseJson(text)
    } catch { /* tenta próximo modelo */ }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// CASCADE PRINCIPAL
// Ordem: Gemini → Mistral → OpenRouter → null (aciona Tesseract no chamador)
// Só tenta providers que têm chave configurada.
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzePhotoWithAI(dataUrl) {
  const providers = [
    { nome: 'Gemini 2.0 Flash', fn: () => gemini(dataUrl) },
    { nome: 'Mistral Pixtral',  fn: () => mistral(dataUrl) },
    { nome: 'OpenRouter',       fn: () => openrouter(dataUrl) }
  ]

  for (const { nome, fn } of providers) {
    try {
      const result = await fn()
      if (result && typeof result === 'object' && Object.keys(result).length > 0) {
        console.info(`[IA OCR] ${nome} ✓`, result)
        return { result, provider: nome }
      }
    } catch (e) {
      console.warn(`[IA OCR] ${nome} falhou:`, e.message)
    }
  }
  return null // todos falharam → chamador usa Tesseract
}

export function aiConfigured() {
  return !!(
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.VITE_MISTRAL_API_KEY ||
    import.meta.env.VITE_OPENROUTER_API_KEY
  )
}

export function aiProviderStatus() {
  return [
    { nome: 'Gemini 2.0 Flash', ok: !!import.meta.env.VITE_GEMINI_API_KEY, url: 'https://aistudio.google.com/apikey' },
    { nome: 'Mistral Pixtral',  ok: !!import.meta.env.VITE_MISTRAL_API_KEY, url: 'https://console.mistral.ai' },
    { nome: 'OpenRouter',       ok: !!import.meta.env.VITE_OPENROUTER_API_KEY, url: 'https://openrouter.ai' }
  ]
}
