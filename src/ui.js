// Utilidades de UI: formatação, toast, modal, helpers DOM

export function money(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function parseMoney(v) {
  if (typeof v === 'number') return Math.round(v * 100) / 100
  if (!v) return 0
  let s = String(v).replace(/R\$|\s/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export function moneyInput(el) {
  if (!el) return 0
  const n = parseMoney(el.value)
  el.value = n ? money(n) : ''
  return n
}

export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]))
}

let toastTimer = null
export function toast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000)
}

export function openPhotoModal(url, nome, data, operador) {
  if (!url) return toast('Este fechamento não tem foto salva na nuvem.')
  const modal = document.getElementById('photoModal')
  const img = document.getElementById('photoModalImg')
  const title = document.getElementById('photoModalTitle')
  const sub = document.getElementById('photoModalSub')
  title.textContent = nome || 'Foto do relatório da maquininha'
  sub.textContent = [data || '', operador ? ('Operador: ' + operador) : ''].filter(Boolean).join(' · ') || 'Imagem salva na nuvem'
  img.src = url
  modal.classList.add('show')
}

export function closePhotoModal() {
  const modal = document.getElementById('photoModal')
  const img = document.getElementById('photoModalImg')
  modal.classList.remove('show')
  setTimeout(() => { img.src = '' }, 160)
}

export function photoModalBackdrop(e) {
  if (e.target && e.target.id === 'photoModal') closePhotoModal()
}

export function attachMoneyListeners() {
  document.querySelectorAll('.brl').forEach(el => {
    if (el._moneyBound) return
    el._moneyBound = true
    el.addEventListener('blur', () => moneyInput(el))
    el.addEventListener('focus', () => setTimeout(() => el.select && el.select(), 10))
  })
}
