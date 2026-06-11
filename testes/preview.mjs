import { readFileSync, writeFileSync } from 'fs'
import { renderToString } from '../src/dashboard.js'

const data = JSON.parse(readFileSync(new URL('./_fita.json', import.meta.url)))
// extrai o bloco CSS do painel a partir do style.css
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const i = css.indexOf('Painel do Caixa (araca-dash)')
const cssBlock = i >= 0 ? css.slice(css.lastIndexOf('/*', i)) : ''
// tokens essenciais do :root para a prévia ficar fiel
const root = (css.match(/:root\{[\s\S]*?\}/) || [''])[0]

const views = ['geral', 'produtos', 'sangrias', 'cancel', 'turno']
let secoes = ''
for (const v of views) {
  const html = renderToString(data, { view: v, filtro: { ini: null, fim: null, weekKey: 'todo' } })
  secoes += `<h2 style="margin:28px 24px 6px;font:700 14px sans-serif;color:#888">VIEW: ${v}</h2>
    <div class="araca-dash" style="padding:0 24px">${html}</div>`
}
// teste de drill aberto (cancelamentos)
const drill = renderToString(data, { view: 'geral', filtro: { ini: null, fim: null, weekKey: 'todo' }, drill: 'cancel' })

const out = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Prévia — Painel do Caixa</title><style>${root}
body{background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:20px 0}
${cssBlock}</style></head><body>
<h1 style="margin:0 24px 10px;font:800 20px sans-serif">Prévia do Painel (código real da app, dados reais)</h1>
<h2 style="margin:28px 24px 6px;font:700 14px sans-serif;color:#888">VIEW: geral + drill CANCELAMENTOS aberto</h2>
<div class="araca-dash" style="padding:0 24px">${drill}</div>
${secoes}</body></html>`
writeFileSync(new URL('./Preview_Painel.html', import.meta.url), out)
console.log('OK preview gerada; tamanho', out.length)
