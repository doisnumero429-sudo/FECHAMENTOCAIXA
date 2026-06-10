import { createClient } from '@supabase/supabase-js'
import { state, activeForms } from './state.js'
import { toast } from './ui.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export function initSupabase() {
  const connEl = document.getElementById('conn')
  try {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      state.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      if (connEl) connEl.innerHTML = '<b>Supabase:</b><br>conectado. Salvamento somente na nuvem.'
    } else {
      state.sb = null
      if (connEl) connEl.innerHTML = '<b>Nuvem indisponível:</b><br>Variáveis de ambiente não configuradas. Nada será salvo localmente.'
    }
  } catch (e) {
    state.sb = null
    if (connEl) connEl.innerHTML = '<b>Nuvem indisponível:</b><br>falha ao conectar. Nada será salvo localmente.'
  }
}

export async function syncFromCloud() {
  if (!state.sb) { toast('Supabase não conectado. Nada será salvo localmente.'); return }
  try {
    const r = await state.sb.from('caixa_formas_pagamento').select('*').order('ordem')
    if (!r.error && r.data?.length) {
      state.forms = r.data.map(x => ({
        id: x.id, nome: x.nome, tipo: x.tipo, ativo: x.ativo, ordem: x.ordem,
        aparece: x.aparece_no_fechamento, ia: x.aceita_ia, origem: x.origem_preferencial,
        aliases: [...(x.aliases_ia || []), ...(x.aliases_totvs || [])]
      }))
    }
  } catch (e) {}
  try {
    const r = await state.sb.from('caixa_operadores').select('*').order('ordem')
    if (!r.error && r.data?.length)
      state.operators = r.data.map(x => ({ id: x.id, nome: x.nome, ativo: x.ativo, ordem: x.ordem }))
  } catch (e) {}
  try {
    const r = await state.sb.from('caixa_turnos').select('*').order('ordem')
    if (!r.error && r.data?.length)
      state.shifts = r.data.map(x => ({ id: x.id, nome: x.nome, ativo: x.ativo, ordem: x.ordem }))
  } catch (e) {}
  try {
    const r = await state.sb.from('caixa_tolerancias').select('*')
    if (!r.error && r.data?.length)
      state.tolerancias = r.data.map(x => ({
        forma_id: x.forma_id, label: x.label, valor: Number(x.valor || 0), acao: x.acao || 'aceitar'
      }))
  } catch (e) {}
}

export async function loadCloudClosures() {
  if (!state.sb) { state.closures = []; return }
  try {
    const r = await state.sb
      .from('caixa_fechamentos')
      .select('*,caixa_fechamento_pagamentos(*)')
      .eq('status', 'fechado')
      .order('criado_em', { ascending: false })
      .limit(100)
    if (!r.error && r.data) {
      state.closures = r.data.map(row => ({
        ...row.payload,
        id: row.id,
        data: row.data_movimento,
        turno: row.turno,
        operador: row.operador,
        terminal: row.terminal,
        abertura: Number(row.abertura_informada || 0),
        aberturaOK: row.abertura_bateu_com_anterior,
        aberturaConfirmada: row.abertura_confirmada_com_divergencia,
        fotoUrl: row.foto_maquininha_url,
        fotoNome: row.foto_maquininha_nome,
        dinheiroContado: Number(row.dinheiro_contado || 0),
        sangriaTroco: Number(row.sangria_troco || 0),
        dinheiroTotvs: Number(row.dinheiro_lancar_totvs || 0),
        trocoFinal: Number(row.troco_final_deixado || 0),
        houveDiferenca: row.houve_diferenca_totvs,
        obsDiferenca: row.observacao_diferenca,
        alertas: row.alertas || [],
        criado_em: row.criado_em,
        status: row.status,
        pagamentos: (row.caixa_fechamento_pagamentos || []).map(p => ({
          formId: p.forma_pagamento_id,
          nome: p.nome_forma,
          iaValue: Number(p.valor_lido_ia || 0),
          confirmedValue: Number(p.valor_confirmado || 0),
          confirmed: p.confirmado,
          edited: p.editado,
          ordem: p.ordem,
          origem: p.origem
        }))
      }))
    }
  } catch (e) {
    toast('Não consegui buscar os caixas na nuvem.')
  }
}

export async function uploadPhoto(file, closureId) {
  if (!state.sb || !file) return ''
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `fechamentos/${closureId}.${ext}`
  const up = await state.sb.storage.from('relatorios-caixa').upload(path, file, { upsert: true })
  if (up.error) throw up.error
  return state.sb.storage.from('relatorios-caixa').getPublicUrl(path).data.publicUrl
}

export async function saveClosure(current, fotoUrl) {
  await state.sb.from('caixa_fechamentos').upsert({
    id: current.id,
    data_movimento: current.data,
    turno: current.turno,
    operador: current.operador,
    terminal: current.terminal,
    status: 'fechado',
    abertura_informada: current.abertura,
    abertura_bateu_com_anterior: current.aberturaOK,
    abertura_confirmada_com_divergencia: current.aberturaConfirmada,
    foto_maquininha_url: fotoUrl || current.fotoUrl || '',
    foto_maquininha_nome: current.fotoNome,
    dinheiro_contado: current.dinheiroContado,
    sangria_troco: current.sangriaTroco,
    dinheiro_lancar_totvs: current.dinheiroTotvs,
    troco_final_deixado: current.trocoFinal,
    houve_diferenca_totvs: current.houveDiferenca,
    observacao_diferenca: current.obsDiferenca,
    alertas: current.alertas,
    payload: current
  })
  await state.sb.from('caixa_fechamento_pagamentos').upsert(
    current.pagamentos.map(p => ({
      id: current.id + '_' + p.formId,
      fechamento_id: current.id,
      forma_pagamento_id: p.formId,
      nome_forma: p.nome,
      valor_lido_ia: p.iaValue || 0,
      valor_confirmado: p.confirmedValue || 0,
      confirmado: p.confirmed,
      editado: p.edited,
      origem: p.origem || 'manual',
      ordem: p.ordem || 999
    }))
  )
}

export async function saveConfigCloud() {
  if (!state.sb) { toast('Não foi salvo: Supabase não conectado.'); return false }
  try {
    await state.sb.from('caixa_formas_pagamento').upsert(state.forms.map(f => ({
      id: f.id, nome: f.nome, tipo: f.tipo, ativo: f.ativo, ordem: f.ordem,
      aparece_no_fechamento: f.aparece, aceita_ia: f.ia, aceita_manual: true, entra_total: true,
      origem_preferencial: f.origem, aliases_ia: f.aliases || [], aliases_totvs: f.aliases || []
    })))
    await state.sb.from('caixa_operadores').upsert(state.operators.map(o => ({ id: o.id, nome: o.nome, ativo: o.ativo, ordem: o.ordem })))
    await state.sb.from('caixa_turnos').upsert(state.shifts.map(t => ({ id: t.id, nome: t.nome, ativo: t.ativo, ordem: t.ordem })))
    // Tolerâncias: não-crítico — se a tabela ainda não existe, não bloqueia o resto.
    try {
      await state.sb.from('caixa_tolerancias').upsert((state.tolerancias || []).map(t => ({
        forma_id: t.forma_id, label: t.label, valor: Number(t.valor || 0), acao: t.acao || 'aceitar'
      })))
    } catch (e) {}
    toast('Configurações salvas na nuvem.')
    return true
  } catch (e) {
    toast('Não consegui salvar as configurações na nuvem. Verifique se o SQL foi rodado.')
    return false
  }
}

// Pedidos de foto (PWA ↔ Android)

export async function createPedidoFoto(data) {
  if (!state.sb) return null
  const row = {
    id: data.id,
    fechamento_id: data.fechamento_id,
    terminal: data.terminal || 'CAIXA',
    status: 'aguardando',
    criado_em: new Date().toISOString()
  }
  const { error } = await state.sb.from('caixa_pedidos_foto').insert(row)
  if (error) throw error
  return row
}

export async function pollPedidoFoto(pedidoId) {
  if (!state.sb) return null
  const { data, error } = await state.sb
    .from('caixa_pedidos_foto')
    .select('*')
    .eq('id', pedidoId)
    .single()
  if (error) return null
  return data
}

export async function cancelPedidoFoto(pedidoId) {
  if (!state.sb || !pedidoId) return
  await state.sb.from('caixa_pedidos_foto').update({ status: 'cancelado' }).eq('id', pedidoId)
}

// ─── Sangrias e cancelamentos do turno ───────────────────────────────────────

export async function loadNfceTurno(dataMovimento) {
  if (!state.sb || !dataMovimento) return []
  const { data } = await state.sb
    .from('caixa_nfce_eventos')
    .select('forma_pagamento, valor_total')
    .eq('data_turno', dataMovimento)
  return data || []
}

export async function loadSangriasTurno(dataMovimento) {
  if (!state.sb || !dataMovimento) return []
  const { data, error } = await state.sb
    .from('caixa_sangrias')
    .select('*')
    .eq('data_turno', dataMovimento)
    .eq('confirmado', false)
    .order('data_hora', { ascending: true })
  if (error) return []
  return data || []
}

export async function loadCancelamentosTurno(dataMovimento) {
  if (!state.sb || !dataMovimento) return []
  const { data, error } = await state.sb
    .from('caixa_cancelamentos')
    .select('*')
    .eq('data_turno', dataMovimento)
    .order('data_hora', { ascending: true })
  if (error) return []
  return data || []
}

export async function confirmSangrias(sangrias, fechamentoId, tipoChanges = {}) {
  if (!state.sb || !sangrias.length) return
  const ids = sangrias.map(s => s.id)
  await state.sb
    .from('caixa_sangrias')
    .update({ confirmado: true, fechamento_id: fechamentoId })
    .in('id', ids)
  const changed = sangrias.filter(s => tipoChanges[s.id] && tipoChanges[s.id] !== s.tipo)
  for (const s of changed) {
    await state.sb.from('caixa_sangrias').update({ tipo: tipoChanges[s.id] }).eq('id', s.id)
  }
}

export async function saveChangeCancelamentos(cancelamentos, changes) {
  if (!state.sb || !cancelamentos.length) return
  const toUpdate = cancelamentos.filter(c => changes[c.id])
  for (const c of toUpdate) {
    const ch = changes[c.id]
    const upd = {}
    if (ch.motivo_editado !== undefined) upd.motivo_editado = ch.motivo_editado || null
    if (ch.classificacao !== undefined) upd.classificacao = ch.classificacao || null
    if (Object.keys(upd).length)
      await state.sb.from('caixa_cancelamentos').update(upd).eq('id', c.id)
  }
}

export async function saveFechamentoResumo(current, sangriasTurno, cancelamentosTurno, tipoChanges = {}) {  if (!state.sb) return
  const effective = (s) => tipoChanges[s.id] || s.tipo || 'outro'
  const byTipo = (t) => sangriasTurno
    .filter(s => effective(s) === t)
    .reduce((sum, s) => sum + Number(s.valor || 0), 0)
  const pVal = (formId) => {
    const p = (current.pagamentos || []).find(x => x.formId === formId)
    return Number(p?.confirmedValue || 0)
  }
  const knownIds = ['credito', 'debito', 'pix', 'voucher', 'assinadas', 'ifood']
  const outras = (current.pagamentos || [])
    .filter(p => !knownIds.includes(p.formId))
    .reduce((sum, p) => sum + Number(p.confirmedValue || 0), 0)
  const totalEl = (current.pagamentos || []).reduce((sum, p) => sum + Number(p.confirmedValue || 0), 0)
  const sangTotal = sangriasTurno.reduce((sum, s) => sum + Number(s.valor || 0), 0)
  await state.sb.from('caixa_fechamento_resumo').upsert({
    fechamento_id: current.id,
    data_turno: current.data,
    turno: current.turno,
    operador: current.operador,
    terminal: current.terminal || 'CAIXA',
    abertura: current.abertura || 0,
    dinheiro_contado: current.dinheiroContado || 0,
    dinheiro_totvs: current.dinheiroTotvs || 0,
    troco_final: current.trocoFinal || 0,
    credito: pVal('credito'),
    debito: pVal('debito'),
    pix: pVal('pix'),
    voucher: pVal('voucher'),
    assinadas: pVal('assinadas'),
    ifood: pVal('ifood'),
    outras_formas: outras,
    total_eletronico: totalEl,
    sangrias_musico: byTipo('musico'),
    sangrias_extra: byTipo('extra'),
    sangrias_vale: byTipo('vale'),
    sangrias_cofre: byTipo('cofre'),
    sangrias_outro: byTipo('outro'),
    sangrias_total: sangTotal,
    cancelamentos_qtde: cancelamentosTurno.length,
    cancelamentos_valor: cancelamentosTurno.reduce((sum, c) => sum + Number(c.valor || 0), 0),
    houve_diferenca: current.houveDiferenca || false,
    conciliacao_status: current.conciliacaoStatus || 'sem_diferenca',
    conciliacao_diferenca_total: Number(current.conciliacao?.diffComparavel || 0)
  }, { onConflict: 'fechamento_id' })
}

// ─── Aprovação de gerente (Fase 2) ───────────────────────────────────────────

export async function loadGerentes() {
  if (!state.sb) { state.gerentes = []; return [] }
  try {
    const { data, error } = await state.sb.from('caixa_gerentes_publico').select('*')
    if (error) { state.gerentes = []; return [] }
    state.gerentes = (data || []).map(g => ({ id: g.id, nome: g.nome }))
    return state.gerentes
  } catch (e) {
    state.gerentes = []
    return []
  }
}

// Chama a função SECURITY DEFINER que valida o PIN no Postgres (bcrypt).
// Retorna { ok, ... } — nunca lê nem recebe o hash do gerente.
export async function aprovarComGerente({ fechamentoId, gerenteId, pin, decisao, observacao, contexto }) {
  if (!state.sb) return { ok: false, erro: 'sem_conexao' }
  try {
    const { data, error } = await state.sb.rpc('gerente_aprovar', {
      p_fechamento_id: fechamentoId,
      p_gerente_id: gerenteId,
      p_pin: pin,
      p_decisao: decisao,
      p_observacao: observacao || '',
      p_contexto: contexto || {}
    })
    if (error) return { ok: false, erro: 'rpc_indisponivel', detalhe: error.message }
    return data || { ok: false, erro: 'sem_resposta' }
  } catch (e) {
    return { ok: false, erro: 'rpc_indisponivel' }
  }
}

export async function loadAprovacoes(fechamentoIds) {
  if (!state.sb || !fechamentoIds?.length) return {}
  try {
    const { data, error } = await state.sb
      .from('caixa_aprovacoes')
      .select('*')
      .in('fechamento_id', fechamentoIds)
      .order('criado_em', { ascending: false })
    if (error) return {}
    const byFech = {}
    for (const a of data || []) {
      if (!byFech[a.fechamento_id]) byFech[a.fechamento_id] = a
    }
    return byFech
  } catch (e) {
    return {}
  }
}
