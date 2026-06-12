# -*- coding: utf-8 -*-
"""Gera os ícones PNG do app (sem dependências — PNG escrito na mão).
Design: fundo azul-escuro do painel, anel vermelho e centro dourado (prato/moeda)."""
import struct
import zlib
from pathlib import Path

FUNDO = (26, 26, 46)      # #1a1a2e
ANEL = (230, 57, 70)      # #e63946
CENTRO = (184, 134, 11)   # #b8860b


def png(width: int, height: int, pixel_fn) -> bytes:
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filtro None por scanline
        for x in range(width):
            raw += bytes(pixel_fn(x, y))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # RGB 8-bit
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def icone(tam: int) -> bytes:
    cx = cy = tam / 2

    def px(x, y):
        d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / tam
        if d < 0.10:
            return CENTRO
        if 0.26 < d < 0.38:
            return ANEL
        return FUNDO

    return png(tam, tam, px)


def main(destino: str = "dashboard-app/icons") -> None:
    out = Path(destino)
    out.mkdir(parents=True, exist_ok=True)
    for tam in (192, 512):
        (out / f"icon-{tam}.png").write_bytes(icone(tam))
        print(f"icon-{tam}.png OK")


if __name__ == "__main__":
    main()
