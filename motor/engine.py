# -*- coding: utf-8 -*-
"""
Motor de extração do FECHAMENTO DE CAIXA (TOTVS) — Araçá / Villa Grill.

Lê o arquivo TODAS_IMPRESSOES_CAIXA.txt (capturas do agente), isola cada
FECHAMENTO DE CAIXA DO PERIODO e extrai TODOS os números relevantes para os donos:

  - Faturamento por forma (crédito, débito, pix, dinheiro)
  - Comissão (gorjeta dos garçons)
  - Sangrias detalhadas e categorizadas: VALE, EXTRA, MUSICO, DESPESA, COFRE, OUTRO
  - Cortesias, Assinadas, Descontos
  - Diferença do caixa (conciliação bordero x caixa)
  - Produtos vendidos com QTDE e R$ (qtde x preço do catálogo), por produto e grupo

Correções aplicadas (vs. versão antiga do agente):
  1. Dedup por (caixa_numero, fech_numero) — o mesmo fechamento é reimpresso várias vezes.
  2. Ignora o caixa "fantasma" do garçom: REDUZIDO / TERMINAL 01 / Caixa Nº 3 com total 0.
  3. Categoria DESPESA para sangrias (compra/ficha/material/gás...).
  4. R$ por produto via catálogo de preços.

Sem dependências externas — roda em qualquer Python 3.8+.
"""
from __future__ import annotations
import re
import json
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

MONEY_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def ascii_fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").upper()


def money_br(tok: str) -> Optional[float]:
    tok = tok.strip()
    if not MONEY_RE.fullmatch(tok):
        return None
    return float(tok.replace(".", "").replace(",", "."))


def last_money(line: str) -> Optional[float]:
    found = MONEY_RE.findall(line)
    return money_br(found[-1]) if found else None


def slice_between(text: str, start: str, *ends: str) -> str:
    i = text.find(start)
    if i < 0:
        return ""
    i += len(start)
    end_pos = len(text)
    for e in ends:
        j = text.find(e, i)
        if j >= 0:
            end_pos = min(end_pos, j)
    return text[i:end_pos]


# ─────────────────────────────────────────────────────────────────────────────
# Classificação de sangrias  →  vale | extra | musico | despesa | cofre | outro
# ─────────────────────────────────────────────────────────────────────────────
_MUSICO_RE = re.compile(
    r"MUSIC[OA]|M.{0,3}SIC[OA]|BANDA\b|CANTOR|CANTORA|ARTISTA|SHOW\s+AO\s+VIVO|VOZ\s+E\s+VIOLAO|DJ\b",
    re.IGNORECASE,
)
_DESPESA_RE = re.compile(
    r"COMPRA|MERCAD|MATERIAL|FICHA|BRINQUEDO|G[AÁ]S|GELO|CARV[AÃ]O|PADARIA|ACOUGUE|"
    r"A[CÇ]OUGUE|FEIRA|HORTI|HORTIFRUT|BANANA|VERDUR|LEGUME|FRUTA|MANUTEN|CONSERTO|"
    r"DESPESA|PAGAMENTO\s+DE|CONTA\s+DE|LIMPEZA|DESCART[AÁ]VEL|EMBALAGEM|TROCO\s+PARA",
    re.IGNORECASE,
)

SANGRIA_LABELS = {
    "vale": "🪙 Vale (adiantamento)",
    "extra": "💵 Extra (freelancer)",
    "musico": "🎵 Músico / Banda",
    "despesa": "🧾 Despesa",
    "cofre": "🏦 Cofre (retirada do dono)",
    "outro": "📦 Outro",
}


def classify_sangria(motivo: str) -> str:
    folded = ascii_fold(motivo)
    if _MUSICO_RE.search(folded):
        return "musico"
    if re.match(r"^\s*VALE\b", folded):
        return "vale"
    if re.match(r"^\s*EXTRA\b", folded):
        return "extra"
    if any(k in folded for k in ("COFRE", "RETIRADA CAIXA", "DONO", "SOCIO", "PROPRIETARIO")):
        return "cofre"
    if _DESPESA_RE.search(folded):
        return "despesa"
    return "outro"


# ─────────────────────────────────────────────────────────────────────────────
# Parsers de seção
# ─────────────────────────────────────────────────────────────────────────────
def formas_da_secao(sec: str) -> Dict[str, float]:
    out = {"credito": 0.0, "debito": 0.0, "dinheiro": 0.0, "pix": 0.0, "total": 0.0}
    for line in sec.splitlines():
        f = ascii_fold(line)
        v = last_money(line)
        if v is None:
            continue
        if "CARTAO DE CREDITO" in f:
            out["credito"] = v
        elif "CARTAO DE DEBITO" in f:
            out["debito"] = v
        elif f.strip().startswith("DINHEIRO"):
            out["dinheiro"] = v
        elif "PIX" in f:
            out["pix"] = v
        elif f.strip().startswith("TOTAL"):
            out["total"] = v
    return out


def parse_zera_caixa(sec: str) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for line in sec.splitlines():
        v = last_money(line)
        if v is None:
            continue
        label = MONEY_RE.sub("", line).replace("+", "").replace("-", "").replace("=", "").strip()
        if label and not label.startswith("="):
            out[ascii_fold(label)] = v
    return out


def parse_lista_valor(sec: str) -> List[Dict[str, Any]]:
    """SANGRIAS/CORTESIAS: 'NOME ... 200,00' + linha '(descrição)' opcional abaixo."""
    itens = []
    linhas = sec.splitlines()
    for i, line in enumerate(linhas):
        up = ascii_fold(line).strip()
        if not up or up.startswith("=") or up.startswith("OPERADOR") or up.startswith("CLIENTE") or up.startswith("TOTAL"):
            continue
        v = last_money(line)
        if v is None:
            continue
        nome = MONEY_RE.sub("", line).strip()
        desc = ""
        if i + 1 < len(linhas):
            nxt = linhas[i + 1].strip()
            if nxt.startswith("(") and nxt.endswith(")"):
                desc = nxt.strip("()").strip()
        itens.append({"nome": nome, "valor": v, "descricao": desc})
    return itens


def parse_produtos_vendidos(sec: str) -> List[Dict[str, Any]]:
    """Categorias com itens (produto, qtde) + subtotais."""
    categorias = []
    atual: Optional[Dict[str, Any]] = None
    linhas = sec.splitlines()
    for i, line in enumerate(linhas):
        raw = line.rstrip()
        up = ascii_fold(raw).strip()
        if not up:
            continue
        if up.startswith("SUB-TOTAL QTDE"):
            if atual:
                mq = re.search(r"(\d+)\s*$", raw)
                atual["subtotal_qtde"] = int(mq.group(1)) if mq else 0
            continue
        if up.startswith("SUB-TOTAL VALOR"):
            if atual:
                atual["subtotal_valor"] = last_money(raw) or 0.0
                categorias.append(atual)
                atual = None
            continue
        if up.startswith("PRODUTO") or up.startswith("TOTAL") or up.startswith("="):
            continue
        prox = linhas[i + 1].strip() if i + 1 < len(linhas) else ""
        if prox.startswith("=") and not MONEY_RE.search(raw):
            atual = {"grupo": raw.strip(), "itens": [], "subtotal_qtde": 0, "subtotal_valor": 0.0}
            continue
        mp = re.match(r"(.+?)\s+(\d+)\s*$", raw)
        if atual and mp:
            atual["itens"].append({"produto": mp.group(1).strip(), "qtde": int(mp.group(2))})
    return categorias


# ─────────────────────────────────────────────────────────────────────────────
# Parser do FECHAMENTO completo
# ─────────────────────────────────────────────────────────────────────────────
def head(text: str, label: str) -> str:
    m = re.search(label + r"[.\s]*([^\n]+)", text)
    return m.group(1).strip() if m else ""


def head_int(text: str, label: str) -> Optional[int]:
    m = re.search(label + r"[.\s]*(\d+)", text)
    return int(m.group(1)) if m else None


def parse_fechamento(text: str) -> Optional[Dict[str, Any]]:
    if "FECHAMENTO DE CAIXA DO PERIODO" not in text:
        return None

    reduzido = "R E D U Z I D O" in text or "REDUZIDO" in text
    operador_ab = head(text, r"Operador Ab")
    operador_fe = head(text, r"Operador Fech")
    caixa_no = head_int(text, r"Caixa No")
    fech_no = head_int(text, r"Fech\. No")

    fe_m = re.search(r"Fechamento[.\s]*(\d{2}/\d{2}/\d{2,4}\s+\d{2}:\d{2}:\d{2})", text)
    ab_m = re.search(r"Abertura[.\s]*\n?\s*(\d{2}/\d{2}/\d{2,4}\s+\d{2}:\d{2}:\d{2})", text)
    fechamento_dt = fe_m.group(1) if fe_m else None
    abertura_dt = ab_m.group(1) if ab_m else None

    entradas = formas_da_secao(slice_between(text, "ENTRADAS", "BORDERO"))
    bordero = formas_da_secao(slice_between(text, "BORDERO", "CONCILIACAO", "SISTEMA TOTVS"))
    zera = parse_zera_caixa(slice_between(text, "ZERA CAIXA", "FITA DETALHE", "QTDE TRANSACOES"))

    def zget(*keys: str) -> float:
        for k in keys:
            kf = ascii_fold(k)
            for label, v in zera.items():
                if label.startswith(kf):
                    return v
        return 0.0

    di = text.find("FITA DETALHE")
    detalhe = text[di:] if di >= 0 else text
    sangrias = parse_lista_valor(slice_between(detalhe, "SANGRIAS\n", "CORTESIAS", "CONTAS CANCELADAS"))
    cortesias = parse_lista_valor(slice_between(detalhe, "CORTESIAS\n", "CONTAS CANCELADAS", "PRODUTOS CANCELADOS"))
    produtos = parse_produtos_vendidos(slice_between(detalhe, "PRODUTOS VENDIDOS", "SISTEMA TOTVS", "V.04."))

    qt_m = re.search(r"QTDE TRANSACOES POS\s+(\d+)", text)
    pess_m = re.search(r"NUMERO PESSOAS\s+(\d+)", text)
    dif_m = re.search(r"DIFERENCA TOTAL\s+([\-\d.,]+)", text)

    # Classifica cada sangria
    for s in sangrias:
        base = s["descricao"] or s["nome"]
        s["tipo"] = classify_sangria(base)

    # Contas reabertas/canceladas (sem valor — informativo)
    contas_canc = []
    for ln in slice_between(detalhe, "CONTAS CANCELADAS DO DIA", "PRODUTOS CANCELADOS").splitlines():
        m = re.match(r"\s*(.+?)\s+(\d{3,})\s*$", ln)
        up = ascii_fold(ln).strip()
        if not m or up.startswith("OPERADOR") or up.startswith("="):
            continue
        contas_canc.append({"operador": m.group(1).strip(), "cupom": m.group(2)})

    return {
        "reduzido": reduzido,
        "operador_abertura": operador_ab,
        "operador_fechamento": operador_fe,
        "caixa_numero": caixa_no,
        "fech_numero": fech_no,
        "abertura_dt": abertura_dt,
        "fechamento_dt": fechamento_dt,
        "data_iso": _iso_date(abertura_dt or fechamento_dt),  # dia do MOVIMENTO = abertura
        "contas_canceladas": contas_canc,
        "credito": entradas["credito"],
        "debito": entradas["debito"],
        "dinheiro": entradas["dinheiro"],
        "pix": bordero["pix"] or entradas["pix"],   # bordero = o que realmente caiu
        "entradas_total": entradas["total"],
        "inicio_periodo": zget("TROCO") if False else 0.0,
        "comissoes": zget("COMISSOES"),
        "cortesias_total": zget("CORTESIAS"),
        "assinadas_total": zget("ASSINADAS"),
        "sangrias_total": zget("SANGRIAS\b", "SANGRIAS"),
        "sangrias_troco": zget("SANGRIAS TROCO"),
        "descontos_total": zget("DESCONTOS"),
        "produtos_total": zget("PRODUTOS"),
        "troco_final": zget("TROCO FINAL"),
        "diferenca_total": money_br(dif_m.group(1)) if dif_m and MONEY_RE.fullmatch(dif_m.group(1)) else 0.0,
        "qtde_transacoes": int(qt_m.group(1)) if qt_m else 0,
        "numero_pessoas": int(pess_m.group(1)) if pess_m else 0,
        "sangrias": sangrias,
        "cortesias": cortesias,
        "produtos": produtos,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Leitura do arquivo de capturas → lista de fechamentos válidos (dedup)
# ─────────────────────────────────────────────────────────────────────────────
def split_capturas(raw: str) -> List[str]:
    """Cada captura fica entre linhas de 80 '='; corpo após a régua de 80 '-'."""
    blocos = re.split(r"\n={80}\n", raw)
    corpos = []
    for b in blocos:
        if "CAPTURA CAIXA" not in b:
            continue
        partes = re.split(r"-{80}", b, maxsplit=1)
        corpos.append(partes[1] if len(partes) > 1 else b)
    return corpos


def _iso_date(dt_br: Optional[str]) -> str:
    """'DD/MM/YYYY HH:MM:SS' -> 'YYYY-MM-DD' (vazio se não der)."""
    if not dt_br:
        return ""
    m = re.search(r"(\d{2})/(\d{2})/(\d{2,4})", dt_br)
    if not m:
        return ""
    d, mo, y = m.groups()
    if len(y) == 2:
        y = "20" + y
    return f"{y}-{mo}-{d}"


def _turno_iso(dt_br: Optional[str]) -> str:
    """Dia do movimento: horário antes das 06:00 conta para o dia anterior."""
    if not dt_br:
        return ""
    m = re.search(r"(\d{2})/(\d{2})/(\d{2,4})\s+(\d{2}):(\d{2})", dt_br)
    if not m:
        return _iso_date(dt_br)
    import datetime as _dt
    d, mo, y, hh, mm = m.groups()
    y = ("20" + y) if len(y) == 2 else y
    base = _dt.date(int(y), int(mo), int(d))
    if int(hh) < 6:
        base -= _dt.timedelta(days=1)
    return base.isoformat()


def parse_cancelamento_slip(text: str) -> Optional[Dict[str, Any]]:
    """Comprovante 'CANCEL. DE PRODUTO' — tem mesa, operador, data, motivo, produto e VALOR."""
    if "CANCEL. DE PRODUTO" not in text:
        return None
    mesa = re.search(r"Mesa:\s*(\w+)", text)
    op = re.search(r"Operador:\s*(.+)", text)
    dt = re.search(r"(\d{2}/\d{2}/\d{2,4}\s+\d{2}:\d{2}(?::\d{2})?)", text)
    mot = re.search(r"Motivo:\s*(.+)", text)
    # Linha do produto: "<nome> <qtde> <valor un> <valor>"
    prod, qtde, valor = "", 0, 0.0
    for line in slice_between(text, "VALOR UN.", "ASSINATURA").splitlines():
        if line.strip().startswith("=") or not line.strip():
            continue
        vs = MONEY_RE.findall(line)
        mq = re.search(r"\s(\d+)\s+\d", line)
        if vs:
            valor = money_br(vs[-1]) or 0.0
            qtde = int(mq.group(1)) if mq else 1
            prod = MONEY_RE.sub("", line)
            prod = re.sub(r"\s+\d+\s*$", "", prod).strip()
            break
    return {
        "data": _turno_iso(dt.group(1) if dt else None),
        "data_hora": dt.group(1).strip() if dt else "",
        "mesa": mesa.group(1) if mesa else "",
        "operador": op.group(1).strip() if op else "",
        "motivo": (mot.group(1).strip() if mot else ""),
        "produto": prod,
        "qtde": qtde,
        "valor": valor,
    }


def extrair_cancelamentos(caminho: str) -> List[Dict[str, Any]]:
    """Todos os comprovantes de cancelamento de produto, deduplicados."""
    raw = Path(caminho).read_text(encoding="utf-8", errors="replace")
    vistos: Dict[Tuple, Dict] = {}
    for corpo in split_capturas(raw):
        c = parse_cancelamento_slip(corpo)
        if not c:
            continue
        chave = (c["data_hora"], c["mesa"], c["produto"], c["valor"])
        vistos.setdefault(chave, c)
    return sorted(vistos.values(), key=lambda x: x["data_hora"])


def extrair_fechamentos(caminho: str) -> List[Dict[str, Any]]:
    raw = Path(caminho).read_text(encoding="utf-8", errors="replace")
    vistos: Dict[Tuple, Dict] = {}
    for corpo in split_capturas(raw):
        if "FECHAMENTO DE CAIXA DO PERIODO" not in corpo:
            continue
        f = parse_fechamento(corpo)
        if not f:
            continue
        # Correção 2: ignora caixa fantasma do garçom
        if f["reduzido"] or (f.get("operador_abertura") or "").upper().startswith("TERMINAL"):
            continue
        if f["entradas_total"] == 0 and not f["produtos"]:
            continue
        # Correção 1: dedup por (caixa, fech) — fica a versão mais completa
        chave = (f["caixa_numero"], f["fech_numero"])
        if chave not in vistos or len(str(f["produtos"])) > len(str(vistos[chave]["produtos"])):
            vistos[chave] = f
    return sorted(vistos.values(), key=lambda x: (x["fechamento_dt"] or ""))


# ─────────────────────────────────────────────────────────────────────────────
# Enriquecimento: R$ por produto via catálogo
# ─────────────────────────────────────────────────────────────────────────────
def carregar_catalogo() -> Dict[str, Dict[str, Any]]:
    p = Path(__file__).parent / "catalogo.json"
    return json.loads(p.read_text(encoding="utf-8"))


def preco_catalogo(nome: str, cat_norm: Dict[str, Dict[str, Any]], cat_keys: List[str]) -> Optional[float]:
    """Preço do produto; a TOTVS trunca nomes longos, então cai p/ prefixo."""
    f = ascii_fold(nome)
    if f in cat_norm:
        return cat_norm[f].get("p")
    # nome do fechamento é prefixo (truncado) de uma chave do catálogo
    cands = [k for k in cat_keys if k.startswith(f)]
    if len(cands) == 1:
        return cat_norm[cands[0]].get("p")
    if cands:  # ambíguo: usa o de menor preço para não inflar
        return min(cat_norm[k].get("p", 0.0) for k in cands)
    # caso raro inverso: chave é prefixo do nome
    cands = [k for k in cat_keys if f.startswith(k)]
    if cands:
        return cat_norm[max(cands, key=len)].get("p")
    return None


def agregar(fechamentos: List[Dict[str, Any]], catalogo: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    cat_norm = {ascii_fold(k): v for k, v in catalogo.items()}
    cat_keys = list(cat_norm.keys())

    tot = {
        "faturamento": 0.0, "credito": 0.0, "debito": 0.0, "pix": 0.0, "dinheiro": 0.0,
        "comissoes": 0.0, "cortesias": 0.0, "assinadas": 0.0, "descontos": 0.0,
        "sangrias_total": 0.0, "diferenca": 0.0, "pessoas": 0, "transacoes": 0, "produtos_total": 0.0,
    }
    sang_por_tipo: Dict[str, float] = {k: 0.0 for k in SANGRIA_LABELS}
    sang_itens: List[Dict[str, Any]] = []
    cortesia_itens: List[Dict[str, Any]] = []
    prod_qtde: Dict[str, int] = {}
    prod_valor: Dict[str, float] = {}
    prod_grupo: Dict[str, str] = {}
    grupo_valor: Dict[str, float] = {}
    grupo_qtde: Dict[str, int] = {}
    sem_preco: Dict[str, int] = {}
    turnos = []

    for f in fechamentos:
        fat = f["credito"] + f["debito"] + f["pix"] + f["dinheiro"]
        tot["faturamento"] += fat
        for k in ("credito", "debito", "pix", "dinheiro", "comissoes"):
            tot[k] += f[k]
        tot["cortesias"] += f["cortesias_total"]
        tot["assinadas"] += f["assinadas_total"]
        tot["descontos"] += f["descontos_total"]
        tot["sangrias_total"] += f["sangrias_total"]
        tot["diferenca"] += f["diferenca_total"]
        tot["pessoas"] += f["numero_pessoas"]
        tot["transacoes"] += f["qtde_transacoes"]
        tot["produtos_total"] += f["produtos_total"]

        for s in f["sangrias"]:
            sang_por_tipo[s["tipo"]] += s["valor"]
            sang_itens.append({**s, "data": (f["fechamento_dt"] or "")[:10]})
        for c in f["cortesias"]:
            cortesia_itens.append({**c, "data": (f["fechamento_dt"] or "")[:10]})

        for grp in f["produtos"]:
            gnome = grp["grupo"]
            grupo_qtde[gnome] = grupo_qtde.get(gnome, 0) + grp.get("subtotal_qtde", 0)
            grupo_valor[gnome] = grupo_valor.get(gnome, 0.0) + grp.get("subtotal_valor", 0.0)
            for it in grp["itens"]:
                nome = it["produto"]
                q = it["qtde"]
                prod_qtde[nome] = prod_qtde.get(nome, 0) + q
                prod_grupo[nome] = gnome
                preco = preco_catalogo(nome, cat_norm, cat_keys)
                if preco is None:
                    sem_preco[nome] = sem_preco.get(nome, 0) + q
                    preco = 0.0
                prod_valor[nome] = prod_valor.get(nome, 0.0) + q * preco

        turnos.append({
            "data": (f["fechamento_dt"] or "")[:10],
            "operador": f["operador_fechamento"],
            "faturamento": fat,
            "comissoes": f["comissoes"],
            "sangrias": f["sangrias_total"],
            "diferenca": f["diferenca_total"],
            "pessoas": f["numero_pessoas"],
            "ticket": fat / f["numero_pessoas"] if f["numero_pessoas"] else 0.0,
        })

    produtos = [
        {"nome": n, "grupo": prod_grupo.get(n, ""), "qtde": prod_qtde[n], "valor": prod_valor.get(n, 0.0)}
        for n in prod_qtde
    ]
    return {
        "totais": tot,
        "sangrias_por_tipo": sang_por_tipo,
        "sangrias_itens": sang_itens,
        "cortesias_itens": cortesia_itens,
        "produtos": produtos,
        "grupos": [{"nome": g, "qtde": grupo_qtde[g], "valor": grupo_valor.get(g, 0.0)} for g in grupo_qtde],
        "turnos": turnos,
        "sem_preco": sem_preco,
        "n_fechamentos": len(fechamentos),
    }


if __name__ == "__main__":
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else "TODAS_IMPRESSOES_CAIXA.txt"
    fes = extrair_fechamentos(src)
    dados = agregar(fes, carregar_catalogo())
    print(json.dumps({"resumo": dados["totais"], "n": dados["n_fechamentos"],
                      "sangrias": dados["sangrias_por_tipo"]}, ensure_ascii=False, indent=2))
