@echo off
setlocal EnableExtensions
title Araca Grill - Agente CAIXA v7

:: %~dp0 = pasta onde este .bat esta salvo (funciona mesmo rodando como admin)
set "PASTA=%~dp0"

:: Solicita permissao de Administrador se necessario
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Solicitando permissao de Administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    exit /b
)

cd /d "%PASTA%"

echo ============================================================
echo   ARACA GRILL - AGENTE CAIXA v7
echo   Captura de impressora + envio ao Supabase
echo ============================================================
echo.

:: Verifica se config_caixa.json existe
if not exist "%PASTA%config_caixa.json" (
    echo CONFIGURACAO NECESSARIA:
    echo.
    echo O arquivo config_caixa.json nao foi encontrado.
    echo.
    echo Voce ja recebeu o config_caixa.json pronto.
    echo Coloque-o na mesma pasta deste arquivo .bat
    echo.
    echo Se precisar ajustar o nome da impressora,
    echo execute LISTAR_IMPRESSORAS.bat primeiro.
    echo.
    pause
    exit /b 1
)

:: Localiza Python
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)

if not defined PY (
    echo ERRO: Python nao encontrado.
    echo.
    echo Instale o Python 3 em: https://python.org
    echo Na instalacao marque: Add Python to PATH
    echo Depois execute este arquivo novamente.
    echo.
    pause
    exit /b 1
)

echo Python encontrado: %PY%
echo.

:: Instala pywin32 se necessario
echo Verificando pywin32...
%PY% -m pip install pywin32 --quiet --no-warn-script-location
echo.

:: Inicia o agente
echo Iniciando agente...
echo Deixe esta janela ABERTA durante o turno.
echo Para parar: CTRL+C ou feche a janela.
echo.
echo ============================================================
echo.

%PY% "%PASTA%agente.py"
set "RET=%errorlevel%"

echo.
echo ============================================================
if "%RET%"=="0" (
    echo Agente encerrado normalmente.
) else (
    echo Agente encerrado com erro. Codigo: %RET%
)
echo.
pause
exit /b %RET%
