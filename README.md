# BudgetFlow (nouvelle version)

Réécriture propre et configurable de BudgetFlow. Les décisions fonctionnelles sont dans
`../brainstorm-nouvelle-version.md` — le lire avant de toucher au code.

## Stack

- **Frontend** : Vue 3 + Vite + Tailwind 4 (`frontend/`), port dev 5174
- **Backend** : Express 5 + SQLite via `node:sqlite` (`backend/`), port dev 3003
- **Base** : `backend/data/budget.db` (créée au premier lancement, ignorée par git)
- **Migrations** : fichiers SQL numérotés dans `backend/db/migrations/`, appliqués
  automatiquement au démarrage (table `_migrations`)
- Tauri 2 sera intégré une fois l'app validée en mode web (même approche que l'ancienne)

## Lancer en dev

Le plus simple : double-cliquer sur `dev.cmd` (ouvre les deux serveurs dans deux fenêtres
et le navigateur sur http://localhost:5174). Sinon à la main :

```sh
# Terminal 1
cd budgetflow/backend && npm run dev

# Terminal 2
cd budgetflow/frontend && npm run dev   # http://localhost:5174
```

## Conventions

- Montants stockés en **centimes** (INTEGER) en base, exposés en **euros** (Number) par l'API
- API en camelCase, tables/colonnes en snake_case
- Toute la logique métier vit dans `backend/services/`, le front ne calcule rien
- Pas de libellé métier en dur dans le code (les noms appartiennent à l'utilisateur)
