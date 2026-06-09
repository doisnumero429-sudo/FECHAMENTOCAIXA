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
