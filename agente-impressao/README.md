# Agente de Impressora — Araçá Grill

Captura trabalhos de impressão do caixa para análise futura.
Fase 1: modo observador. Não interfere em nada.

## Instalação (Windows, no computador do caixa)

```bat
pip install pywin32 wmi
```

## Configuração

1. Copie `config.example.json` para `config.json`
2. Edite o nome da impressora:
   - Veja o nome exato em: Painel de Controle → Dispositivos e Impressoras
   - Copie o nome exato no campo `impressora_nome`

## Executar

```bat
python agente.py
```

Para rodar em segundo plano (sem janela):

```bat
pythonw agente.py
```

## O que o agente captura

Para cada trabalho de impressão da impressora configurada:
- Horário
- Nome do documento
- Tipo provável (fechamento, sangria, assinada, cancelamento, transferência)
- Tamanho e páginas
- Nome do computador

Os dados são salvos em arquivos JSON diários na pasta configurada.
Exemplo: `C:\ProgramData\AracaGrill\Impressora\2026-06-09.json`

## O que o agente NÃO faz (fase 1)

- Não cancela impressões
- Não pausa a fila
- Não atrapalha o TOTVS
- Não envia dados para internet
- Não lê o conteúdo do documento impresso (só o nome)

## Fase 2 (futuro)

- Identificar automaticamente assinadas/fiado pelo texto impresso
- Comparar com fechamento lançado no PWA
- Enviar para Supabase para conferência automática
