# BudgetFlow2 🦊

Mon appli de budget personnelle. Elle vit sur mon ordinateur, les données ne quittent
jamais la maison : pas de compte en ligne, pas de cloud, pas d'abonnement — juste un
petit fichier de base de données local.

## C'est quoi, en une phrase ?

Un **registre de mois** : chaque mois je note ce qui rentre et ce qui sort, l'appli
compare avec ce qui était prévu, me dit combien il me reste à vivre, et quand le mois
est fini je le clôture — il devient une archive qu'on ne peut plus modifier par erreur.

## Installer l'application

L'installeur se fabrique avec **`build-app.cmd`** (double-clic à la racine du projet).
Il apparaît ensuite ici :

```
src-tauri\target\release\bundle\nsis\BudgetFlow2_1.0.0_x64-setup.exe
```

Double-clic sur le setup, et BudgetFlow2 s'installe comme n'importe quel logiciel
Windows (icône renard). Au premier lancement elle démarre avec la base embarquée dans
l'installeur ; ensuite elle garde ses propres données et les mises à jour ne les
écrasent jamais. Il faut Node.js 22+ installé sur la machine.

## Ce que l'appli sait faire

**Le mois** — la page principale. Les revenus et dépenses prévues arrivent tout seuls
depuis le template, je pointe ce qui est vraiment passé sur le compte, et le bandeau
du haut me dit où j'en suis : combien j'ai encaissé, dépensé, et surtout le **reste à
vivre** qui tient compte de ce qui n'est pas encore tombé. Une note libre par mois, et
la clôture qui fige tout.

**Les enveloppes** — des cagnottes avec un objectif (vacances, matelas de sécurité…).
Certaines sont **mensualisées** : une grosse dépense annuelle (assurance, abonnement
annuel) est découpée en petites parts mises de côté chaque mois, comme ça pas de trou
dans le budget quand la facture tombe. Quand l'échéance arrive, **« Liquider et
renouveler »** vide l'enveloppe vers le compte de mon choix avec une trace du
virement, et le cycle repart pour l'année suivante.

**« Annuler ce mois-ci »** — un mois où je saute un versement (pas de crypto ce
mois-ci, pas de mise de côté) : un clic, la somme revient dans le reste à vivre, et
c'est réversible. Ça ne vaut que pour le mois en cours.

**Les comptes** — la liste de mes comptes avec leur solde réel, calculé à partir des
opérations pointées. Virements entre comptes, découvert autorisé, comptes en sommeil.

**Les investissements** — mes actifs (crypto, bourse…) avec leur valeur actuelle, ce
que j'y ai mis, et les versements programmés chaque mois.

**Les stats** — des graphiques sur plusieurs mois : évolution du patrimoine,
répartition par catégorie, où part l'argent.

**Le tracker d'abonnements** — un bac à sable accessible depuis la page du mois. Il
liste tous mes abonnements (mensuels, annuels, hebdo) avec le vrai coût par mois et
par an, et je peux **simuler** : et si je résiliais Netflix ? et si je passais sur
l'offre à 5 € ? L'économie s'affiche par mois et par an, sans jamais rien toucher au
vrai budget.

**Et partout** : mode confidentialité qui floute tous les montants d'un clic (pour
montrer l'écran sans montrer les chiffres), thème sombre, et des calculateurs
intégrés.

## Pour les curieux (partie technique)

- **Frontend** : Vue 3 + Vite (`frontend/`), port dev 5174
- **Backend** : Express 5 + SQLite via `node:sqlite` (`backend/`), port dev 3003
- **Appli installable** : Tauri 2 (`src-tauri/`), backend embarqué en sidecar node,
  port 3004, données dans `%APPDATA%/fr.revaw.budgetflow2/`
- **Base** : `backend/data/budget.db` (créée au premier lancement, jamais dans git)
- **Migrations** : fichiers SQL numérotés dans `backend/db/migrations/`, appliqués
  automatiquement au démarrage
- **Tests** : `cd backend && npm test`

Lancer en dev : double-clic sur `dev.cmd` (ouvre les deux serveurs et le navigateur),
ou à la main :

```sh
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev   # http://localhost:5174
```

Conventions maison :

- Montants stockés en **centimes** (INTEGER) en base, exposés en **euros** par l'API
- API en camelCase, tables/colonnes en snake_case
- Toute la logique métier vit dans `backend/services/`, le front ne calcule rien
- Pas de libellé métier en dur dans le code (les noms appartiennent à l'utilisateur)
