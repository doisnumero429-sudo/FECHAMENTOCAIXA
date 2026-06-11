# -*- coding: utf-8 -*-
"""
Gera um dashboard HTML autocontido (estilo Araçá Grill) a partir das capturas
reais de FECHAMENTO. Uso:

    python3 motor/gerar_dashboard.py CAMINHO/TODAS_IMPRESSOES_CAIXA.txt saida.html
"""
import json
import re
import sys
from pathlib import Path

# import robusto: roda de qualquer pasta
sys.path.insert(0, str(Path(__file__).parent))
from engine import extrair_fechamentos, agregar, carregar_catalogo, SANGRIA_LABELS  # noqa: E402


def limpar(s: str) -> str:
    """Remove mojibake de encoding (cp850 lido errado) das descrições."""
    s = re.sub(r"[ÃÂ][\x80-\xBF|,]?", "", s)
    s = re.sub(r"[^\x20-\x7EÀ-ÿ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


HTML = r"""<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Araçá Grill — Painel do Caixa</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f2f5;color:#222;font-size:14px}
header{background:#1a1a2e;color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
header h1{font-size:18px;font-weight:600}
header span{font-size:12px;opacity:.6}
nav{background:#fff;border-bottom:2px solid #e8e8e8;display:flex;overflow-x:auto;position:sticky;top:0;z-index:5}
nav button{padding:13px 22px;border:none;background:none;cursor:pointer;font-size:13px;color:#666;border-bottom:3px solid transparent;white-space:nowrap}
nav button:hover{color:#1a1a2e;background:#fafafa}
nav button.active{color:#1a1a2e;border-bottom-color:#e63946;font-weight:600}
.page{display:none;padding:20px 24px;max-width:1150px;margin:0 auto}
.page.active{display:block}
h2{font-size:15px;font-weight:600;margin-bottom:16px;color:#1a1a2e;padding-bottom:8px;border-bottom:1px solid #e8e8e8}
h3{font-size:13px;font-weight:600;margin-bottom:12px;color:#444}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px;margin-bottom:20px}
.card{background:#fff;border-radius:8px;padding:15px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.card .lbl{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.card .val{font-size:20px;font-weight:700;color:#1a1a2e}
.card .val.blue{color:#2563eb}.card .val.green{color:#2a9d5c}.card .val.red{color:#e63946}.card .val.gold{color:#b8860b}.card .val.purple{color:#7c3aed}
.card .sub{font-size:11px;color:#bbb;margin-top:4px}
.sec{background:#fff;border-radius:8px;padding:16px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:760px){.g2{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#f7f7f7;padding:9px 10px;text-align:left;font-weight:600;color:#555;border-bottom:2px solid #e8e8e8;white-space:nowrap;position:sticky;top:0}
td{padding:8px 10px;border-bottom:1px solid #f2f2f2;vertical-align:middle}
tr:hover td{background:#fafafa}
.num{text-align:right;font-variant-numeric:tabular-nums}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap}
.t-vale{background:#dbeafe;color:#1d4ed8}.t-extra{background:#d1fae5;color:#065f46}
.t-musico{background:#ede9fe;color:#5b21b6}.t-despesa{background:#fff3cd;color:#856404}
.t-cofre{background:#fee2e2;color:#b91c1c}.t-outro{background:#e5e7eb;color:#374151}
.brow{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.bname{width:190px;font-size:12px;color:#555;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bbg{flex:1;background:#f0f0f0;border-radius:4px;height:8px;overflow:hidden}
.bfill{height:8px;border-radius:4px;background:#e63946}
.bval{width:110px;text-align:right;font-size:12px;font-weight:700;flex-shrink:0}
.sbar{margin-bottom:12px}
.sbar input{width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:13px}
.cap{max-height:430px;overflow:auto;border:1px solid #f0f0f0;border-radius:6px}
.foot{text-align:center;color:#aaa;font-size:11px;padding:18px}
canvas{max-height:240px}
</style></head><body>
<header>
  <h1>🥩 Araçá Grill — Painel do Caixa</h1>
  <span id="periodo"></span>
</header>
<nav>
  <button class="active" onclick="show('pg-geral',this)">📊 Visão Geral</button>
  <button onclick="show('pg-prod',this)">🍽️ Produtos</button>
  <button onclick="show('pg-sang',this)">💸 Sangrias &amp; Comissão</button>
  <button onclick="show('pg-turno',this)">📅 Por Turno</button>
</nav>

<div id="pg-geral" class="page active">
  <h2>Visão Geral</h2>
  <div class="cards" id="kpis"></div>
  <div class="g2">
    <div class="sec"><h3>Faturamento por forma de pagamento</h3><canvas id="cv-formas"></canvas></div>
    <div class="sec"><h3>Faturamento por dia (R$)</h3><canvas id="cv-dias"></canvas></div>
  </div>
  <div class="sec"><h3>Resumo financeiro consolidado</h3><table id="tb-resumo"></table></div>
</div>

<div id="pg-prod" class="page">
  <h2>Produtos Vendidos</h2>
  <div class="cards" id="kpis-prod"></div>
  <div class="g2">
    <div class="sec"><h3>🏆 Top 12 produtos por faturamento (R$)</h3><div id="bars-prod"></div></div>
    <div class="sec"><h3>Faturamento por grupo (R$)</h3><canvas id="cv-grupos"></canvas></div>
  </div>
  <div class="sec">
    <h3>Todos os produtos</h3>
    <div class="sbar"><input id="busca" placeholder="🔎 Buscar produto..." oninput="filtra()"></div>
    <div class="cap"><table id="tb-prod"></table></div>
  </div>
</div>

<div id="pg-sang" class="page">
  <h2>Sangrias &amp; Comissão</h2>
  <div class="cards" id="kpis-sang"></div>
  <div class="g2">
    <div class="sec"><h3>Sangrias por categoria</h3><canvas id="cv-sang"></canvas></div>
    <div class="sec"><h3>Comissão por turno (R$)</h3><canvas id="cv-comis"></canvas></div>
  </div>
  <div class="sec"><h3>Sangrias detalhadas (item a item)</h3><div class="cap"><table id="tb-sang"></table></div></div>
</div>

<div id="pg-turno" class="page">
  <h2>Por Turno</h2>
  <div class="sec"><table id="tb-turno"></table></div>
</div>

<div class="foot">Gerado a partir das capturas reais do agente de impressão · __NFECH__ fechamento(s)</div>

<script>
const D = __DADOS__;
const money = v => 'R$ ' + (v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const C = {azul:'#2563eb',verde:'#2a9d5c',verm:'#e63946',roxo:'#7c3aed',ouro:'#b8860b',cinza:'#64748b',laranja:'#ea580c'};
function show(id,b){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');}
function card(lbl,val,cls,sub){return `<div class="card"><div class="lbl">${lbl}</div><div class="val ${cls||''}">${val}</div>${sub?`<div class="sub">${sub}</div>`:''}</div>`;}

const t=D.totais;
document.getElementById('periodo').textContent = D.periodo;

// ── KPIs Visão Geral ──
document.getElementById('kpis').innerHTML =
  card('Faturamento', money(t.faturamento),'green') +
  card('Comissão (garçons)', money(t.comissoes),'gold') +
  card('Sangrias', money(t.sangrias_total),'red') +
  card('Nº de pessoas', t.pessoas,'blue') +
  card('Ticket médio', money(t.pessoas? t.faturamento/t.pessoas:0),'') +
  card('Cortesias', money(t.cortesias),'purple') +
  card('Assinadas', money(t.assinadas),'') +
  card('Diferença de caixa', money(t.diferenca), t.diferenca<0?'red':'green');

new Chart(cvformas(),{type:'doughnut',data:{labels:['Crédito','Débito','PIX','Dinheiro'],
  datasets:[{data:[t.credito,t.debito,t.pix,t.dinheiro],backgroundColor:[C.azul,C.roxo,C.verde,C.ouro]}]},
  options:{plugins:{legend:{position:'right'}}}});
function cvformas(){return document.getElementById('cv-formas');}

new Chart(document.getElementById('cv-dias'),{type:'bar',data:{labels:D.turnos.map(x=>x.data),
  datasets:[{label:'Faturamento',data:D.turnos.map(x=>x.faturamento),backgroundColor:C.verde}]},
  options:{plugins:{legend:{display:false}}}});

document.getElementById('tb-resumo').innerHTML =
  `<tbody>
   <tr><td>Cartão de Crédito</td><td class="num">${money(t.credito)}</td></tr>
   <tr><td>Cartão de Débito</td><td class="num">${money(t.debito)}</td></tr>
   <tr><td>PIX</td><td class="num">${money(t.pix)}</td></tr>
   <tr><td>Dinheiro</td><td class="num">${money(t.dinheiro)}</td></tr>
   <tr><td><b>Faturamento total</b></td><td class="num"><b>${money(t.faturamento)}</b></td></tr>
   <tr><td>Comissão (gorjeta)</td><td class="num">${money(t.comissoes)}</td></tr>
   <tr><td>Descontos concedidos</td><td class="num">${money(t.descontos)}</td></tr>
   <tr><td>Cortesias</td><td class="num">${money(t.cortesias)}</td></tr>
   <tr><td>Contas assinadas</td><td class="num">${money(t.assinadas)}</td></tr>
   <tr><td>Transações na maquininha</td><td class="num">${t.transacoes}</td></tr>
   </tbody>`;

// ── Produtos ──
const prod = D.produtos.slice().sort((a,b)=>b.valor-a.valor);
const qtdeTotal = prod.reduce((s,p)=>s+p.qtde,0);
const valorTotal = prod.reduce((s,p)=>s+p.valor,0);
const maisVend = prod.slice().sort((a,b)=>b.qtde-a.qtde)[0]||{nome:'-',qtde:0};
document.getElementById('kpis-prod').innerHTML =
  card('Itens vendidos', qtdeTotal,'blue') +
  card('Faturamento em produtos', money(valorTotal),'green') +
  card('Produtos distintos', prod.length,'') +
  card('Campeão de vendas', maisVend.nome, 'gold', maisVend.qtde+' un');

const maxv = Math.max(1,...prod.slice(0,12).map(p=>p.valor));
document.getElementById('bars-prod').innerHTML = prod.slice(0,12).map(p=>
  `<div class="brow"><div class="bname" title="${p.nome}">${p.nome}</div>
   <div class="bbg"><div class="bfill" style="width:${100*p.valor/maxv}%"></div></div>
   <div class="bval">${money(p.valor)}</div></div>`).join('');

const grp = D.grupos.slice().sort((a,b)=>b.valor-a.valor);
new Chart(document.getElementById('cv-grupos'),{type:'bar',data:{labels:grp.map(g=>g.nome),
  datasets:[{data:grp.map(g=>g.valor),backgroundColor:C.laranja}]},
  options:{indexAxis:'y',plugins:{legend:{display:false}}}});

function tabelaProd(lista){document.getElementById('tb-prod').innerHTML =
  `<thead><tr><th>Produto</th><th>Grupo</th><th class="num">Qtde</th><th class="num">R$ total</th></tr></thead>
   <tbody>`+lista.map(p=>`<tr><td>${p.nome}</td><td>${p.grupo}</td>
   <td class="num">${p.qtde}</td><td class="num">${money(p.valor)}</td></tr>`).join('')+`</tbody>`;}
tabelaProd(prod);
function filtra(){const q=document.getElementById('busca').value.toLowerCase();
  tabelaProd(prod.filter(p=>p.nome.toLowerCase().includes(q)));}

// ── Sangrias ──
const sl = D.sangria_labels;
const st = D.sangrias_por_tipo;
document.getElementById('kpis-sang').innerHTML =
  Object.keys(sl).filter(k=>st[k]>0).map(k=>card(sl[k], money(st[k]),
    k==='despesa'?'red':k==='musico'?'purple':k==='vale'?'blue':k==='extra'?'green':'')).join('') ||
  card('Sem sangrias','—');

new Chart(document.getElementById('cv-sang'),{type:'doughnut',
  data:{labels:Object.keys(sl).filter(k=>st[k]>0).map(k=>sl[k]),
    datasets:[{data:Object.keys(sl).filter(k=>st[k]>0).map(k=>st[k]),
      backgroundColor:[C.azul,C.verde,C.roxo,C.ouro,C.verm,C.cinza]}]},
  options:{plugins:{legend:{position:'right'}}}});

new Chart(document.getElementById('cv-comis'),{type:'bar',data:{labels:D.turnos.map(x=>x.data),
  datasets:[{data:D.turnos.map(x=>x.comissoes),backgroundColor:C.ouro}]},
  options:{plugins:{legend:{display:false}}}});

document.getElementById('tb-sang').innerHTML =
  `<thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>`+
  D.sangrias_itens.sort((a,b)=>b.valor-a.valor).map(s=>
   `<tr><td>${s.data}</td><td><span class="tag t-${s.tipo}">${sl[s.tipo]}</span></td>
    <td>${s.descricao||s.nome}</td><td class="num">${money(s.valor)}</td></tr>`).join('')+`</tbody>`;

// ── Por turno ──
document.getElementById('tb-turno').innerHTML =
  `<thead><tr><th>Data</th><th>Operador</th><th class="num">Faturamento</th><th class="num">Comissão</th>
   <th class="num">Sangrias</th><th class="num">Pessoas</th><th class="num">Ticket</th><th class="num">Diferença</th></tr></thead>
   <tbody>`+D.turnos.map(x=>`<tr><td>${x.data}</td><td>${x.operador}</td>
   <td class="num">${money(x.faturamento)}</td><td class="num">${money(x.comissoes)}</td>
   <td class="num">${money(x.sangrias)}</td><td class="num">${x.pessoas}</td>
   <td class="num">${money(x.ticket)}</td>
   <td class="num" style="color:${x.diferenca<0?'#e63946':'#2a9d5c'}">${money(x.diferenca)}</td></tr>`).join('')+`</tbody>`;
</script></body></html>"""


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "TODAS_IMPRESSOES_CAIXA.txt"
    out = sys.argv[2] if len(sys.argv) > 2 else "dashboard.html"
    fes = extrair_fechamentos(src)
    dados = agregar(fes, carregar_catalogo())
    for s in dados["sangrias_itens"]:
        s["descricao"] = limpar(s["descricao"])
        s["nome"] = limpar(s["nome"])
    datas = sorted({t["data"] for t in dados["turnos"] if t["data"]})
    periodo = f"{datas[0]} a {datas[-1]}" if datas else ""
    payload = {
        "totais": dados["totais"],
        "sangrias_por_tipo": dados["sangrias_por_tipo"],
        "sangrias_itens": dados["sangrias_itens"],
        "produtos": dados["produtos"],
        "grupos": dados["grupos"],
        "turnos": dados["turnos"],
        "sangria_labels": SANGRIA_LABELS,
        "periodo": periodo,
    }
    html = (HTML
            .replace("__DADOS__", json.dumps(payload, ensure_ascii=False))
            .replace("__NFECH__", str(dados["n_fechamentos"])))
    Path(out).write_text(html, encoding="utf-8")
    print(f"OK: {out}  ({dados['n_fechamentos']} fechamentos, "
          f"faturamento {dados['totais']['faturamento']:.2f})")


if __name__ == "__main__":
    main()
