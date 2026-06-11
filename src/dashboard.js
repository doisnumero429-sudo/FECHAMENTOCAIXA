// Painel do Caixa — Araçá Grill
// Lê os dados ao vivo do Supabase (caixa_fechamento_fita + caixa_cancelamentos),
// agrega no cliente por semana (segunda→domingo) ou período personalizado, enriquece
// os produtos com o catálogo de preços e abre os lançamentos em drill-downs bonitos.
//
// Princípios:
//  - Dia do caixa = ABERTURA (o movimento da madrugada pertence ao dia que abriu).
//  - Dedup por (caixa, fechamento): o TOTVS reimprime a mesma fita várias vezes.
//  - Ignora o caixa do garçom (TERMINAL 01 / REDUZIDO / caixa 3, sem entradas).
//  - Sangrias categorizadas: VALE, EXTRA (freelancer), MÚSICO, DESPESA, COFRE, OUTRO.
//  - Todos os valores no padrão R$ (real brasileiro).

import { money, esc } from './ui.js'
import { loadDashboardData } from './supabase.js'
import { CATALOGO_PRODUTOS } from './catalogo-produtos.js'

let dashData = null
let dashLoading = false
let dashView = 'geral'
let dashFiltro = { ini: null, fim: null, weekKey: 'todo' }
let dashDrillKey = null

const VIEWS = [
  ['geral', '📊 Visão geral'],
  ['produtos', '🍽️ Produtos'],
  ['sangrias', '💸 Sangrias & comissão'],
  ['cancel', '❌ Cancelamentos'],
  ['turno', '📅 Por turno']
]

const SANG = {
  vale: { lbl: 'Vale (adiantamento)', ico: '🪙', cor: '#2563eb' },
  extra: { lbl: 'Extra (freelancer)', ico: '💵', cor: '#16a34a' },
  musico: { lbl: 'Músico / Banda', ico: '🎵', cor: '#7c3aed' },
  despesa: { lbl: 'Despesa', ico: '🧾', cor: '#d97706' },
  cofre: { lbl: 'Cofre (retirada do dono)', ico: '🏦', cor: '#dc2626' },
  outro: { lbl: 'Outro', ico: '📦', cor: '#64748b' }
}

const num = v => Number(v) || 0

// ─── Normalização e catálogo ─────────────────────────────────────────────────
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()

const CAT_NORM = (() => {
  const m = {}
  for (const [nome, v] of Object.entries(CATALOGO_PRODUTOS)) m[fold(nome)] = v
  return m
})()
const CAT_KEYS = Object.keys(CAT_NORM)

function precoProduto(nome) {
  const f = fold(nome)
  if (CAT_NORM[f]) return CAT_NORM[f].p || 0
  // A TOTVS trunca nomes longos → casa por prefixo
  let cands = CAT_KEYS.filter(k => k.startsWith(f))
  if (cands.length) return Math.min(...cands.map(k => CAT_NORM[k].p || 0))
  cands = CAT_KEYS.filter(k => f.startsWith(k))
  if (cands.length) return CAT_NORM[cands.sort((a, b) => b.length - a.length)[0]].p || 0
  return 0
}

const MUSICO_RE = /MUSIC[OA]|M.{0,3}SIC[OA]|BANDA|CANTOR|ARTISTA|SHOW AO VIVO|VOZ E VIOLAO|\bDJ\b/
const DESPESA_RE = /COMPRA|MERCAD|MATERIAL|FICHA|BRINQUEDO|\bGAS\b|GELO|CARV[AO]|PADARIA|ACOUGUE|FEIRA|HORTI|BANANA|VERDUR|LEGUME|FRUTA|MANUTEN|CONSERTO|DESPESA|LIMPEZA|DESCART|EMBALAGEM/

function classificaSangria(motivo) {
  const f = fold(motivo)
  if (MUSICO_RE.test(f)) return 'musico'
  if (/^VALE\b/.test(f)) return 'vale'
  if (/^EXTRA\b/.test(f)) return 'extra'
  if (/COFRE|RETIRADA CAIXA|DONO|SOCIO|PROPRIETARIO/.test(f)) return 'cofre'
  if (DESPESA_RE.test(f)) return 'despesa'
  return 'outro'
}

// remove mojibake de encoding (cp850 lido errado) e normaliza espaços
function limpa(s) {
  return String(s || '').replace(/[ÃÂ][\x80-\xBF|,]?/g, '').replace(/[^\x20-\x7EÀ-ÿ]/g, '').replace(/\s+/g, ' ').trim()
}

// ─── Datas / semanas (segunda → domingo) ─────────────────────────────────────
function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function diaMovimento(fita) {
  // data_turno já é o dia do movimento (abertura, com regra das 6h) calculado pelo agente
  if (fita.data_turno) return String(fita.data_turno).slice(0, 10)
  const ab = fita.abertura_dt || fita.fechamento_dt
  if (ab) {
    const d = new Date(ab)
    if (d.getHours() < 6) d.setDate(d.getDate() - 1) // madrugada conta p/ dia anterior
    return isoOf(d)
  }
  return ''
}
function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00')
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return d
}
const fmtDM = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
const brDate = iso => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}` }

function construirSemanas(datas) {
  const map = {}
  datas.filter(Boolean).forEach(iso => {
    const mon = mondayOf(iso)
    const dom = new Date(mon); dom.setDate(dom.getDate() + 6)
    map[isoOf(mon)] = { key: isoOf(mon), ini: isoOf(mon), fim: isoOf(dom), label: fmtDM(mon) + '–' + fmtDM(dom) }
  })
  return Object.values(map).sort((a, b) => a.ini < b.ini ? 1 : -1)
}

// ─── Preparação dos fechamentos (dedup + filtro do garçom) ───────────────────
function fitasValidas(data) {
  const fitas = (data?.fitas || [])
  const vistos = {}
  for (const f of fitas) {
    const opAb = fold(f.operador_abertura)
    const prods = f.produtos_vendidos?.categorias?.length || 0
    if (opAb.startsWith('TERMINAL') || f.caixa_numero === 3) continue
    if ((Number(f.entradas_total) || 0) === 0 && prods === 0) continue
    const chave = `${f.caixa_numero}#${f.fech_numero}#${diaMovimento(f)}`
    if (!vistos[chave] || prods > (vistos[chave].produtos_vendidos?.categorias?.length || 0)) vistos[chave] = f
  }
  return Object.values(vistos).map(f => ({ ...f, _dia: diaMovimento(f) }))
}

function cancelDia(c) {
  if (c.data_turno) return String(c.data_turno).slice(0, 10)
  if (c.data_hora) { const d = new Date(c.data_hora); if (d.getHours() < 6) d.setDate(d.getDate() - 1); return isoOf(d) }
  return ''
}

const inRange = (iso, filtro) => (!filtro.ini || iso >= filtro.ini) && (!filtro.fim || iso <= filtro.fim)

// ─── Agregação dinâmica conforme o filtro ────────────────────────────────────
function agregar(data, filtro) {
  const fitas = fitasValidas(data).filter(f => inRange(f._dia, filtro))
  const cancel = (data?.cancelamentos || [])
    .map(c => ({ ...c, _dia: cancelDia(c) }))
    .filter(c => inRange(c._dia, filtro))
    .sort((a, b) => (a.data_hora || '') < (b.data_hora || '') ? -1 : 1)

  const t = { faturamento: 0, credito: 0, debito: 0, pix: 0, dinheiro: 0, comissoes: 0, cortesias: 0, assinadas: 0, descontos: 0, sangrias: 0, diferenca: 0, pessoas: 0, transacoes: 0 }
  const st = {}; Object.keys(SANG).forEach(k => st[k] = 0)
  const sangItens = [], cortItens = [], turnos = [], dias = {}
  const prodMap = {}, grpMap = {}

  for (const f of fitas) {
    const cred = num(f.bordero_credito) || num(f.entradas_credito)
    const deb = num(f.bordero_debito) || num(f.entradas_debito)
    const pix = num(f.bordero_pix) || num(f.entradas_pix)
    const din = num(f.entradas_dinheiro)
    const fat = cred + deb + pix + din
    t.faturamento += fat; t.credito += cred; t.debito += deb; t.pix += pix; t.dinheiro += din
    t.comissoes += num(f.comissoes_total); t.cortesias += num(f.cortesias_total); t.assinadas += num(f.assinadas_total)
    t.descontos += num(f.descontos_total); t.sangrias += num(f.sangrias_total); t.diferenca += num(f.diferenca_total)
    t.pessoas += num(f.numero_pessoas); t.transacoes += num(f.qtde_transacoes_pos)

    const dia = f._dia
    dias[dia] = dias[dia] || { fat: 0, com: 0 }
    dias[dia].fat += fat; dias[dia].com += num(f.comissoes_total)

    for (const s of (f.sangrias || [])) {
      const desc = limpa(s.descricao || s.nome)
      const tipo = classificaSangria(s.descricao || s.nome)
      st[tipo] += num(s.valor)
      sangItens.push({ dia, tipo, desc, valor: num(s.valor) })
    }
    for (const c of (f.cortesias || [])) {
      cortItens.push({ dia, nome: limpa(c.nome), desc: limpa(c.descricao), valor: num(c.valor) })
    }
    for (const cat of (f.produtos_vendidos?.categorias || [])) {
      for (const it of (cat.itens || [])) {
        const valor = (it.qtde || 0) * precoProduto(it.produto)
        const k = it.produto
        ;(prodMap[k] = prodMap[k] || { nome: it.produto, grupo: cat.nome, qtde: 0, valor: 0 })
        prodMap[k].qtde += (it.qtde || 0); prodMap[k].valor += valor
        ;(grpMap[cat.nome] = grpMap[cat.nome] || { nome: cat.nome, qtde: 0, valor: 0 })
        grpMap[cat.nome].qtde += (it.qtde || 0); grpMap[cat.nome].valor += valor
      }
    }
    turnos.push({
      dia, data_br: brDate(dia), operador: f.operador_fechamento || f.operador_abertura || '—',
      faturamento: fat, comissoes: num(f.comissoes_total), sangrias: num(f.sangrias_total),
      pessoas: num(f.numero_pessoas), ticket: f.numero_pessoas ? fat / f.numero_pessoas : 0, diferenca: num(f.diferenca_total)
    })
  }
  turnos.sort((a, b) => a.dia < b.dia ? -1 : 1)
  return {
    t, st, sangItens, cortItens, turnos, cancel,
    dias: Object.keys(dias).sort().map(d => ({ dia: d, data_br: brDate(d), ...dias[d] })),
    prod: Object.values(prodMap), grp: Object.values(grpMap)
  }
}

// ─── Componentes visuais ─────────────────────────────────────────────────────
function kpi(lbl, val, cls, sub, key) {
  return `<button class="adash-kpi${key ? ' click' : ''}${dashDrillKey === key ? ' sel' : ''}"
    ${key ? `onclick="window.__dashboard.drill('${key}')"` : 'disabled'}>
    <span class="k-lbl">${esc(lbl)}</span>
    <span class="k-val ${cls || ''}">${val}</span>
    ${sub ? `<span class="k-sub">${esc(sub)}</span>` : ''}
    ${key ? '<span class="k-go">ver detalhes ▾</span>' : ''}</button>`
}

function barras(itens, fmt) {
  if (!itens.length) return `<div class="adash-vazio">Sem dados no período</div>`
  const m = Math.max(1, ...itens.map(i => i.valor))
  return `<div class="adash-bars">` + itens.map(i => `
    <div class="b-row"><div class="b-name" title="${esc(i.nome)}">${esc(i.nome)}</div>
      <div class="b-track"><div class="b-fill" style="width:${Math.max(2, 100 * i.valor / m)}%;background:${i.cor || 'var(--brand)'}"></div></div>
      <div class="b-val">${(fmt || money)(i.valor)}</div></div>`).join('') + `</div>`
}

function tabela(cols, rows, vazio) {
  if (!rows.length) return `<div class="adash-vazio">${esc(vazio || 'Sem registros')}</div>`
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.t)}</th>`).join('')
  const body = rows.map(r => '<tr>' + r.map((c, i) =>
    `<td class="${cols[i].num ? 'num' : ''}">${c}</td>`).join('') + '</tr>').join('')
  return `<div class="adash-tablewrap"><table class="adash-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function section(title, inner, extra) {
  return `<div class="adash-sec"><h4>${title}${extra ? `<span class="sec-extra">${extra}</span>` : ''}</h4>${inner}</div>`
}

// ─── Views ───────────────────────────────────────────────────────────────────
function viewGeral(a) {
  const t = a.t
  const ticket = t.pessoas ? t.faturamento / t.pessoas : 0
  const totCancel = a.cancel.reduce((s, c) => s + num(c.valor), 0)
  const nCat = Object.keys(SANG).filter(k => a.st[k] > 0).length
  const kpis = `<div class="adash-kpis">` +
    kpi('Faturamento', money(t.faturamento), 'green') +
    kpi('Comissão (garçons)', money(t.comissoes), 'gold', '', 'comissao') +
    kpi('Sangrias', money(t.sangrias), 'red', nCat + ' categorias', 'sangrias') +
    kpi('Cancelamentos', money(totCancel), 'red', a.cancel.length + ' lançamentos', 'cancel') +
    kpi('Cortesias', money(t.cortesias), 'purple', '', 'cortesias') +
    kpi('Nº de pessoas', t.pessoas, 'blue') +
    kpi('Ticket médio', money(ticket)) +
    kpi('Diferença de caixa', money(t.diferenca), t.diferenca < 0 ? 'red' : 'green') +
    `</div>`

  const formas = [
    { nome: '💳 Crédito', valor: t.credito, cor: '#2563eb' },
    { nome: '💳 Débito', valor: t.debito, cor: '#7c3aed' },
    { nome: '📱 PIX', valor: t.pix, cor: '#16a34a' },
    { nome: '💵 Dinheiro', valor: t.dinheiro, cor: '#d97706' }
  ].filter(f => f.valor > 0)

  const resumo = tabela(
    [{ t: 'Item' }, { t: 'Valor', num: true }],
    [
      ['Cartão de crédito', money(t.credito)], ['Cartão de débito', money(t.debito)],
      ['PIX', money(t.pix)], ['Dinheiro', money(t.dinheiro)],
      ['<b>Faturamento total</b>', `<b>${money(t.faturamento)}</b>`],
      ['Comissão (gorjeta)', money(t.comissoes)], ['Descontos concedidos', money(t.descontos)],
      ['Cortesias', money(t.cortesias)], ['Contas assinadas', money(t.assinadas)],
      ['Transações na maquininha', String(t.transacoes)]
    ]
  )

  return kpis + drillPanel(a) + `<div class="adash-grid2">
      ${section('Faturamento por forma', barras(formas))}
      ${section('Faturamento por dia', barras(a.dias.map(d => ({ nome: d.data_br, valor: d.fat, cor: 'var(--ok)' }))))}
    </div>` + section('Resumo financeiro consolidado', resumo)
}

function viewProdutos(a) {
  const prod = a.prod.slice().sort((x, y) => y.valor - x.valor)
  const qT = prod.reduce((s, p) => s + p.qtde, 0)
  const vT = prod.reduce((s, p) => s + p.valor, 0)
  const campeao = prod.slice().sort((x, y) => y.qtde - x.qtde)[0] || { nome: '—', qtde: 0 }
  const kpis = `<div class="adash-kpis">` +
    kpi('Itens vendidos', qT, 'blue') +
    kpi('Faturamento em produtos', money(vT), 'green') +
    kpi('Produtos distintos', prod.length) +
    kpi('Campeão de vendas', campeao.nome, 'gold', campeao.qtde + ' un') + `</div>`
  const top = prod.slice(0, 12).map(p => ({ nome: p.nome, valor: p.valor }))
  const grp = a.grp.slice().sort((x, y) => y.valor - x.valor).map(g => ({ nome: g.nome, valor: g.valor, cor: '#ea580c' }))
  const tbl = tabela([{ t: 'Produto' }, { t: 'Grupo' }, { t: 'Qtde', num: true }, { t: 'R$ total', num: true }],
    prod.map(p => [esc(p.nome), esc(p.grupo), String(p.qtde), money(p.valor)]), 'Sem produtos no período')
  return kpis + `<div class="adash-grid2">
      ${section('🏆 Top 12 por faturamento', barras(top))}
      ${section('Faturamento por grupo', barras(grp))}
    </div>` +
    section('Todos os produtos', `<input class="adash-busca" id="adashBusca" placeholder="🔎 Buscar produto..."
      oninput="window.__dashboard.filtraProd(this.value)">${tbl}`)
}

function viewSangrias(a) {
  const ativos = Object.keys(SANG).filter(k => a.st[k] > 0)
  const kpis = `<div class="adash-kpis">` + (ativos.length
    ? ativos.map(k => kpi(`${SANG[k].ico} ${SANG[k].lbl}`, money(a.st[k]), '', '', 'sang:' + k)).join('')
    : kpi('Sangrias', money(0))) + `</div>`
  const donut = barras(ativos.map(k => ({ nome: `${SANG[k].ico} ${SANG[k].lbl}`, valor: a.st[k], cor: SANG[k].cor })))
  const comis = barras(a.dias.map(d => ({ nome: d.data_br, valor: d.com, cor: '#b8860b' })))
  return kpis + drillPanel(a) + `<div class="adash-grid2">
      ${section('Sangrias por categoria', donut)}
      ${section('Comissão por dia', comis)}
    </div>` + section('Sangrias detalhadas (por data)', listaSangrias(a.sangItens))
}

function viewCancel(a) {
  const tot = a.cancel.reduce((s, c) => s + num(c.valor), 0)
  const kpis = `<div class="adash-kpis">` +
    kpi('Total cancelado', money(tot), 'red') +
    kpi('Qtde de cancelamentos', a.cancel.length) +
    kpi('Cancelamento médio', money(a.cancel.length ? tot / a.cancel.length : 0)) + `</div>`
  return kpis + section('Lançamentos de cancelamento (por data)', listaCancel(a.cancel))
}

function viewTurno(a) {
  const rows = a.turnos.map(x => [
    x.data_br, esc(x.operador), money(x.faturamento), money(x.comissoes), money(x.sangrias),
    String(x.pessoas), money(x.ticket),
    `<span style="color:${x.diferenca < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(x.diferenca)}</span>`
  ])
  return section('Resumo por turno', tabela(
    [{ t: 'Data' }, { t: 'Operador' }, { t: 'Faturamento', num: true }, { t: 'Comissão', num: true },
      { t: 'Sangrias', num: true }, { t: 'Pessoas', num: true }, { t: 'Ticket', num: true }, { t: 'Diferença', num: true }],
    rows, 'Sem turnos no período'))
}

// ─── Drill-down (lançamentos detalhados, bonitos e separados) ────────────────
function drillPanel(a) {
  if (!dashDrillKey) return ''
  let titulo = '', conteudo = ''
  if (dashDrillKey === 'cancel') { titulo = '❌ Cancelamentos'; conteudo = listaCancel(a.cancel) }
  else if (dashDrillKey === 'sangrias') { titulo = '💸 Sangrias'; conteudo = listaSangrias(a.sangItens) }
  else if (dashDrillKey === 'cortesias') { titulo = '🎁 Cortesias'; conteudo = listaCortesias(a.cortItens) }
  else if (dashDrillKey === 'comissao') { titulo = '💰 Comissão por dia'; conteudo = listaComissao(a.dias) }
  else if (dashDrillKey.startsWith('sang:')) {
    const k = dashDrillKey.slice(5)
    titulo = `${SANG[k].ico} ${SANG[k].lbl}`
    conteudo = listaSangrias(a.sangItens.filter(s => s.tipo === k))
  } else return ''
  return `<div class="adash-drill">
    <div class="drill-head"><span>${titulo}</span>
      <button class="drill-x" onclick="window.__dashboard.drill('${dashDrillKey}')">✕ fechar</button></div>
    ${conteudo}</div>`
}

function diaBadge(iso) { return `<span class="ld-date">${brDate(iso)}</span>` }

function listaSangrias(itens) {
  if (!itens.length) return `<div class="adash-vazio">Sem sangrias no período</div>`
  const porTipo = {}
  itens.forEach(s => (porTipo[s.tipo] = porTipo[s.tipo] || []).push(s))
  return Object.keys(SANG).filter(k => porTipo[k]).map(k => {
    const lista = porTipo[k].sort((a, b) => b.valor - a.valor)
    const soma = lista.reduce((s, x) => s + x.valor, 0)
    const rows = lista.map(s => `<div class="ld-row">
      ${diaBadge(s.dia)}<span class="ld-name">${esc(s.desc || '—')}</span>
      <span class="ld-val">${money(s.valor)}</span></div>`).join('')
    return `<div class="ld-group" style="--gc:${SANG[k].cor}">
      <div class="ld-gh"><span>${SANG[k].ico} ${SANG[k].lbl}</span><b>${money(soma)}</b></div>${rows}</div>`
  }).join('')
}

function listaCancel(itens) {
  if (!itens.length) return `<div class="adash-vazio">Sem cancelamentos no período</div>`
  const rows = itens.map(c => `<div class="ld-row cancel">
    <span class="ld-date">${esc((c.data_hora || '').replace('T', ' ').slice(0, 16) || brDate(c._dia))}</span>
    <span class="ld-chip">mesa ${esc(c.mesa || '—')}</span>
    <span class="ld-name"><b>${esc(c.produto || '—')}</b>
      <small>${esc(c.operador || '')}${c.motivo ? ' · ' + esc(limpa(c.motivo)) : ''}</small></span>
    <span class="ld-val red">${money(c.valor)}</span></div>`).join('')
  return `<div class="ld-group" style="--gc:var(--bad)">${rows}</div>`
}

function listaCortesias(itens) {
  if (!itens.length) return `<div class="adash-vazio">Sem cortesias no período</div>`
  const rows = itens.sort((a, b) => b.valor - a.valor).map(c => `<div class="ld-row">
    ${diaBadge(c.dia)}<span class="ld-name">${esc(c.desc || c.nome || 'Cortesia')}</span>
    <span class="ld-val">${money(c.valor)}</span></div>`).join('')
  return `<div class="ld-group" style="--gc:#7c3aed">${rows}</div>`
}

function listaComissao(dias) {
  if (!dias.length) return `<div class="adash-vazio">Sem comissão no período</div>`
  const rows = dias.map(d => `<div class="ld-row">
    ${diaBadge(d.dia)}<span class="ld-name">Comissão dos garçons</span>
    <span class="ld-val gold">${money(d.com)}</span></div>`).join('')
  return `<div class="ld-group" style="--gc:#b8860b">${rows}</div>`
}

// ─── Shell, filtros e render ─────────────────────────────────────────────────
function buildControls(data, filtro, view) {
  const datas = [
    ...fitasValidas(data).map(f => f._dia),
    ...(data?.cancelamentos || []).map(cancelDia)
  ]
  const semanas = construirSemanas(datas)
  const pill = (key, label, active) =>
    `<button class="adash-pill${active ? ' active' : ''}" onclick="window.__dashboard.setWeek('${key}')">${label}</button>`
  const pills = pill('todo', 'Todo o período', filtro.weekKey === 'todo') +
    semanas.map(s => pill(s.key, 'Semana ' + s.label, filtro.weekKey === s.key)).join('')
  const tabs = VIEWS.map(([id, lbl]) =>
    `<button class="dash-tab${view === id ? ' active' : ''}" onclick="window.__dashboard.setView('${id}')">${lbl}</button>`).join('')
  return `<div class="adash-filtros">
      <span class="f-lbl">Período</span>
      <div class="adash-pills">${pills}</div>
      <span class="f-sep"></span>
      <label class="f-date">De <input type="date" id="dashIni" value="${filtro.ini || ''}"></label>
      <label class="f-date">Até <input type="date" id="dashFim" value="${filtro.fim || ''}"></label>
      <button class="adash-pill" onclick="window.__dashboard.apply()">Aplicar</button>
    </div>
    <div class="dash-tabs adash-tabs">${tabs}</div>`
}

function renderBody() {
  const body = document.getElementById('dashBody')
  if (!body) return
  if (dashLoading) { body.innerHTML = `<div class="alert blue"><b>Carregando dados…</b></div>`; return }
  if (!dashData) { body.innerHTML = `<div class="alert warn"><b>Nuvem indisponível.</b> Não foi possível carregar os dados.</div>`; return }
  body.innerHTML = renderViewHTML(dashData, dashFiltro, dashView)
}

// Renderização pura (sem DOM) — usada pela tela e por testes/prévia
function renderViewHTML(data, filtro, view) {
  const a = agregar(data, filtro)
  const views = { geral: viewGeral, produtos: viewProdutos, sangrias: viewSangrias, cancel: viewCancel, turno: viewTurno }
  return (views[view] || viewGeral)(a)
}

export function renderToString(data, opts = {}) {
  dashView = opts.view || 'geral'
  dashFiltro = opts.filtro || { ini: null, fim: null, weekKey: 'todo' }
  dashDrillKey = opts.drill || null
  return buildControls(data, dashFiltro, dashView) + `<div id="dashBody">` + renderViewHTML(data, dashFiltro, dashView) + `</div>`
}

export async function renderDashboard(force = false) {
  const host = document.getElementById('dashHost')
  if (!host) return
  host.classList.add('araca-dash')
  if (force || !dashData) {
    dashLoading = true
    host.innerHTML = buildControls() + `<div id="dashBody"></div>`
    renderBody()
    // janela ampla: traz tudo p/ montar as semanas; o filtro é aplicado no cliente
    const hoje = new Date(); const ini = new Date(); ini.setDate(ini.getDate() - 400)
    try { dashData = await loadDashboardData(isoOf(ini), isoOf(new Date(hoje.getTime() + 864e5))) } catch (e) { dashData = null }
    dashLoading = false
  }
  host.innerHTML = buildControls() + `<div id="dashBody"></div>`
  renderBody()
}

export function setDashView(v) {
  dashView = v
  renderBody()
  document.querySelectorAll('.adash-tabs .dash-tab').forEach(b =>
    b.classList.toggle('active', b.textContent.includes((VIEWS.find(x => x[0] === v) || [])[1]?.slice(2) || '')))
}

export function setDashWeek(key) {
  if (key === 'todo') dashFiltro = { ini: null, fim: null, weekKey: 'todo' }
  else {
    const datas = [...fitasValidas(dashData).map(f => f._dia), ...(dashData?.cancelamentos || []).map(cancelDia)]
    const s = construirSemanas(datas).find(x => x.key === key)
    if (s) dashFiltro = { ini: s.ini, fim: s.fim, weekKey: key }
  }
  renderDashboard(false)
}

export function applyDashRange() {
  const i = document.getElementById('dashIni')?.value || null
  const f = document.getElementById('dashFim')?.value || null
  dashFiltro = { ini: i, fim: f, weekKey: 'custom' }
  renderDashboard(false)
}

export function dashDrill(key) {
  dashDrillKey = (dashDrillKey === key) ? null : key
  renderBody()
}

export function filtraProd(q) {
  const termo = String(q || '').toLowerCase()
  const a = agregar(dashData, dashFiltro)
  const prod = a.prod.slice().sort((x, y) => y.valor - x.valor).filter(p => p.nome.toLowerCase().includes(termo))
  const wrap = document.querySelector('#dashBody .adash-sec:last-child .adash-tablewrap')
  const novo = tabela([{ t: 'Produto' }, { t: 'Grupo' }, { t: 'Qtde', num: true }, { t: 'R$ total', num: true }],
    prod.map(p => [esc(p.nome), esc(p.grupo), String(p.qtde), money(p.valor)]), 'Nenhum produto')
  if (wrap) wrap.outerHTML = novo
}

export function dashboardResize() { /* sem canvas: layout é responsivo via CSS */ }
