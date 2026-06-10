# -*- coding: utf-8 -*-
"""
Araçá Spool Guard - CAIXA v7
Baseado no v6 AGRESSIVO + integração Supabase.

Objetivo:
- Monitorar somente a impressora CAIXA.
- Ignorar completamente arquivos .SHD.
- Capturar agressivamente arquivos .SPL.
- Salvar textos em TODAS_IMPRESSOES_CAIXA.txt e SQLite local.
- Classificar documentos e enviar ao Supabase:
    * NFC-e               → caixa_nfce_eventos
    * Sangria             → caixa_sangrias
    * Cancelamento Prod.  → caixa_cancelamentos

Configure supabase_url e supabase_key em config_caixa.json para
habilitar envio ao Supabase. Se vazios, o agente funciona somente
em modo local (txt + sqlite).
"""
from __future__ import annotations

import ctypes
import hashlib
import importlib
import json
import os
import queue
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import win32print  # type: ignore
    import win32con    # type: ignore
    import win32event  # type: ignore
    HAS_PYWIN32 = True
except Exception:
    win32print = None
    win32con = None
    win32event = None
    HAS_PYWIN32 = False

APP_NAME = "AracaSpoolGuard-CAIXA-v7"
BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config_caixa.json"
STOP_EVENT = threading.Event()


# ─── Utilitários básicos ──────────────────────────────────────────────────────

def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]


def safe_filename(value: str, max_len: int = 80) -> str:
    value = re.sub(r"[^\w\-.() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]+", "_", value, flags=re.UNICODE)
    value = value.strip("._ ")
    return (value[:max_len] or "sem_nome")


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def set_high_priority() -> bool:
    try:
        kernel32 = ctypes.windll.kernel32
        HIGH_PRIORITY_CLASS = 0x00000080
        handle = kernel32.GetCurrentProcess()
        return bool(kernel32.SetPriorityClass(handle, HIGH_PRIORITY_CLASS))
    except Exception:
        return False


# ─── Configuração ────────────────────────────────────────────────────────────

@dataclass
class Config:
    printer_name: str
    spool_dir: Path
    output_dir: Path
    aggregate_text_file: str = "TODAS_IMPRESSOES_CAIXA.txt"
    job_poll_interval_seconds: float = 0.03
    spool_poll_interval_seconds: float = 0.005
    notification_wait_ms: int = 120
    job_file_watch_seconds: float = 18.0
    job_file_watch_interval_seconds: float = 0.003
    after_first_seen_extra_seconds: float = 1.2
    stable_required_seconds: float = 0.12
    copy_retries: int = 80
    copy_retry_sleep_seconds: float = 0.006
    extract_text: bool = True
    keep_raw_spl_backup: bool = True
    ignore_shd: bool = True
    set_high_process_priority: bool = True
    enable_keep_printed_jobs: bool = True
    enable_printservice_log: bool = True
    # Supabase (deixar vazios para modo somente-local)
    supabase_url: str = ""
    supabase_key: str = ""

    @classmethod
    def load(cls) -> "Config":
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return cls(
            printer_name=data.get("printer_name", "CAIXA"),
            spool_dir=Path(data.get("spool_dir", r"C:\Windows\System32\spool\PRINTERS")),
            output_dir=Path(data.get("output_dir", r"C:\AracaSpoolGuard\capturas_caixa")),
            aggregate_text_file=data.get("aggregate_text_file", "TODAS_IMPRESSOES_CAIXA.txt"),
            job_poll_interval_seconds=float(data.get("job_poll_interval_seconds", 0.03)),
            spool_poll_interval_seconds=float(data.get("spool_poll_interval_seconds", 0.005)),
            notification_wait_ms=int(data.get("notification_wait_ms", 120)),
            job_file_watch_seconds=float(data.get("job_file_watch_seconds", 18.0)),
            job_file_watch_interval_seconds=float(data.get("job_file_watch_interval_seconds", 0.003)),
            after_first_seen_extra_seconds=float(data.get("after_first_seen_extra_seconds", 1.2)),
            stable_required_seconds=float(data.get("stable_required_seconds", 0.12)),
            copy_retries=int(data.get("copy_retries", 80)),
            copy_retry_sleep_seconds=float(data.get("copy_retry_sleep_seconds", 0.006)),
            extract_text=bool(data.get("extract_text", True)),
            keep_raw_spl_backup=bool(data.get("keep_raw_spl_backup", True)),
            ignore_shd=bool(data.get("ignore_shd", True)),
            set_high_process_priority=bool(data.get("set_high_process_priority", True)),
            enable_keep_printed_jobs=bool(data.get("enable_keep_printed_jobs", True)),
            enable_printservice_log=bool(data.get("enable_printservice_log", True)),
            supabase_url=data.get("supabase_url", "").strip(),
            supabase_key=data.get("supabase_key", "").strip(),
        )


# ─── Logger / Database ────────────────────────────────────────────────────────

class Logger:
    def __init__(self, log_dir: Path):
        self.log_dir = log_dir
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    @property
    def log_file(self) -> Path:
        return self.log_dir / f"agente_caixa_{datetime.now().strftime('%Y-%m-%d')}.log"

    def write(self, msg: str) -> None:
        line = f"{now_str()}  {msg}"
        with self.lock:
            print(line, flush=True)
            with self.log_file.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    def error(self, msg: str) -> None:
        self.write("ERRO: " + msg)


class Database:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _init(self) -> None:
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS captures (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    printer_name TEXT NOT NULL,
                    computer_name TEXT,
                    windows_user TEXT,
                    job_id INTEGER,
                    document_name TEXT,
                    job_user TEXT,
                    job_status TEXT,
                    raw_path TEXT,
                    aggregate_text_path TEXT,
                    sha256 TEXT,
                    bytes_copied INTEGER,
                    text_chars INTEGER,
                    preview TEXT,
                    notes TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    level TEXT NOT NULL,
                    message TEXT NOT NULL
                )
            """)

    def insert_capture(self, **kwargs: Any) -> None:
        keys = list(kwargs.keys())
        placeholders = ", ".join([":" + k for k in keys])
        columns = ", ".join(keys)
        with self.lock, self._connect() as conn:
            conn.execute(f"INSERT INTO captures ({columns}) VALUES ({placeholders})", kwargs)

    def event(self, level: str, message: str) -> None:
        with self.lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO events (created_at, level, message) VALUES (?, ?, ?)",
                (now_str(), level, message),
            )


# ─── Supabase client ─────────────────────────────────────────────────────────

class SupabaseClient:
    """Cliente HTTP mínimo para Supabase REST — usa apenas stdlib."""

    def __init__(self, url: str, key: str) -> None:
        self.base = url.rstrip("/")
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # resolve=ignore-duplicates faz o POST agir como UPSERT ignorando
            # conflitos de UNIQUE (sha256), evitando duplicatas se o agente reiniciar.
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        }

    def insert(self, table: str, data: Dict, log: Optional[Logger] = None) -> bool:
        url = f"{self.base}/rest/v1/{table}"
        body = json.dumps(data, default=str).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=self.headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status in (200, 201)
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                return True  # conflito de sha256 = duplicata, tudo certo
            if log:
                try:
                    detail = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    detail = str(exc)
                log.error(f"Supabase HTTP {exc.code} → {table}: {detail[:400]}")
            return False
        except Exception as exc:
            if log:
                log.error(f"Supabase erro → {table}: {exc}")
            return False


class SupabaseSender:
    """Fila assíncrona para envios ao Supabase sem bloquear a captura."""

    def __init__(self, client: SupabaseClient, log: Logger) -> None:
        self.client = client
        self.log = log
        self._q: queue.Queue[Tuple[str, Dict]] = queue.Queue(maxsize=500)
        t = threading.Thread(target=self._worker, daemon=True, name="supabase_sender")
        t.start()

    def enqueue(self, table: str, data: Dict) -> None:
        try:
            self._q.put_nowait((table, data))
        except queue.Full:
            self.log.error("Fila Supabase cheia; evento descartado.")

    def _worker(self) -> None:
        while True:
            table, data = self._q.get()
            try:
                ok = self.client.insert(table, data, self.log)
                sha = str(data.get("sha256", ""))[:16]
                if ok:
                    self.log.write(f"Supabase OK  {table}  sha256={sha}…")
                else:
                    self.log.write(f"Supabase FALHOU  {table}  sha256={sha}…")
            except Exception as exc:
                self.log.error(f"Supabase worker: {exc}")
            finally:
                self._q.task_done()


# ─── Parsers de documentos ────────────────────────────────────────────────────

def _ascii_fold(s: str) -> str:
    """Remove acentos (inclusive artefatos de encoding quebrado) para matching."""
    try:
        return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").upper()
    except Exception:
        return s.upper()


def _parse_decimal_br(s: str) -> Optional[float]:
    """1.234,56 → 1234.56 (formato brasileiro)."""
    try:
        return float(s.strip().replace(".", "").replace(",", "."))
    except Exception:
        return None


def _parse_decimal_us(s: str) -> Optional[float]:
    """1234.56 → 1234.56 (formato NFC-e usa ponto como separador decimal)."""
    try:
        return float(s.strip().replace(",", ""))
    except Exception:
        return None


def _parse_datetime_br(s: str) -> Optional[str]:
    """DD/MM/YY ou DD/MM/YYYY HH:MM[:SS] → ISO-8601 sem fuso."""
    s = s.strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%y %H:%M"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            continue
    return None


def _turno_date(iso_dt: str) -> str:
    """Eventos antes das 06:00 pertencem ao turno do dia anterior (turno noturno)."""
    try:
        dt = datetime.strptime(iso_dt[:19], "%Y-%m-%dT%H:%M:%S")
        if dt.hour < 6:
            dt -= timedelta(days=1)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return iso_dt[:10]


# Regex para detectar músico mesmo com encoding quebrado.
# "MÚSICA" pode aparecer como "MÃ|SICA" (cp850/cp860 mismatch) —
# M.{0,3}SICA cobre "MÚSICA", "MÃ|SICA", "MÓSICA", etc.
_MUSICO_RE = re.compile(
    r"MUSICA|MUSICO|MUSICOS|M.{0,3}SICA|BANDA\b|CANTOR|CANTORA|ARTISTA|SHOW\s+AO\s+VIVO",
    re.IGNORECASE,
)


def _classify_sangria_tipo(motivo: str) -> str:
    folded = _ascii_fold(motivo)
    raw = motivo.upper()
    if _MUSICO_RE.search(folded) or _MUSICO_RE.search(raw):
        return "musico"
    if any(k in folded for k in ("COFRE", "RETIRADA COFRE", "RETIRADA CAIXA", "DONO")):
        return "cofre"
    if re.match(r"^(VALE|EXTRA)\s", folded) or any(
        k in folded for k in ("AUX ", " AUX", "FUNCIONARIO", "FUNC ", "SEGURANCA", "COZINHA")
    ):
        return "extra"
    return "outro"


def _classify_doc(text: str) -> str:
    if "CUPOM FISCAL ELETRONICO - NFC-e" in text:
        return "NFCE"
    # SANGRIA: exige a palavra isolada em linha E campo Motivo para evitar falsos positivos
    if re.search(r"^\s*SANGRIA\s*$", text, re.MULTILINE) and "Motivo" in text:
        return "SANGRIA"
    if "FECHAMENTO DE CAIXA DO PERIODO" in text:
        return "FECHAMENTO"
    if "CANCEL. DE PRODUTO" in text:
        return "CANCELAMENTO"
    if "C O N F E R E N C I A  DE  PRODUTOS" in text or "CONFERENCIA DE PRODUTOS" in text:
        return "CONFERENCIA"
    if "TRANSFERENCIA DE MESA" in text:
        return "TRANSFERENCIA"
    if "CONTA ASSINADA" in text:
        return "CONTA_ASSINADA"
    if re.match(r"\s*SENHA:\s*\d+", text):
        return "SENHA"
    return "DESCONHECIDO"


def _parse_nfce(text: str, sha256: str, job_id: int, capture_dt: str) -> Optional[Dict]:
    total_m = re.search(r"VALOR TOTAL R\$\s+([\d.]+)", text)
    if not total_m:
        return None
    valor_total = _parse_decimal_us(total_m.group(1))

    gorjeta: Optional[float] = None
    gorjeta_m = re.search(r"999\s+TAXA DE SERVICO\s+[\d.]+\s+UN x 1\.00\s+([\d.]+)", text)
    if gorjeta_m:
        gorjeta = _parse_decimal_us(gorjeta_m.group(1))

    forma = "outros"
    if re.search(r"Cartao de Credito", text, re.IGNORECASE):
        forma = "credito"
    elif re.search(r"Cartao de Debito", text, re.IGNORECASE):
        forma = "debito"
    elif re.search(r"\bPIX\b", text, re.IGNORECASE):
        forma = "pix"
    elif re.search(r"\bDinheiro\b", text, re.IGNORECASE):
        forma = "dinheiro"

    mesa: Optional[str] = None
    pedido: Optional[str] = None
    obs_m = re.search(r"OBSERVACOES DO CONTRIBUINTE\s*\n(.+)", text)
    if obs_m:
        obs = obs_m.group(1)
        m = re.search(r"Mesa:(\w+)", obs)
        if m:
            mesa = m.group(1)
        m = re.search(r"Pedido:(\d+)", obs)
        if m:
            pedido = m.group(1)

    return {
        "data_hora": capture_dt,
        "data_turno": _turno_date(capture_dt),
        "mesa": mesa,
        "pedido": pedido,
        "valor_total": valor_total,
        "gorjeta": gorjeta,
        "forma_pagamento": forma,
        "raw_text": text[:3000],
        "job_id": job_id,
        "sha256": sha256,
    }


def _parse_sangria(text: str, sha256: str, job_id: int) -> Optional[Dict]:
    op_m = re.search(r"Operador\s*:\s*(.+)", text)
    dt_m = re.search(r"Data/Hora\s*:\s*(\d{2}/\d{2}/\d{2,4}\s+\d{2}:\d{2})", text)
    mot_m = re.search(r"Motivo\s*:\s*(.+)", text)
    val_m = re.search(r"Valor:\s*([\d.,]+)", text)

    if not (val_m and dt_m):
        return None

    iso_dt = _parse_datetime_br(dt_m.group(1))
    if not iso_dt:
        return None

    motivo = mot_m.group(1).strip() if mot_m else ""

    return {
        "data_hora": iso_dt,
        "data_turno": _turno_date(iso_dt),
        "operador": op_m.group(1).strip() if op_m else None,
        "motivo": motivo,
        "valor": _parse_decimal_br(val_m.group(1)),
        "tipo": _classify_sangria_tipo(motivo),
        "job_id": job_id,
        "sha256": sha256,
    }


def _parse_cancelamento(text: str, sha256: str, job_id: int) -> Optional[Dict]:
    mesa_m = re.search(r"Mesa:\s*(\d+)", text)
    op_m = re.search(r"Operador:\s*(.+)", text)
    dt_m = re.search(r"(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)", text)
    mot_m = re.search(r"Motivo:\s*(.+)", text)

    iso_dt = _parse_datetime_br(dt_m.group(1)) if dt_m else None
    if not iso_dt:
        return None

    produto: Optional[str] = None
    qtde: Optional[float] = None
    valor: Optional[float] = None
    in_prod = False
    for line in text.splitlines():
        line = line.strip()
        if "PRODUTO" in line and "QTDE" in line:
            in_prod = True
            continue
        if in_prod and line and not line.startswith("="):
            m = re.match(r"(.+?)\s{2,}(\d+)\s+([\d.,]+)\s+([\d.,]+)\s*$", line)
            if m:
                produto = m.group(1).strip()
                try:
                    qtde = float(m.group(2))
                except Exception:
                    pass
                valor = _parse_decimal_br(m.group(4))
            break

    return {
        "data_hora": iso_dt,
        "data_turno": _turno_date(iso_dt),
        "mesa": mesa_m.group(1) if mesa_m else None,
        "operador": op_m.group(1).strip() if op_m else None,
        "motivo": mot_m.group(1).strip() if mot_m else None,
        "produto": produto,
        "qtde": qtde,
        "valor": valor,
        "job_id": job_id,
        "sha256": sha256,
    }


# ─── Print job info ───────────────────────────────────────────────────────────

JOB_STATUS_NAMES = {
    0x00000001: "PAUSED",
    0x00000002: "ERROR",
    0x00000004: "DELETING",
    0x00000008: "SPOOLING",
    0x00000010: "PRINTING",
    0x00000020: "OFFLINE",
    0x00000040: "PAPEROUT",
    0x00000080: "PRINTED",
    0x00000100: "DELETED",
    0x00000200: "BLOCKED",
    0x00000400: "USER_INTERVENTION",
    0x00000800: "RESTART",
    0x00001000: "COMPLETE",
    0x00002000: "RETAINED",
    0x00004000: "RENDERING_LOCALLY",
}


def describe_job_status(status_value: Any) -> str:
    try:
        value = int(status_value or 0)
    except Exception:
        return str(status_value or "")
    if value == 0:
        return "0"
    names = [name for bit, name in JOB_STATUS_NAMES.items() if value & bit]
    return f"{value} ({'|'.join(names)})" if names else str(value)


@dataclass
class PrintJobInfo:
    job_id: Optional[int]
    document_name: str
    user_name: str
    status: str
    size: Optional[int]
    submitted: str


def job_signature(job: PrintJobInfo) -> str:
    return "|".join([
        str(job.job_id or ""),
        job.document_name or "",
        job.user_name or "",
        str(job.status or ""),
        str(job.size or ""),
    ])


def enum_jobs(printer_name: str, log: Optional[Logger] = None) -> List[PrintJobInfo]:
    if not HAS_PYWIN32:
        return []
    try:
        h = win32print.OpenPrinter(printer_name)
    except Exception as exc:
        if log:
            log.error(f"Não consegui abrir a impressora '{printer_name}': {exc}")
        return []
    try:
        jobs_raw = win32print.EnumJobs(h, 0, 999, 1)
        result: List[PrintJobInfo] = []
        for j in jobs_raw:
            result.append(PrintJobInfo(
                job_id=j.get("JobId"),
                document_name=str(j.get("pDocument") or ""),
                user_name=str(j.get("pUserName") or ""),
                status=str(j.get("Status") or j.get("pStatus") or ""),
                size=j.get("Size"),
                submitted=str(j.get("Submitted") or ""),
            ))
        return result
    except Exception as exc:
        if log:
            log.error(f"Falha ao listar jobs da impressora '{printer_name}': {exc}")
        return []
    finally:
        try:
            win32print.ClosePrinter(h)
        except Exception:
            pass


def get_printer_names() -> List[str]:
    if not HAS_PYWIN32:
        return []
    try:
        printers = win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS)
        return [str(p[2]) for p in printers if len(p) >= 3]
    except Exception:
        return []


# ─── SPL file utilities ───────────────────────────────────────────────────────

def infer_job_id_from_spool_path(src: Path) -> Optional[int]:
    m = re.match(r"^(\d{5})\.(SPL)$", src.name, re.IGNORECASE)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def list_spl_files(spool_dir: Path) -> Dict[Path, Tuple[int, float]]:
    files: Dict[Path, Tuple[int, float]] = {}
    try:
        for item in spool_dir.iterdir():
            if item.is_file() and item.suffix.lower() == ".spl":
                try:
                    st = item.stat()
                    files[item] = (int(st.st_size), float(st.st_mtime))
                except OSError:
                    continue
    except Exception:
        pass
    return files


def copy_file_retry(src: Path, dest: Path, retries: int, sleep_s: float) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_exc: Optional[Exception] = None
    for _ in range(max(1, retries)):
        try:
            with src.open("rb") as fsrc, dest.open("wb") as fdst:
                while True:
                    chunk = fsrc.read(1024 * 1024)
                    if not chunk:
                        break
                    fdst.write(chunk)
            return dest.stat().st_size
        except Exception as exc:
            last_exc = exc
            try:
                shutil.copyfile(str(src), str(dest))
                return dest.stat().st_size
            except Exception as exc2:
                last_exc = exc2
                time.sleep(sleep_s)
    if last_exc:
        raise last_exc
    raise RuntimeError("Falha desconhecida ao copiar arquivo")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def escpos_to_text(data: bytes) -> str:
    out = bytearray()
    i = 0
    n = len(data)

    esc_fixed = {
        0x40: 0, 0x21: 1, 0x2D: 1, 0x45: 1, 0x47: 1, 0x4A: 1,
        0x64: 1, 0x61: 1, 0x74: 1, 0x33: 1, 0x32: 0, 0x69: 0,
        0x6D: 0, 0x70: 3, 0x52: 1, 0x20: 1, 0x25: 1, 0x26: 0,
        0x3F: 1, 0x44: 0, 0x24: 2, 0x5C: 2,
    }
    gs_fixed = {
        0x21: 1, 0x42: 1, 0x48: 1, 0x4C: 2, 0x57: 2, 0x56: 1,
        0x68: 1, 0x77: 1, 0x66: 1, 0x49: 1, 0x72: 1, 0x61: 1,
    }

    while i < n:
        b = data[i]
        if b in (0x0A, 0x0D):
            out.append(0x0A)
            i += 1
            continue
        if b == 0x09:
            out.append(0x20)
            i += 1
            continue
        if b == 0x1B and i + 1 < n:
            cmd = data[i + 1]
            if cmd == 0x44:
                end = data.find(b"\x00", i + 2, min(n, i + 40))
                i = (end + 1) if end != -1 else i + 2
                continue
            skip = esc_fixed.get(cmd)
            if skip is not None:
                i += 2 + skip
                continue
            i += 2
            continue
        if b == 0x1D and i + 1 < n:
            cmd = data[i + 1]
            if cmd == 0x28 and i + 4 < n:
                pL = data[i + 3]
                pH = data[i + 4]
                length = pL + 256 * pH
                i += 5 + length
                continue
            if cmd == 0x6B:
                j = i + 2
                end = data.find(b"\x00", j, min(n, j + 180))
                i = (end + 1) if end != -1 else i + 3
                continue
            skip = gs_fixed.get(cmd)
            if skip is not None:
                i += 2 + skip
                continue
            i += 2
            continue
        if b in (0x10, 0x1C):
            i += 2 if i + 1 < n else 1
            continue
        if b < 0x20:
            i += 1
            continue
        out.append(b)
        i += 1

    candidates = []
    for enc in ("cp850", "cp860", "cp1252", "latin1", "utf-8"):
        try:
            decoded = out.decode(enc, errors="replace")
            score = decoded.count("�") * 8 - sum(decoded.count(ch) for ch in "áéíóúãõçÁÉÍÓÚÃÕÇ")
            candidates.append((score, enc, decoded))
        except Exception:
            pass
    if not candidates:
        return ""
    candidates.sort(key=lambda x: x[0])
    text = candidates[0][2]

    lines: List[str] = []
    blank = False
    for line in text.splitlines():
        line = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", line).rstrip()
        if line:
            lines.append(line)
            blank = False
        else:
            if not blank and lines:
                lines.append("")
                blank = True
    return "\n".join(lines).strip()


def extract_text_from_spl(path: Path) -> str:
    return escpos_to_text(path.read_bytes())


# ─── Setup helpers ────────────────────────────────────────────────────────────

def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def run_cmd(args: List[str], timeout: int = 60) -> Tuple[int, str]:
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
        return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()
    except Exception as exc:
        return 999, str(exc)


def ensure_pywin32_available(log: Logger) -> bool:
    global win32print, win32con, win32event, HAS_PYWIN32
    if HAS_PYWIN32:
        log.write("ETAPA 1/5 Dependências: pywin32 já está instalado.")
        return True
    log.write("ETAPA 1/5 Dependências: pywin32 não encontrado. Tentando instalar...")
    req = BASE_DIR / "requirements.txt"
    if req.exists():
        code, out = run_cmd([sys.executable, "-m", "pip", "install", "-r", str(req)], timeout=180)
    else:
        code, out = run_cmd([sys.executable, "-m", "pip", "install", "pywin32"], timeout=180)
    if out:
        log.write("Resultado pip: " + out[-1200:])
    if code != 0:
        log.write("AVISO: não consegui instalar pywin32 automaticamente.")
        return False
    try:
        win32print = importlib.import_module("win32print")
        win32con = importlib.import_module("win32con")
        win32event = importlib.import_module("win32event")
        HAS_PYWIN32 = True
        log.write("ETAPA 1/5 Dependências: pywin32 instalado/carregado com sucesso.")
        return True
    except Exception as exc:
        log.write(f"AVISO: pywin32 instalou, mas não carregou nesta execução: {exc}")
        return False


def enable_keep_printed_jobs(printer_name: str, log: Logger) -> None:
    log.write(f"ETAPA 2/5 Impressora: ativando 'Manter documentos impressos' em {printer_name}...")
    q = ps_quote(printer_name)
    cmd = (
        f"try {{ "
        f"Set-Printer -Name {q} -KeepPrintedJobs $true -ErrorAction Stop; "
        f"$p=Get-Printer -Name {q} -ErrorAction Stop; "
        f"Write-Output ('OK KeepPrintedJobs=' + $p.KeepPrintedJobs) "
        f"}} catch {{ Write-Output ('ERRO ' + $_.Exception.Message); exit 1 }}"
    )
    code, out = run_cmd(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], timeout=30)
    if code == 0:
        log.write("ETAPA 2/5 Impressora: " + (out or "comando executado"))
    else:
        log.write("AVISO: não consegui ativar KeepPrintedJobs automaticamente: " + out)


def enable_printservice_log(log: Logger) -> None:
    log.write("ETAPA 3/5 Auditoria: ativando log PrintService/Operational...")
    code, out = run_cmd(["wevtutil", "sl", "Microsoft-Windows-PrintService/Operational", "/e:true"], timeout=30)
    if code == 0:
        log.write("ETAPA 3/5 Auditoria: log PrintService ativado ou já estava ativo.")
    else:
        log.write("AVISO: não consegui ativar log PrintService: " + out)


# ─── SpoolGuard ───────────────────────────────────────────────────────────────

class SpoolGuard:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.out = cfg.output_dir
        self.raw_dir = self.out / "raw_spl"
        self.log = Logger(self.out / "logs")
        self.db = Database(self.out / "araca_caixa_spool_guard.sqlite3")
        self.aggregate_path = self.out / cfg.aggregate_text_file
        self.aggregate_lock = threading.Lock()
        self.jobs_by_id: Dict[int, PrintJobInfo] = {}
        self.logged_job_signatures: Dict[int, str] = {}
        self.jobs_present_last_scan: set[int] = set()
        self.job_watch_started: set[int] = set()
        self.job_finalized: set[int] = set()
        self.job_watch_lock = threading.Lock()
        self.seen_spl_signatures: set[str] = set()
        self.pending_unknown_spl: Dict[int, Path] = {}
        self.last_caixa_activity = 0.0

        # Supabase (None se não configurado)
        self.sb_sender: Optional[SupabaseSender] = None
        if cfg.supabase_url and cfg.supabase_key:
            client = SupabaseClient(cfg.supabase_url, cfg.supabase_key)
            self.sb_sender = SupabaseSender(client, self.log)

    def ensure_dirs(self) -> None:
        self.out.mkdir(parents=True, exist_ok=True)
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        (self.out / "logs").mkdir(parents=True, exist_ok=True)
        if not self.aggregate_path.exists():
            self.aggregate_path.write_text("", encoding="utf-8")

    def bootstrap_steps(self) -> None:
        self.ensure_dirs()
        self.log.write("=" * 60)
        self.log.write("AGENTE CAIXA v7 (v6 AGRESSIVO + Supabase)")
        self.log.write("=" * 60)
        ensure_pywin32_available(self.log)
        if self.cfg.set_high_process_priority:
            ok = set_high_priority()
            self.log.write("Prioridade alta: " + ("ATIVADA" if ok else "não foi possível ativar"))
        if self.cfg.enable_keep_printed_jobs:
            enable_keep_printed_jobs(self.cfg.printer_name, self.log)
        if self.cfg.enable_printservice_log:
            enable_printservice_log(self.log)
        self.log.write("ETAPA 4/5 Preparação: conferindo impressora, spool e pastas de saída...")
        if self.sb_sender:
            self.log.write(f"Supabase: ATIVO → {self.cfg.supabase_url}")
        else:
            self.log.write("Supabase: INATIVO (supabase_url/supabase_key não configurados)")

    def preflight(self) -> None:
        self.log.write(f"Iniciando {APP_NAME}")
        self.log.write(f"Computador: {os.environ.get('COMPUTERNAME', '')} | Usuário: {os.environ.get('USERNAME', '')}")
        self.log.write(f"Impressora alvo: {self.cfg.printer_name}")
        self.log.write(f"Pasta spool: {self.cfg.spool_dir}")
        self.log.write(f"Pasta saída: {self.cfg.output_dir}")
        self.log.write(f"Arquivo único: {self.aggregate_path}")
        self.log.write("Modo: IGNORAR .SHD / CAPTURAR SOMENTE .SPL / AGRESSIVO")
        self.log.write(f"Administrador: {'SIM' if is_admin() else 'NÃO'}")
        if not is_admin():
            self.log.write("AVISO: execute como Administrador para acessar melhor a pasta do spool.")
        if HAS_PYWIN32:
            names = get_printer_names()
            if self.cfg.printer_name in names:
                self.log.write("Impressora CAIXA encontrada no Windows.")
            else:
                self.log.write("AVISO: impressora CAIXA não encontrada. Disponíveis: " + ", ".join(names))
        else:
            self.log.write("AVISO: sem pywin32, captura muito limitada.")
        if not self.cfg.spool_dir.exists():
            self.log.write("AVISO: pasta spool não encontrada ou sem acesso.")
        self.db.event("INFO", "Agente v7 iniciado")

    def update_jobs(self) -> None:
        jobs = enum_jobs(self.cfg.printer_name, self.log)
        current_ids: set[int] = set()
        changed_or_new: List[PrintJobInfo] = []
        for j in jobs:
            if j.job_id is None:
                continue
            jid = int(j.job_id)
            current_ids.add(jid)
            self.jobs_by_id[jid] = j
            sig = job_signature(j)
            if self.logged_job_signatures.get(jid) != sig:
                self.logged_job_signatures[jid] = sig
                changed_or_new.append(j)

        if changed_or_new:
            self.last_caixa_activity = time.time()
            for j in changed_or_new:
                self.log.write(
                    f"Job CAIXA novo/mudou: id={j.job_id} doc='{j.document_name}' "
                    f"user='{j.user_name}' status='{describe_job_status(j.status)}' size={j.size}"
                )
                self.start_job_file_watch(int(j.job_id))

        gone = self.jobs_present_last_scan - current_ids
        for jid in gone:
            self.log.write(f"Job CAIXA saiu da fila: id={jid}")
        self.jobs_present_last_scan = current_ids

    def start_job_file_watch(self, job_id: int) -> None:
        with self.job_watch_lock:
            if job_id in self.job_watch_started:
                return
            self.job_watch_started.add(job_id)
        t = threading.Thread(target=self.watch_exact_spl, args=(job_id,), name=f"watch_spl_{job_id}", daemon=True)
        t.start()

    def copy_spl_snapshot(self, src: Path, job_id: int) -> Optional[Path]:
        job = self.jobs_by_id.get(job_id)
        doc = safe_filename(job.document_name if job else "VIP_RAW_PrinterDocument", 50)
        raw_name = f"{stamp()}_{safe_filename(self.cfg.printer_name)}_job{job_id}_{doc}_{src.name}"
        dest = self.raw_dir / raw_name
        try:
            size = copy_file_retry(src, dest, self.cfg.copy_retries, self.cfg.copy_retry_sleep_seconds)
            if size <= 0:
                return None
            return dest
        except Exception as exc:
            self.log.error(f"Falha copiando snapshot SPL {src.name} job {job_id}: {exc}")
            return None

    def watch_exact_spl(self, job_id: int) -> None:
        if job_id in self.job_finalized:
            return
        src = self.cfg.spool_dir / f"{job_id:05d}.SPL"
        deadline = time.time() + self.cfg.job_file_watch_seconds
        first_seen_at: Optional[float] = None
        last_size: Optional[int] = None
        last_change_at = time.time()
        best_raw: Optional[Path] = None
        best_size = -1
        copies = 0

        pending = self.pending_unknown_spl.get(job_id)
        if pending and pending.exists():
            try:
                best_raw = pending
                best_size = pending.stat().st_size
                copies += 1
                first_seen_at = time.time()
                last_size = best_size
                last_change_at = time.time()
            except Exception:
                pass

        while time.time() < deadline and not STOP_EVENT.is_set():
            if src.exists():
                now = time.time()
                if first_seen_at is None:
                    first_seen_at = now
                    self.log.write(f"SPL encontrado para job {job_id}: {src.name}")
                try:
                    size_now = src.stat().st_size
                except OSError:
                    size_now = -1
                should_copy = False
                if size_now > best_size:
                    should_copy = True
                elif copies == 0:
                    should_copy = True
                elif last_size is not None and size_now != last_size:
                    should_copy = True
                if should_copy:
                    raw = self.copy_spl_snapshot(src, job_id)
                    if raw:
                        copies += 1
                        try:
                            raw_size = raw.stat().st_size
                        except OSError:
                            raw_size = size_now
                        if raw_size >= best_size:
                            best_raw = raw
                            best_size = raw_size
                        last_change_at = now
                        last_size = size_now
                if first_seen_at is not None:
                    seen_for = now - first_seen_at
                    stable_for = now - last_change_at
                    if seen_for >= self.cfg.after_first_seen_extra_seconds and stable_for >= self.cfg.stable_required_seconds and best_raw:
                        break
            time.sleep(self.cfg.job_file_watch_interval_seconds)

        if best_raw and best_raw.exists():
            self.finalize_job_capture(job_id, best_raw, copies, best_size)
        else:
            self.log.write(
                f"ALERTA: job {job_id} detectado na CAIXA, mas nenhum .SPL capturado."
            )
            self.db.event("WARN", f"Job {job_id} sem SPL capturado")

    def finalize_job_capture(self, job_id: int, raw_path: Path, copies: int, bytes_copied: int) -> None:
        with self.job_watch_lock:
            if job_id in self.job_finalized:
                return
            self.job_finalized.add(job_id)
        job = self.jobs_by_id.get(job_id)
        try:
            digest = sha256_file(raw_path)
        except Exception:
            digest = ""
        text = ""
        notes = f"SPL capturado agressivo; snapshots={copies}"
        try:
            text = extract_text_from_spl(raw_path) if self.cfg.extract_text else ""
            if not text.strip():
                notes += " | texto vazio ou não extraído"
        except Exception as exc:
            notes += f" | falha ao extrair texto: {exc}"
            self.log.error(f"Falha ao extrair texto do SPL job {job_id}: {exc}\n{traceback.format_exc()}")

        capture_dt = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        self.append_to_aggregate(job_id, job, raw_path, text, bytes_copied, digest, notes)

        preview = " | ".join([ln.strip() for ln in text.splitlines() if ln.strip()][:4])[:300]
        self.log.write(f"CAPTURADO job={job_id} arquivo={raw_path.name} bytes={bytes_copied} snapshots={copies}")
        if preview:
            self.log.write(f"Preview: {preview}")
        else:
            self.log.write(f"Preview: [vazio] job={job_id}")

        # Classificar e enviar ao Supabase (assíncrono)
        if self.sb_sender and text.strip() and digest:
            self._classify_and_send(text, digest, job_id, capture_dt)

    def _classify_and_send(self, text: str, sha256: str, job_id: int, capture_dt: str) -> None:
        doc_type = _classify_doc(text)
        self.log.write(f"Tipo doc job={job_id}: {doc_type}")

        if doc_type == "NFCE":
            record = _parse_nfce(text, sha256, job_id, capture_dt)
            if record:
                self.sb_sender.enqueue("caixa_nfce_eventos", record)
            else:
                self.log.write(f"NFC-e job={job_id}: não foi possível extrair campos essenciais")

        elif doc_type == "SANGRIA":
            record = _parse_sangria(text, sha256, job_id)
            if record:
                self.sb_sender.enqueue("caixa_sangrias", record)
                self.log.write(
                    f"Sangria job={job_id}: tipo={record['tipo']} valor={record['valor']} motivo={record['motivo'][:60]}"
                )
            else:
                self.log.write(f"Sangria job={job_id}: não foi possível extrair campos essenciais")

        elif doc_type == "CANCELAMENTO":
            record = _parse_cancelamento(text, sha256, job_id)
            if record:
                self.sb_sender.enqueue("caixa_cancelamentos", record)
            else:
                self.log.write(f"Cancelamento job={job_id}: não foi possível extrair campos essenciais")

        # FECHAMENTO, CONFERENCIA, TRANSFERENCIA, CONTA_ASSINADA, SENHA, DESCONHECIDO:
        # apenas logado, sem envio ao Supabase por enquanto.

    def append_to_aggregate(
        self,
        job_id: int,
        job: Optional[PrintJobInfo],
        raw_path: Path,
        text: str,
        bytes_copied: int,
        digest: str,
        notes: str,
    ) -> None:
        header = []
        header.append("\n" + "=" * 80)
        header.append(f"CAPTURA CAIXA | {now_str()} | JOB {job_id}")
        header.append(f"Computador: {os.environ.get('COMPUTERNAME', '')} | Usuario Windows: {os.environ.get('USERNAME', '')}")
        if job:
            header.append(f"Documento: {job.document_name} | Usuario job: {job.user_name} | Status: {describe_job_status(job.status)}")
        header.append(f"Arquivo bruto SPL: {raw_path}")
        header.append(f"Bytes: {bytes_copied} | SHA256: {digest}")
        header.append("-" * 80)
        body = text.strip() if text.strip() else "[TEXTO NAO EXTRAIDO - SPL BRUTO FOI SALVO]"
        footer = "\n" + "=" * 80 + "\n"
        block = "\n".join(header) + "\n" + body + footer
        with self.aggregate_lock:
            with self.aggregate_path.open("a", encoding="utf-8", errors="replace") as f:
                f.write(block)
        preview = text[:800]
        self.db.insert_capture(
            created_at=now_str(),
            printer_name=self.cfg.printer_name,
            computer_name=os.environ.get("COMPUTERNAME", ""),
            windows_user=os.environ.get("USERNAME", ""),
            job_id=job_id,
            document_name=job.document_name if job else "",
            job_user=job.user_name if job else "",
            job_status=job.status if job else "",
            raw_path=str(raw_path),
            aggregate_text_path=str(self.aggregate_path),
            sha256=digest,
            bytes_copied=bytes_copied,
            text_chars=len(text),
            preview=preview,
            notes=notes,
        )

    def aggressive_spool_scan(self) -> None:
        files = list_spl_files(self.cfg.spool_dir)
        for path, (size, mtime) in files.items():
            jid = infer_job_id_from_spool_path(path)
            sig = f"{path}|{size}|{mtime}"
            if sig in self.seen_spl_signatures:
                continue
            self.seen_spl_signatures.add(sig)
            if jid is None:
                continue
            if jid in self.jobs_by_id:
                self.start_job_file_watch(jid)
            else:
                try:
                    qname = f"{stamp()}_PENDENTE_job{jid}_{path.name}"
                    dest = self.raw_dir / qname
                    copied = copy_file_retry(path, dest, max(3, self.cfg.copy_retries // 4), self.cfg.copy_retry_sleep_seconds)
                    if copied > 0:
                        old = self.pending_unknown_spl.get(jid)
                        if old is None or (old.exists() and copied >= old.stat().st_size):
                            self.pending_unknown_spl[jid] = dest
                except Exception:
                    pass

    def spool_loop(self) -> None:
        self.log.write("Loop agressivo de spool iniciado: SOMENTE .SPL, ignorando .SHD.")
        while not STOP_EVENT.is_set():
            self.aggressive_spool_scan()
            time.sleep(self.cfg.spool_poll_interval_seconds)

    def job_loop(self) -> None:
        self.log.write("Loop agressivo da fila CAIXA iniciado.")
        while not STOP_EVENT.is_set():
            self.update_jobs()
            time.sleep(self.cfg.job_poll_interval_seconds)

    def notification_loop(self) -> None:
        if not HAS_PYWIN32:
            return
        try:
            hprinter = win32print.OpenPrinter(self.cfg.printer_name)
        except Exception as exc:
            self.log.error(f"Não abriu impressora para notificação: {exc}")
            return
        change_handle = None
        try:
            PRINTER_CHANGE_ADD_JOB = 0x00000100
            PRINTER_CHANGE_SET_JOB = 0x00000200
            PRINTER_CHANGE_DELETE_JOB = 0x00000400
            PRINTER_CHANGE_WRITE_JOB = 0x00000800
            flags = PRINTER_CHANGE_ADD_JOB | PRINTER_CHANGE_SET_JOB | PRINTER_CHANGE_DELETE_JOB | PRINTER_CHANGE_WRITE_JOB
            change_handle = win32print.FindFirstPrinterChangeNotification(hprinter, flags, 0, None)
            self.log.write("Notificação do spooler ativada para CAIXA.")
            while not STOP_EVENT.is_set():
                rc = win32event.WaitForSingleObject(change_handle, self.cfg.notification_wait_ms)
                if rc == win32con.WAIT_OBJECT_0:
                    self.last_caixa_activity = time.time()
                    self.update_jobs()
                    self.aggressive_spool_scan()
                    try:
                        win32print.FindNextPrinterChangeNotification(change_handle)
                    except Exception:
                        pass
        except Exception as exc:
            self.log.error(f"Camada de notificação falhou; seguindo com polling agressivo. Detalhe: {exc}")
        finally:
            try:
                if change_handle:
                    win32print.FindClosePrinterChangeNotification(change_handle)
            except Exception:
                pass
            try:
                win32print.ClosePrinter(hprinter)
            except Exception:
                pass

    def run(self) -> None:
        self.bootstrap_steps()
        self.preflight()
        self.log.write("ETAPA 5/5 Monitoramento: iniciando captura agressiva da impressora CAIXA.")
        threads = [
            threading.Thread(target=self.job_loop, name="job_loop_agressivo", daemon=True),
            threading.Thread(target=self.spool_loop, name="spool_loop_agressivo", daemon=True),
        ]
        if HAS_PYWIN32:
            threads.append(threading.Thread(target=self.notification_loop, name="notification_loop", daemon=True))
        for t in threads:
            t.start()
        self.log.write("Agente CAIXA v7 rodando. Pressione CTRL+C para parar.")
        self.log.write(f"TEXTOS ANEXADOS EM: {self.aggregate_path}")
        try:
            while not STOP_EVENT.is_set():
                time.sleep(0.25)
        except KeyboardInterrupt:
            self.log.write("Parando por CTRL+C...")
            STOP_EVENT.set()
        finally:
            self.db.event("INFO", "Agente v7 encerrado")
            self.log.write("Agente encerrado.")


# ─── Entry point ──────────────────────────────────────────────────────────────

def handle_signal(signum: Any, frame: Any) -> None:
    STOP_EVENT.set()


def main() -> int:
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    try:
        cfg = Config.load()
    except Exception as exc:
        print(f"Erro lendo config_caixa.json: {exc}")
        return 2
    guard = SpoolGuard(cfg)
    guard.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
