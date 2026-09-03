# Refonte UI — Page « Investissements »

Complément à `refonte-ui-budgetflow.md` et à la spec de la page Comptes. Mêmes tokens, mêmes
composants, aucun nouveau. Cette page est la plus courte de l'application : l'enjeu est autant de la
mettre en cohérence que de lui donner de quoi exister.

---

## 1. Diagnostic

### A. Incohérences avec le design system

| # | Problème | Correction |
|---|---|---|
| A1 | `200,00 €` (versements prévus) est en **violet**. Le violet ne code jamais une donnée. | `--c-ink`. |
| A2 | Tags `CRYPTO` et `ETF` en **violet** et en **capitales**. Les capitales sont proscrites (§4.4). | `Crypto` en tag `neutral`. `ETF` reste en capitales : c'est un sigle, pas une mise en forme. |
| A3 | Dates en ISO : `valeur au 2026-09-01`, répété sur chaque ligne. | `valeur au 1er sept. 2026`, affiché **une seule fois** en en-tête de colonne. |
| A4 | Pourcentages avec **point décimal** : `-0.78 %`, `+2.98 %`, alors que les montants utilisent la virgule. | `−0,78 %` avec espace fine insécable avant `%` et vrai signe moins (U+2212). |
| A5 | Pastille `?` dans le sous-titre. | Supprimée. |
| A6 | Les quatre indicateurs du bandeau ont **la même taille et la même graisse** : aucune hiérarchie. | Une seule valeur en grand (§3). |

### B. Problèmes de structure

| # | Problème | Correction |
|---|---|---|
| B1 | **~800 px de vide** entre le nom de l'actif et le premier chiffre, puis trois blocs de chiffres tassés à droite. | Colonnes réparties sur toute la largeur (§4). |
| B2 | Les étiquettes `investi`, `valeur au…`, sont **répétées sous chaque valeur, sur chaque ligne**. | En-têtes de colonne affichés une fois, sticky. |
| B3 | La page n'affiche **aucun historique**. Un portefeuille sans évolution dans le temps ne dit presque rien. | Courbe d'évolution (§5). |
| B4 | Aucune notion de **répartition** : impossible de voir que le PEA pèse 54 % et la crypto 46 %. | Colonne `poids` + barre de répartition (§4, §5). |
| B5 | L'action principale de cette page — **mettre à jour la valorisation** — n'existe pas. Seul un crayon d'édition est présent. | Bouton dédié + date de dernière valorisation (§3). |
| B6 | Page vide sur 700 px de hauteur avec 2 lignes. | §5, mais voir l'avertissement en tête de ce paragraphe. |

### C. Une exception assumée à la règle des couleurs

La règle « une dépense normale n'est pas rouge » ne s'applique **pas** ici. Sur un portefeuille, la
plus ou moins-value est une donnée réellement bipolaire : `--c-credit` pour un gain, `--c-over` pour
une perte est le bon codage. Deux garde-fous :

- le signe (`+` / `−`) porte déjà l'information, la couleur ne fait que la renforcer — jamais de
  couleur seule ;
- ne pas colorer la ligne entière ni le fond de la cellule, seulement le texte du montant et du
  pourcentage.

---

## 2. Note sur l'exactitude du calcul (hors design)

`plus-value % = (valeur − investi) / investi` est faux dès qu'il y a des versements programmés, ce
qui est ton cas (200 €/mois). Un versement de la veille dilue mécaniquement le pourcentage sans que
la performance ait changé. Deux options :

- afficher la performance en **TWR** ou en **MWR/TRI**, et garder le montant brut de plus-value ;
- ou, plus simple et honnête, garder le calcul actuel mais **renommer l'étiquette** en
  `Écart valeur / investi` plutôt que `Plus-value`, avec une infobulle expliquant la limite.

Ne pas laisser `Plus-value +2,98 %` tel quel : c'est un chiffre que tu vas regarder tous les mois et
il ne mesure pas ce que son nom annonce. À trancher côté logique métier avant l'implémentation UI.

---

## 3. En-tête de page et bandeau

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Investissements                            [Mettre à jour]      [+ Actif]  │
│ Actifs, versements, valorisation                                           │
├────────────────────────────────────────────────────────────────────────────┤
│  1 080,22 €        Investi        Écart          Versements / mois         │
│  Valeur actuelle    1 049,00 €     +31,22 €       200,00 €                 │
│  au 1er sept. 2026                 +2,98 %                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Hero : la valeur actuelle**, 28 px / 600 `--c-ink`. C'est ce que vaut le portefeuille
  aujourd'hui ; l'investi est un chiffre de référence, pas le sujet. Étiquette + date de valorisation
  en 11 px `--c-ink-3` dessous.
- Trois indicateurs secondaires en `étiquette 12 px` + `valeur 15 px`, séparés par des filets 1 px
  `--c-line`. L'écart porte la couleur sémantique, les deux autres sont en `--c-ink`.
- `Versements / mois` est cliquable et renvoie vers la section Investissements de la page Mois : les
  deux chiffres viennent de la même source, le lien évite de les ressaisir.
- **Bouton `Mettre à jour`** (secondaire) à côté de `+ Actif` : ouvre un formulaire listant les actifs
  avec un champ de valorisation par ligne, pour tout saisir d'un coup. C'est le geste répété de cette
  page, il mérite un chemin direct.
- Si la dernière valorisation date de plus de 30 jours, la date passe en `--c-warn` avec un tag
  `à mettre à jour`.

---

## 4. Registre des actifs

Panneau unique, en-têtes de colonne sticky affichés une fois, comme sur les autres pages. Ce sont
ces colonnes qui remplissent les 800 px de vide actuels.

```
                        support        / mois      investi     valeur       écart    poids
 Crypto  BTC, SOL, ETH   Kraken        50,00 €     499,00 €    495,09 €    −3,91 €    46 %
                                                                           −0,78 %
 ETF  MSCI world, ASIE…  Fortuneo PEA  150,00 €    550,00 €    585,13 €   +35,13 €    54 %
                                                                          +6,39 %
 ─────────────────────────────────────────────────────────────────────────────────────────
 Total                                 200,00 €  1 049,00 €  1 080,22 €   +31,22 €   100 %
```

```css
grid-template-columns:
  minmax(0, 1fr)  /* nom + tag de classe */
  132px           /* support / courtier */
  92px            /* versement mensuel */
  110px           /* investi */
  110px           /* valeur */
  110px           /* écart € et % */
  64px            /* poids */
  32px;           /* actions */
```

- Hauteur de ligne 48 px (l'écart tient sur deux lignes : montant puis pourcentage en 12 px).
- Toutes les colonnes numériques : alignées à droite, `tabular-nums`.
- Le tag de classe (`Crypto`, `ETF`) passe **avant** le nom, en `neutral` : il sert de marqueur de
  catégorie, comme le point de couleur des sections de la page Mois.
- Le support (`Kraken`, `Fortuneo PEA`) sort des tags et devient une **colonne texte** 13 px
  `--c-ink-2`. Un tag qui apparaît sur toutes les lignes n'est plus un tag, c'est une colonne.
- Colonne `poids` : pourcentage + micro-barre de 48 px de large, 3 px de haut, `--c-fill`.
- **Ligne de total** en bas du panneau, `--c-surface-sunken`, filet haut `--c-line-strong`, mêmes
  colonnes. Cohérent avec le total du registre du mois.
- Le nom long (`MSCI world, ASIE, CHINE`) tronque en ellipse avec le nom complet en `title`.
- Actions : crayon au survol, menu `⋯` permanent contenant `Mettre à jour la valorisation`,
  `Modifier`, `Supprimer` (confirmation).

**Pas de regroupement par support pour l'instant** : avec deux actifs sur deux courtiers, chaque
groupe ferait une ligne, ce qui ajouterait du chrome sans rien organiser. À réintroduire au-delà de
six actifs environ, sur le modèle de la page Comptes.

---

## 5. Combler la hauteur — dans cet ordre

**a. Répartition** — une barre empilée unique sous le bandeau, 10 px de haut, `--r-pill`, un segment
par actif au prorata de la valeur, avec légende sur une ligne. Même composant que la répartition du
mois : ne pas en écrire un second.

**b. Évolution de la valeur** — une courbe unique, hauteur 180 px, pleine largeur, tracée sur les
valorisations mensuelles historiques. Deux séries seulement : `valeur` (trait plein `--c-ink`) et
`investi` (trait pointillé `--c-ink-3`). L'écart entre les deux courbes *est* la plus-value : pas
besoin d'une troisième série pour la représenter.

  - Pas de zone remplie sous la courbe, pas de dégradé, pas de points sur chaque valeur.
  - Axe Y sans quadrillage horizontal complet : deux repères suffisent (min et max).
  - Infobulle au survol : mois, valeur, investi, écart.
  - Si moins de 3 points d'historique, **ne pas afficher la courbe** — afficher à la place une ligne
    de texte : `L'évolution s'affichera après trois valorisations mensuelles.`

**c. Versements du mois** — un bloc court rappelant les lignes d'investissement prévues sur le mois
en cours et leur état de pointage, réutilisant `RegisterRow`. Il relie cette page au registre
mensuel.

C'est tout. Ne pas ajouter de camembert de répartition (la barre empilée fait le même travail en 10
px), ni de cartes de statistiques (« meilleur actif », « performance annualisée »), ni d'indicateurs
de marché externes.

---

## 6. États vides

- **Aucun actif** : phrase unique centrée `Aucun actif suivi pour l'instant.` + bouton `Ajouter un actif`.
  Le bandeau d'indicateurs ne s'affiche pas du tout — quatre zéros n'apprennent rien.
- **Actif sans valorisation** : colonne `valeur` à `—` en `--c-ink-3`, colonnes `écart` et `poids`
  vides, tag `à valoriser` en variante `alert`.

---

## 7. Micro-copie

| Actuel | Remplacer par |
|---|---|
| `Actifs, versements, valorisation` | garder |
| `Investi` | garder |
| `Valeur actuelle` | garder, devient le hero |
| `Plus-value +2.98 %` | `Écart` + `+2,98 %` — voir §2 avant de trancher |
| `Versements prévus / mois` | `Versements / mois` |
| `valeur au 2026-09-01` | `valeur au 1er sept. 2026`, en en-tête de colonne uniquement |
| `CRYPTO` | `Crypto` |
| `50,00 € / mois` | colonne `/ mois`, valeur seule |

---

## 8. Responsive

- < 1120 px : masquer la colonne `support` (l'information passe en méta sous le nom) et la colonne
  `/ mois`.
- < 780 px : passer en lignes à deux niveaux — nom + tag sur la première, `valeur` et `écart` sur la
  seconde ; `investi` et `poids` accessibles au dépliage.
- La courbe garde 180 px de haut et reste lisible jusqu'à 360 px de large.

---

## 9. Ordre d'implémentation

1. Trancher la question du §2 (calcul de performance) — ça conditionne les libellés.
2. Bandeau hiérarchisé + bouton `Mettre à jour` + date de valorisation (§3).
3. Grille de colonnes et en-têtes sticky (§4) → règle B1 et B2.
4. Tags, couleurs, formats de date et de pourcentage (§1 A1→A4).
5. Ligne de total et colonne `poids` (§4).
6. Barre de répartition (§5a).
7. Courbe d'évolution (§5b), puis bloc versements du mois (§5c) si la page paraît encore courte.

### Recette

- [ ] Aucun violet en dehors des boutons, liens et onglet actif.
- [ ] Aucune étiquette répétée sous les valeurs : elles sont toutes en en-tête de colonne.
- [ ] Toutes les dates au format français long, toutes les décimales avec une virgule.
- [ ] Les colonnes numériques occupent la largeur ; plus aucun bloc de vide de plus de 200 px.
- [ ] Gain et perte lisibles en niveaux de gris (le signe suffit).
- [ ] La courbe ne s'affiche pas tant qu'il y a moins de trois points.
- [ ] Une seule ombre déclarée, aucune sur les panneaux.
