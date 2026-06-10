import './style.css'
import { createIcons, LayoutDashboard, Search, Settings2, RefreshCw, Copy, ChevronsDown, ChevronsUp, Save, ArrowLeft, ArrowRight, Plus, CheckCircle, Check, Trash2, X, RotateCw, Camera, ClipboardList, Image, ExternalLink, AlertTriangle, Info, ChevronRight, ChevronDown } from 'lucide'
import autoAnimate from '@formkit/auto-animate'
import { state, loadDefaults, activeForms, activeOps, activeShifts, hydrate } from './state.js'
import { closePhotoModal, photoModalBackdrop, toast } from './ui.js'
import { initSupabase, syncFromCloud, loadCloudClosures } from './supabase.js'
import { render, next, prev, startNew, finish, confirmDivAbertura, syncPay, confirmPay, zeroPay, toggleJson, applyJsonUI, addCash, removeCash, clearCash, copy, copyAll, toggleDif, addPhoto, associarIncerto, changeSangriaTipo, changeDigitacaoTotvs, autofillExplicacao, autofillCompensacao } from './wizard.js'
import { renderConfig, updateConfigCounters, updSimple, moveSimple, removeSimple, addOperator, addShift, updForm, updAliases, moveForm, removeForm, addForm, resetForms, toggleConfigSections, copySql, saveConfig, updTolerancia, addTolerancia, removeTolerancia, resetTolerancias } from './config.js'
import { renderClosures, openPhoto, refreshClosures, copyJson } from './history.js'
import { retryOcr } from './ocr.js'
import { handleManualAdvance, handleFallbackUpload } from './photo-request.js'

const ICONS = {
  LayoutDashboard, Search, Settings2, RefreshCw, Copy, ChevronsDown, ChevronsUp, Save,
  ArrowLeft, ArrowRight, Plus, CheckCircle, Check, Trash2, X, RotateCw, Camera,
  ClipboardList, Image, ExternalLink, AlertTriangle, Info, ChevronRight, ChevronDown
}

function refreshIcons() { createIcons({ icons: ICONS }) }
window.__refreshIcons = refreshIcons

// Expor closePhotoModal globalmente (usado no botão X do modal no HTML estático)
window.__ui = { closePhotoModal }

// Expor funções globalmente para os handlers HTML (onclick inline nos templates)
window.__wizard = {
  next, prev, startNew, finish, confirmDivAbertura,
  syncPay, confirmPay, zeroPay, toggleJson, applyJsonUI,
  addCash, removeCash, clearCash, copy, copyAll, toggleDif,
  addPhoto, associarIncerto, changeSangriaTipo,
  changeDigitacaoTotvs, autofillExplicacao, autofillCompensacao
}
window.__config = {
  updSimple, moveSimple, removeSimple, addOperator, addShift,
  updForm, updAliases, moveForm, removeForm, addForm, resetForms,
  toggleConfigSections, copySql, saveConfig,
  updTolerancia, addTolerancia, removeTolerancia, resetTolerancias
}
window.__history = { renderClosures, openPhoto, refreshClosures, copyJson }
window.__ocr = { retryOcr }
window.__photoRequest = { handleManualAdvance, handleFallbackUpload }

// Helpers de estado expostos para wizard e config
window.__stateHelpers = { activeForms, activeOps, activeShifts, hydrate }

// Render principal (usado por módulos internos via window.__appRender)
window.__appRender = { render, next }

function showPage(id) {
  const page = document.getElementById('page-' + id)
  if (!page) return
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  page.classList.add('active')
  document.querySelectorAll('.nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.page === id)
  )
  const map = {
    fechamento: ['Fechamento guiado', 'Abertura, maquininha, dinheiro, sangria troco, TOTVS e conferência.'],
    consulta: ['Conferência', 'Histórico, alertas e divergências.'],
    config: ['Configurações', 'Nuvem, operadores, turnos, formas de pagamento, SQL e manutenção.']
  }
  const [title, subtitle] = map[id] || ['', '']
  document.getElementById('title').textContent = title
  document.getElementById('subtitle').textContent = subtitle
  if (id === 'config') renderConfig()
  if (id === 'consulta') renderClosures()
  requestAnimationFrame(refreshIcons)
}

// Handlers de navegação
document.querySelectorAll('.nav button').forEach(b =>
  b.addEventListener('click', () => showPage(b.dataset.page))
)

// Modal de foto
document.getElementById('photoModal')?.addEventListener('click', photoModalBackdrop)
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePhotoModal() })

// Botões da página de conferência
document.getElementById('btnRefreshCloud')?.addEventListener('click', refreshClosures)
document.getElementById('btnCopyJson')?.addEventListener('click', copyJson)

// Botões de configuração
document.getElementById('btnOpenAll')?.addEventListener('click', () => toggleConfigSections(true))
document.getElementById('btnCloseAll')?.addEventListener('click', () => toggleConfigSections(false))
document.getElementById('btnSaveConfig')?.addEventListener('click', saveConfig)

// Boot
async function boot() {
  loadDefaults()
  initSupabase()
  await syncFromCloud()
  await loadCloudClosures()
  render()
  renderConfig()
  renderClosures()
  requestAnimationFrame(refreshIcons)
  autoAnimate(document.getElementById('closures') || document.body)
}

boot()
