// Estado global da aplicação — sem acesso ao DOM

export const DEFAULT_FORMS = [
  {id:'credito',nome:'Crédito',tipo:'cartao',ativo:true,ordem:1,aparece:true,ia:true,origem:'ia',aliases:['CRED','CREDITO','CRÉDITO','CARTAO CREDITO']},
  {id:'debito',nome:'Débito',tipo:'cartao',ativo:true,ordem:2,aparece:true,ia:true,origem:'ia',aliases:['DEB','DEBITO','DÉBITO','CARTAO DEBITO']},
  {id:'pix',nome:'Pix',tipo:'pix',ativo:true,ordem:3,aparece:true,ia:true,origem:'manual',aliases:['PIX']},
  {id:'voucher',nome:'Voucher',tipo:'voucher',ativo:true,ordem:4,aparece:true,ia:true,origem:'ia',aliases:['VOUCHER','VALE','VR','SODEXO','ALELO']},
  {id:'assinadas',nome:'Assinadas',tipo:'fiado',ativo:true,ordem:5,aparece:true,ia:false,origem:'agente',aliases:['ASSINADA','FIADO','ASSINADAS']},
  {id:'ifood',nome:'iFood',tipo:'delivery',ativo:true,ordem:6,aparece:true,ia:false,origem:'manual',aliases:['IFOOD','I-FOOD']}
]

export const DEFAULT_OPS = [{id:'operador_padrao',nome:'Operador',ativo:true,ordem:1}]
export const DEFAULT_SHIFTS = [{id:'almoco',nome:'Almoço',ativo:true,ordem:1},{id:'noite',nome:'Noite',ativo:true,ordem:2}]

export const STEPS = [
  ['Abertura','Confirme operador, turno e valor inicial.'],
  ['App Meu Caixa','Abra o app no celular antes de continuar.'],
  ['Maquininha','Aguarde a foto e confirme os valores.'],
  ['Dinheiro','Digite os valores da gaveta.'],
  ['Sangria troco','Procure no TOTVS.'],
  ['Lançar TOTVS','Copie os valores finais.'],
  ['Resultado','Informe se houve diferença.'],
  ['Salvar','Revise e salve.']
]

export const state = {
  sb: null,
  step: 1,
  forms: [],
  operators: [],
  shifts: [],
  closures: [],
  current: null,
  photoFile: null,
  photoPollInterval: null,
  currentPedidoId: null
}

export function uid(p = 'id') {
  return p + '_' + Date.now() + '_' + Math.random().toString(16).slice(2)
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

export function activeForms() {
  return state.forms.filter(f => f.ativo && f.aparece).sort((a, b) => (a.ordem || 999) - (b.ordem || 999))
}

export function activeOps() {
  return state.operators.filter(o => o.ativo).sort((a, b) => (a.ordem || 999) - (b.ordem || 999))
}

export function activeShifts() {
  return state.shifts.filter(o => o.ativo).sort((a, b) => (a.ordem || 999) - (b.ordem || 999))
}

export function newClosure() {
  state.current = {
    id: uid('fechamento'),
    data: today(),
    turno: '',
    operador: '',
    terminal: 'CAIXA',
    abertura: 0,
    aberturaOK: null,
    aberturaConfirmada: false,
    fotoNome: '',
    fotoUrl: '',
    fotoPreview: '',
    ocrStatus: 'aguardando',
    ocrText: '',
    pagamentos: [],
    cash: [],
    dinheiroContado: 0,
    sangriaTroco: 0,
    dinheiroTotvs: 0,
    trocoFinal: 0,
    houveDiferenca: false,
    obsDiferenca: '',
    alertas: [],
    fotos: [],
    ocrIncerto: [],
    criado_em: new Date().toISOString()
  }
  hydrate()
  updateDraftBadge()
  return state.current
}

export function hydrate() {
  const ids = new Set(activeForms().map(f => f.id))
  activeForms().forEach(f => {
    if (!state.current.pagamentos.find(p => p.formId === f.id)) {
      state.current.pagamentos.push({
        formId: f.id,
        nome: f.nome,
        iaValue: 0,
        confirmedValue: 0,
        confirmed: false,
        edited: false,
        ordem: f.ordem,
        origem: f.origem
      })
    }
  })
  state.current.pagamentos = state.current.pagamentos.filter(p => ids.has(p.formId))
}

export function calc() {
  const c = state.current
  c.dinheiroContado = c.cash.reduce((s, v) => s + Number(v || 0), 0)
  c.trocoFinal = c.dinheiroContado
  c.dinheiroTotvs = Math.round((c.dinheiroContado - c.abertura + c.sangriaTroco) * 100) / 100
}

export function buildAlerts() {
  const c = state.current
  const a = []
  if (c.aberturaOK === false)
    a.push({ nivel: 'bad', texto: 'Abertura diferente do troco final anterior.' })
  if (c.aberturaConfirmada)
    a.push({ nivel: 'warn', texto: 'Operador confirmou abertura com divergência.' })
  if (!c.fotoNome && !c.fotoUrl)
    a.push({ nivel: 'warn', texto: 'Sem foto do relatório da maquininha.' })
  const edits = c.pagamentos.filter(p => p.edited).length
  if (edits)
    a.push({ nivel: 'warn', texto: edits + ' valor(es) editado(s) após OCR.' })
  if (c.houveDiferenca)
    a.push({ nivel: 'bad', texto: 'TOTVS informou diferença.' })
  c.alertas = a
}

export function lastClosure() {
  const c = state.current
  return state.closures
    .filter(x =>
      x.id !== c.id &&
      (x.terminal || 'CAIXA') === (c.terminal || 'CAIXA') &&
      x.status === 'fechado' &&
      x.trocoFinal !== undefined &&
      x.trocoFinal !== null
    )
    .sort((a, b) => new Date(b.criado_em || b.data) - new Date(a.criado_em || a.data))[0] || null
}

export function compareOpening() {
  const prev = lastClosure()
  if (!prev) { state.current.aberturaOK = null; return }
  state.current.aberturaOK = Math.abs(Number(prev.trocoFinal || 0) - Number(state.current.abertura || 0)) < 0.01
  if (state.current.aberturaOK) state.current.aberturaConfirmada = false
}

export function loadDefaults() {
  state.forms = clone(DEFAULT_FORMS)
  state.operators = clone(DEFAULT_OPS)
  state.shifts = clone(DEFAULT_SHIFTS)
  state.closures = []
  newClosure()
}

function updateDraftBadge() {
  const d = document.getElementById('draft')
  if (d) d.textContent = state.sb ? 'Somente nuvem' : 'Nuvem indisponível'
}
