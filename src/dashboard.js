// Dashboard inteligente — lê dados reais do Supabase e mostra a visão financeira
// do período. Reaproveita o design do app (.summary, .table, .chip).
import { money, esc } from './ui.js'
import { loadDashboardData } from './supabase.js'
import { STATUS } from './conciliacao.js'
import { CATALOGO_PRODUTOS } from './catalogo-produtos.js'

let dashData = null
let dashView = 'geral'
let dashIni = ''
let dashFim = ''
let dashLoading = false

const VIEWS = [
  ['geral',     '📊 Visão geral'],
  ['formas',    '💳 Formas'],
  ['totvs',     '🏦 Conciliação'],
  ['produtos',  '🍽️ Produtos'],
  ['cancel',    '❌ Cancelamentos'],
  ['sangrias',  '💸 Sangrias'],
  ['concil',    '⚖️ Status'],
  ['insights',  '💡 Insights']
]

const CLASS_LABEL = {
  indevido: 'Indevido',
  erro_lancamento: 'Erro de lançamento',
  qualidade: 'Qualidade',
  cliente_desistiu: 'Cliente desistiu',
  outro: 'Outro',
  sem_classificacao: 'Sem classificação'
}

const SANG_LABEL = {
  musico: '🎵 Músico / Banda',
  extra: '💵 Extra / Freelancer',
  vale: '🪙 Vale (adiantamento)',
  cofre: '🏦 Cofre (dono)',
  outro: '📦 Outro'
}

const FORMA_LABEL = {
  credito: 'Crédito', debito: 'Débito', pix: 'PIX', voucher: 'Voucher',
  assinadas: 'Assinadas', ifood: 'iFood', dinheiro: 'Dinheiro', outras: 'Outras'
}

const statusColor = (nivel) =>
  ({ ok: { c: '#065f46', bg: '#d1fae5' }, warn: { c: '#92400e', bg: '#fef3c7' }, bad: { c: '#991b1b', bg: '#fee2e2' } }[nivel] || { c: '#374151', bg: '#f3f4f6' })

// Primeiro e último dia do mês corrente, em ISO (YYYY-MM-DD).
function defaultRange() {
  const d = new Date()
  const ini = new Date(d.getFullYear(), d.getMonth(), 1)
  const fim = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const iso = (x) => x.toISOString().slice(0, 10)
  return [iso(ini), iso(fim)]
}

function fmtDia(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}`
}

function num(v) { return Number(v || 0) }

// ─── Agregação ───────────────────────────────────────────────────────────────
function aggregate(data) {
  const resumo = data?.resumo || []
  const nfce = data?.nfce || []
  const cancelamentos = data?.cancelamentos || []
  const sangrias = data?.sangrias || []

  // Faturamento por dia (eletrônico + dinheiro lançado no TOTVS)
  const porDia = {}
  const addDia = (dia) => (porDia[dia] = porDia[dia] || { dia, faturamento: 0, dinheiro: 0, eletronico: 0, gorjeta: 0, cancel: 0, sangrias: 0 })

  const formas = { credito: 0, debito: 0, pix: 0, voucher: 0, assinadas: 0, ifood: 0, dinheiro: 0, outras: 0 }
  let totalFat = 0, totalElet = 0, totalDinheiro = 0, totalCancelVal = 0, totalCancelQtd = 0
  let nFechamentos = 0
  const sangPorTipo = { musico: 0, extra: 0, vale: 0, cofre: 0, outro: 0 }
  let totalSangrias = 0
  const concilCount = {}

  for (const r of resumo) {
    nFechamentos++
    const d = addDia(r.data_turno)
    const elet = num(r.total_eletronico)
    const dinheiro = num(r.dinheiro_totvs)
    d.eletronico += elet
    d.dinheiro += dinheiro
    d.faturamento += elet + dinheiro
    d.cancel += num(r.cancelamentos_valor)
    d.sangrias += num(r.sangrias_total)
    totalElet += elet
    totalDinheiro += dinheiro
    totalFat += elet + dinheiro
    formas.credito += num(r.credito)
    formas.debito += num(r.debito)
    formas.pix += num(r.pix)
    formas.voucher += num(r.voucher)
    formas.assinadas += num(r.assinadas)
    formas.ifood += num(r.ifood)
    formas.outras += num(r.outras_formas)
    formas.dinheiro += dinheiro
    sangPorTipo.musico += num(r.sangrias_musico)
    sangPorTipo.extra += num(r.sangrias_extra)
    sangPorTipo.vale += num(r.sangrias_vale)
    sangPorTipo.cofre += num(r.sangrias_cofre)
    sangPorTipo.outro += num(r.sangrias_outro)
    totalSangrias += num(r.sangrias_total)
    const st = r.conciliacao_status || 'sem_diferenca'
    concilCount[st] = (concilCount[st] || 0) + 1
  }

  // Gorjeta vem dos eventos NFC-e (não está no resumo)
  let totalGorjeta = 0
  for (const e of nfce) {
    totalGorjeta += num(e.gorjeta)
    const d = addDia(e.data_turno)
    d.gorjeta += num(e.gorjeta)
  }

  // Cancelamentos por classificação (usa motivo_editado/classificacao quando houver)
  const cancelPorClasse = {}
  for (const c of cancelamentos) {
    totalCancelVal += num(c.valor)
    totalCancelQtd++
    const cl = c.classificacao || 'sem_classificacao'
    if (!cancelPorClasse[cl]) cancelPorClasse[cl] = { valor: 0, qtd: 0 }
    cancelPorClasse[cl].valor += num(c.valor)
    cancelPorClasse[cl].qtd++
  }

  const dias = Object.values(porDia).sort((a, b) => a.dia.localeCompare(b.dia))

  // Fita de fechamento (TOTVS) — conciliação oficial, pessoas e produtos
  const fitas = data?.fitas || []
  let totalPessoas = 0, totalTransacoes = 0, totalComissoes = 0, totalCortesias = 0, totalDescontos = 0
  const concilPorForma = {}   // forma → { bordero, caixa, diff }
  const categorias = {}       // cat.nome → { qtd, valor, recCatalogo }
  const produtosRec = {}      // produto → { qtd, receita, preco, grupo }

  for (const f of fitas) {
    totalPessoas += num(f.numero_pessoas)
    totalTransacoes += num(f.qtde_transacoes_pos)
    totalComissoes += num(f.comissoes_total)
    totalCortesias += num(f.cortesias_total)
    totalDescontos += num(f.descontos_total)
    for (const c of (f.conciliacao || [])) {
      const k = c.forma || '—'
      if (!concilPorForma[k]) concilPorForma[k] = { bordero: 0, caixa: 0, diff: 0 }
      concilPorForma[k].bordero += num(c.bordero)
      concilPorForma[k].caixa += num(c.caixa)
      concilPorForma[k].diff += num(c.diff)
    }
    const pv = f.produtos_vendidos || {}
    for (const cat of (pv.categorias || [])) {
      const catNome = cat.nome || '—'
      if (!categorias[catNome]) categorias[catNome] = { qtd: 0, valor: 0, recCatalogo: 0 }
      categorias[catNome].qtd += num(cat.subtotal_qtde)
      categorias[catNome].valor += num(cat.subtotal_valor)
      for (const it of (cat.itens || [])) {
        const nome = it.produto
        const qtd = num(it.qtde)
        const entry = CATALOGO_PRODUTOS[nome]
        const preco = entry?.p || 0
        const receita = preco > 0 ? qtd * preco : 0
        const grupo = entry?.g || catNome
        if (!produtosRec[nome]) produtosRec[nome] = { qtd: 0, receita: 0, preco, grupo }
        produtosRec[nome].qtd += qtd
        produtosRec[nome].receita += receita
        categorias[catNome].recCatalogo += receita
      }
    }
  }
  const ticketPessoa = totalPessoas > 0 ? a_div(totalFat, totalPessoas) : 0
  const ticketTransacao = totalTransacoes > 0 ? a_div(totalFat, totalTransacoes) : 0

  return {
    dias, formas, sangPorTipo, cancelPorClasse, concilCount,
    totalFat, totalElet, totalDinheiro, totalGorjeta,
    totalCancelVal, totalCancelQtd, totalSangrias, nFechamentos,
    cancelamentos, sangrias,
    fitas, totalPessoas, totalTransacoes, totalComissoes, totalCortesias, totalDescontos,
    concilPorForma, categorias, produtosRec, ticketPessoa, ticketTransacao
  }
}

function a_div(a, b) { return b ? a / b : 0 }

// ─── Gráfico de barras (canvas, vanilla) ─────────────────────────────────────
function drawBars(canvasId, labels, vals, color) {
  const cv = document.getElementById(canvasId)
  if (!cv) return
  const W = cv.parentElement.clientWidth || 600
  const H = cv.height
  cv.width = W
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  if (!labels.length) {
    ctx.fillStyle = '#9099a6'; ctx.font = '13px Inter'; ctx.textAlign = 'center'
    ctx.fillText('Sem dados no período', W / 2, H / 2)
    return
  }
  const pl = 56, pr = 14, pt = 18, pb = 30
  const gW = W - pl - pr, gH = H - pt - pb
  let mx = 0
  for (const v of vals) if (v > mx) mx = v
  mx = mx * 1.15 || 1
  const bW = Math.max(14, (gW / labels.length) * 0.6)
  ctx.strokeStyle = '#eceff6'; ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const v = mx * i / 4, y = pt + gH - gH * i / 4
    ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + gW, y); ctx.stroke()
    ctx.fillStyle = '#9099a6'; ctx.font = '10px Inter'; ctx.textAlign = 'right'
    ctx.fillText(v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0), pl - 5, y + 3)
  }
  for (let i = 0; i < labels.length; i++) {
    const x = pl + (i + 0.5) * gW / labels.length
    const bH = gH * vals[i] / mx
    const bX = x - bW / 2, bY = pt + gH - bH
    const grad = ctx.createLinearGradient(0, bY, 0, pt + gH)
    grad.addColorStop(0, color); grad.addColorStop(1, color + 'aa')
    ctx.fillStyle = grad
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(bX, bY, bW, bH, [4, 4, 0, 0]); else ctx.rect(bX, bY, bW, bH)
    ctx.fill()
    const vs = vals[i] >= 1000 ? (vals[i] / 1000).toFixed(1) + 'k' : vals[i].toFixed(0)
    ctx.fillStyle = '#4b5563'; ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center'
    if (bH > 16) ctx.fillText(vs, x, bY + 12); else if (vals[i] > 0) ctx.fillText(vs, x, bY - 4)
    ctx.fillStyle = '#9099a6'; ctx.font = '10px Inter'
    if (labels.length <= 31) ctx.fillText(labels[i], x, pt + gH + 13)
  }
}

// Barra horizontal proporcional (forma de pagamento, classificação, etc.)
function barRow(label, valor, max, color) {
  const pct = max > 0 ? (valor / max) * 100 : 0
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <div style="width:130px;font-size:12.5px;color:#4b5563;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</div>
    <div style="flex:1;background:#eef1f6;border-radius:6px;height:9px;overflow:hidden">
      <div style="height:9px;border-radius:6px;width:${pct.toFixed(1)}%;background:${color}"></div>
    </div>
    <div style="width:104px;text-align:right;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0">${money(valor)}</div>
  </div>`
}

function kpi(label, valor, cor, sub) {
  return `<div class="summary">
    <small>${esc(label)}</small>
    <strong style="${cor ? `color:${cor}` : ''}">${valor}</strong>
    ${sub ? `<div style="margin-top:4px;font-size:11px;color:#9099a6;font-weight:600">${esc(sub)}</div>` : ''}
  </div>`
}

// ─── Views ───────────────────────────────────────────────────────────────────
function viewGeral(a) {
  const melhorDia = a.dias.slice().sort((x, y) => y.faturamento - x.faturamento)[0]
  const ticketCards = a.fitas.length
    ? [
        kpi('Ticket / pessoa', money(a.ticketPessoa), 'var(--blue)', `${a.totalPessoas} pessoa(s)`),
        kpi('Ticket / transação POS', money(a.ticketTransacao), 'var(--text)', `${a.totalTransacoes} transação(ões)`)
      ].join('')
    : ''
  const cards = [
    kpi('Faturamento', money(a.totalFat), 'var(--blue)', `${a.nFechamentos} fechamento(s)`),
    kpi('Gorjeta (serviço)', money(a.totalGorjeta), 'var(--ok)'),
    kpi('Cancelamentos', money(a.totalCancelVal), 'var(--bad)', `${a.totalCancelQtd} item(ns)`),
    kpi('Sangrias', money(a.totalSangrias), '#7c3aed'),
    kpi('Dinheiro (gaveta)', money(a.totalDinheiro), 'var(--text)'),
    kpi('Eletrônico', money(a.totalElet), 'var(--text)'),
    kpi('Melhor dia', melhorDia ? fmtDia(melhorDia.dia) : '—', 'var(--blue)', melhorDia ? money(melhorDia.faturamento) : '')
  ].join('')

  const consolidado = a.dias.length
    ? `<div class="table" style="margin-top:14px"><table>
        <thead><tr><th>Dia</th><th class="num">Faturamento</th><th class="num">Eletrônico</th><th class="num">Dinheiro</th><th class="num">Gorjeta</th><th class="num">Cancel.</th><th class="num">Sangrias</th></tr></thead>
        <tbody>${a.dias.map(d => `<tr>
          <td><b>${fmtDia(d.dia)}</b></td>
          <td class="num">${money(d.faturamento)}</td>
          <td class="num">${money(d.eletronico)}</td>
          <td class="num">${money(d.dinheiro)}</td>
          <td class="num" style="color:var(--ok)">${money(d.gorjeta)}</td>
          <td class="num" style="color:var(--bad)">${money(d.cancel)}</td>
          <td class="num" style="color:#7c3aed">${money(d.sangrias)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr style="font-weight:800;background:#f5f7fb">
          <td>TOTAL</td>
          <td class="num">${money(a.totalFat)}</td>
          <td class="num">${money(a.totalElet)}</td>
          <td class="num">${money(a.totalDinheiro)}</td>
          <td class="num" style="color:var(--ok)">${money(a.totalGorjeta)}</td>
          <td class="num" style="color:var(--bad)">${money(a.totalCancelVal)}</td>
          <td class="num" style="color:#7c3aed">${money(a.totalSangrias)}</td>
        </tr></tfoot>
      </table></div>`
    : `<div class="alert blue" style="margin-top:14px">Nenhum fechamento salvo neste período.</div>`

  return `<div class="grid g3">${cards}${ticketCards}</div>
    <div class="dash-sec"><h4>Faturamento por dia</h4><canvas id="dashCvFat" height="190"></canvas></div>
    ${consolidado}`
}

function viewFormas(a) {
  const entries = Object.entries(a.formas).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1])
  const max = entries.length ? entries[0][1] : 0
  const total = entries.reduce((s, [, v]) => s + v, 0)
  if (!entries.length) return `<div class="alert blue">Sem formas de pagamento no período.</div>`
  const bars = entries.map(([k, v]) =>
    barRow(`${FORMA_LABEL[k] || k} · ${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%`, v, max,
      k === 'dinheiro' ? '#16a34a' : k === 'pix' ? '#0891b2' : 'var(--blue)')).join('')
  return `<div class="dash-sec"><h4>Faturamento por forma de pagamento — ${money(total)}</h4>${bars}</div>`
}

function viewCancel(a) {
  const entries = Object.entries(a.cancelPorClasse).sort((x, y) => y[1].valor - x[1].valor)
  const max = entries.length ? entries[0][1].valor : 0
  const total = a.totalCancelVal
  const bars = entries.length
    ? entries.map(([k, o]) =>
        barRow(`${CLASS_LABEL[k] || k} (${o.qtd})`, o.valor, max, 'var(--bad)')).join('')
    : '<div class="alert blue">Nenhum cancelamento no período.</div>'

  // Lista detalhada (até 200 linhas — restaurante pequeno)
  const rows = (a.cancelamentos || []).slice(0, 200).map(c => {
    const motivo = c.motivo_editado || c.motivo || '—'
    const cl = c.classificacao ? `<span class="chip">${esc(CLASS_LABEL[c.classificacao] || c.classificacao)}</span>` : '<span style="color:#bbb">—</span>'
    return `<tr>
      <td>${esc(fmtDia(c.data_turno))}</td>
      <td>${esc(c.produto || '—')}</td>
      <td class="num">${money(c.valor)}</td>
      <td style="font-size:12px;color:#555">${esc(motivo)}</td>
      <td>${cl}</td>
      <td style="font-size:12px">${esc(c.operador || '—')}</td>
    </tr>`
  }).join('')

  return `<div class="dash-sec"><h4>Cancelamentos por classificação — ${money(total)}</h4>${bars}</div>
    <div class="table" style="margin-top:14px"><table>
      <thead><tr><th>Dia</th><th>Produto</th><th class="num">Valor</th><th>Motivo</th><th>Classificação</th><th>Operador</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#bbb;padding:18px">Nenhum registro</td></tr>'}</tbody>
    </table></div>`
}

function viewSangrias(a) {
  const entries = Object.entries(a.sangPorTipo).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1])
  const max = entries.length ? entries[0][1] : 0
  const bars = entries.length
    ? entries.map(([k, v]) => barRow(SANG_LABEL[k] || k, v, max, k === 'cofre' ? '#b91c1c' : '#7c3aed')).join('')
    : '<div class="alert blue">Nenhuma sangria no período.</div>'

  const cofre = (a.sangrias || []).filter(s => s.tipo === 'cofre')
  const cofreTotal = cofre.reduce((s, x) => s + num(x.valor), 0)
  const cofreBox = cofre.length
    ? `<div class="dash-sec" style="border-left:3px solid #b91c1c">
        <h4>🏦 Retiradas de cofre — ${money(cofreTotal)}</h4>
        <div class="table"><table>
          <thead><tr><th>Dia</th><th>Motivo</th><th>Operador</th><th class="num">Valor</th></tr></thead>
          <tbody>${cofre.map(s => `<tr>
            <td>${esc(fmtDia(s.data_turno))}</td>
            <td style="font-size:12px">${esc(s.motivo || '—')}</td>
            <td style="font-size:12px">${esc(s.operador || '—')}</td>
            <td class="num" style="color:#b91c1c">${money(s.valor)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`
    : ''

  const rows = (a.sangrias || []).slice(0, 200).map(s => `<tr>
    <td>${esc(fmtDia(s.data_turno))}</td>
    <td><span class="chip">${esc((SANG_LABEL[s.tipo] || s.tipo || 'outro'))}</span></td>
    <td style="font-size:12px;color:#555">${esc(s.motivo || '—')}</td>
    <td style="font-size:12px">${esc(s.operador || '—')}</td>
    <td class="num">${money(s.valor)}</td>
  </tr>`).join('')

  return `<div class="dash-sec"><h4>Sangrias por tipo — ${money(a.totalSangrias)}</h4>${bars}</div>
    ${cofreBox}
    <div class="table" style="margin-top:14px"><table>
      <thead><tr><th>Dia</th><th>Tipo</th><th>Motivo</th><th>Operador</th><th class="num">Valor</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:18px">Nenhum registro</td></tr>'}</tbody>
    </table></div>`
}

function viewConcil(a) {
  const entries = Object.entries(a.concilCount).sort((x, y) => y[1] - x[1])
  if (!entries.length) return `<div class="alert blue">Nenhum fechamento no período.</div>`
  const cards = entries.map(([st, qtd]) => {
    const info = STATUS[st] || { label: st, nivel: 'warn' }
    const cs = statusColor(info.nivel)
    return `<div class="summary">
      <small>${esc(info.label)}</small>
      <strong style="color:${cs.c}">${qtd}</strong>
      <div style="margin-top:6px"><span class="chip" style="color:${cs.c};background:${cs.bg};border-color:transparent">${esc(info.label)}</span></div>
    </div>`
  }).join('')
  const okN = (a.concilCount.sem_diferenca || 0) + (a.concilCount.tolerada || 0) + (a.concilCount.aprovada || 0)
  const pct = a.nFechamentos > 0 ? ((okN / a.nFechamentos) * 100).toFixed(0) : 0
  return `<div class="alert ok" style="margin-bottom:14px">
      <b>${pct}% dos fechamentos sem pendência.</b> ${okN} de ${a.nFechamentos} ficaram sem diferença, dentro da tolerância ou aprovados pelo gerente.
    </div>
    <div class="grid g3">${cards}</div>`
}

function viewTotvs(a) {
  if (!a.fitas.length) {
    return `<div class="alert warn">
      <b>Nenhuma fita TOTVS recebida neste período.</b>
      O agente Windows precisa estar na versão mais recente para enviar o fechamento ao Supabase.
      Após atualizar o agente, os dados aparecem aqui automaticamente.
    </div>`
  }
  const concilEntries = Object.entries(a.concilPorForma).sort((x, y) => Math.abs(y[1].diff) - Math.abs(x[1].diff))
  const totalBordero = concilEntries.reduce((s, [, v]) => s + v.bordero, 0)
  const totalCaixa = concilEntries.reduce((s, [, v]) => s + v.caixa, 0)
  const totalDiff = concilEntries.reduce((s, [, v]) => s + v.diff, 0)
  const concilRows = concilEntries.map(([forma, o]) => {
    const ok = Math.abs(o.diff) < 0.05
    const diffColor = ok ? '#16a34a' : o.diff > 0 ? '#16a34a' : '#dc2626'
    const diffSign = o.diff > 0.005 ? '+' : ''
    return `<tr>
      <td>${esc(forma)}</td>
      <td class="num">${money(o.bordero)}</td>
      <td class="num">${money(o.caixa)}</td>
      <td class="num" style="color:${diffColor};font-weight:700">${diffSign}${money(o.diff)}</td>
    </tr>`
  }).join('')
  const diffColor = Math.abs(totalDiff) < 0.10 ? '#16a34a' : '#dc2626'
  const kpis = [
    kpi('Comissões', money(a.totalComissoes), '#7c3aed', `${a.fitas.length} fita(s)`),
    kpi('Cortesias', money(a.totalCortesias), '#0891b2'),
    kpi('Descontos', money(a.totalDescontos), '#ea580c'),
    kpi('Diferença acumulada', money(Math.abs(totalDiff)), diffColor,
      Math.abs(totalDiff) < 0.10 ? 'Zerado' : totalDiff > 0 ? 'Sobra no borderô' : 'Falta no borderô')
  ].join('')
  return `<div class="grid g3" style="margin-bottom:14px">${kpis}</div>
    <div class="dash-sec">
      <h4>Conciliação TOTVS — Borderô vs Caixa (${a.fitas.length} fita(s))</h4>
      <div class="table"><table>
        <thead><tr><th>Forma</th><th class="num">Borderô (TOTVS)</th><th class="num">Caixa (PWA)</th><th class="num">Diferença</th></tr></thead>
        <tbody>${concilRows || '<tr><td colspan="4" style="text-align:center;color:#bbb;padding:18px">Sem dados</td></tr>'}</tbody>
        <tfoot><tr style="font-weight:800;background:#f5f7fb">
          <td>TOTAL</td>
          <td class="num">${money(totalBordero)}</td>
          <td class="num">${money(totalCaixa)}</td>
          <td class="num" style="color:${diffColor};font-weight:800">${money(totalDiff)}</td>
        </tr></tfoot>
      </table></div>
    </div>`
}

function viewProdutos(a) {
  if (!a.fitas.length) {
    return `<div class="alert warn">
      <b>Nenhuma fita TOTVS recebida neste período.</b>
      Atualize o agente Windows para começar a receber o detalhamento de produtos.
    </div>`
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const prodList = Object.values(a.produtosRec)
  const totalRecCat = prodList.reduce((s, p) => s + p.receita, 0)
  const totalQtdGeral = prodList.reduce((s, p) => s + p.qtd, 0)
  const comPreco = prodList.filter(p => p.preco > 0).length
  const totalProdos = prodList.length
  const coverage = totalProdos > 0 ? ((comPreco / totalProdos) * 100).toFixed(0) : 0
  const ticketItem = totalQtdGeral > 0 ? totalRecCat / totalQtdGeral : 0
  const kpis = [
    kpi('Receita estimada', money(totalRecCat), 'var(--blue)', 'qtde × preço cardápio'),
    kpi('Itens vendidos', totalQtdGeral.toLocaleString('pt-BR'), 'var(--text)'),
    kpi('Ticket / item', money(ticketItem), 'var(--text)'),
    kpi('Cobertura catálogo', `${coverage}%`, Number(coverage) >= 80 ? 'var(--ok)' : '#ea580c',
      `${comPreco} de ${totalProdos} produtos`)
  ].join('')

  // ── Categorias (usa valor TOTVS se disponível, senão estimativa catálogo) ─
  const catColors = ['#2563eb', '#0891b2', '#7c3aed', '#ea580c', '#16a34a', '#db2777', '#d97706', '#be185d']
  const catEntries = Object.entries(a.categorias)
    .map(([nome, o]) => [nome, { ...o, exibir: o.valor > 0 ? o.valor : o.recCatalogo }])
    .filter(([, o]) => o.exibir > 0 || o.qtd > 0)
    .sort((x, y) => y[1].exibir - x[1].exibir)
  const maxCat = catEntries.length ? catEntries[0][1].exibir : 0
  const totalCatValor = catEntries.reduce((s, [, o]) => s + o.exibir, 0)
  const catBars = catEntries.length
    ? catEntries.map(([nome, o], i) => {
        const pct = totalCatValor > 0 ? ((o.exibir / totalCatValor) * 100).toFixed(1) : 0
        const label = `${nome} · ${o.qtd} unid. · ${pct}%`
        return barRow(label, o.exibir, maxCat, catColors[i % catColors.length])
      }).join('')
    : '<div class="alert blue">Sem categorias no período.</div>'

  // ── Top 20 por receita estimada ──────────────────────────────────────────
  const topRec = Object.entries(a.produtosRec)
    .filter(([, p]) => p.receita > 0)
    .sort((x, y) => y[1].receita - x[1].receita)
    .slice(0, 20)
  const maxRec = topRec.length ? topRec[0][1].receita : 0
  const recRows = topRec.map(([nome, p], i) => `<tr>
    <td style="font-size:11px;color:#9099a6;width:24px">${i + 1}</td>
    <td style="font-size:12.5px">${esc(nome)}</td>
    <td style="font-size:11px;color:#9099a6">${esc(p.grupo)}</td>
    <td class="num" style="width:54px;font-weight:700">${p.qtd}</td>
    <td class="num" style="width:80px;color:#6b7280">${money(p.preco)}</td>
    <td class="num" style="width:96px;font-weight:800;color:#2563eb">${money(p.receita)}</td>
    <td style="width:100px;padding-left:8px">
      <div style="height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden">
        <div style="height:6px;border-radius:3px;background:#2563eb;width:${maxRec > 0 ? ((p.receita / maxRec) * 100).toFixed(1) : 0}%"></div>
      </div>
    </td>
  </tr>`).join('')

  // ── Top 20 por quantidade ────────────────────────────────────────────────
  const topQtd = Object.entries(a.produtosRec)
    .sort((x, y) => y[1].qtd - x[1].qtd)
    .slice(0, 20)
  const maxQtd = topQtd.length ? topQtd[0][1].qtd : 0
  const qtdRows = topQtd.map(([nome, p], i) => `<tr>
    <td style="font-size:11px;color:#9099a6;width:24px">${i + 1}</td>
    <td style="font-size:12.5px">${esc(nome)}</td>
    <td class="num" style="font-weight:800;width:64px">${p.qtd}</td>
    <td class="num" style="color:#6b7280;width:90px">${p.receita > 0 ? money(p.receita) : '<span style="color:#d1d5db">—</span>'}</td>
    <td style="width:120px;padding-left:8px">
      <div style="height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden">
        <div style="height:6px;border-radius:3px;background:#0891b2;width:${maxQtd > 0 ? ((p.qtd / maxQtd) * 100).toFixed(1) : 0}%"></div>
      </div>
    </td>
  </tr>`).join('')

  return `
    <div class="grid g3" style="margin-bottom:16px">${kpis}</div>

    <div class="dash-sec">
      <h4>Faturamento por categoria</h4>
      <div class="hint" style="margin-bottom:10px">Fonte: TOTVS (fita de fechamento). Percentual em relação ao total de produtos vendidos.</div>
      ${catBars}
    </div>

    <div class="dash-sec" style="margin-top:14px">
      <h4>Top 20 por receita estimada</h4>
      <div class="hint" style="margin-bottom:8px">Calculado como quantidade × preço de venda do cardápio.</div>
      <div class="table"><table>
        <thead><tr><th>#</th><th>Produto</th><th>Categoria</th><th class="num">Qtde</th><th class="num">Preço unit.</th><th class="num">Receita est.</th><th>Proporção</th></tr></thead>
        <tbody>${recRows || '<tr><td colspan="7" style="text-align:center;color:#bbb;padding:18px">Nenhum produto com preço no catálogo</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="dash-sec" style="margin-top:14px">
      <h4>Top 20 por quantidade vendida</h4>
      <div class="table"><table>
        <thead><tr><th>#</th><th>Produto</th><th class="num">Qtde</th><th class="num">Receita est.</th><th>Proporção</th></tr></thead>
        <tbody>${qtdRows || '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:18px">Nenhum produto</td></tr>'}</tbody>
      </table></div>
    </div>`
}

// ─── Insights automáticos ────────────────────────────────────────────────────
function viewInsights(a) {
  const ins = []
  const pct1 = (v, t) => t > 0 ? ((v / t) * 100).toFixed(1) : '0'

  // Melhor e pior dia
  if (a.dias.length >= 2) {
    const sorted = a.dias.slice().sort((x, y) => y.faturamento - x.faturamento)
    const melhor = sorted[0], pior = sorted[sorted.length - 1]
    ins.push({ nivel: 'ok',
      titulo: `Melhor dia: ${fmtDia(melhor.dia)} — ${money(melhor.faturamento)}`,
      texto: `O pior dia foi ${fmtDia(pior.dia)} com ${money(pior.faturamento)}. Variação de ${pct1(melhor.faturamento - pior.faturamento, melhor.faturamento)}% entre os extremos.` })
  }

  // Ticket por pessoa
  if (a.totalPessoas > 0) {
    const nivel = a.ticketPessoa >= 90 ? 'ok' : a.ticketPessoa >= 60 ? 'blue' : 'warn'
    ins.push({ nivel,
      titulo: `Ticket médio: ${money(a.ticketPessoa)} / pessoa`,
      texto: `${a.totalPessoas} pessoas atendidas, ${money(a.totalFat)} de faturamento total. Transações POS: ${a.totalTransacoes}.` })
  }

  // Forma de pagamento dominante
  const formaTotal = Object.values(a.formas).reduce((s, v) => s + v, 0)
  if (formaTotal > 0) {
    const top2 = Object.entries(a.formas).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 2)
    if (top2.length) {
      const [k1, v1] = top2[0]
      ins.push({ nivel: 'blue',
        titulo: `Forma dominante: ${FORMA_LABEL[k1] || k1} (${pct1(v1, formaTotal)}%)`,
        texto: `${money(v1)} dos ${money(formaTotal)} faturados. ` +
          (top2[1] ? `Segunda maior: ${FORMA_LABEL[top2[1][0]] || top2[1][0]} com ${pct1(top2[1][1], formaTotal)}%.` : '') })
    }
  }

  // Produto mais lucrativo e mais vendido
  const prodRec = Object.entries(a.produtosRec)
  if (prodRec.length > 0) {
    const topR = prodRec.filter(([, p]) => p.receita > 0).sort((x, y) => y[1].receita - x[1].receita)[0]
    const topQ = prodRec.sort((x, y) => y[1].qtd - x[1].qtd)[0]
    if (topR) ins.push({ nivel: 'ok',
      titulo: `Produto mais lucrativo: ${topR[0]}`,
      texto: `${topR[1].qtd} unidades × ${money(topR[1].preco)} = ${money(topR[1].receita)} estimados no período.` })
    if (topQ && topQ[0] !== topR?.[0]) ins.push({ nivel: 'blue',
      titulo: `Produto mais pedido: ${topQ[0]}`,
      texto: `${topQ[1].qtd} unidades vendidas. Receita estimada: ${topQ[1].receita > 0 ? money(topQ[1].receita) : 'não calculada (sem preço no catálogo)'}.` })
  }

  // Bebidas vs comida
  const totalCatValor2 = Object.values(a.categorias).reduce((s, o) => s + (o.valor || o.recCatalogo || 0), 0)
  const bebidas = num(a.categorias['BEBIDAS']?.valor) || num(a.categorias['BEBIDAS']?.recCatalogo)
  if (totalCatValor2 > 0 && bebidas > 0) {
    const pctBeb = parseFloat(pct1(bebidas, totalCatValor2))
    ins.push({ nivel: pctBeb > 55 ? 'warn' : 'blue',
      titulo: `Bebidas: ${pctBeb.toFixed(1)}% das vendas por categoria`,
      texto: `${money(bebidas)} em bebidas de ${money(totalCatValor2)} total. ` +
        (pctBeb > 55 ? 'Participação alta de bebidas — pode refletir eventos com show ou bar movimentado.' :
          pctBeb < 20 ? 'Participação baixa de bebidas — refeição domina o mix.' : 'Mix equilibrado entre bebidas e alimentos.') })
  }

  // Cancelamentos
  if (a.totalCancelQtd > 0) {
    const pctC = parseFloat(pct1(a.totalCancelVal, a.totalFat))
    const topCl = Object.entries(a.cancelPorClasse).sort((x, y) => y[1].valor - x[1].valor)[0]
    ins.push({ nivel: pctC > 5 ? 'bad' : pctC > 2 ? 'warn' : 'ok',
      titulo: `Cancelamentos: ${pctC.toFixed(1)}% do faturamento`,
      texto: `${a.totalCancelQtd} item(ns) · ${money(a.totalCancelVal)}.` +
        (topCl ? ` Principal motivo: ${CLASS_LABEL[topCl[0]] || topCl[0]} (${money(topCl[1].valor)}).` : '') })
  }

  // Sangrias — custos com pessoal x operacional
  const custoPessoal = (a.sangPorTipo.musico || 0) + (a.sangPorTipo.extra || 0) + (a.sangPorTipo.vale || 0)
  if (custoPessoal > 0 && a.totalFat > 0) {
    const pctP = parseFloat(pct1(custoPessoal, a.totalFat))
    ins.push({ nivel: pctP > 15 ? 'warn' : 'blue',
      titulo: `Custo operacional (músicos + extras + vales): ${money(custoPessoal)} (${pctP.toFixed(1)}%)`,
      texto: `Músico/banda: ${money(a.sangPorTipo.musico || 0)} · Extra/freelancer: ${money(a.sangPorTipo.extra || 0)} · Vale: ${money(a.sangPorTipo.vale || 0)}.` })
  }

  // Cortesias
  if (a.totalCortesias > 0 && a.totalFat > 0) {
    const pctCort = parseFloat(pct1(a.totalCortesias, a.totalFat))
    ins.push({ nivel: pctCort > 3 ? 'warn' : 'blue',
      titulo: `Cortesias: ${money(a.totalCortesias)} (${pctCort.toFixed(1)}% do faturamento)`,
      texto: 'Contas ou itens liberados gratuitamente. Verifique se estão autorizados.' })
  }

  // Gorjeta
  if (a.totalGorjeta > 0 && a.totalFat > 0) {
    const pctG = parseFloat(pct1(a.totalGorjeta, a.totalFat))
    ins.push({ nivel: 'ok',
      titulo: `Taxa de serviço (gorjeta): ${money(a.totalGorjeta)} (${pctG.toFixed(1)}%)`,
      texto: 'Cobrada nos cupons fiscais NFC-e. Incluída no faturamento total.' })
  }

  // Qualidade de conciliação
  if (a.nFechamentos > 0) {
    const nOk = (a.concilCount.sem_diferenca || 0) + (a.concilCount.tolerada || 0) + (a.concilCount.aprovada || 0)
    const pctOk = parseFloat(pct1(nOk, a.nFechamentos))
    ins.push({ nivel: pctOk >= 80 ? 'ok' : pctOk >= 60 ? 'warn' : 'bad',
      titulo: `Fechamentos sem pendência: ${pctOk.toFixed(0)}% (${nOk} de ${a.nFechamentos})`,
      texto: `${a.concilCount.pendente || 0} pendente(s) · ${a.concilCount.troca_modalidade || 0} troca de forma · ${a.concilCount.justificada || 0} justificada(s).` })
  }

  if (!ins.length)
    return `<div class="alert blue">Sem dados suficientes para gerar insights neste período. Abra fechamentos para ver análises aqui.</div>`

  const iconColor = { ok: '#16a34a', bad: '#dc2626', warn: '#d97706', blue: '#2563eb' }
  return `<div style="display:grid;gap:10px">
    ${ins.map(i => `<div class="alert ${i.nivel === 'ok' ? 'ok' : i.nivel === 'bad' ? 'bad' : i.nivel === 'blue' ? 'blue' : 'warn'}">
      <b>${esc(i.titulo)}</b><br>
      <span style="font-size:13px;line-height:1.6">${esc(i.texto)}</span>
    </div>`).join('')}
  </div>`
}

// ─── Controles + render ──────────────────────────────────────────────────────
function buildControls() {
  const tabs = VIEWS.map(([id, label]) =>
    `<button class="dash-tab${dashView === id ? ' active' : ''}" onclick="window.__dashboard.setView('${id}')">${label}</button>`
  ).join('')
  return `<div class="dash-controls">
      <div class="dash-dates">
        <div class="field"><label>De</label><input type="date" id="dashIni" value="${dashIni}"></div>
        <div class="field"><label>Até</label><input type="date" id="dashFim" value="${dashFim}"></div>
        <button class="btn light" onclick="window.__dashboard.apply()"><i data-lucide="refresh-cw"></i> Aplicar</button>
      </div>
      <div class="dash-tabs">${tabs}</div>
    </div>`
}

function renderBody() {
  const body = document.getElementById('dashBody')
  if (!body) return
  if (dashLoading) { body.innerHTML = `<div class="alert blue"><b>Carregando dados do período…</b></div>`; return }
  if (!dashData) { body.innerHTML = `<div class="alert warn"><b>Nuvem indisponível.</b> Não foi possível carregar os dados.</div>`; return }
  const a = aggregate(dashData)
  const views = { geral: viewGeral, formas: viewFormas, totvs: viewTotvs, produtos: viewProdutos, cancel: viewCancel, sangrias: viewSangrias, concil: viewConcil, insights: viewInsights }
  body.innerHTML = (views[dashView] || viewGeral)(a)
  if (dashView === 'geral') {
    requestAnimationFrame(() =>
      drawBars('dashCvFat', a.dias.map(d => fmtDia(d.dia)), a.dias.map(d => d.faturamento), '#2563eb'))
  }
  requestAnimationFrame(() => window.__refreshIcons?.())
}

export async function renderDashboard(force) {
  const host = document.getElementById('dashHost')
  if (!host) return
  if (!dashIni || !dashFim) { const [i, f] = defaultRange(); dashIni = i; dashFim = f }
  host.innerHTML = buildControls() + `<div id="dashBody"></div>`
  requestAnimationFrame(() => window.__refreshIcons?.())
  if (!dashData || force) {
    dashLoading = true
    renderBody()
    dashData = await loadDashboardData(dashIni, dashFim)
    dashLoading = false
  }
  renderBody()
}

export function setDashView(v) {
  dashView = v
  document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active'))
  renderBody()
  document.querySelectorAll('.dash-tab').forEach(b => {
    if (b.getAttribute('onclick')?.includes(`'${v}'`)) b.classList.add('active')
  })
}

export async function applyDashRange() {
  const i = document.getElementById('dashIni')?.value
  const f = document.getElementById('dashFim')?.value
  if (i) dashIni = i
  if (f) dashFim = f
  await renderDashboard(true)
}

// Recalcula o gráfico quando a janela muda de tamanho.
export function dashboardResize() {
  if (document.getElementById('dashCvFat') && dashData && dashView === 'geral') {
    const a = aggregate(dashData)
    drawBars('dashCvFat', a.dias.map(d => fmtDia(d.dia)), a.dias.map(d => d.faturamento), '#2563eb')
  }
}
