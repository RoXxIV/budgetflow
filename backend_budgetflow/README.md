# BudgetFlow — Backend

Application budgétaire personnelle (mono-utilisateur). Pas d'auth pour l'instant, à ajouter plus tard.

---

## Architecture des collections

### `MonthlySheet`
Le pivot central. Presque tout est rattaché à un sheet.
- `periodMonth` : date du mois (ex: 2026-04-01)
- `isTemplate` : le sheet template sert de base pour créer les nouveaux mois
- `status` : draft / active / archived
- A chaque nouveau mois, on duplique les `BudgetLine` du template vers le nouveau sheet

---

### `Section`
Blocs UI globaux pour regrouper les BudgetLines (ex: Facture, Abonnement, Épargne, Dépense, Dette).
- Globales, non liées à un sheet
- Éditables dans les paramètres
- Quand on duplique le template, les BudgetLines copiées gardent les mêmes refs Section

### `Theme`
Sous-catégories analytiques (ex: Alimentation, Shopping, Appartement...).
- Globaux, éditables dans les paramètres
- `role: "rent_base"` : thème spécial utilisé pour labelliser automatiquement la transaction de rééquilibrage 50/50 (loyer)

---

### `BudgetLine`
Enveloppe budgétaire par sheet. Une ligne = une dépense ou revenu planifié.
- `sheet` : ref MonthlySheet (template ou mois réel)
- `section` : bloc UI
- `theme` : sous-catégorie
- `flow` : expense | income
- `type` : fixed | variable
- `plannedAmount` : montant budgété
- `actualAmount` : **cache** mis à jour via `$inc` à chaque création de transaction — évite de recalculer les transactions à chaque affichage
- `fromAccount` : compte source par défaut (colonne "Depuis")
- `toAccount` : compte destination par défaut (colonne "Vers", pour les virements)
- `paymentMethod` : CB | virement | especes | autre
- `isShared` : ligne incluse dans le calcul de rééquilibrage 50/50 (voir feature "Partage")
- `applyRounding` : activer l'arrondi à l'euro supérieur pour cette ligne

---

### `Transaction`
Dépense ou revenu réel sur un sheet.
- `sheet` : mois concerné
- `budgetLine` : enveloppe associée — sa création déclenche `$inc` sur `BudgetLine.actualAmount`
- `flow` : income | expense
- `account` : compte débité/crédité
- `source` : manual | bank_import | meter | cancellation | rounding
  - `cancellation` : transaction inverse créée pour annuler une transaction existante
  - `rounding` : transaction auto-générée par la feature arrondi
- `goal` : ref SavingGoal si la transaction est une contribution à un objectif

**Annulation :** pas de suppression, on crée une transaction inverse (`source: "cancellation"`) qui déclenche le `$inc` négatif sur `actualAmount`.

---

### `Account`
Comptes bancaires/cash de l'utilisateur.
- `type` : bank | cash | savings
- `includeInNetWorth` : inclure dans le calcul du patrimoine total

### `AccountSnapshot`
Solde de début de mois par compte.
- Lié à un `MonthlySheet` + un `Account` (index unique)
- Saisi manuellement (pré-remplissage depuis le mois précédent possible)
- Solde courant = snapshot + sum(transactions du mois pour ce compte)
- Solde fin de mois projeté = snapshot + revenus - dépenses fixes (template) - dépenses réelles saisies

---

### `SavingGoal`
Objectif d'épargne (ex: Japon, Voiture).
- `account` : compte où l'argent est stocké (ex: N26 Voyage)
- `targetAmount` : montant cible
- `initialAmount` : montant déjà disponible au départ
- `deadline` : date cible
- Géré dans son propre onglet (pas dans le sheet mensuel)
- **Total épargné** = `initialAmount` + sum(SavingContributions)
- **Mensualité suggérée** = (targetAmount - total épargné) / mois restants jusqu'à deadline

### `SavingContribution`
Contribution mensuelle vers un objectif.
- Créée quand on alloue de l'argent à un goal depuis un sheet
- **Flow lors d'une contribution depuis un sheet :**
  1. `Transaction` créée : expense depuis le compte source, `goal` ref renseigné
  2. `SavingContribution` créée : goal + sheet + amount
  3. L'onglet goal agrège les SavingContributions pour afficher la progression

---

### `UtilityMeter`
Compteur électrique (EDF). Module calculateur indépendant du système de transactions.
- `config` : hpPrice, hcPrice, subscriptionPrice, tvaRate (défaut 20%)
- Lié à un `Theme` (pas à une BudgetLine)

### `UtilityReading`
Relevé mensuel du compteur.
- `hpPrevious/hpCurrent` : index heures pleines début/fin
- `hcPrevious/hcCurrent` : index heures creuses début/fin
- **Calcul :**
  - Total HP = (hpCurrent - hpPrevious) × hpPrice
  - Total HC = (hcCurrent - hcPrevious) × hcPrice
  - TVA + Abo = (Total HP + Total HC) × (tvaRate/100) + subscriptionPrice
  - Coût réel = Total HP + Total HC + TVA + Abo
- Le coût réel est affiché à côté du sheet, **pas de transaction auto-créée**
- La mensualité EDF est une BudgetLine fixe dans le template
- Si coût réel > mensualité : l'utilisateur crée manuellement une transaction pour la différence (souvent marquée `isShared`)

---

### `Investment`
Actif d'investissement (ETF, CRYPTO, STOCK, OTHER).
- `account` : compte associé (ex: PEA)
- `monthlyInvestment` : montant DCA mensuel
- `currentValue` : valeur actuelle saisie manuellement depuis l'app d'investissement — intentionnellement un seul chiffre (pas d'historique), sert à calculer le % gain/perte
- **Total investi** = sum(InvestmentTransactions) — calculé à la requête
- **Gain/perte %** = (currentValue - totalInvesti) / totalInvesti × 100

### `InvestmentTransaction`
Versement individuel sur un investissement.

---

### `AppSettings`
Singleton (un seul document).
- `savingRate` : objectif d'épargne global en %
- `currency` : devise (défaut EUR)
- `includeInvestmentsInSavings` : compter les investissements dans le taux d'épargne
- `roundingEmitterAccount` : compte qui émet les centimes (feature arrondi)
- `roundingReceiverAccount` : compte qui reçoit les centimes (feature arrondi)

---

## Features métier

### Feature "Arrondi"
Si une transaction est sur une BudgetLine avec `applyRounding: true` :
- Ex: payer 53.14€ → arrondi à 54€
- Transaction principale : 53.14€ (normale)
- Transaction auto : 0.86€ depuis `roundingEmitterAccount` vers `roundingReceiverAccount`, `source: "rounding"`
- Les comptes emitter/receiver sont définis dans `AppSettings`

### Feature "Partage 50/50"
Pour calculer le rééquilibrage des dépenses communes avec la copine :
- Les BudgetLines avec `isShared: true` sont incluses dans le calcul
- Total commun = sum(plannedAmount ou actualAmount des lignes isShared)
- Part de chacun = total / 2
- Différence = montant à envoyer (ou recevoir)
- La transaction de rééquilibrage est créée **manuellement** par l'utilisateur
- Elle utilise le thème avec `role: "rent_base"` → label "Loyer"
- Cette transaction peut elle-même être marquée `isShared: false` pour ne pas créer une boucle

### Feature "Template"
- Un seul MonthlySheet avec `isTemplate: true`
- Editable (sections, lignes, montants, comptes par défaut)
- Création d'un nouveau mois = duplication des BudgetLines du template vers le nouveau sheet

### Feature "Solde dynamique"
A tout moment, l'app doit afficher :
- Solde actuel par compte = AccountSnapshot.balance + sum(transactions du mois)
- Solde projeté fin de mois = solde actuel - dépenses fixes restantes non encore payées

---

## Relations clés

```
MonthlySheet
  ├── BudgetLine[]        (sheet ref)
  ├── Transaction[]       (sheet ref)
  ├── AccountSnapshot[]   (sheet ref)
  ├── SavingContribution[] (sheet ref, optionnel)
  ├── UtilityReading[]    (sheet ref)
  └── InvestmentTransaction[] (sheet ref, optionnel)

BudgetLine
  └── Transaction[]       (budgetLine ref) → $inc sur actualAmount

SavingGoal
  └── SavingContribution[] (goal ref)

Investment
  └── InvestmentTransaction[] (investment ref)

UtilityMeter
  └── UtilityReading[]    (meter ref)
```

---

## Ordre d'implémentation

L'ordre suit la dépendance des données : on ne peut pas créer un sheet sans comptes ni template.

---

### Étape 1 — Paramètres
**Pourquoi en premier :** comptes, sections et thèmes sont des prérequis pour tout le reste.

Pages frontend : `/parametres`

Endpoints backend :
- `GET/POST/PUT/DELETE /api/accounts`
- `GET/POST/PUT/DELETE /api/sections`
- `GET/POST/PUT/DELETE /api/themes`
- `GET /api/settings` — récupère le singleton AppSettings (le crée s'il n'existe pas)
- `PUT /api/settings` — met à jour devise, savingRate, comptes arrondi, includeInvestmentsInSavings

---

### Étape 2 — Template
**Pourquoi deuxième :** le template est la base de tous les sheets. Il doit être configuré avant de créer le premier mois.

Pages frontend : `/template`

Endpoints backend :
- `GET /api/template` — récupère le MonthlySheet avec `isTemplate: true` (le crée s'il n'existe pas)
- `GET /api/template/lines` — liste les BudgetLines du template avec populate section/theme/accounts
- `POST /api/template/lines` — ajoute une ligne au template
- `PUT /api/template/lines/:id` — modifie une ligne (label, montants, comptes, isShared, applyRounding...)
- `DELETE /api/template/lines/:id` — supprime une ligne
- `PUT /api/template/lines/reorder` — met à jour l'ordre des lignes

---

### Étape 3 — Sheet mensuel
**Pourquoi troisième :** c'est le cœur de l'app. Dépend du template et des comptes.

Pages frontend : `/sheet/:id`, `/sheet/nouveau`

Endpoints backend :
- `POST /api/sheets` — crée un nouveau sheet en dupliquant les BudgetLines du template
- `GET /api/sheets/active` — récupère le sheet actif du mois en cours
- `GET /api/sheets/:id` — récupère un sheet avec ses BudgetLines (populate complet)
- `GET /api/sheets/:id/summary` — soldes dynamiques : snapshot + transactions par compte, total budgété/réel/restant par section, calcul partage 50/50
- `POST/PUT/DELETE /api/sheets/:id/snapshots` — soldes de début de mois par compte
- `GET /api/sheets/:id/transactions` — liste les transactions du sheet
- `POST /api/sheets/:id/transactions` — crée une transaction + `$inc` sur BudgetLine.actualAmount + génère transaction arrondi si applicable
- `POST /api/sheets/:id/transactions/:id/cancel` — crée la transaction inverse (`source: "cancellation"`)
- `GET/POST /api/sheets/:id/utility-reading` — relevé compteur EDF du mois

---

### Étape 4 — Objectifs d'épargne
**Pourquoi ici :** feature indépendante, mais une contribution peut être liée à un sheet (étape 3 nécessaire).

Pages frontend : `/objectifs`

Endpoints backend :
- `GET/POST /api/goals` — liste et création des objectifs
- `PUT/DELETE /api/goals/:id` — modification et suppression
- `GET /api/goals/:id` — détail : total épargné, % atteint, mensualité suggérée, historique contributions
- `POST /api/goals/:id/contributions` — ajoute une contribution (crée aussi une Transaction sur le sheet si `sheetId` fourni)
- `DELETE /api/goals/:id/contributions/:id` — supprime une contribution

---

### Étape 5 — Investissements
**Pourquoi ici :** feature indépendante.

Pages frontend : `/investissements`

Endpoints backend :
- `GET/POST /api/investments` — liste et création
- `PUT/DELETE /api/investments/:id` — modification (dont mise à jour manuelle de `currentValue`)
- `GET /api/investments/:id` — détail : total investi (sum transactions), gain/perte %
- `POST /api/investments/:id/transactions` — ajoute un versement
- `DELETE /api/investments/:id/transactions/:id` — supprime un versement

---

### Étape 6 — Archives
**Pourquoi ici :** nécessite des sheets existants (étape 3).

Pages frontend : `/archives`

Endpoints backend :
- `GET /api/sheets` — liste tous les sheets non-template, triés par date desc
- `PUT /api/sheets/:id/archive` — passe le status à `archived`

---

### Étape 7 — Statistiques
**Pourquoi en dernier :** nécessite des données sur plusieurs mois.

Pages frontend : `/statistiques`

Endpoints backend :
- `GET /api/stats/spending-by-theme?from=&to=` — dépenses agrégées par thème sur une période
- `GET /api/stats/monthly-balance?months=` — revenus / dépenses / épargne par mois
- `GET /api/stats/savings-rate?months=` — taux d'épargne réel par mois
- `GET /api/stats/net-worth-evolution` — évolution du patrimoine (basé sur AccountSnapshots)
