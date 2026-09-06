# CONTEXTE.md — repères BudgetFlow2

Contexte projet à connaître avant de coder. Les règles non-négociables sont dans
**[CLAUDE.md](CLAUDE.md)** (jamais la vraie base · tout ajout avec ses tests ·
diagnostiquer avant de modifier).

---

## 1. Carte du code

**Backend** (`backend/`, Express 5 + `node:sqlite`, port 3003)

```
routes/*.routes.js     (11)  HTTP uniquement : parse, appelle un service, renvoie
services/*.service.js  (14)  TOUTE la logique métier vit ici
db/index.js                  ouverture SQLite + application des migrations au boot
db/migrations/NNN-*.sql (20) migrations numérotées
tests/*.test.mjs        (7)  une suite par page, base neuve jetable (_setup.mjs)
scripts/*.mjs                outils ponctuels (import, alignement, review)
```

**Frontend** (`frontend/src/`, Vue 3 + Vite + Tailwind 4, port 5174)

```
views/         (7)  MonthView, AccountsView, InvestmentsView, TemplateView,
                    StatsView, SettingsView, SubscriptionsView
components/         AppModal, DialogHost, HelpTip, BarChart, StackedAreaChart,
                    LineChart, SeriesPicker
lib/                format.js (eur()), privacy.js (mode discret), theme.js (clair/sombre)
styles/tokens.css   tous les tokens de couleur et de typo
api/                appels axios vers le backend
```

**Où ajouter quoi** : une règle de calcul → un service, jamais une vue. Une nouvelle
donnée → une migration + le service + le test. Le front n'invente aucun montant :
il affiche ce que l'API renvoie.

### Conventions

- Montants stockés en **centimes** (INTEGER) en base, exposés en **euros** par l'API.
- API en **camelCase**, tables et colonnes en **snake_case**.
- Aucun libellé métier en dur dans le code : les noms (comptes, catégories, enveloppes)
  appartiennent à l'utilisateur et vivent en base.

### Migrations

Fichiers numérotés `backend/db/migrations/NNN-nom.sql`, appliqués automatiquement au
démarrage du backend. **Ne jamais modifier une migration déjà passée** (elle est déjà
appliquée sur la base de dev et sur l'app installée) → toujours en créer une nouvelle.

### Design system : palette fermée

Pas de couleur en dur, pas d'input color. Tout passe par les tokens de
`frontend/src/styles/tokens.css` : `--cat-1..12` (catégories), `--chart-1..6` +
`--chart-other` (graphiques), `--c-*` (interface), `--c-on-accent`.
Typo IBM Plex Sans. Thème clair/sombre/système via `lib/theme.js`
(localStorage `budgetflow.theme`, pré-script anti-flash dans `index.html`).
Le mode discret (`lib/privacy.js`) doit flouter **tout** montant affiché : un nouveau
montant à l'écran, c'est un montant à passer au filtre.

---

## 2. Règles produit structurantes

### « Jamais de perte »

Rien qui porte de l'historique ne se supprime :

- **Compte** avec des opérations → **désactivation** (`is_active`), avec transfert du
  solde vers un autre compte. Jamais de suppression.
- **Enveloppe** avec de l'historique → **clôture**, avec réaffectation libre du solde
  vers n'importe quelle enveloppe ou compte (virement système si l'hôte change).
- **Suppression** réservée aux objets sans aucun historique.
- Un mois **clôturé** est figé : on ne le modifie plus.

Ne jamais proposer un `DELETE` sur une donnée qui a servi. En cas de doute :
désactiver, clôturer, ou demander.

### Autres garde-fous déjà en place

- Cases à cocher de pointage **à sens unique** (on pointe, on ne dépointe pas à la légère).
- Découvert autorisé configurable par compte.
- Unicité des noms (comptes, enveloppes, catégories).
- « Annuler ce mois-ci » : sauter une mensualité ou un DCA sans rien casser, réversible,
  valable pour le mois en cours uniquement.

---

## 3. Conventions de données (chantier bancaire du 02/09)

Février → août 2026 ont été réconciliés au centime avec le CSV N26. Ces choix sont
**délibérés** : ne pas les « corriger ».

- Les **arrondis N26** (~10-20 €/mois versés vers l'enveloppe Voyage) ne sont **pas**
  des entrées : ils sont absorbés par le recalage des soldes en début de mois.
- Les **snapshots historiques saisis de tête** sont conservés tels quels, même s'ils
  ne tombent pas juste.
- Catégorie **« Operations » = type transfert** (mouvements internes, hors stats).
- Le **cycle d'une feuille de mois ≈ salaire à salaire** ; les dates réelles des
  opérations sont conservées.
- Cartes virtuelles N26 absentes du CSV : Spotify = 12,14 € via Google Play le 22 du
  mois, HBO = Amazon EU 10,99 €.
- Entrées = **montant marchand**.

### Invariants

Avant/après toute manipulation de données, relever ces chiffres **sur la copie** et
montrer la comparaison à Evan. Certains sont stables, d'autres bougent avec le temps —
ce qui compte, c'est qu'ils ne bougent pas *à cause du changement*.

```powershell
cd backend ; $env:DB_PATH="<copie>\budget.db" ; node -e "..."   # via summary.getNetWorth() et asset.list()
```

| Repère | Valeur au 06/09/2026 | Nature |
|---|---|---|
| Patrimoine total | 12 458,73 € | bouge chaque mois |
| Solde N26 Voyage | 4 120,50 € | bouge chaque mois |
| Solde N26 Safety | 5 006,25 € | bouge chaque mois |
| Investi BTC/SOL/ETH | 499 € | stable (n'augmente qu'au DCA) |
| Investi MSCI/ASIE/CHINE | 700 € | stable (n'augmente qu'au DCA) |

Un solde qui change après un simple refactor = régression, même si le total semble juste.

---

## 4. Ports et release

### Ports — cartographie à respecter

| Port | Quoi | Consigne |
|---|---|---|
| 3001 / 3002 | **ANCIENNE app installée** (Mongo), gardée pour comparaison | **NE JAMAIS TUER** |
| 3003 | backend de dev (`npm run dev`, `--watch`) | à toi |
| 5174 | frontend de dev (vite) | à toi |
| 3004 | **BudgetFlow2 installée** (sidecar node lancé par Tauri) | ne pas tuer sans raison |

`npm run dev` arrêté laisse parfois un `node --watch` orphelin sur 3003 : le tuer via
netstat/taskkill — en vérifiant le port **avant** de tirer.

### Release

1. `cd backend ; npm test` — tout au vert.
2. Vérifier que `backend/data/budget.db` est bien la vraie base intacte (elle part en seed).
3. `build-app.cmd` → vite build (VITE_API_URL sur 3004) → copie du backend runtime dans
   `src-tauri/backend/` → copie de la base de dev dans `src-tauri/seed/` → build Tauri.
4. Installeur NSIS dans `src-tauri/target/release/bundle/nsis/`.

La seed n'est posée qu'au **premier** lancement (si `budget.db` absent de
`%APPDATA%/fr.revaw.budgetflow2/`). Ensuite l'app installée vit sa vie.
`src-tauri/backend/` et `src-tauri/seed/` sont gitignorés (données bancaires réelles).
Pas de remote git configuré : tout reste local.

**En attente pour la prochaine release** : rejouer
`backend/scripts/registre-parametres-donnees.mjs` sur la base installée (il est déjà
passé sur la base de dev et sur `backup-propre-20260901`).

**Bug hérité à surveiller** : si Tauri crashe sans `RunEvent::Exit`, un node orphelin
peut rester sur 3004.

---

## 5. Documentation du projet

Ces documents sont **hors dépôt git**, dans le dossier parent
`C:\Users\RoXx\Desktop\Dev_perso\new_budgetflow\` :

- `Design_md/brainstorm-nouvelle-version.md` — **source de vérité fonctionnelle**.
  À lire avant de coder une nouveauté, à tenir à jour.
- `Design_md/refonte-ui-budgetflow*.md` (7 briefs) — la refonte UI « registre »
  appliquée les 03-04/09, page par page. Appliqués en filtrant ce qui contredisait
  la logique métier.
- `review.md` — rapport de la revue du 04/09.
- `budgetflow/README.md` — ce que fait l'app, raconté simplement.
