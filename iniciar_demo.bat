@echo off
chcp 65001 >nul
title Nex-J Chess - teste do motor
cd /d "%~dp0www"
echo Abra no navegador:  http://localhost:8765/demo_motor.html
echo (feche esta janela para parar)
echo.
start "" http://localhost:8765/demo_motor.html
python -m http.server 8765
pause
