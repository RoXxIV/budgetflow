@echo off
rem Lance l'app en mode dev sans dependre d'une session Claude.
rem Coupe d'abord proprement ce qui tourne deja : les fenetres "budgetflow ..."
rem et tout processus orphelin sur les ports 3003/5174 (JAMAIS le 3001 de l'app installee),
rem puis relance backend (port 3003, --watch) et frontend (port 5174) dans deux fenetres.

echo Fermeture des serveurs existants...
taskkill /FI "WINDOWTITLE eq budgetflow backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq budgetflow frontend*" /T /F >nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3003,5174 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('  orphelin ' + $_ + ' arrete') } catch {} }"

echo Lancement...
start "budgetflow backend" cmd /k "cd /d %~dp0backend && npm run dev"
start "budgetflow frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 3 >nul
start http://localhost:5174
