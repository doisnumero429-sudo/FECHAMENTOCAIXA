import sys, json, re
sys.path.insert(0, 'motor')
from engine import extrair_fechamentos, extrair_cancelamentos, _turno_iso

F = sys.argv[1]
def isodt(br):
    m = re.search(r"(\d{2})/(\d{2})/(\d{2,4})\s+(\d{2}):(\d{2}):(\d{2})", br or "")
    if not m: return None
    d,mo,y,h,mi,s = m.groups(); y = "20"+y if len(y)==2 else y
    return f"{y}-{mo}-{d}T{h}:{mi}:{s}"

fitas=[]
for f in extrair_fechamentos(F):
    if f['reduzido'] or (f.get('operador_abertura') or '').upper().startswith('TERMINAL'): 
        continue
    fitas.append({
        "data_turno": _turno_iso(f['abertura_dt']),
        "abertura_dt": isodt(f['abertura_dt']), "fechamento_dt": isodt(f['fechamento_dt']),
        "operador_abertura": f['operador_abertura'], "operador_fechamento": f['operador_fechamento'],
        "caixa_numero": f['caixa_numero'], "fech_numero": f['fech_numero'],
        "entradas_total": f['entradas_total'],
        "entradas_credito": f['credito'], "entradas_debito": f['debito'], "entradas_pix": f['pix'], "entradas_dinheiro": f['dinheiro'],
        "bordero_credito": f['credito'], "bordero_debito": f['debito'], "bordero_pix": f['pix'],
        "comissoes_total": f['comissoes'], "cortesias_total": f['cortesias_total'], "assinadas_total": f['assinadas_total'],
        "descontos_total": f['descontos_total'], "sangrias_total": f['sangrias_total'], "diferenca_total": f['diferenca_total'],
        "numero_pessoas": f['numero_pessoas'], "qtde_transacoes_pos": f['qtde_transacoes'],
        "sangrias": [{"nome": s['nome'], "valor": s['valor'], "descricao": s['descricao']} for s in f['sangrias']],
        "cortesias": [{"nome": c['nome'], "valor": c['valor'], "descricao": c.get('descricao','')} for c in f['cortesias']],
        "produtos_vendidos": {"categorias": [{"nome": g['grupo'], "itens": g['itens'],
            "subtotal_qtde": g.get('subtotal_qtde',0), "subtotal_valor": g.get('subtotal_valor',0)} for g in f['produtos']]},
    })

cancel=[{**c, "data_turno": _turno_iso(c['data_hora'])} for c in extrair_cancelamentos(F)]
json.dump({"fitas": fitas, "cancelamentos": cancel}, open('testes/_fita.json','w'), ensure_ascii=False)
print(f"fitas={len(fitas)} cancel={len(cancel)}")
