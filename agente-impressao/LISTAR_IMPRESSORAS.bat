@echo off
title Impressoras disponiveis

echo ============================================================
echo   IMPRESSORAS DISPONIVEIS NESTE COMPUTADOR
echo ============================================================
echo.
echo Copie o nome exato da impressora e coloque no
echo campo "printer_name" do arquivo config_caixa.json
echo.
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, DriverName | Format-Table -AutoSize"
echo ------------------------------------------------------------
echo.
pause
