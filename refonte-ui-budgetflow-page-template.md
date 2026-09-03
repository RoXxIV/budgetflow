# Refonte UI — Page « Template »

Complément à `refonte-ui-budgetflow.md` et aux specs des pages Comptes et Investissements. Mêmes
tokens, mêmes composants, aucun nouveau.

Cette page a un statut particulier : c'est **la source** de toutes les autres. Une erreur ici se
propage à tous les mois créés ensuite. Elle doit donc être la plus lisible et la plus explicite de
l'application — c'est aujourd'hui la moins lisible des quatre.

---

## 1. Diagnostic

### A. Incohérences avec le design system

| # | Problème | Correction |
|---|---|---|
| A1 | **Une quinzaine de couleurs de tags** sur un seul écran : `Tel`, `Streaming`, `Gaming`, `IA`, `Dev / Software`, `Internet`, `Bien-être / Sport`, `Frais banque`, `Prevision EDF`, `Prévision EAU`, `Assurance habitation`, `Mutuel`, `impots et taxes`, `Loyer`, `mensualisée`, `le 10`… La couleur ne code rien, elle empêche de lire les montants. | §3 — le plus gros chantier de la page. |
| A2 | Le tag de type de section `dépense` est **rouge**. Une dépense normale n'est jamais rouge (règle 2). | §4. |
| A3 | Les quatre indicateurs d'en-tête sont **colorés au hasard** : vert, rouge, violet, noir. Le violet sur `Épargne prévue` est interdit. | §2. |
| A4 | **Grille 2 colonnes** de hauteurs inégales, ordre de lecture ambigu, comme sur la page Comptes. | Panneau unique, sections empilées. |
| A5 | Cartes avec ombre et rayon uniforme. | Panneau `--r-container` + filets. |
| A6 | Pastille `?` dans le sous-titre. | Supprimée. |
| A7 | Montants **non alignés** (les flèches de spinner décalent chaque valeur) et dates mélangeant les formats (`1 juil. 2027`, `1 janv. 2027`, `le 10`, `le 1`). | §5, §6. |

### B. Problèmes de structure

| # | Problème | Correction |
|---|---|---|
| B1 | **Cinq concepts différents sont encodés comme des tags** sur la même ligne : jour de prélèvement (`le 10`), périodicité (`annuel · 1 juil. 2027`), mode de lissage (`mensualisée`), partage (`½`), catégorie (`Streaming`), origine du montant (`calculé`). Ils se ressemblent tous, donc aucun ne se lit. | Les transformer en **colonnes** (§5). C'est le cœur de la refonte de cette page. |
| B2 | **Spinners `▲▼`** natifs sur chaque champ de montant : 20 paires de flèches à l'écran, inutiles sur une devise, et elles cassent l'alignement à droite. | Supprimés (§6). |
| B3 | `Aucune ligne.` répété 3 fois, `+ ligne` répété 6 fois. | Message supprimé, bouton d'ajout unifié. |
| B4 | La ligne `Loyer` combine surlignage jaune, barre orange, montant `calculé` grisé et un tag `cagnotte · Marion paie 630,02 €` : quatre signaux pour une information. | §7. |
| B5 | Aucune vue par **échéance**. Un template de récurrences, c'est d'abord un calendrier. | §8. |

### C. Incohérences de données à trancher avant l'implémentation

Ce ne sont pas des problèmes de design, mais ils sont visibles à l'écran et ils vont te coûter cher.

1. **Le total de `Logement & factures` diffère entre les deux pages** : 241,72 € ici, 388,29 € sur la
   page Mois. L'écart est exactement le loyer (146,57 €), c'est-à-dire la ligne `calculé`. Le template
   exclut donc les lignes calculées de son total, mais le mois les inclut. Une même catégorie ne peut
   pas afficher deux totaux différents selon la page : soit on les compte des deux côtés, soit on les
   exclut des deux, et dans ce cas le total doit porter la mention `hors lignes calculées`.
2. **`Épargne prévue 0,00 €`** alors que tu as 200 €/mois de versements programmés et un objectif
   d'épargne mensuel de 967,20 € sur la page Mois. Ou bien l'épargne n'est pas modélisée dans le
   template, et l'indicateur ne devrait pas y figurer ; ou bien elle devrait l'être, et le `Reste
   théorique` de 1 770,50 € est faux de 200 €.

---

## 2. En-tête de page

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Template                                                        [+ Ligne]  │
│ La base dupliquée à chaque nouveau mois                                    │
├────────────────────────────────────────────────────────────────────────────┤
│  1 770,50 €        Revenus       Dépenses      Épargne                     │
│  Reste théorique    2 418,00 €    647,50 €      0,00 €                     │
│                                                                            │
│  ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  Dépenses 27 %          Épargne 0 %                    Reste 73 %          │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Hero : le reste théorique.** C'est ce que produit le template ; les trois autres chiffres sont
  ses composantes. 28 px / 600 `--c-ink`, passe en `--c-over` si négatif.
- Les trois secondaires en `étiquette 12 px` + `valeur 15 px`, séparés par des filets `--c-line`,
  tous en `--c-ink`. **Aucun n'est coloré** : ce ne sont ni des gains, ni des dépassements, ce sont
  des composantes d'un budget. Les indicateurs remontent en haut à gauche avec le titre, pas dans le
  coin droit.
- **Barre de composition** pleine largeur, 10 px, `--r-pill` : dépenses / épargne / reste sur la base
  des revenus. Même composant que la barre de répartition des autres pages. Elle rend immédiatement
  lisible ce que le template décide, et elle occupe la largeur au lieu de la laisser vide.

---

## 3. Le système de tags — le vrai chantier

Aujourd'hui la couleur d'un tag est décorative : `Streaming` violet et `Gaming` cyan n'ont pas de
rapport hiérarchique, la couleur n'aide à rien. Application stricte des quatre variantes du document
principal :

| Information | Nouveau rendu |
|---|---|
| Sous-catégorie (`Streaming`, `Gaming`, `Tel`, `IA`, `Dev / Software`, `Internet`, `Bien-être / Sport`, `Frais banque`, `Mutuel`, `impots et taxes`, `Assurance habitation`, `Loyer`) | **Colonne `catégorie`**, texte 13 px `--c-ink-2`, sans fond ni bordure. Une étiquette présente sur toutes les lignes est une colonne, pas un tag. |
| Jour de prélèvement (`le 10`, `le 1`) | **Colonne `échéance`** (§5). |
| Périodicité (`annuel · 1 juil. 2027`, `mensualisée`) | **Colonne `périodicité`** (§5). |
| Partage (`½`) | **Colonne `partagé`** (§5). |
| Origine du montant (`calculé`) | Tag `info`, seul tag conservé sur la ligne (§7). |
| Ligne inactive / suspendue | Tag `neutral` `en pause`. |

Résultat : **au plus un tag par ligne**, et il signale toujours une exception. Tout le reste est
tabulé. Si la sous-catégorie porte une couleur choisie par l'utilisateur en base, ne l'afficher que
sous forme d'un point de 6 px devant le texte de la colonne, désaturé à 65 % comme les points de
section.

---

## 4. Sections

Panneau unique, sections empilées en **une seule colonne**, réutilisant `SectionHeader` : en-tête
sticky, point de couleur, compteur de lignes, total aligné dans la colonne montant.

- Les tags de type `dépense` / `revenu` / `transfert` **perdent leur couleur** et deviennent un
  libellé 12 px `--c-ink-3` placé après le compteur. Le rouge sur `dépense` est proscrit.
- **Ordre imposé** : `Revenus` en premier, puis les dépenses par total décroissant, puis
  `Operations` (transferts) en dernier. Un budget se lit dans ce sens. Aujourd'hui `Revenus` est en
  bas à gauche, ce qui est l'endroit le moins lu de la page.
- Une section vide affiche une ligne unique `Aucune ligne récurrente.` en 13 px `--c-ink-2`, sans
  répétition du bouton d'ajout : celui-ci apparaît au survol de la section et existe déjà en haut de
  page.

---

## 5. Colonnes de ligne

C'est ce qui remplace la bouillie de tags.

```
 libellé                catégorie        périodicité      échéance   partagé   montant
 EDF                    Prévision EDF    mensuel          —            ½      127,88 €
 SFR Box                Internet         mensuel          le 10        ½       43,00 €
 Strava                 Bien-être/Sport  annuel, lissé    1 juil.      —       79,99 €
 N26                    Frais banque     annuel, lissé    1 janv.      —      118,80 €
 Loyer      calculé     Loyer            mensuel          —            —      146,57 €
```

```css
grid-template-columns:
  minmax(0, 1fr)  /* libellé + tag d'exception */
  148px           /* catégorie */
  120px           /* périodicité */
  84px            /* échéance */
  64px            /* partagé */
  120px           /* montant */
  32px;           /* actions */
```

- **Périodicité** : valeurs normalisées `mensuel`, `annuel, lissé`, `annuel`, `trimestriel`. Le terme
  `mensualisée` devient `lissé` et se lit dans la même colonne : une charge annuelle répartie sur 12
  mois. Infobulle sur `annuel, lissé` : `948,00 € par an, soit 79,99 € par mois.`
- **Échéance** : jour du mois (`le 10`) pour le mensuel, date courte (`1 juil.`) pour l'annuel, `—`
  si non défini. Un seul format de date par nature de récurrence, jamais l'année en clair dans la
  ligne (elle va dans l'infobulle).
- **Partagé** : `½` en 13 px `--c-ink-2` centré, `—` sinon. Infobulle `Dépense partagée, 50 % à ta
  charge.`
- **Montant** aligné à droite, tabulaire, 15 px / 500.
- Hauteur de ligne `--h-row`, filet bas `--c-line`, survol `--c-surface-hover`.
- < 1200 px : masquer `catégorie`. < 980 px : masquer `partagé` et passer `périodicité` + `échéance`
  en méta 12 px sous le libellé.

---

## 6. Édition des montants

- **Supprimer les spinners** : `input[type=number]::-webkit-inner-spin-button { appearance: none; }`
  et `-moz-appearance: textfield`, ou passer en `type="text"` avec `inputmode="decimal"`. Les flèches
  ↑/↓ du clavier continuent de fonctionner si tu gardes `type="number"`.
- Champ transparent, sans bordure, aligné à droite, tabulaire — visuellement identique à un montant
  affiché. Bordure `--c-line-strong` + fond `--c-surface` uniquement au survol et au focus.
- Formatage à la perte du focus : `127,88 €`. Saisie tolérante à l'entrée (`127.88`, `127,88`,
  `127`).
- Enregistrement au blur, avec un discret retour de confirmation (le montant de section se met à
  jour, transition `--dur-base`). Pas de toast pour chaque frappe.
- Modifier une ligne du template ne modifie **pas** les mois déjà créés : l'indiquer une fois, en
  sous-titre de page, plutôt qu'à chaque enregistrement.

---

## 7. Ligne à montant calculé (le loyer)

Aujourd'hui : fond jaune, barre verticale orange, montant grisé `calculé`, plus un tag
`cagnotte · Marion paie 630,02 €`. Quatre signaux pour dire une seule chose.

À la place :

- Ligne au traitement **normal**, sans surlignage ni barre de couleur.
- Un seul tag `info` : `calculé`.
- Le montant s'affiche comme les autres (`146,57 €`) mais en `--c-ink-2`, non éditable, avec un
  curseur `not-allowed` et une infobulle donnant la règle :
  `Cagnotte commune : 776,59 € − 630,02 € payés par Marion.`
- Le détail complet reste accessible via le menu `⋯` → `Modifier la règle de calcul`.

Le surlignage jaune est réservé — s'il doit exister — à un état transitoire, pas à une propriété
permanente d'une ligne.

---

## 8. Un ajout, et un seul : la vue par échéance

Cette page n'a **pas** de problème de vide : elle est déjà dense. Ne rien ajouter de décoratif.

Le seul manque réel est qu'on ne peut pas répondre à « qu'est-ce qui tombe le 1er, le 10, le 15 ? ».
Ajouter un **basculement de vue** dans l'en-tête du panneau, deux options :

- `Par catégorie` (défaut, la vue actuelle) ;
- `Par échéance` : les mêmes lignes, regroupées par jour du mois (`Le 1`, `Le 10`, `Sans date`),
  avec un sous-total par jour. Mêmes composants, seul le regroupement change.

Rendu du bascule : deux libellés texte, l'actif en `--c-ink` souligné 2 px `--c-accent`, comme les
onglets de navigation. Pas de segmented control à fond gris.

---

## 9. Micro-copie

| Actuel | Remplacer par |
|---|---|
| `La base dupliquée à chaque nouveau mois` | `Les lignes recopiées dans chaque nouveau mois. Les modifier n'affecte pas les mois déjà créés.` |
| `Reste théorique` | garder — devient le hero |
| `mensualisée` | `annuel, lissé` |
| `annuel · 1 juil. 2027` | colonne `périodicité` = `annuel, lissé`, colonne `échéance` = `1 juil.` |
| `le 10` | colonne `échéance` = `le 10` |
| `calculé` | garder, en tag `info` |
| `Aucune ligne.` | `Aucune ligne récurrente.` |
| `+ ligne` | `Ajouter une ligne` |
| `Prevision EDF` | `Prévision EDF` (accent manquant) |
| `impots et taxes` | `Impôts et taxes` |
| `Alimentation & litiere` | `Alimentation & litière` |
| `Salaire revaw` | à vérifier côté données, probablement `Salaire Revaw` |
| `Xbox Game pass` | `Xbox Game Pass` |

---

## 10. Ordre d'implémentation

1. Trancher les deux incohérences de données du §1.C — elles changent les chiffres affichés.
2. Passage en colonne unique + panneau + sections ordonnées (§4).
3. **Tags → colonnes** (§3, §5). C'est le changement qui transforme la page ; le faire d'un bloc,
   pas tag par tag.
4. Suppression des spinners et refonte du champ montant (§6).
5. En-tête hiérarchisé + barre de composition (§2).
6. Ligne calculée (§7).
7. Micro-copie et fautes d'accent (§9).
8. Vue par échéance (§8), en dernier — c'est un confort, pas un correctif.

### Recette

- [ ] Au plus **un tag par ligne**, et il signale une exception.
- [ ] Aucun rouge ni vert sur les libellés de type de section.
- [ ] Aucune flèche de spinner à l'écran.
- [ ] Tous les montants alignés sur une seule colonne, totaux de section compris.
- [ ] Un seul format de date par nature de récurrence.
- [ ] Le total de `Logement & factures` est identique ici et sur la page Mois, ou porte une mention
      explicite de ce qu'il exclut.
- [ ] `Revenus` est la première section de la page.
- [ ] Aucun accent manquant dans les libellés livrés par défaut.
