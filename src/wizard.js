import { state, STEPS, activeForms, hydrate, calc, buildAlerts, compareOpening, newClosure, today, uid } from './state.js'
import { money, parseMoney, moneyInput, esc, norm, toast, attachMoneyListeners, openPhotoModal } from './ui.js'
import { startPhotoRequest, stopPhotoRequest, handleFallbackUpload, handleManualAdvance } from './photo-request.js'
import { retryOcr, applyJson, applyOcrText } from './ocr.js'
import { uploadPhoto, saveClosure, loadCloudClosures } from './supabase.js'

export function render() {
  hydrate()
  renderSteps()
  document.getElementById('stepTitle').textContent = STEPS[state.step - 1][0]
  document.getElementById('stepHelp').textContent = STEPS[state.step - 1][1]
  document.getElementById('counter').textContent = state.step + '/8'

  const stepFns = [stepOpening, stepAppReminder, stepMachine, stepCash, stepSangria, stepTotvs, stepResult, stepReview]
  document.getElementById('stepBody').innerHTML = stepFns[state.step - 1]()

  attachMoneyListeners()

  // Restaurar preview da foto se existir
  if (state.step === 3 && state.current.fotoPreview) {
    const img = document.getElementById('photoPreview')
    if (img) { img.src = state.current.fotoPreview; img.style.display = 'block' }
  }

  // Iniciar pedido de foto ao entrar etapa 3 (apenas uma vez por fechamento)
  if (state.step === 3 && !state.photoPollInterval && !state.currentPedidoId && !state.current.fotoUrl && !state.current.fotoPreview) {
    startPhotoRequest()
  }

  updateDraftBadge()
}

function renderSteps() {
  document.getElementById('steps').innerHTML = STEPS.map((s, i) =>
    `<div class="step ${i + 1 === state.step ? 'active' : i + 1 < state.step ? 'done' : ''}">
      <span>Etapa ${i + 1}</span><b>${s[0]}</b>
    </div>`
  ).join('')
}

function footer() {
  const back = state.step > 1
    ? `<button class="btn light" onclick="window.__wizard.prev()">← Voltar</button>`
    : `<button class="btn light" onclick="window.__wizard.startNew()">Novo fechamento</button>`
  const fwd = state.step < 8
    ? `<button class="btn primary" onclick="window.__wizard.next()">Continuar →</button>`
    : `<button class="btn success" onclick="window.__wizard.finish()">Fechar caixa e salvar</button>`
  return `<div class="btnrow"><div>${back}</div><div>${fwd}</div></div>`
}

export function next() {
  if (!validate(state.step)) return
  state.step = Math.min(8, state.step + 1)
  render()
}

export function prev() {
  state.step = Math.max(1, state.step - 1)
  render()
}

export function startNew() {
  if (confirm('Criar novo fechamento? O rascunho atual não será salvo.')) {
    stopPhotoRequest()
    state.step = 1
    newClosure()
    render()
  }
}

function validate(s) {
  if (s === 1) {
    state.current.operador = document.getElementById('operador').value
    state.current.turno = document.getElementById('turno').value
    state.current.data = document.getElementById('dataMov').value
    state.current.terminal = document.getElementById('terminal').value.trim() || 'CAIXA'
    state.current.abertura = moneyInput(document.getElementById('abertura'))
    if (!state.current.operador) return toast('Selecione o operador.'), false
    if (!state.current.turno) return toast('Selecione o turno.'), false
    if (!state.current.data) return toast('Informe a data.'), false
    compareOpening()
  }
  if (s === 3) {
    syncPay()
    stopPhotoRequest()
    const pend = state.current.pagamentos.filter(p => {
      const f = state.forms.find(x => x.id === p.formId)
      return f && f.ativo && f.aparece && f.origem !== 'agente' && !p.confirmed
    })
    if (pend.length) return toast('Confirme cada valor antes de continuar.'), false
  }
  if (s === 4) { calc() }
  if (s === 5) {
    state.current.sangriaTroco = moneyInput(document.getElementById('sangria'))
    calc()
  }
  if (s === 7) {
    state.current.houveDiferenca = document.querySelector('input[name=dif]:checked')?.value === 'sim'
    state.current.obsDiferenca = document.getElementById('obsDif')?.value.trim() || ''
    calc()
    state.current.trocoFinal = state.current.dinheiroContado
    if (state.current.houveDiferenca && !state.current.obsDiferenca)
      return toast('Explique a diferença.'), false
    buildAlerts()
  }
  return true
}

export async function finish() {
  if (!validate(7)) return
  if (!state.sb) {
    toast('Não foi salvo: Supabase não conectado. Verifique a conexão e tente novamente.')
    return
  }
  buildAlerts()
  state.current.status = 'fechado'
  state.current.criado_em = new Date().toISOString()
  let fotoUrl = state.current.fotoUrl || ''

  if (state.photoFile) {
    try {
      fotoUrl = await uploadPhoto(state.photoFile, state.current.id)
      state.current.fotoUrl = fotoUrl
    } catch (e) {
      toast('A foto não subiu para a nuvem. Verifique o bucket relatorios-caixa e tente novamente.')
      return
    }
  }

  try {
    await saveClosure(state.current, fotoUrl)
    toast('Fechamento salvo na nuvem.')
    await loadCloudClosures()
    const { renderClosures } = window.__history || {}
    renderClosures && renderClosures()
    state.photoFile = null
    stopPhotoRequest()
    newClosure()
    state.step = 1
    render()
  } catch (e) {
    toast('Não foi salvo na nuvem. Verifique se o SQL foi rodado no Supabase.')
  }
}

// ─── Etapa 1 — Abertura ──────────────────────────────────────────────────────

function stepOpening() {
  const ops = activeForms  // placeholder — usando activeOps abaixo
  const { activeOps, activeShifts } = window.__stateHelpers || {}
  const optsOp = (window.__stateHelpers?.activeOps() || []).map(o =>
    `<option value="${esc(o.nome)}" ${state.current.operador === o.nome ? 'selected' : ''}>${esc(o.nome)}</option>`
  ).join('')
  const optsTs = (window.__stateHelpers?.activeShifts() || []).map(t =>
    `<option value="${esc(t.nome)}" ${state.current.turno === t.nome ? 'selected' : ''}>${esc(t.nome)}</option>`
  ).join('')

  return `
    <div class="grid g2">
      <div class="field"><label>Operador</label>
        <select id="operador"><option value="">Selecione...</option>${optsOp}</select></div>
      <div class="field"><label>Turno</label>
        <select id="turno"><option value="">Selecione...</option>${optsTs}</select></div>
      <div class="field"><label>Data do movimento</label>
        <input type="date" id="dataMov" value="${state.current.data || today()}"></div>
      <div class="field"><label>Terminal / caixa</label>
        <input id="terminal" value="${esc(state.current.terminal || 'CAIXA')}"></div>
      <div class="field"><label>Valor de abertura da gaveta</label>
        <input class="brl money" inputmode="decimal" id="abertura"
          value="${money(state.current.abertura || 0)}" placeholder="R$ 0,00"></div>
    </div>
    <div style="margin-top:14px" id="openBox">${openingBox()}</div>
    <div class="hint"><b>Controle:</b> o sistema compara com o troco final do fechamento anterior e não mostra o valor anterior para o operador.</div>
    ${footer()}`
}

function openingBox() {
  if (state.current.aberturaOK === null)
    return `<div class="alert blue">Ao continuar, o sistema verifica se a abertura bate com o fechamento anterior.</div>`
  if (state.current.aberturaOK)
    return `<div class="alert ok"><b>Abertura conferida:</b> bate com o fechamento anterior.</div>`
  return `<div class="alert bad">
    <b>Abertura diferente do fechamento anterior.</b>
    O valor anterior não será mostrado. Reconte e edite ou confirme mesmo assim.
    <div class="btns" style="margin-top:10px">
      <button class="btn light" onclick="document.getElementById('abertura').focus()">Recontar e editar</button>
      <button class="btn primary" onclick="window.__wizard.confirmDivAbertura()">Confirmar mesmo assim</button>
    </div>
    ${state.current.aberturaConfirmada ? '<p><b>Divergência confirmada e enviada para conferência.</b></p>' : ''}
  </div>`
}

export function confirmDivAbertura() {
  state.current.aberturaConfirmada = true
  document.getElementById('openBox').innerHTML = openingBox()
}

// ─── Etapa 2 — App Meu Caixa ─────────────────────────────────────────────────

function stepAppReminder() {
  return `
    <div style="text-align:center;padding:16px 0 4px">
      <div style="display:inline-flex;align-items:center;justify-content:center;
                  width:96px;height:96px;border-radius:28px;
                  background:linear-gradient(135deg,#fff7cc 0%,#f7a51c 50%,#ff6b1a 100%);
                  box-shadow:0 22px 54px rgba(247,165,28,.42),0 6px 18px rgba(0,0,0,.16);
                  margin-bottom:16px">
        <svg viewBox="0 0 64 64" width="58" height="58" xmlns="http://www.w3.org/2000/svg">
          <text x="32" y="44" font-family="Arial Black,Arial,sans-serif"
                font-weight="900" font-size="26" fill="#111827" text-anchor="middle">AG</text>
        </svg>
      </div>
      <div style="font-size:20px;font-weight:1000;margin-bottom:4px">Meu Caixa</div>
      <div style="color:#6b7280;font-size:13px;margin-bottom:28px">App do celular da empresa</div>
    </div>

    <div class="alert blue" style="margin-bottom:20px">
      <b>Abra o app Meu Caixa no celular antes de continuar.</b><br>
      Ele precisa estar na tela "Aguardando pedido..." para receber a solicitação de foto.
    </div>

    <div style="display:grid;gap:16px;margin-bottom:24px">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="min-width:34px;height:34px;border-radius:50%;flex-shrink:0;
                    background:linear-gradient(135deg,#f7a51c,#ff6b1a);
                    display:flex;align-items:center;justify-content:center;
                    font-weight:1000;color:#111827;font-size:15px;
                    box-shadow:0 4px 12px rgba(247,165,28,.35)">1</div>
        <div style="padding-top:4px">
          <div style="font-weight:800;margin-bottom:3px">Pegue o celular da empresa</div>
          <div style="color:#6b7280;font-size:13px;line-height:1.5">O aparelho que tem o ícone <b>AG</b> na tela inicial.</div>
        </div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="min-width:34px;height:34px;border-radius:50%;flex-shrink:0;
                    background:linear-gradient(135deg,#f7a51c,#ff6b1a);
                    display:flex;align-items:center;justify-content:center;
                    font-weight:1000;color:#111827;font-size:15px;
                    box-shadow:0 4px 12px rgba(247,165,28,.35)">2</div>
        <div style="padding-top:4px">
          <div style="font-weight:800;margin-bottom:3px">Toque no ícone e abra o app</div>
          <div style="color:#6b7280;font-size:13px;line-height:1.5">Espere aparecer o spinner e a mensagem <b>"Aguardando pedido de foto..."</b></div>
        </div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="min-width:34px;height:34px;border-radius:50%;flex-shrink:0;
                    background:linear-gradient(135deg,#f7a51c,#ff6b1a);
                    display:flex;align-items:center;justify-content:center;
                    font-weight:1000;color:#111827;font-size:15px;
                    box-shadow:0 4px 12px rgba(247,165,28,.35)">3</div>
        <div style="padding-top:4px">
          <div style="font-weight:800;margin-bottom:3px">Clique em "Continuar →" aqui</div>
          <div style="color:#6b7280;font-size:13px;line-height:1.5">O app receberá o pedido e abrirá a câmera automaticamente em alguns segundos.</div>
        </div>
      </div>
    </div>

    <div class="hint">Se o app já estava aberto na tela de espera, pode clicar em Continuar diretamente.</div>
    ${footer()}`
}

// ─── Etapa 3 — Maquininha ────────────────────────────────────────────────────

function stepMachine() {
  const ocrBanner = {
    lendo: '<div class="alert blue"><b>OCR em andamento:</b> tentando ler a foto...</div>',
    ok: '<div class="alert ok"><b>OCR concluído:</b> confira os valores preenchidos.</div>',
    erro: '<div class="alert warn"><b>OCR não conseguiu preencher.</b> Preencha manualmente ou cole JSON.</div>'
  }[state.current.ocrStatus] || ''

  const cards = activeForms().map(f => {
    const p = state.current.pagamentos.find(x => x.formId === f.id) || {}
    const agent = f.origem === 'agente'
    return `<div class="payment ${p.confirmed ? 'confirmed' : ''} ${p.edited ? 'edited' : ''}">
      <div class="payrow">
        <div>
          <span class="chip ${agent ? 'chipwarn' : f.ia ? 'chipblue' : ''}">${esc(f.nome)}</span>
          <div style="font-size:12px;color:#6b7280;margin-top:8px">${agent ? 'Agente futuramente' : f.ia ? 'IA/OCR ou manual' : 'Manual'}</div>
        </div>
        <div class="field"><label>Lido pela IA</label>
          <input class="brl ia" data-id="${f.id}" value="${p.iaValue ? money(p.iaValue) : ''}"
            ${!f.ia ? 'disabled' : ''} placeholder="R$ 0,00"></div>
        <div class="field"><label>Confirmado</label>
          <input class="brl conf" data-id="${f.id}" value="${p.confirmedValue ? money(p.confirmedValue) : ''}"
            placeholder="R$ 0,00"></div>
        <div class="btns">
          <button class="btn success small" onclick="window.__wizard.confirmPay('${f.id}')">Confirmar</button>
          <button class="btn light small" onclick="window.__wizard.zeroPay('${f.id}')">Zerar</button>
        </div>
      </div>
      ${p.edited ? '<div class="alert warn" style="margin-top:10px"><b>Editado:</b> diferente do valor lido pela IA.</div>' : ''}
    </div>`
  }).join('')

  const fotoStatus = state.current.fotoUrl
    ? `<div class="alert ok" style="margin-top:10px"><b>Foto já recebida</b> e salva na nuvem.</div>`
    : ''

  return `
    <div class="grid g2">
      <div>
        <div id="photoRequestStatus"></div>
        ${fotoStatus}
        ${state.current.fotoPreview
          ? `<img id="photoPreview" class="photo" style="display:block" src="${state.current.fotoPreview}">`
          : `<img id="photoPreview" class="photo">`}
        ${ocrBanner}
        <div class="btns" style="margin-top:10px">
          <button class="btn secondary" onclick="window.__ocr.retryOcr()">Tentar OCR novamente</button>
          <button class="btn light" onclick="window.__wizard.toggleJson()">Colar JSON da IA</button>
        </div>
        <div id="jsonArea" class="hidden" style="margin-top:12px">
          <textarea id="jsonIa" placeholder='{ "credito": "1250,00", "debito": "730,00" }'></textarea>
          <button class="btn primary" onclick="window.__wizard.applyJsonUI()">Aplicar JSON</button>
        </div>
        ${state.current.ocrText
          ? `<details style="margin-top:12px"><summary>Ver texto lido pelo OCR</summary><textarea readonly>${esc(state.current.ocrText)}</textarea></details>`
          : ''}
        <details style="margin-top:14px">
          <summary>Enviar foto manualmente (alternativa)</summary>
          <div style="padding-top:12px">
            <div class="field">
              <label>Selecionar foto do dispositivo</label>
              <input type="file" accept="image/*" onchange="window.__photoRequest.handleFallbackUpload(event)">
            </div>
            <div class="hint">Use apenas se o app Meu Caixa não estiver disponível.</div>
          </div>
        </details>
      </div>
      <div>
        <div class="alert blue"><b>Confirme individualmente:</b> se editar, o card fica marcado e isso vai para a conferência.</div>
        <div class="grid">${cards}</div>
      </div>
    </div>
    ${footer()}`
}

export function syncPay() {
  document.querySelectorAll('.ia').forEach(el => {
    const p = state.current.pagamentos.find(x => x.formId === el.dataset.id)
    if (p) p.iaValue = moneyInput(el)
  })
  document.querySelectorAll('.conf').forEach(el => {
    const p = state.current.pagamentos.find(x => x.formId === el.dataset.id)
    if (p) p.confirmedValue = moneyInput(el)
  })
}

export function confirmPay(id) {
  syncPay()
  const f = state.forms.find(x => x.id === id)
  const p = state.current.pagamentos.find(x => x.formId === id)
  p.confirmed = true
  p.edited = !!(f.ia && Math.abs((p.iaValue || 0) - (p.confirmedValue || 0)) > 0.01)
  p.origem = p.edited ? 'editado' : f.origem
  toast(f.nome + ' confirmado.')
  render()
}

export function zeroPay(id) {
  const p = state.current.pagamentos.find(x => x.formId === id)
  Object.assign(p, { iaValue: 0, confirmedValue: 0, confirmed: true, edited: false })
  render()
}

export function toggleJson() {
  document.getElementById('jsonArea')?.classList.toggle('hidden')
}

export function applyJsonUI() {
  applyJson(document.getElementById('jsonIa')?.value || '')
}

// ─── Etapa 4 — Dinheiro ──────────────────────────────────────────────────────

function stepCash() {
  calc()
  const list = state.current.cash.map((v, i) =>
    `<div class="cashitem" style="display:flex;justify-content:space-between;align-items:center">
      <b>${money(v)}</b>
      <button class="btn danger small" onclick="window.__wizard.removeCash(${i})">Remover</button>
    </div>`
  ).join('')

  return `
    <div class="grid g2">
      <div>
        <div class="field"><label>Digite um valor por vez</label>
          <input id="cashInput" class="brl money" inputmode="decimal" placeholder="Ex: 50,00"
            onkeydown="if(event.key==='Enter'){event.preventDefault();window.__wizard.addCash()}">
        </div>
        <div class="btns">
          <button class="btn secondary" onclick="window.__wizard.addCash()">Adicionar valor</button>
          <button class="btn light" onclick="window.__wizard.clearCash()">Limpar</button>
        </div>
        <div class="hint">Depois de dar Enter, o campo fica selecionado para continuar digitando.</div>
      </div>
      <div>
        <div class="summary"><small>Dinheiro contado na gaveta</small><strong>${money(state.current.dinheiroContado)}</strong></div>
        <div class="grid" style="margin-top:14px">${list || '<div class="hint">Nenhum valor lançado.</div>'}</div>
      </div>
    </div>
    ${footer()}`
}

export function addCash() {
  const el = document.getElementById('cashInput')
  const v = moneyInput(el)
  if (v <= 0) return toast('Digite valor maior que zero.')
  state.current.cash.push(v)
  calc()
  render()
  setTimeout(() => { const n = document.getElementById('cashInput'); if (n) { n.focus(); n.select() } }, 30)
}

export function removeCash(i) {
  state.current.cash.splice(i, 1)
  calc()
  render()
}

export function clearCash() {
  if (confirm('Limpar valores de dinheiro?')) { state.current.cash = []; calc(); render() }
}

// ─── Etapa 5 — Sangria Troco ─────────────────────────────────────────────────

function stepSangria() {
  calc()
  return `
    <div class="alert warn">
      <b>Agora vá no fechamento do caixa no TOTVS.</b><br>
      Aperte <b>CTRL + F</b> e procure <b>"SANGRIA TROCO"</b>. Se aparecer, informe o valor aqui. Se não aparecer, deixe R$ 0,00.
    </div>
    <div class="grid g2">
      <div class="field"><label>Sangria troco informada pelo TOTVS</label>
        <input id="sangria" class="brl money" inputmode="decimal"
          value="${state.current.sangriaTroco ? money(state.current.sangriaTroco) : ''}" placeholder="R$ 0,00">
      </div>
      <div class="summary"><small>Dinheiro contado na gaveta</small><strong>${money(state.current.dinheiroContado)}</strong></div>
    </div>
    <div class="hint">O valor de dinheiro para lançar no TOTVS só aparece na próxima etapa.</div>
    ${footer()}`
}

// ─── Etapa 6 — Lançar TOTVS ──────────────────────────────────────────────────

function rowsFinal() {
  calc()
  return [
    ...state.current.pagamentos.slice().sort((a, b) => (a.ordem || 999) - (b.ordem || 999))
      .map(p => ({ nome: p.nome, valor: Number(p.confirmedValue || 0) })),
    { nome: 'Dinheiro', valor: Number(state.current.dinheiroTotvs || 0) }
  ]
}

function stepTotvs() {
  const rows = rowsFinal().map(r =>
    `<tr><td>${esc(r.nome)}</td><td class="num">${money(r.valor)}</td>
     <td><button class="btn light small" onclick="window.__wizard.copy('${money(r.valor)}')">Copiar</button></td></tr>`
  ).join('')
  return `
    <div class="alert blue">
      <b>Agora preencha estes valores no fechamento do TOTVS.</b><br>
      Depois aperte <b>F10</b> e espere a fita de fechamento sair da impressora.
    </div>
    <div class="table"><table>
      <thead><tr><th>Campo no TOTVS</th><th class="num">Valor</th><th>Ação</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="btns" style="margin-top:14px">
      <button class="btn secondary" onclick="window.__wizard.copyAll()">Copiar resumo</button>
    </div>
    ${footer()}`
}

export function copy(t) { navigator.clipboard?.writeText(t); toast('Copiado.') }

export function copyAll() {
  navigator.clipboard?.writeText(rowsFinal().map(r => r.nome + ': ' + money(r.valor)).join('\n'))
  toast('Resumo copiado.')
}

// ─── Etapa 7 — Resultado ─────────────────────────────────────────────────────

function stepResult() {
  calc()
  return `
    <div class="alert blue">A fita de fechamento informou diferença? Se sim, apenas explique em texto livre.</div>
    <div class="grid g2">
      <div class="payment">
        <label style="font-weight:900">O TOTVS informou diferença?</label><br><br>
        <label><input type="radio" name="dif" value="nao" ${!state.current.houveDiferenca ? 'checked' : ''}
          onchange="window.__wizard.toggleDif()"> Não, bateu tudo</label><br><br>
        <label><input type="radio" name="dif" value="sim" ${state.current.houveDiferenca ? 'checked' : ''}
          onchange="window.__wizard.toggleDif()"> Sim, teve diferença</label>
        <div id="difArea" class="${state.current.houveDiferenca ? '' : 'hidden'}" style="margin-top:14px">
          <div class="field"><label>Explique a diferença</label>
            <textarea id="obsDif" placeholder="Explique o que apareceu na fita, o que foi recontado e qual foi a conclusão.">${esc(state.current.obsDiferenca || '')}</textarea>
          </div>
        </div>
      </div>
      <div class="payment">
        <div class="summary">
          <small>Troco final deixado para o próximo caixa</small>
          <strong>${money(state.current.dinheiroContado)}</strong>
        </div>
        <div class="hint">É o mesmo valor que a pessoa informou ao somar quanto tem na gaveta.</div>
      </div>
    </div>
    ${footer()}`
}

export function toggleDif() {
  const sim = document.querySelector('input[name=dif]:checked')?.value === 'sim'
  document.getElementById('difArea')?.classList.toggle('hidden', !sim)
}

// ─── Etapa 8 — Salvar ────────────────────────────────────────────────────────

function stepReview() {
  buildAlerts()
  const pays = state.current.pagamentos.map(p =>
    `<tr><td>${esc(p.nome)}</td><td class="num">${money(p.confirmedValue)}</td>
     <td>${p.edited ? 'Editado' : p.confirmed ? 'Confirmado' : 'Pendente'}</td></tr>`
  ).join('')

  return `
    <div class="grid g2">
      <div class="summary"><small>Operador / Turno</small>
        <strong>${esc(state.current.operador || '-')} · ${esc(state.current.turno || '-')}</strong></div>
      <div class="summary"><small>Dinheiro para TOTVS</small>
        <strong>${money(state.current.dinheiroTotvs)}</strong></div>
      <div class="summary"><small>Abertura</small>
        <strong>${money(state.current.abertura)}</strong></div>
      <div class="summary"><small>Dinheiro contado / troco final</small>
        <strong>${money(state.current.dinheiroContado)}</strong></div>
    </div>
    <div class="divider"></div>
    ${state.current.alertas.map(x =>
      `<div class="alert ${x.nivel === 'bad' ? 'bad' : 'warn'}">${esc(x.texto)}</div>`
    ).join('') || '<div class="alert ok">Sem alertas principais.</div>'}
    <div class="divider"></div>
    <div class="table"><table>
      <thead><tr><th>Forma</th><th class="num">Valor</th><th>Status</th></tr></thead>
      <tbody>${pays}</tbody>
    </table></div>
    ${footer()}`
}

function updateDraftBadge() {
  const d = document.getElementById('draft')
  if (d) d.textContent = state.sb ? 'Somente nuvem' : 'Nuvem indisponível'
}
