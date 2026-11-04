@echo off
chcp 65001 >nul
title Nex-J Chess - app do celular (teste no PC)
cd /d "%~dp0www"
echo Abra no navegador:  http://localhost:8765/index.html
echo (os dados de teste ficam neste navegador; feche esta janela para parar)
echo.
start "" http://localhost:8765/index.html
python -m http.server 8765
pause
