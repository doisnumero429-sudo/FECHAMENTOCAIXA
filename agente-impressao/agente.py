"""
Agente de captura de impressora — Araçá Grill
Modo: OBSERVADOR APENAS (fase 1 — coleta de dados brutos)

Monitora trabalhos de impressão via WMI no Windows.
Salva JSON diário em pasta_saida/YYYY-MM-DD.json.
NÃO interfere na fila, NÃO cancela, NÃO pausa impressões.
NÃO envia para o Supabase ainda.

Como usar:
  1. pip install pywin32 wmi
  2. Copie config.example.json para config.json e preencha
  3. python agente.py
"""

import json
import os
import sys
import time
import hashlib
import datetime
import socket

try:
    import wmi
    import win32print
except ImportError:
    print("ERRO: Instale as dependências com: pip install pywin32 wmi")
    sys.exit(1)


def carregar_config():
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    if not os.path.exists(config_path):
        example = os.path.join(os.path.dirname(__file__), "config.example.json")
        if os.path.exists(example):
            import shutil
            shutil.copy(example, config_path)
            print(f"Arquivo config.json criado a partir do exemplo. Edite antes de continuar: {config_path}")
            sys.exit(0)
        else:
            print(f"Arquivo config.json não encontrado: {config_path}")
            sys.exit(1)
    with open(config_path, encoding="utf-8") as f:
        return json.load(f)


def garantir_pasta(pasta):
    os.makedirs(pasta, exist_ok=True)


def arquivo_diario(pasta):
    data = datetime.date.today().isoformat()
    return os.path.join(pasta, f"{data}.json")


def hash_trabalho(nome_doc, impressora, paginas, tamanho):
    chave = f"{nome_doc}|{impressora}|{paginas}|{tamanho}"
    return hashlib.md5(chave.encode()).hexdigest()


def carregar_hashes_salvos(arquivo):
    if not os.path.exists(arquivo):
        return set()
    try:
        with open(arquivo, encoding="utf-8") as f:
            dados = json.load(f)
        return {e.get("hash", "") for e in dados}
    except Exception:
        return set()


def salvar_registro(arquivo, registro):
    dados = []
    if os.path.exists(arquivo):
        try:
            with open(arquivo, encoding="utf-8") as f:
                dados = json.load(f)
        except Exception:
            dados = []
    dados.append(registro)
    with open(arquivo, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)


def classificar_tipo(nome_doc):
    """Tenta identificar o tipo de documento pela fita impressa."""
    nome = (nome_doc or "").upper()
    if "SANGRIA" in nome:
        return "sangria"
    if "FECHAMENTO" in nome or "FITA" in nome:
        return "fechamento"
    if "ASSINADA" in nome or "FIADO" in nome:
        return "assinada"
    if "CANCEL" in nome:
        return "cancelamento"
    if "TRANSFERE" in nome or "MESA" in nome:
        return "transferencia"
    return "outro"


def monitorar(config):
    impressora_alvo = config.get("impressora_nome", "")
    pasta = config.get("pasta_saida", os.path.join(os.path.dirname(__file__), "saida"))
    intervalo = config.get("intervalo_poll_segundos", 5)
    debug = config.get("debug", False)
    computador = socket.gethostname()

    garantir_pasta(pasta)
    print(f"[AGENTE] Monitorando impressora: '{impressora_alvo}'")
    print(f"[AGENTE] Salvando em: {pasta}")
    print(f"[AGENTE] Intervalo: {intervalo}s — Pressione Ctrl+C para parar\n")

    c = wmi.WMI()
    hashes_vistos = set()

    # Recarregar hashes do dia atual ao iniciar
    arq = arquivo_diario(pasta)
    hashes_vistos = carregar_hashes_salvos(arq)

    while True:
        try:
            # Atualizar arquivo diário (pode virar a meia-noite)
            arq = arquivo_diario(pasta)

            jobs = c.Win32_PrintJob()
            for job in jobs:
                impressora = getattr(job, "Name", "").split(",")[0].strip()

                # Filtrar só a impressora configurada
                if impressora_alvo and impressora_alvo.lower() not in impressora.lower():
                    continue

                nome_doc = getattr(job, "Document", "")
                paginas = getattr(job, "TotalPages", 0)
                tamanho = getattr(job, "Size", 0)
                status = getattr(job, "Status", "")
                horario = datetime.datetime.now().isoformat()

                h = hash_trabalho(nome_doc, impressora, paginas, tamanho)
                if h in hashes_vistos:
                    continue  # Já registrado

                hashes_vistos.add(h)

                registro = {
                    "hash": h,
                    "horario": horario,
                    "computador": computador,
                    "impressora": impressora,
                    "documento": nome_doc,
                    "tipo_provavel": classificar_tipo(nome_doc),
                    "paginas": paginas,
                    "tamanho_bytes": tamanho,
                    "status_job": status
                }

                salvar_registro(arq, registro)
                print(f"[CAPTURADO] {horario} | {impressora} | {nome_doc} | tipo: {registro['tipo_provavel']}")

                if debug:
                    print(json.dumps(registro, indent=2, ensure_ascii=False))

        except KeyboardInterrupt:
            print("\n[AGENTE] Encerrado pelo usuário.")
            break
        except Exception as e:
            print(f"[ERRO] {e}")

        time.sleep(intervalo)


if __name__ == "__main__":
    cfg = carregar_config()
    monitorar(cfg)
