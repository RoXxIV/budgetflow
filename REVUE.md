# Revue fonctionnelle — 01/09/2026

Passe complète faite pendant ton absence : script de revue backend, remplacement des dialogues natifs, aide contextuelle. Tout est committé. Ce fichier liste ce qui a été **vérifié**, ce qui a été **corrigé** sans te demander, et ce qui **attend ta décision**.

## 1. Ce qui a été vérifié

`backend/scripts/review.mjs` exerce toutes les règles métier sur une base **neuve** (jamais ta base de dev) : **83 vérifications, 0 échec**. Rejouable à tout moment :

```sh
cd budgetflow/backend
node scripts/review.mjs "C:\chemin\vers\une-base-neuve.db"
```

Couvert : comptes (principal d'office, enveloppe auto, renommage synchronisé, multi-projets), enveloppes (virtuelles, clôture, suggestion, invariant Σ ≤ solde, réaffectation, recalage, dépense depuis une enveloppe avec cible corrigée), catégories/thèmes (types, doublons, ordre, garde-fous de suppression, fusion), template (périodicité, mois d'ancrage, mensualisation, cagnotte, ½ rattaché), mois (prefill, duplication selon le cycle, recalage d'enveloppes à la création, doublon), entrées (☐ payé / décocher, réel = Σ entrées, compte par défaut, Depuis → Vers), cagnottes (calcul, négatif, ☐ payé), mensualisation (cycle complet, ENVELOPE_SHORT, virements système, échéance qui avance et revient), calculateur (formule, report d'index, régularisation remplacée), investissements (performance avec retrait, DCA unique, valeur de marché dans le patrimoine), clôture et suppressions.

## 2. Corrigé sans validation (comportements clairement attendus)

| Correctif | Détail |
|---|---|
| **Suppression du compte principal** | Refusée (409) tant qu'il existe d'autres comptes : « désignez-en un autre avant ». Sinon le bilan perdait sa référence. |
| **Suppression d'une catégorie utilisée** | Le backend refuse (409) sans `force` et donne les comptes (lignes template / lignes de mois). Le modal de confirmation affiche ces chiffres et explique que les lignes deviendront « sans catégorie ». |
| **Suppression d'un thème utilisé** | Idem (lignes / entrées), avec la suggestion de fusionner. **Fusion de thèmes** ajoutée (Paramètres › Thèmes, select « fusionner dans… ») : lignes, entrées et calculateurs suivent, la source disparaît. |
| **Suppression d'un compte** | Le modal liste ce qui perd son rattachement (enveloppes → virtuelles, entrées, lignes, actifs). |
| **Arrondi flottant** dans le bilan (55,28999…) | Corrigé plus tôt dans la journée, reconfirmé par la revue. |

## 3. UX livrée

- **Plus aucun `alert` / `confirm` / `prompt`** : composant `DialogHost` (confirmation, saisie, toasts) branché dans `App.vue`, utilisé partout. Les erreurs d'API arrivent en toast rouge non bloquant ; les suppressions en modal rouge avec le contexte (« et ses 3 entrées »).
- **Aide contextuelle** : composant `HelpTip` (petit « ? » au survol / clic) posé là où la technicité s'est accumulée — Comptes (enveloppe, compte principal, patrimoine, multi-projets, compte hôte, cible), Template (concept, prévu, jour, périodicité, mensualiser, Depuis/Vers, ½, cagnotte), Mois (règle prévu/réel/☐, projeté, enveloppes, prévu vs montant), Paramètres (types de catégories, thèmes), Investissements (performance). Les paragraphes verbeux du Template ont été réduits à une ligne.

## 4. À valider (je n'ai rien changé)

1. **Supprimer une ligne du template mensualisée** laisse son enveloppe ouverte, détachée. Proposition : la **clôturer automatiquement si elle est vide**, sinon la garder ouverte (l'argent y est) avec un toast « l'enveloppe X reste ».
2. **Supprimer l'enveloppe liée à une ligne mensualisée** démensualise la ligne en silence (`envelope_id` → NULL). Proposition : **refuser** tant que la ligne existe (« démensualisez la ligne d'abord »).
3. **Contribution virtuelle refusée quand le compte principal est « sous » ses enveloppes** : c'est l'invariant, mais dans ta base de test N26 Main est négatif (tests) → ☐ versé sur Strava/N26 répond 409 « dépasse le disponible ». Proposition : garder la règle, mais message dédié « votre compte principal est à −X € : recalez-le ou choisissez un autre compte ».
4. **Modifier le montant d'une entrée ☐ payé d'une ligne mensualisée** : le virement système lié ne suit pas. Proposition : sur ces entrées, **verrouiller le montant** (décocher puis recocher pour changer) ou faire suivre le virement.
5. **Changer le compte hôte d'une enveloppe** (Comptes › Modifier) ne vérifie pas l'invariant sur le nouveau compte. Proposition : même 409 que pour une contribution.
6. **Supprimer un mois** où un ☐ payé a fait avancer une échéance d'enveloppe : l'échéance ne revient pas. Rare ; proposition : ignorer, ou recalculer les échéances à la suppression.
7. **Stats (à venir)** : exclure les virements système (entrées sans ligne) et les catégories *transfert* des dépenses — noté pour ne pas l'oublier.

## 5. État de ta base de dev

- **Strava** est encore ancrée sur **septembre** (pour tes tests) : dis-moi quand la remettre en **juillet**.
- Ta base contient des essais (N26 Main négatif, entrées de test). Sauvegarde propre post-import : `backend/data/backup-import-20260901/budget.db`. Le script d'import Mongo est rejouable si tu veux repartir de zéro.
