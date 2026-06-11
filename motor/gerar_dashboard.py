# -*- coding: utf-8 -*-
"""
Gera um dashboard HTML autocontido (estilo Araçá Grill) a partir das capturas
reais de FECHAMENTO + CANCELAMENTOS. Filtros de tempo por semana (seg→dom) e
período personalizado, com drill-down nos lançamentos.

    python3 motor/gerar_dashboard.py CAMINHO/TODAS_IMPRESSOES_CAIXA.txt saida.html
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from engine import (extrair_fechamentos, extrair_cancelamentos, carregar_catalogo,  # noqa: E402
                    preco_catalogo, ascii_fold, SANGRIA_LABELS)


def limpar(s: str) -> str:
    """Remove mojibake (cp850 lido errado) das descrições."""
    s = re.sub(r"[ÃÂ][\x80-\xBF|,]?", "", s or "")
    s = re.sub(r"[^\x20-\x7EÀ-ÿ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def montar_payload(src: str) -> dict:
    catalogo = carregar_catalogo()
    cat_norm = {ascii_fold(k): v for k, v in catalogo.items()}
    cat_keys = list(cat_norm.keys())
    fes = extrair_fechamentos(src)
    cancel = extrair_cancelamentos(src)

    fechamentos = []
    for f in fes:
        produtos = []
        for grp in f["produtos"]:
            for it in grp["itens"]:
                preco = preco_catalogo(it["produto"], cat_norm, cat_keys) or 0.0
                produtos.append({"nome": it["produto"], "grupo": grp["grupo"],
                                 "qtde": it["qtde"], "valor": round(it["qtde"] * preco, 2)})
        sangrias = [{"tipo": s["tipo"], "valor": s["valor"],
                     "desc": limpar(s["descricao"] or s["nome"])} for s in f["sangrias"]]
        cortesias = [{"nome": limpar(c["nome"]), "desc": limpar(c["descricao"]), "valor": c["valor"]}
                     for c in f["cortesias"]]
        fechamentos.append({
            "data": f["data_iso"], "data_br": (f["abertura_dt"] or f["fechamento_dt"] or "")[:10],
            "operador": f["operador_fechamento"], "caixa": f["caixa_numero"], "fech": f["fech_numero"],
            "credito": f["credito"], "debito": f["debito"], "pix": f["pix"], "dinheiro": f["dinheiro"],
            "comissoes": f["comissoes"], "cortesias_total": f["cortesias_total"],
            "assinadas_total": f["assinadas_total"], "descontos_total": f["descontos_total"],
            "sangrias_total": f["sangrias_total"], "diferenca_total": f["diferenca_total"],
            "pessoas": f["numero_pessoas"], "transacoes": f["qtde_transacoes"],
            "sangrias": sangrias, "cortesias": cortesias, "produtos": produtos,
            "contas_canceladas": f["contas_canceladas"],
        })

    return {"fechamentos": fechamentos, "cancelamentos": cancel, "sangria_labels": SANGRIA_LABELS}


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
nav{background:#fff;border-bottom:2px solid #e8e8e8;display:flex;overflow-x:auto;position:sticky;top:0;z-index:5}
nav button{padding:13px 22px;border:none;background:none;cursor:pointer;font-size:13px;color:#666;border-bottom:3px solid transparent;white-space:nowrap}
nav button.active{color:#1a1a2e;border-bottom-color:#e63946;font-weight:600}
.filtros{background:#fff;border-bottom:1px solid #e8e8e8;padding:12px 24px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.wtab{padding:7px 14px;border:2px solid #ddd;border-radius:20px;cursor:pointer;font-size:12px;background:#fff;white-space:nowrap}
.wtab:hover{border-color:#e63946;color:#e63946}
.wtab.active{background:#1a1a2e;color:#fff;border-color:#1a1a2e}
.filtros .sep{width:1px;height:24px;background:#e0e0e0;margin:0 4px}
.filtros label{font-size:12px;color:#777}
.filtros input[type=date]{padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px}
.page{display:none;padding:20px 24px;max-width:1150px;margin:0 auto}
.page.active{display:block}
h2{font-size:15px;font-weight:600;margin-bottom:16px;color:#1a1a2e;padding-bottom:8px;border-bottom:1px solid #e8e8e8}
h3{font-size:13px;font-weight:600;margin-bottom:12px;color:#444}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px;margin-bottom:20px}
.card{background:#fff;border-radius:8px;padding:15px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.card.click{cursor:pointer;transition:transform .08s,box-shadow .08s}
.card.click:hover{transform:translateY(-2px);box-shadow:0 3px 10px rgba(0,0,0,.12)}
.card.click.sel{outline:2px solid #e63946}
.card .lbl{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.card .val{font-size:20px;font-weight:700;color:#1a1a2e}
.card .val.blue{color:#2563eb}.card .val.green{color:#2a9d5c}.card .val.red{color:#e63946}.card .val.gold{color:#b8860b}.card .val.purple{color:#7c3aed}
.card .sub{font-size:11px;color:#bbb;margin-top:4px}
.card .hint{font-size:10px;color:#e63946;margin-top:6px}
.sec{background:#fff;border-radius:8px;padding:16px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:760px){.g2{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#f7f7f7;padding:9px 10px;text-align:left;font-weight:600;color:#555;border-bottom:2px solid #e8e8e8;white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid #f2f2f2}
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
.bval{width:120px;text-align:right;font-size:12px;font-weight:700;flex-shrink:0}
.sbar input{width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:13px;margin-bottom:12px}
.cap{max-height:430px;overflow:auto;border:1px solid #f0f0f0;border-radius:6px}
.drill{display:none;margin-bottom:20px}
.drill.open{display:block}
.foot{text-align:center;color:#aaa;font-size:11px;padding:18px}
.vazio{color:#aaa;text-align:center;padding:24px;font-size:13px}
canvas{max-height:240px}
</style></head><body>
<header><h1>🥩 Araçá Grill — Painel do Caixa</h1><span id="periodo" style="font-size:12px;opacity:.7"></span></header>
<nav>
  <button class="active" onclick="show('pg-geral',this)">📊 Visão Geral</button>
  <button onclick="show('pg-prod',this)">🍽️ Produtos</button>
  <button onclick="show('pg-sang',this)">💸 Sangrias &amp; Comissão</button>
  <button onclick="show('pg-cancel',this)">❌ Cancelamentos</button>
  <button onclick="show('pg-turno',this)">📅 Por Turno</button>
</nav>
<div class="filtros" id="filtros">
  <span style="font-size:12px;color:#777;font-weight:600">Período:</span>
  <span id="wtabs"></span>
  <span class="sep"></span>
  <label>De <input type="date" id="dini"></label>
  <label>Até <input type="date" id="dfim"></label>
  <button class="wtab" onclick="aplicarRange()">Aplicar</button>
</div>

<div id="pg-geral" class="page active">
  <h2>Visão Geral</h2>
  <div class="cards" id="kpis"></div>
  <div class="drill sec" id="drill"></div>
  <div class="g2">
    <div class="sec"><h3>Faturamento por forma</h3><canvas id="cv-formas"></canvas></div>
    <div class="sec"><h3>Faturamento por dia (R$)</h3><canvas id="cv-dias"></canvas></div>
  </div>
  <div class="sec"><h3>Resumo financeiro consolidado</h3><table id="tb-resumo"></table></div>
</div>
<div id="pg-prod" class="page">
  <h2>Produtos Vendidos</h2><div class="cards" id="kpis-prod"></div>
  <div class="g2">
    <div class="sec"><h3>🏆 Top 12 por faturamento (R$)</h3><div id="bars-prod"></div></div>
    <div class="sec"><h3>Faturamento por grupo (R$)</h3><canvas id="cv-grupos"></canvas></div>
  </div>
  <div class="sec"><h3>Todos os produtos</h3>
    <div class="sbar"><input id="busca" placeholder="🔎 Buscar produto..." oninput="filtraProd()"></div>
    <div class="cap"><table id="tb-prod"></table></div></div>
</div>
<div id="pg-sang" class="page">
  <h2>Sangrias &amp; Comissão</h2><div class="cards" id="kpis-sang"></div>
  <div class="g2">
    <div class="sec"><h3>Sangrias por categoria</h3><canvas id="cv-sang"></canvas></div>
    <div class="sec"><h3>Comissão por dia (R$)</h3><canvas id="cv-comis"></canvas></div>
  </div>
  <div class="sec"><h3>Sangrias detalhadas (por data)</h3><div class="cap"><table id="tb-sang"></table></div></div>
</div>
<div id="pg-cancel" class="page">
  <h2>Cancelamentos</h2><div class="cards" id="kpis-cancel"></div>
  <div class="sec"><h3>Lançamentos de cancelamento (por data)</h3><div class="cap"><table id="tb-cancel"></table></div></div>
</div>
<div id="pg-turno" class="page">
  <h2>Por Turno</h2><div class="sec"><table id="tb-turno"></table></div>
</div>
<div class="foot">Painel alimentado pelas capturas do agente · padrão monetário R$ (real brasileiro)</div>

<script>
const RAW = __DADOS__;
const SL = RAW.sangria_labels;
const money = v => 'R$ ' + (Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const C = {azul:'#2563eb',verde:'#2a9d5c',verm:'#e63946',roxo:'#7c3aed',ouro:'#b8860b',cinza:'#64748b',laranja:'#ea580c'};
let charts = {}, filtro = {ini:null, fim:null}, drillAtivo = null;

function show(id,b){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');}
function card(lbl,val,cls,sub,key){return `<div class="card ${key?'click':''}" ${key?`onclick="drill('${key}',this)"`:''}>
  <div class="lbl">${lbl}</div><div class="val ${cls||''}">${val}</div>${sub?`<div class="sub">${sub}</div>`:''}
  ${key?'<div class="hint">clique p/ detalhes ▾</div>':''}</div>`;}

// ── Semanas (segunda → domingo) ──
function mondayOf(iso){const d=new Date(iso+'T12:00:00');const dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow);return d;}
function fmtDM(d){return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2);}
function isoOf(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
function construirSemanas(){
  const datas=[...new Set(RAW.fechamentos.map(f=>f.data).concat(RAW.cancelamentos.map(c=>c.data)).filter(Boolean))];
  const semanas={};
  datas.forEach(iso=>{const m=mondayOf(iso);const dom=new Date(m);dom.setDate(dom.getDate()+6);
    const k=isoOf(m);semanas[k]={ini:isoOf(m),fim:isoOf(dom),label:fmtDM(m)+'–'+fmtDM(dom)};});
  return Object.values(semanas).sort((a,b)=>a.ini<b.ini?1:-1);
}
function montarFiltros(){
  const sem=construirSemanas();
  let h=`<button class="wtab active" data-k="todo" onclick="selWeek(this,null,null)">Todo o período</button>`;
  sem.forEach(s=>h+=`<button class="wtab" data-k="${s.ini}" onclick="selWeek(this,'${s.ini}','${s.fim}')">Semana ${s.label}</button>`);
  document.getElementById('wtabs').innerHTML=h;
}
function selWeek(b,ini,fim){document.querySelectorAll('#wtabs .wtab').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');filtro={ini,fim};
  document.getElementById('dini').value=ini||'';document.getElementById('dfim').value=fim||'';render();}
function aplicarRange(){const i=document.getElementById('dini').value||null,f=document.getElementById('dfim').value||null;
  document.querySelectorAll('#wtabs .wtab').forEach(x=>x.classList.remove('active'));filtro={ini:i,fim:f};render();}

function noRange(d){return (!filtro.ini||d>=filtro.ini)&&(!filtro.fim||d<=filtro.fim);}

// ── Agregação dinâmica ──
function agregar(){
  const fs=RAW.fechamentos.filter(f=>noRange(f.data));
  const cs=RAW.cancelamentos.filter(c=>noRange(c.data));
  const t={faturamento:0,credito:0,debito:0,pix:0,dinheiro:0,comissoes:0,cortesias:0,assinadas:0,
    descontos:0,sangrias:0,diferenca:0,pessoas:0,transacoes:0};
  const st={},prodMap={},grpMap={},sangItens=[],cortItens=[],turnos=[],dias={};
  Object.keys(SL).forEach(k=>st[k]=0);
  fs.forEach(f=>{const fat=f.credito+f.debito+f.pix+f.dinheiro;
    t.faturamento+=fat;t.credito+=f.credito;t.debito+=f.debito;t.pix+=f.pix;t.dinheiro+=f.dinheiro;
    t.comissoes+=f.comissoes;t.cortesias+=f.cortesias_total;t.assinadas+=f.assinadas_total;
    t.descontos+=f.descontos_total;t.sangrias+=f.sangrias_total;t.diferenca+=f.diferenca_total;
    t.pessoas+=f.pessoas;t.transacoes+=f.transacoes;
    dias[f.data_br]=dias[f.data_br]||{fat:0,com:0};dias[f.data_br].fat+=fat;dias[f.data_br].com+=f.comissoes;
    f.sangrias.forEach(s=>{st[s.tipo]+=s.valor;sangItens.push({...s,data:f.data_br});});
    f.cortesias.forEach(c=>cortItens.push({...c,data:f.data_br}));
    f.produtos.forEach(p=>{const k=p.nome;(prodMap[k]=prodMap[k]||{nome:p.nome,grupo:p.grupo,qtde:0,valor:0});
      prodMap[k].qtde+=p.qtde;prodMap[k].valor+=p.valor;
      (grpMap[p.grupo]=grpMap[p.grupo]||{nome:p.grupo,qtde:0,valor:0});grpMap[p.grupo].qtde+=p.qtde;grpMap[p.grupo].valor+=p.valor;});
    turnos.push({data:f.data_br,operador:f.operador,faturamento:fat,comissoes:f.comissoes,
      sangrias:f.sangrias_total,pessoas:f.pessoas,ticket:f.pessoas?fat/f.pessoas:0,diferenca:f.diferenca_total});
  });
  return {t,st,prod:Object.values(prodMap),grp:Object.values(grpMap),sangItens,cortItens,
    turnos,dias,cancel:cs.slice().sort((a,b)=>a.data_hora<b.data_hora?-1:1)};
}

function destroy(){Object.values(charts).forEach(c=>c&&c.destroy());charts={};}

function render(){
  destroy();
  const A=agregar(),t=A.t;
  document.getElementById('periodo').textContent =
    filtro.ini||filtro.fim ? `${filtro.ini||'início'} a ${filtro.fim||'fim'}` : 'Todo o período';

  // KPIs (cards clicáveis abrem drill-down)
  document.getElementById('kpis').innerHTML =
    card('Faturamento',money(t.faturamento),'green') +
    card('Comissão (garçons)',money(t.comissoes),'gold','','comissao') +
    card('Sangrias',money(t.sangrias),'red',Object.keys(SL).filter(k=>A.st[k]>0).length+' categorias','sangrias') +
    card('Cancelamentos',money(A.cancel.reduce((s,c)=>s+c.valor,0)),'red',A.cancel.length+' lançamentos','cancel') +
    card('Cortesias',money(t.cortesias),'purple','','cortesias') +
    card('Nº de pessoas',t.pessoas,'blue') +
    card('Ticket médio',money(t.pessoas?t.faturamento/t.pessoas:0)) +
    card('Diferença de caixa',money(t.diferenca),t.diferenca<0?'red':'green');
  if(drillAtivo) drill(drillAtivo); else document.getElementById('drill').classList.remove('open');

  charts.formas=mkChart('cv-formas',{type:'doughnut',data:{labels:['Crédito','Débito','PIX','Dinheiro'],
    datasets:[{data:[t.credito,t.debito,t.pix,t.dinheiro],backgroundColor:[C.azul,C.roxo,C.verde,C.ouro]}]},
    options:{plugins:{legend:{position:'right'},tooltip:{callbacks:{label:c=>' '+money(c.parsed)}}}}});
  const dlabels=Object.keys(A.dias);
  charts.dias=mkChart('cv-dias',{type:'bar',data:{labels:dlabels,
    datasets:[{data:dlabels.map(d=>A.dias[d].fat),backgroundColor:C.verde}]},
    options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+money(c.parsed.y)}}}}});

  document.getElementById('tb-resumo').innerHTML = `<tbody>
    <tr><td>Cartão de Crédito</td><td class="num">${money(t.credito)}</td></tr>
    <tr><td>Cartão de Débito</td><td class="num">${money(t.debito)}</td></tr>
    <tr><td>PIX</td><td class="num">${money(t.pix)}</td></tr>
    <tr><td>Dinheiro</td><td class="num">${money(t.dinheiro)}</td></tr>
    <tr><td><b>Faturamento total</b></td><td class="num"><b>${money(t.faturamento)}</b></td></tr>
    <tr><td>Comissão (gorjeta)</td><td class="num">${money(t.comissoes)}</td></tr>
    <tr><td>Descontos concedidos</td><td class="num">${money(t.descontos)}</td></tr>
    <tr><td>Cortesias</td><td class="num">${money(t.cortesias)}</td></tr>
    <tr><td>Contas assinadas</td><td class="num">${money(t.assinadas)}</td></tr>
    <tr><td>Transações na maquininha</td><td class="num">${t.transacoes}</td></tr></tbody>`;

  // Produtos
  const prod=A.prod.slice().sort((a,b)=>b.valor-a.valor);
  const qT=prod.reduce((s,p)=>s+p.qtde,0),vT=prod.reduce((s,p)=>s+p.valor,0);
  const campeao=prod.slice().sort((a,b)=>b.qtde-a.qtde)[0]||{nome:'-',qtde:0};
  document.getElementById('kpis-prod').innerHTML =
    card('Itens vendidos',qT,'blue')+card('Faturamento em produtos',money(vT),'green')+
    card('Produtos distintos',prod.length)+card('Campeão de vendas',campeao.nome,'gold',campeao.qtde+' un');
  const maxv=Math.max(1,...prod.slice(0,12).map(p=>p.valor));
  document.getElementById('bars-prod').innerHTML = prod.slice(0,12).map(p=>
    `<div class="brow"><div class="bname" title="${p.nome}">${p.nome}</div>
     <div class="bbg"><div class="bfill" style="width:${100*p.valor/maxv}%"></div></div>
     <div class="bval">${money(p.valor)}</div></div>`).join('') || '<div class="vazio">Sem produtos no período</div>';
  const grp=A.grp.slice().sort((a,b)=>b.valor-a.valor);
  charts.grupos=mkChart('cv-grupos',{type:'bar',data:{labels:grp.map(g=>g.nome),
    datasets:[{data:grp.map(g=>g.valor),backgroundColor:C.laranja}]},
    options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+money(c.parsed.x)}}}}});
  window.__prod=prod;filtraProd();

  // Sangrias
  document.getElementById('kpis-sang').innerHTML =
    Object.keys(SL).filter(k=>A.st[k]>0).map(k=>card(SL[k],money(A.st[k]),
      k==='despesa'?'red':k==='musico'?'purple':k==='vale'?'blue':k==='extra'?'green':'')).join('')
    || card('Sem sangrias','—');
  const sk=Object.keys(SL).filter(k=>A.st[k]>0);
  charts.sang=mkChart('cv-sang',{type:'doughnut',data:{labels:sk.map(k=>SL[k]),
    datasets:[{data:sk.map(k=>A.st[k]),backgroundColor:[C.azul,C.verde,C.roxo,C.ouro,C.verm,C.cinza]}]},
    options:{plugins:{legend:{position:'right'},tooltip:{callbacks:{label:c=>' '+money(c.parsed)}}}}});
  const dl=Object.keys(A.dias);
  charts.comis=mkChart('cv-comis',{type:'bar',data:{labels:dl,
    datasets:[{data:dl.map(d=>A.dias[d].com),backgroundColor:C.ouro}]},
    options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+money(c.parsed.y)}}}}});
  document.getElementById('tb-sang').innerHTML = tabela(
    ['Data','Categoria','Descrição','Valor'],
    A.sangItens.slice().sort((a,b)=>a.data<b.data?-1:1).map(s=>
      [s.data,`<span class="tag t-${s.tipo}">${SL[s.tipo]}</span>`,s.desc||'—',{n:money(s.valor)}]),
    'Sem sangrias no período');

  // Cancelamentos
  const totCancel=A.cancel.reduce((s,c)=>s+c.valor,0);
  document.getElementById('kpis-cancel').innerHTML =
    card('Total cancelado',money(totCancel),'red')+card('Qtde de cancelamentos',A.cancel.length)+
    card('Ticket cancelado médio',money(A.cancel.length?totCancel/A.cancel.length:0));
  document.getElementById('tb-cancel').innerHTML = tabela(
    ['Data','Mesa','Operador','Produto','Motivo','Valor'],
    A.cancel.map(c=>[c.data_hora,c.mesa,c.operador,c.produto,c.motivo||'—',{n:money(c.valor)}]),
    'Sem cancelamentos no período');

  // Por turno
  document.getElementById('tb-turno').innerHTML = `<thead><tr><th>Data</th><th>Operador</th>
    <th class="num">Faturamento</th><th class="num">Comissão</th><th class="num">Sangrias</th>
    <th class="num">Pessoas</th><th class="num">Ticket</th><th class="num">Diferença</th></tr></thead><tbody>`+
    (A.turnos.length?A.turnos.map(x=>`<tr><td>${x.data}</td><td>${x.operador}</td>
    <td class="num">${money(x.faturamento)}</td><td class="num">${money(x.comissoes)}</td>
    <td class="num">${money(x.sangrias)}</td><td class="num">${x.pessoas}</td><td class="num">${money(x.ticket)}</td>
    <td class="num" style="color:${x.diferenca<0?'#e63946':'#2a9d5c'}">${money(x.diferenca)}</td></tr>`).join('')
    :`<tr><td colspan=8 class="vazio">Sem turnos no período</td></tr>`)+`</tbody>`;
}

function cv(id){return document.getElementById(id);}
// Cria gráfico com segurança: se o Chart.js não carregar, KPIs e tabelas seguem funcionando.
function mkChart(id,cfg){try{if(typeof Chart==='undefined')return null;const el=cv(id);if(!el)return null;
  return new Chart(el,cfg);}catch(e){console.warn('grafico',id,e);return null;}}
function tabela(cols,rows,vazio){
  if(!rows.length) return `<tbody><tr><td colspan="${cols.length}" class="vazio">${vazio}</td></tr></tbody>`;
  return `<thead><tr>`+cols.map((c,i)=>`<th class="${i>=cols.length-1?'num':''}">${c}</th>`).join('')+`</tr></thead><tbody>`+
    rows.map(r=>`<tr>`+r.map(c=>typeof c==='object'?`<td class="num">${c.n}</td>`:`<td>${c}</td>`).join('')+`</tr>`).join('')+`</tbody>`;
}
function filtraProd(){const q=(document.getElementById('busca').value||'').toLowerCase();
  const l=(window.__prod||[]).filter(p=>p.nome.toLowerCase().includes(q));
  document.getElementById('tb-prod').innerHTML = tabela(['Produto','Grupo','Qtde','R$ total'],
    l.map(p=>[p.nome,p.grupo,p.qtde,{n:money(p.valor)}]),'Nenhum produto');}

// ── Drill-down (clique no card abre os lançamentos por data) ──
function drill(key,el){
  const A=agregar(),box=document.getElementById('drill');
  if(drillAtivo===key && el){drillAtivo=null;box.classList.remove('open');
    document.querySelectorAll('#kpis .card').forEach(c=>c.classList.remove('sel'));return;}
  drillAtivo=key;
  document.querySelectorAll('#kpis .card').forEach(c=>c.classList.remove('sel'));
  if(el)el.classList.add('sel');
  let html='';
  if(key==='cancel') html=`<h3>❌ Cancelamentos — por data</h3>`+tabela(
    ['Data','Mesa','Operador','Produto','Motivo','Valor'],
    A.cancel.map(c=>[c.data_hora,c.mesa,c.operador,c.produto,c.motivo||'—',{n:money(c.valor)}]),'Sem cancelamentos');
  else if(key==='sangrias') html=`<h3>💸 Sangrias — por data</h3>`+tabela(
    ['Data','Categoria','Descrição','Valor'],
    A.sangItens.slice().sort((a,b)=>a.data<b.data?-1:1).map(s=>
      [s.data,`<span class="tag t-${s.tipo}">${SL[s.tipo]}</span>`,s.desc||'—',{n:money(s.valor)}]),'Sem sangrias');
  else if(key==='cortesias') html=`<h3>🎁 Cortesias — por data</h3>`+tabela(
    ['Data','Cliente/Descrição','Valor'],
    A.cortItens.map(c=>[c.data,c.desc||c.nome||'—',{n:money(c.valor)}]),'Sem cortesias');
  else if(key==='comissao') html=`<h3>💰 Comissão por dia</h3>`+tabela(['Data','Comissão'],
    Object.keys(A.dias).map(d=>[d,{n:money(A.dias[d].com)}]),'Sem comissão');
  box.innerHTML=html;box.classList.add('open');
}

montarFiltros();render();
</script></body></html>"""


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "TODAS_IMPRESSOES_CAIXA.txt"
    out = sys.argv[2] if len(sys.argv) > 2 else "dashboard.html"
    payload = montar_payload(src)
    html = HTML.replace("__DADOS__", json.dumps(payload, ensure_ascii=False))
    Path(out).write_text(html, encoding="utf-8")
    fat = sum(f["credito"] + f["debito"] + f["pix"] + f["dinheiro"] for f in payload["fechamentos"])
    print(f"OK: {out} | {len(payload['fechamentos'])} fechamentos | "
          f"{len(payload['cancelamentos'])} cancelamentos | faturamento {fat:.2f}")


if __name__ == "__main__":
    main()
