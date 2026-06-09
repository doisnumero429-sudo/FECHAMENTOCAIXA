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

  box.innerHTML = list.map(c => buildCard(c)).join('')
}

function buildCard(c) {
  const hasAlerts = (c.alertas || []).length > 0
  const criadoEm = c.criado_em
    ? new Date(c.criado_em).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : ''

  // ── Abertura ──
  const aberturaIcon = c.aberturaOK === false
    ? `<span title="Divergência de abertura" style="color:#dc2626;font-size:15px;margin-left:5px">⚠</span>`
    : c.aberturaOK === true
    ? `<span title="Abertura conferida" style="color:#16a34a;font-size:13px;margin-left:4px">✓</span>`
    : ''
  let aberturaStatus = ''
  if (c.aberturaOK === true)
    aberturaStatus = '<span style="color:#16a34a;font-weight:800">✓ Bateu com o fechamento anterior</span>'
  else if (c.aberturaOK === false && c.aberturaConfirmada)
    aberturaStatus = '<span style="color:#d97706;font-weight:800">⚠ Divergência confirmada pelo operador</span>'
  else if (c.aberturaOK === false)
    aberturaStatus = '<span style="color:#dc2626;font-weight:800">✗ Diferente do fechamento anterior</span>'
  else
    aberturaStatus = '<span style="color:#6b7280">Sem comparação disponível</span>'

  // ── Ação manual ──
  const acaoManual = (c.pagamentos || []).some(p => p.edited) || c.aberturaConfirmada

  // ── Formas de pagamento (filtrar zeros) ──
  const pagamentos = (c.pagamentos || [])
    .filter(p => Number(p.confirmedValue || 0) > 0)
    .slice()
    .sort((a, b) => (a.ordem || 999) - (b.ordem || 999))

  const totalMaq = pagamentos.reduce((s, p) => s + Number(p.confirmedValue || 0), 0)

  const payRows = pagamentos.map(p => {
    const editado = p.edited
      ? `<span style="color:#d97706;font-size:11px;font-weight:800">Editado</span>`
      : p.confirmed
        ? `<span style="color:#16a34a;font-size:11px">Confirmado</span>`
        : `<span style="color:#6b7280;font-size:11px">—</span>`
    const iaDiff = p.edited && p.iaValue
      ? `<br><span style="color:#9ca3af;font-size:11px">IA leu: ${money(p.iaValue)}</span>`
      : ''
    return `<tr>
      <td style="font-weight:800">${esc(p.nome)}</td>
      <td class="num">${money(p.confirmedValue)}</td>
      <td>${editado}${iaDiff}</td>
    </tr>`
  }).join('')

  // ── Cédulas / dinheiro ──
  const cash = c.cash || []
  const cashItems = cash.length
    ? cash.map(v => `<span class="chip" style="font-size:12px">${money(v)}</span>`).join(' ')
    : '<span style="color:#9ca3af;font-size:12px">Nenhum valor registrado individualmente</span>'

  // ── Alertas ──
  const alertasList = (c.alertas || []).map(a =>
    `<div class="alert ${a.nivel === 'bad' ? 'bad' : 'warn'}" style="margin-top:8px">${esc(a.texto)}</div>`
  ).join('')

  // ── Foto (suporta múltiplas) ──
  const todasFotos = (c.fotos && c.fotos.length > 0)
    ? c.fotos
    : c.fotoUrl ? [{ url: c.fotoUrl, nome: c.fotoNome || 'Foto da maquininha', preview: null }] : []

  const fotoSection = todasFotos.length > 0
    ? `<div style="margin-top:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <span class="chip" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);color:#166534;border-color:#bbf7d0">
            📷 ${todasFotos.length > 1 ? todasFotos.length + ' fotos' : 'Foto anexada'}
          </span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${todasFotos.map((f, i) => `
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
              ${f.preview
                ? `<img src="${esc(f.preview)}" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:2px solid #e5e7eb;cursor:pointer"
                     onclick="window.__history.openPhoto('${esc(f.url)}','${esc(f.nome || 'Foto ' + (i+1))}','${esc(c.data || '')}','${esc(c.operador || '')}')">` : ''}
              <div style="display:flex;gap:6px">
                <button class="btn secondary small"
                  onclick="window.__history.openPhoto('${esc(f.url)}','${esc(f.nome || 'Foto ' + (i+1))}','${esc(c.data || '')}','${esc(c.operador || '')}')">
                  ${todasFotos.length > 1 ? 'Ver ' + (i+1) : 'Ver foto'}
                </button>
                <a class="btn light small" href="${esc(f.url)}" target="_blank" rel="noopener">Nova aba</a>
              </div>
            </div>`).join('')}
        </div>
      </div>`
    : `<div class="alert warn" style="margin-top:10px"><b>Sem foto:</b> nenhuma imagem do relatório da maquininha.</div>`

  return `<div class="payment" style="margin-bottom:20px">

    <!-- Cabeçalho -->
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
      <div>
        <h3 style="margin:0 0 4px;font-size:18px">${esc(c.data)} · ${esc(c.turno || '-')}</h3>
        <div style="color:#6b7280;font-size:13px">
          Operador: <b>${esc(c.operador || '-')}</b> ·
          Terminal: <b>${esc(c.terminal || 'CAIXA')}</b>
          ${criadoEm ? `· <span style="color:#9ca3af">${criadoEm}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${acaoManual ? `<span class="chip chipwarn" title="Um ou mais valores foram editados manualmente">⚡ Ação manual</span>` : ''}
        <span class="chip ${hasAlerts ? 'chipwarn' : 'chipblue'}">${hasAlerts ? '⚠ Com alerta' : '✓ OK'}</span>
      </div>
    </div>

    <!-- Resumo sempre visível -->
    <div class="grid g3" style="margin-top:14px">
      <div class="summary" ${c.aberturaOK === false ? 'style="border-color:#fecaca;background:linear-gradient(135deg,#fef2f2,#fff)"' : ''}>
        <small>Troco inicial${aberturaIcon}</small>
        <strong ${c.aberturaOK === false ? 'style="color:#dc2626"' : ''}>${money(c.abertura)}</strong>
      </div>
      <div class="summary">
        <small>Troco final (contado)</small>
        <strong>${money(c.trocoFinal || c.dinheiroContado)}</strong>
      </div>
      <div class="summary" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-color:#bfdbfe">
        <small style="color:#1e40af">Dinheiro TOTVS</small>
        <strong style="color:#1e40af">${money(c.dinheiroTotvs)}</strong>
      </div>
    </div>
    <div class="grid g2" style="margin-top:10px">
      <div class="summary">
        <small>Sangria / Troco TOTVS</small>
        <strong>${money(c.sangriaTroco)}</strong>
      </div>
      <div class="summary" style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);border-color:#ddd6fe">
        <small style="color:#5b21b6">Total maquininha</small>
        <strong style="color:#5b21b6">${money(totalMaq)}</strong>
      </div>
    </div>

    <!-- Detalhes expansíveis -->
    <details style="margin-top:16px">
      <summary style="cursor:pointer;font-weight:800;font-size:13px;color:#374151;padding:8px 0;
                      list-style:none;display:flex;align-items:center;gap:8px;user-select:none">
        <span style="font-size:10px">▶</span> Ver detalhes completos
      </summary>

      <div style="margin-top:14px;display:grid;gap:18px">

        <!-- Abertura -->
        <div>
          <div style="font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:8px">Abertura</div>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <span style="font-size:22px;font-weight:1000">${money(c.abertura)}</span>
            <span>${aberturaStatus}</span>
          </div>
          ${c.aberturaConfirmada && c.aberturaOK === false
            ? `<div class="alert warn" style="margin-top:8px">Operador confirmou divergência de abertura e avançou mesmo assim.</div>`
            : ''}
        </div>

        <div style="height:1px;background:var(--line)"></div>

        <!-- Formas de pagamento -->
        <div>
          <div style="font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:10px">Formas de pagamento (maquininha)</div>
          <div class="table">
            <table>
              <thead>
                <tr>
                  <th>Forma</th>
                  <th class="num">Valor confirmado</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${payRows}</tbody>
              <tfoot>
                <tr style="background:var(--soft)">
                  <td><b>Total maquininha</b></td>
                  <td class="num"><b>${money(totalMaq)}</b></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div style="height:1px;background:var(--line)"></div>

        <!-- Foto da maquininha -->
        <div>
          <div style="font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:6px">Foto da maquininha</div>
          ${fotoSection}
        </div>

        <div style="height:1px;background:var(--line)"></div>

        <!-- Dinheiro na gaveta -->
        <div>
          <div style="font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:10px">Dinheiro na gaveta</div>
          <div style="margin-bottom:10px">${cashItems}</div>
          <div class="grid g3">
            <div class="summary">
              <small>Total contado</small>
              <strong>${money(c.dinheiroContado)}</strong>
            </div>
            <div class="summary">
              <small>Sangria / Troco TOTVS</small>
              <strong>${money(c.sangriaTroco)}</strong>
            </div>
            <div class="summary" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-color:#bfdbfe">
              <small style="color:#1e40af">A lançar no TOTVS</small>
              <strong style="color:#1e40af">${money(c.dinheiroTotvs)}</strong>
            </div>
          </div>
          <div class="hint" style="margin-top:10px;font-size:12px">
            Fórmula: Dinheiro TOTVS = Contado (${money(c.dinheiroContado)}) − Abertura (${money(c.abertura)}) + Sangria (${money(c.sangriaTroco)}) = <b>${money(c.dinheiroTotvs)}</b>
          </div>
          <div class="summary" style="margin-top:10px">
            <small>Troco final deixado para o próximo caixa</small>
            <strong>${money(c.trocoFinal)}</strong>
          </div>
        </div>

        <div style="height:1px;background:var(--line)"></div>

        <!-- Diferença TOTVS -->
        <div>
          <div style="font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:8px">Diferença no TOTVS</div>
          ${c.houveDiferenca
            ? `<div class="alert bad"><b>Sim, houve diferença.</b><br>${esc(c.obsDiferenca || '(sem observação)')}</div>`
            : `<div class="alert ok"><b>Não.</b> O TOTVS bateu com os valores informados.</div>`
          }
        </div>

        ${alertasList ? `<div style="height:1px;background:var(--line)"></div><div>
          <div style="font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:8px">Alertas do fechamento</div>
          ${alertasList}
        </div>` : ''}

      </div>
    </details>

    <!-- Alertas sempre visíveis se existirem -->
    ${hasAlerts ? alertasList : ''}
    ${c.houveDiferenca ? `<div class="alert bad" style="margin-top:8px"><b>Diferença registrada:</b> ${esc(c.obsDiferenca || '-')}</div>` : ''}

  </div>`
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
