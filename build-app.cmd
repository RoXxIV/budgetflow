@echo off
setlocal
rem ─── Build de l'app installable BudgetFlow2 (Tauri) ──────────────────────────
rem 1. frontend Vite avec l'API pointée sur le port 3004 (celui de l'app installée)
rem 2. runtime backend copié dans src-tauri/backend (sans data/tests/scripts)
rem 3. base ACTUELLE copiée en seed (db+wal+shm) — embarquée dans l'installeur,
rem    posée dans %%APPDATA%% au premier lancement. JAMAIS commitée (gitignore).
rem 4. tauri build → l'installeur NSIS sort dans src-tauri\target\release\bundle\nsis\

cd /d %~dp0

echo [1/4] Frontend...
cd frontend
set VITE_API_URL=http://localhost:3004/api
call npx vite build || exit /b 1
set VITE_API_URL=
cd ..

echo [2/4] Backend runtime...
if exist src-tauri\backend rmdir /s /q src-tauri\backend
robocopy backend src-tauri\backend /e /xd data tests scripts node_modules\.cache /njh /njs /ndl /nc /ns /np >nul
if errorlevel 8 exit /b 1

echo [3/4] Seed (base actuelle)...
if exist src-tauri\seed rmdir /s /q src-tauri\seed
mkdir src-tauri\seed
copy /y backend\data\budget.db src-tauri\seed\ >nul
if exist backend\data\budget.db-wal copy /y backend\data\budget.db-wal src-tauri\seed\ >nul
if exist backend\data\budget.db-shm copy /y backend\data\budget.db-shm src-tauri\seed\ >nul

echo [4/4] Tauri build...
call npx --yes @tauri-apps/cli@^2 build || exit /b 1

echo.
echo Termine. Installeur : src-tauri\target\release\bundle\nsis\
