import { state } from './state.js'
import { money, esc, norm, toast, openPhotoModal } from './ui.js'
import { loadCloudClosures } from './supabase.js'

export function renderClosures() {
  const box = document.getElementById('closures')
  if (!box) return

  let list = state.closures.slice()
  const d = document.getElementById('fData')?.value
  if (d) list = list.filter(c => c.data === d)

  const st = document.getElementById('fStatus')?.value
  if (st === 'alertas') list = list.filter(c => (c.alertas || []).length)
  if (st === 'ok') list = list.filter(c => !(c.alertas || []).length)

  const tx = norm(document.getElementById('fText')?.value || '')
  if (tx) list = list.filter(c =>
    norm(`${c.operador} ${c.turno} ${c.obsDiferenca} ${c.fotoNome || ''}`).includes(tx)
  )

  if (!list.length) {
    box.innerHTML = '<div class="hint">Nenhum fechamento encontrado.</div>'
    return
  }

  box.innerHTML = list.map(c => {
    const temFoto = !!c.fotoUrl
    const fotoBtn = temFoto
      ? `<div class="photo-actions">
           <span class="photo-badge">Foto anexada</span>
           <button class="btn secondary small"
             onclick="window.__history.openPhoto('${esc(c.fotoUrl)}','${esc(c.fotoNome || 'Foto da maquininha')}','${esc(c.data || '')}','${esc(c.operador || '')}')">
             Ver foto
           </button>
           <a class="btn light small" href="${esc(c.fotoUrl)}" target="_blank" rel="noopener">Abrir em nova aba</a>
         </div>`
      : `<div class="alert warn" style="margin-top:10px"><b>Sem foto:</b> este fechamento não tem imagem do relatório da maquininha.</div>`

    return `<div class="payment">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <h3 style="margin:0 0 4px">${esc(c.data)} · ${esc(c.turno || '-')}</h3>
          <div style="color:#6b7280">Operador: <b>${esc(c.operador || '-')}</b> · Terminal: ${esc(c.terminal || 'CAIXA')}</div>
        </div>
        <span class="chip ${c.alertas?.length ? 'chipwarn' : 'chipblue'}">${c.alertas?.length ? 'Com alerta' : 'OK'}</span>
      </div>
      <div class="grid g3" style="margin-top:14px">
        <div class="summary"><small>Abertura</small><strong>${money(c.abertura)}</strong></div>
        <div class="summary"><small>Dinheiro contado</small><strong>${money(c.dinheiroContado)}</strong></div>
        <div class="summary"><small>Dinheiro TOTVS</small><strong>${money(c.dinheiroTotvs)}</strong></div>
      </div>
      ${(c.alertas || []).map(a =>
        `<div class="alert ${a.nivel === 'bad' ? 'bad' : 'warn'}" style="margin-top:10px">${esc(a.texto)}</div>`
      ).join('')}
      ${c.houveDiferenca ? `<div class="alert bad" style="margin-top:10px"><b>Diferença:</b> ${esc(c.obsDiferenca || '-')}</div>` : ''}
      ${fotoBtn}
    </div>`
  }).join('')
}

export function openPhoto(url, nome, data, operador) {
  openPhotoModal(url, nome, data, operador)
}

export async function refreshClosures() {
  await loadCloudClosures()
  renderClosures()
}

export function copyJson() {
  navigator.clipboard?.writeText(JSON.stringify(state.closures, null, 2))
  toast('JSON copiado. Nenhum arquivo foi salvo no computador.')
}
