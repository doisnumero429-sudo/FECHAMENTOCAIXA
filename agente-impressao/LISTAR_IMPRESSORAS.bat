@echo off
chcp 65001 >nul
title Impressoras disponiveis no Windows

echo ============================================================
echo   IMPRESSORAS DISPONIVEIS NESTE COMPUTADOR
echo ============================================================
echo.
echo Copie exatamente o nome da impressora CAIXA e cole no
echo campo "printer_name" do arquivo config_caixa.json
echo.
echo ─────────────────────────────────────────────
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, DriverName, PortName | Format-Table -AutoSize"
echo ─────────────────────────────────────────────
echo.
pause
