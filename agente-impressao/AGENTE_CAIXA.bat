@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Araca Grill - Agente CAIXA v7

pushd "%~dp0"

:: ─── Solicita permissao de Administrador se necessario ─────────────────────
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Solicitando permissao de Administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   ARACA GRILL - AGENTE CAIXA v7
echo   Captura de impressora + envio ao Supabase
echo ============================================================
echo.

:: ─── Verifica se config_caixa.json existe ──────────────────────────────────
if not exist "config_caixa.json" (
    echo CONFIGURACAO NECESSARIA:
    echo.
    echo O arquivo config_caixa.json nao foi encontrado.
    echo.
    echo 1. Copie o arquivo config.example.json
    echo 2. Renomeie a copia para config_caixa.json
    echo 3. Abra com o Bloco de Notas e preencha:
    echo       printer_name   - nome exato da impressora CAIXA no Windows
    echo       supabase_url   - URL do projeto Supabase
    echo       supabase_key   - chave anon do Supabase
    echo 4. Execute este arquivo novamente
    echo.
    echo Dica: execute LISTAR_IMPRESSORAS.bat para ver os nomes
    echo       disponiveis no Windows.
    echo.
    pause
    exit /b 1
)

:: ─── Localiza Python ────────────────────────────────────────────────────────
set "PYTHON_EXE="
where py >nul 2>nul
if "%errorlevel%"=="0" set "PYTHON_EXE=py -3"

if not defined PYTHON_EXE (
    where python >nul 2>nul
    if "%errorlevel%"=="0" set "PYTHON_EXE=python"
)

if not defined PYTHON_EXE (
    echo ERRO: Python nao encontrado neste computador.
    echo.
    echo Instale o Python 3 em https://python.org
    echo Na instalacao marque a opcao: Add Python to PATH
    echo Depois execute este arquivo novamente.
    echo.
    pause
    exit /b 1
)

echo Python encontrado: %PYTHON_EXE%
echo.

:: ─── Instala dependencias ────────────────────────────────────────────────────
echo Verificando dependencias (pywin32)...
%PYTHON_EXE% -m pip install pywin32 --quiet --no-warn-script-location
if not "%errorlevel%"=="0" (
    echo AVISO: pip retornou erro, mas o agente vai tentar continuar.
)
echo.

:: ─── Inicia o agente ─────────────────────────────────────────────────────────
echo Iniciando agente...
echo Deixe esta janela ABERTA enquanto o caixa estiver em funcionamento.
echo Para parar: CTRL+C ou feche esta janela.
echo.
echo ============================================================
echo.

%PYTHON_EXE% "%CD%\agente.py"
set "RET=%errorlevel%"

echo.
echo ============================================================
if not "%RET%"=="0" (
    echo Agente encerrado com erro. Codigo: %RET%
    echo Verifique as mensagens acima.
) else (
    echo Agente encerrado normalmente.
)
echo.
pause
exit /b %RET%
