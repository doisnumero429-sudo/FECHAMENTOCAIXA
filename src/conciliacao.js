// Motor de conciliação de caixa — funções puras, sem acesso ao DOM.
// Detecta diferenças por forma de pagamento, classifica por tolerância e
// procura compensações entre modalidades (erro de classificação).

import { state, DEFAULT_TOLERANCIAS } from './state.js'
import { money } from './ui.js'

export const STATUS = {
  sem_diferenca:    { label: 'Sem diferença',            nivel: 'ok'   },
  tolerada:         { label: 'Dentro da tolerância',     nivel: 'ok'   },
  troca_modalidade: { label: 'Provável troca de forma',  nivel: 'warn' },
  digitacao:        { label: 'Erro de digitação',        nivel: 'warn' },
  justificada:      { label: 'Justificada',              nivel: 'warn' },
  pendente:         { label: 'Pendente de conferência',  nivel: 'warn' },
  critica:          { label: 'Diferença crítica',        nivel: 'bad'  }
}

// Tolerância configurada para uma forma. Cai no padrão por forma (0,50) se ausente.
export function tolDe(formaId) {
  const list = state.tolerancias?.length ? state.tolerancias : DEFAULT_TOLERANCIAS
  const t = list.find(x => x.forma_id === formaId)
  if (t && t.valor != null) return Number(t.valor)
  const padrao = list.find(x => x.forma_id === '_geral')
  return padrao && padrao.valor != null ? Number(padrao.valor) : 0.5
}

export function acaoDe(formaId) {
  const list = state.tolerancias?.length ? state.tolerancias : DEFAULT_TOLERANCIAS
  const t = list.find(x => x.forma_id === formaId)
  return t?.acao || 'aceitar'
}

// Classifica uma diferença individual em relação à tolerância da forma.
//   diff ~ 0           → 'zero'
//   |diff| <= tol      → 'tolerada'
//   |diff| > tol       → 'fora'
export function classificarDiff(diff, formaId) {
  const ad = Math.abs(diff)
  if (ad < 0.005) return 'zero'
  return ad <= tolDe(formaId) ? 'tolerada' : 'fora'
}

function nivelConfianca(residuo, menorAbs) {
  if (residuo <= 0.10) return 'alta'         // centavos: quase certo
  if (residuo <= 2.00) return 'media'        // valores próximos
  if (residuo <= menorAbs * 0.15) return 'baixa'  // parecidos, com sobra parcial
  return null
}

// Motor de compensação: procura pares de formas cujas diferenças se anulam.
// Entrada: [{ id, label, diff }]  (diff = valor do agente − valor informado)
// Saída: pares ordenados por confiança (alta → baixa) e valor (desc).
export function detectarCompensacoes(diffs, opts = {}) {
  const minValor = opts.minValor ?? 1
  const candidatos = diffs
    .filter(d => Math.abs(d.diff) >= minValor)
    .slice()
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

  const usados = new Set()
  const pares = []

  for (let i = 0; i < candidatos.length; i++) {
    if (usados.has(candidatos[i].id)) continue
    for (let j = i + 1; j < candidatos.length; j++) {
      if (usados.has(candidatos[j].id)) continue
      const a = candidatos[i], b = candidatos[j]
      // Sinais opostos: um sobra, o outro falta.
      if (Math.sign(a.diff) === Math.sign(b.diff)) continue
      const residuo = Math.abs(a.diff + b.diff)
      const menorAbs = Math.min(Math.abs(a.diff), Math.abs(b.diff))
      const confianca = nivelConfianca(residuo, menorAbs)
      if (!confianca) continue
      // pos = forma onde o agente tem mais (informado a menos);
      // neg = forma onde o agente tem menos (informado a mais).
      const pos = a.diff > 0 ? a : b
      const neg = a.diff > 0 ? b : a
      pares.push({ pos, neg, residuo, confianca, valor: menorAbs })
      usados.add(a.id); usados.add(b.id)
      break
    }
  }

  const ordem = { alta: 0, media: 1, baixa: 2 }
  return pares.sort((x, y) => ordem[x.confianca] - ordem[y.confianca] || y.valor - x.valor)
}

const CONF_LABEL = { alta: 'Alta confiança', media: 'Média confiança', baixa: 'Baixa confiança' }

// Texto explicativo (contexto de restaurante) para um par de compensação.
export function narrativaCompensacao(par) {
  const { pos, neg, valor, residuo, confianca } = par
  const resto = residuo >= 0.005
    ? ` Sobra uma diferença de ${money(residuo)} que não fecha — confira se há mais de um lançamento envolvido.`
    : ' Os valores se anulam exatamente.'
  return {
    nivel: confianca === 'baixa' ? 'warn' : 'warn',
    emoji: '🔄',
    titulo: `Possível troca entre ${neg.label} e ${pos.label} — ${CONF_LABEL[confianca]}`,
    texto: `Você informou cerca de ${money(valor)} a mais em <b>${neg.label}</b> e a menos em <b>${pos.label}</b>. ` +
      `Isso costuma acontecer quando uma venda é fechada no TOTVS na forma errada (ex.: passou no ${pos.label} mas foi lançada como ${neg.label}). ` +
      `Não altera o total do caixa, mas entra errado nos relatórios.${resto}`
  }
}

// Sugere um status automático para a conciliação (antes da ação do operador).
export function sugerirStatus({ totalDiff, comp, compensacoes }) {
  const todasTolerada = comp.every(c => classificarDiff(c.diff, c.id) !== 'fora')
  // Só é "sem diferença" se o total fecha E cada forma está dentro da tolerância.
  // (Uma troca perfeita soma zero no total, mas as formas individuais estão fora.)
  if (todasTolerada && Math.abs(totalDiff) < 0.005) return 'sem_diferenca'
  if (todasTolerada && Math.abs(totalDiff) <= tolDe('_geral')) return 'tolerada'
  // Compensação de alta/média confiança que explica a diferença.
  const forte = compensacoes.find(p => p.confianca === 'alta' || p.confianca === 'media')
  if (forte) return 'troca_modalidade'
  return 'pendente'
}
