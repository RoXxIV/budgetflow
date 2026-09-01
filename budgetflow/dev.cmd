@echo off
rem Lance l'app en mode dev sans dépendre d'une session Claude :
rem backend (port 3003, --watch) et frontend (port 5174) dans deux fenêtres.
start "budgetflow backend" cmd /k "cd /d %~dp0backend && npm run dev"
start "budgetflow frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 3 >nul
start http://localhost:5174
