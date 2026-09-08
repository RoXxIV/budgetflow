@echo off
rem Lance l'app en mode dev sans dependre d'une session Claude.
rem
rem LA BASE : backend\data\dev\budget.db — le bac a sable, jamais la base de reference.
rem   - pour tester avec de vraies donnees : y coller budget.db + -wal + -shm
rem     (les TROIS fichiers : les ecritures recentes vivent dans le -wal)
rem   - pour tester une premiere utilisation : supprimer les trois, l'app en recree
rem     une vide au demarrage et le guide de bienvenue se relance
rem   - dans les deux cas, fermer les fenetres serveur AVANT de toucher aux fichiers
rem
rem backend\data\budget.db, lui, ne bouge pas : c'est la seed embarquee par
rem build-app.cmd dans l'installeur.
rem
rem Coupe d'abord proprement ce qui tourne deja : les fenetres "budgetflow ..."
rem et tout processus orphelin sur les ports 3003/5174 (JAMAIS le 3001 de l'app installee),
rem puis relance backend (port 3003, --watch) et frontend (port 5174) dans deux fenetres.

echo Fermeture des serveurs existants...
taskkill /FI "WINDOWTITLE eq budgetflow backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq budgetflow frontend*" /T /F >nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3003,5174 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('  orphelin ' + $_ + ' arrete') } catch {} }"

rem La variable est posee ICI et non dans le cmd /k : les guillemets imbriques dans un
rem start "..." cmd /k "..." se melangent, et un chemin a espaces casserait tout.
rem start transmet l'environnement du parent a la fenetre qu'il ouvre.
set "DB_PATH=%~dp0backend\data\dev\budget.db"

echo Lancement sur %DB_PATH%
start "budgetflow backend" cmd /k "cd /d %~dp0backend && npm run dev"
start "budgetflow frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 3 >nul
start http://localhost:5174
