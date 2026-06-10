import { state, STEPS, activeForms, hydrate, calc, buildAlerts, compareOpening, newClosure, today, uid } from './state.js'
import { money, parseMoney, moneyInput, esc, norm, toast, attachMoneyListeners, openPhotoModal } from './ui.js'
import { startPhotoRequest, stopPhotoRequest, handleFallbackUpload, handleManualAdvance, requestAnotherPhoto } from './photo-request.js'
import { retryOcr, applyJson, applyOcrText } from './ocr.js'
import { saveLearnedAssociation } from './ai-ocr.js'
import { uploadPhoto, saveClosure, loadCloudClosures, loadSangriasTurno, loadCancelamentosTurno, confirmSangrias, saveFechamentoResumo } from './supabase.js'

export function render() {
  hydrate()
  renderSteps()
  document.getElementById('stepTitle').textContent = STEPS[state.step - 1][0]
  document.getElementById('stepHelp').textContent = STEPS[state.step - 1][1]
  document.getElementById('counter').textContent = state.step + '/8'

  const stepFns = [stepOpening, stepAppReminder, stepMachine, stepCash, stepSangria, stepTotvs, stepResult, stepReview]
  document.getElementById('stepBody').innerHTML = stepFns[state.step - 1]()

  attachMoneyListeners()
  requestAnimationFrame(() => window.__refreshIcons?.())

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
    ? `<button class="btn light" onclick="window.__wizard.prev()"><i data-lucide="arrow-left"></i> Voltar</button>`
    : `<button class="btn light" onclick="window.__wizard.startNew()"><i data-lucide="plus"></i> Novo fechamento</button>`
  const fwd = state.step < 8
    ? `<button class="btn primary" onclick="window.__wizard.next()">Continuar <i data-lucide="arrow-right"></i></button>`
    : `<button class="btn success" onclick="window.__wizard.finish()"><i data-lucide="check-circle"></i> Fechar caixa e salvar</button>`
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
    const prevData = state.current.data
    state.current.operador = document.getElementById('operador').value
    state.current.turno = document.getElementById('turno').value
    state.current.data = document.getElementById('dataMov').value
    state.current.terminal = document.getElementById('terminal').value.trim() || 'CAIXA'
    state.current.abertura = moneyInput(document.getElementById('abertura'))
    if (!state.current.operador) return toast('Selecione o operador.'), false
    if (!state.current.turno) return toast('Selecione o turno.'), false
    if (!state.current.data) return toast('Informe a data.'), false
    if (state.current.data !== prevData) {
      state.sangriasTurnoLoaded = false
      state.sangriasTurnoLoading = false
      state.sangriasTurno = []
      state.cancelamentosTurno = []
      state.sangriaTipoChanges = {}
    }
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
    toast('Sem conexão com a nuvem. Verifique a internet e tente novamente.')
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
      toast('Não foi possível enviar a foto. Verifique a conexão e tente novamente.')
      return
    }
  }

  try {
    await saveClosure(state.current, fotoUrl)
    toast('Fechamento salvo.')

    // Confirmar sangrias e gravar resumo (não-críticos — erros não bloqueiam o fluxo)
    const snapId = state.current.id
    const snapCurrent = { ...state.current }
    const snapSangrias = [...state.sangriasTurno]
    const snapCancelamentos = [...state.cancelamentosTurno]
    const snapTipos = { ...state.sangriaTipoChanges }
    try { if (snapSangrias.length) await confirmSangrias(snapSangrias, snapId, snapTipos) } catch (_) {}
    try { await saveFechamentoResumo(snapCurrent, snapSangrias, snapCancelamentos, snapTipos) } catch (_) {}

    await loadCloudClosures()
    const { renderClosures } = window.__history || {}
    renderClosures && renderClosures()
    state.photoFile = null
    stopPhotoRequest()
    newClosure()
    state.step = 1
    render()
  } catch (e) {
    toast('Não foi possível salvar. Verifique a conexão e tente novamente.')
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
      <div class="field"><label>Data do turno</label>
        <input type="date" id="dataMov" value="${state.current.data || today()}">
        ${new Date().getHours() < 6 ? '<div class="hint" style="color:#f59e0b">Antes das 6h — data ajustada para o turno anterior.</div>' : ''}
      </div>
      <div class="field"><label>Terminal / caixa</label>
        <input id="terminal" value="${esc(state.current.terminal || 'CAIXA')}"></div>
      <div class="field"><label>Valor de abertura da gaveta</label>
        <input class="brl money" inputmode="decimal" id="abertura"
          value="${money(state.current.abertura || 0)}" placeholder="R$ 0,00"></div>
    </div>
    <div style="margin-top:14px" id="openBox">${openingBox()}</div>
    ${footer()}`
}

function openingBox() {
  if (state.current.aberturaOK === null)
    return `<div class="alert blue">Ao continuar, o sistema verifica se este valor bate com o troco deixado pelo caixa anterior.</div>`
  if (state.current.aberturaOK)
    return `<div class="alert ok"><b>Tudo certo:</b> valor confere com o troco deixado pelo caixa anterior.</div>`
  return `<div class="alert bad">
    <b>Valor diferente do troco deixado pelo caixa anterior.</b>
    Reconte se necessário, ou confirme mesmo assim.
    <div class="btns" style="margin-top:10px">
      <button class="btn light" onclick="document.getElementById('abertura').focus()">Recontar e corrigir</button>
      <button class="btn primary" onclick="window.__wizard.confirmDivAbertura()">Confirmar mesmo assim</button>
    </div>
    ${state.current.aberturaConfirmada ? '<p><b>Diferença confirmada e registrada.</b></p>' : ''}
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
    lendo: '<div class="alert blue"><b>Lendo a foto...</b> aguarde um momento.</div>',
    ok: '<div class="alert ok"><b>Foto lida!</b> Confira os valores preenchidos abaixo.</div>',
    erro: '<div class="alert warn"><b>Não consegui ler os valores.</b> Preencha ou corrija manualmente.</div>'
  }[state.current.ocrStatus] || ''

  const cards = activeForms().map(f => {
    const p = state.current.pagamentos.find(x => x.formId === f.id) || {}
    const agent = f.origem === 'agente'

    // Valor que vai aparecer como padrão no campo confirmado:
    // se já confirmado → valor confirmado; se não → copia o valor da IA
    const confDefault = p.confirmed ? money(p.confirmedValue) : (p.iaValue > 0 ? money(p.iaValue) : '')

    // Campo IA: display readonly (nunca editável)
    const iaDisplay = f.ia
      ? `<div style="min-height:48px;padding:13px 14px;background:#f3f4f6;border:1px solid #e5e7eb;
                    border-radius:16px;font-weight:760;color:#374151;display:flex;align-items:center;
                    font-size:15px">
           ${p.iaValue > 0 ? money(p.iaValue) : '<span style="color:#9ca3af">—</span>'}
         </div>`
      : `<div style="min-height:48px;padding:13px 14px;background:#f9fafb;border:1px solid #f0f0f0;
                    border-radius:16px;font-weight:760;color:#9ca3af;display:flex;align-items:center;
                    font-size:13px">Inserir manualmente</div>`

    return `<div class="payment ${p.confirmed ? 'confirmed' : ''} ${p.edited ? 'edited' : ''}">
      <div class="payrow">
        <div>
          <span class="chip ${agent ? 'chipwarn' : f.ia ? 'chipblue' : ''}">${esc(f.nome)}</span>
          <div style="font-size:12px;color:#6b7280;margin-top:8px">${agent ? 'Em breve' : f.ia ? 'Automático' : 'Manual'}</div>
        </div>
        <div class="field">
          <label>Lido automaticamente</label>
          ${iaDisplay}
        </div>
        <div class="field">
          <label>Valor confirmado</label>
          <input class="brl conf money" data-id="${f.id}" value="${confDefault}"
            placeholder="R$ 0,00" inputmode="decimal">
        </div>
        <div class="btns">
          <button class="btn success small" onclick="window.__wizard.confirmPay('${f.id}')"><i data-lucide="check"></i> Confirmar</button>
        </div>
      </div>
      ${p.edited ? '<div class="alert warn" style="margin-top:10px">Valor alterado manualmente.</div>' : ''}
    </div>`
  }).join('')

  const fotoStatus = state.current.fotoUrl
    ? `<div class="alert ok" style="margin-top:10px"><b>Foto recebida.</b></div>`
    : ''

  const fotosGallery = (state.current.fotos || []).length > 0
    ? `<div style="margin-top:12px">
         <div style="font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:8px">
           Fotos recebidas (${state.current.fotos.length})
         </div>
         <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
           ${state.current.fotos.map((f, i) => f.preview
             ? `<img src="${f.preview}" style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:2px solid #e5e7eb;cursor:pointer"
                  onclick="window.__history?.openPhoto('${esc(f.url)}','Foto ${i+1}','','')"> `
             : `<div style="width:64px;height:64px;border-radius:10px;background:#f3f4f6;border:2px solid #e5e7eb;display:flex;align-items:center;justify-content:center;font-size:11px;color:#9ca3af">Foto ${i+1}</div>`
           ).join('')}
         </div>
         <button class="btn secondary small" onclick="window.__wizard.addPhoto()"><i data-lucide="camera"></i> Solicitar outra foto</button>
       </div>`
    : ''

  const incertoPanel = (state.current.ocrIncerto || []).length > 0
    ? `<div class="alert warn" style="margin-top:14px">
         <b>&#9888; Encontramos valores que não identificamos — selecione a forma de pagamento correspondente:</b>
         <div style="margin-top:10px;display:grid;gap:10px">
           ${state.current.ocrIncerto.map((item, i) => `
             <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px;background:rgba(255,255,255,.6);border-radius:10px">
               <div>
                 <div style="font-weight:800;font-size:13px">${esc(item.texto)}</div>
                 <div style="font-size:12px;color:#9ca3af">${money(item.valor)}</div>
               </div>
               <select onchange="window.__wizard.associarIncerto(${i}, this.value)"
                 style="flex:1;min-height:36px;border-radius:10px;padding:4px 10px;font-size:13px;border:1px solid #fde68a">
                 <option value="">Selecione a forma de pagamento...</option>
                 ${activeForms().map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}
                 <option value="ignorar">— Ignorar este item</option>
               </select>
             </div>`).join('')}
         </div>
       </div>`
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
        ${fotosGallery}
        <div class="btns" style="margin-top:10px">
          <button class="btn secondary" onclick="window.__ocr.retryOcr()"><i data-lucide="rotate-cw"></i> Tentar novamente</button>
        </div>
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
        <div class="alert blue">Confira e confirme cada valor. Se alterar algum, ele ficará marcado na conferência.</div>
        <div class="grid">${cards}</div>
        ${incertoPanel}
      </div>
    </div>
    ${footer()}`
}

export function addPhoto() {
  requestAnotherPhoto()
}

export function associarIncerto(i, formId) {
  const item = state.current.ocrIncerto?.[i]
  if (!item) return
  if (formId === 'ignorar') {
    state.current.ocrIncerto.splice(i, 1)
    render()
    return
  }
  if (!formId) return
  saveLearnedAssociation(item.texto, formId)
  const p = state.current.pagamentos.find(x => x.formId === formId)
  if (p) {
    p.iaValue = item.valor
    p.confirmedValue = item.valor
    p.confirmed = false
    p.edited = false
  }
  state.current.ocrIncerto.splice(i, 1)
  toast(`"${item.texto}" → "${formId}" salvo. Usarei essa associação nas próximas leituras.`)
  render()
}

export function syncPay() {
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
      <button class="btn danger small" onclick="window.__wizard.removeCash(${i})"><i data-lucide="x"></i></button>
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
          <button class="btn secondary" onclick="window.__wizard.addCash()"><i data-lucide="plus"></i> Adicionar</button>
          <button class="btn light" onclick="window.__wizard.clearCash()"><i data-lucide="trash-2"></i> Limpar</button>
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

// ─── Etapa 5 — Sangrias & Troco ──────────────────────────────────────────────

export function changeSangriaTipo(id, tipo) {
  state.sangriaTipoChanges[id] = tipo
}

function stepSangria() {
  calc()

  if (!state.sangriasTurnoLoaded && !state.sangriasTurnoLoading && state.current.data) {
    state.sangriasTurnoLoading = true
    Promise.all([
      loadSangriasTurno(state.current.data),
      loadCancelamentosTurno(state.current.data)
    ]).then(([sangrias, cancelamentos]) => {
      if (state.step !== 5) return
      state.sangriasTurno = sangrias || []
      state.cancelamentosTurno = cancelamentos || []
      state.sangriasTurnoLoaded = true
      state.sangriasTurnoLoading = false
      render()
    }).catch(() => {
      state.sangriasTurnoLoaded = true
      state.sangriasTurnoLoading = false
    })
    return `<div class="alert blue"><b>Buscando sangrias e cancelamentos do turno...</b></div>${footer()}`
  }

  const sangrias = state.sangriasTurno
  const cancelamentos = state.cancelamentosTurno
  const tipoOptions = [
    ['musico','Músico / Banda'],['extra','Extra / Freelancer'],
    ['vale','Vale (adiantamento)'],['cofre','Cofre (dono)'],['outro','Outro']
  ]
  const totalSangrias = sangrias.reduce((s, x) => s + Number(x.valor || 0), 0)
  const totalCancel = cancelamentos.reduce((s, x) => s + Number(x.valor || 0), 0)

  const sangriasPanel = sangrias.length
    ? `<div style="margin-bottom:14px">
         <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
           <b>Sangrias capturadas pela impressora</b>
           <span class="chip chipblue">${sangrias.length} · ${money(totalSangrias)}</span>
         </div>
         <div class="table">
           <table>
             <thead><tr><th>Hora</th><th>Motivo</th><th class="num">Valor</th><th>Tipo</th></tr></thead>
             <tbody>${sangrias.map(s => {
               const hora = s.data_hora ? s.data_hora.slice(11, 16) : '—'
               const cur = state.sangriaTipoChanges[s.id] || s.tipo || 'outro'
               const opts = tipoOptions.map(([v, l]) =>
                 `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')
               return `<tr>
                 <td>${esc(hora)}</td>
                 <td>${esc(s.motivo || '—')}</td>
                 <td class="num">${money(s.valor)}</td>
                 <td><select style="font-size:12px;border-radius:8px;padding:4px 8px;border:1px solid #d1d5db"
                   onchange="window.__wizard.changeSangriaTipo('${s.id}',this.value)">${opts}</select></td>
               </tr>`
             }).join('')}</tbody>
           </table>
         </div>
         <div class="summary" style="margin-top:10px">
           <small>Total capturado pelo agente</small>
           <strong>${money(totalSangrias)}</strong>
         </div>
       </div>`
    : `<div class="alert blue" style="margin-bottom:14px">
         Nenhuma sangria capturada pelo agente para <b>${esc(state.current.data)}</b>.
         Se houve sangrias, use o campo ao lado.
       </div>`

  const cancelPanel = cancelamentos.length
    ? `<details style="margin-top:6px">
         <summary style="cursor:pointer;font-weight:800;font-size:13px;padding:8px 0">
           Cancelamentos do turno — ${cancelamentos.length} · ${money(totalCancel)}
         </summary>
         <div class="table" style="margin-top:10px">
           <table>
             <thead><tr><th>Hora</th><th>Produto</th><th>Motivo</th><th class="num">Valor</th></tr></thead>
             <tbody>${cancelamentos.map(c => {
               const hora = c.data_hora ? c.data_hora.slice(11, 16) : '—'
               return `<tr>
                 <td>${esc(hora)}</td>
                 <td>${esc(c.produto || '—')}</td>
                 <td>${esc(c.motivo || '—')}</td>
                 <td class="num">${money(c.valor)}</td>
               </tr>`
             }).join('')}</tbody>
           </table>
         </div>
       </details>`
    : `<div class="hint" style="margin-top:8px">Nenhum cancelamento neste turno.</div>`

  return `
    <div class="grid g2">
      <div>
        ${sangriasPanel}
        ${cancelPanel}
      </div>
      <div>
        <div class="alert warn">
          <b>Vá ao TOTVS e procure "SANGRIA TROCO".</b><br>
          Use <b>CTRL + F</b> na fita de fechamento. Se não aparecer, deixe R$ 0,00.
        </div>
        <div class="field"><label>Sangria Troco informada pelo TOTVS</label>
          <input id="sangria" class="brl money" inputmode="decimal"
            value="${state.current.sangriaTroco ? money(state.current.sangriaTroco) : ''}" placeholder="R$ 0,00">
        </div>
        <div class="summary"><small>Dinheiro contado na gaveta</small><strong>${money(state.current.dinheiroContado)}</strong></div>
        <div class="hint">O valor de dinheiro para lançar no TOTVS aparece na próxima etapa.</div>
      </div>
    </div>
    ${footer()}`
}

// ─── Etapa 6 — Lançar TOTVS ──────────────────────────────────────────────────

function rowsFinal() {
  calc()
  return [
    ...state.current.pagamentos
      .filter(p => Number(p.confirmedValue || 0) > 0)
      .slice().sort((a, b) => (a.ordem || 999) - (b.ordem || 999))
      .map(p => ({ nome: p.nome, valor: Number(p.confirmedValue) })),
    { nome: 'Dinheiro', valor: Number(state.current.dinheiroTotvs || 0), destaque: true }
  ]
}

function stepTotvs() {
  const rows = rowsFinal().map(r =>
    `<tr ${r.destaque ? 'style="background:linear-gradient(135deg,#eff6ff,#dbeafe)"' : ''}>
     <td ${r.destaque ? 'style="font-weight:1000;color:#1e40af"' : ''}>${esc(r.nome)}</td>
     <td class="num" ${r.destaque ? 'style="color:#1e40af"' : ''}>${money(r.valor)}</td>
     <td><button class="btn light small" onclick="window.__wizard.copy('${money(r.valor)}')"><i data-lucide="copy"></i> Copiar</button></td>
    </tr>`
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
      <button class="btn secondary" onclick="window.__wizard.copyAll()"><i data-lucide="clipboard-list"></i> Copiar resumo</button>
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
  const pays = state.current.pagamentos
    .filter(p => Number(p.confirmedValue || 0) > 0)
    .map(p =>
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
