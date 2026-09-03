# Refonte UI — Page « Stats »

Complément à `refonte-ui-budgetflow.md` et aux specs Comptes, Investissements et Template. Mêmes
tokens et mêmes composants, plus **une seule extension** : une palette catégorielle pour les
graphiques (§4), qui n'existe pas encore dans le système.

Cette page a un problème que les autres n'ont pas : ses graphiques **racontent des choses fausses**.
Avant toute question de style, il faut corriger ça.

---

## 1. Les trois problèmes graves

### 1.1 La falaise de septembre

Sur les quatre graphiques, **toutes les courbes plongent à zéro sur le dernier point**. Ce n'est pas
une information, c'est le mois en cours qui n'est pas encore rempli. Visuellement, ça se lit comme un
effondrement du patrimoine et des revenus. C'est le défaut le plus grave de la page.

Correction, au choix, par ordre de préférence :

1. **Exclure le mois en cours** des séries par défaut, avec une mention discrète sous le graphique :
   `Septembre 2026 exclu — mois en cours.` et une case `Inclure le mois en cours`.
2. Le tracer en **segment pointillé** avec le dernier point creux (non rempli) et un libellé d'axe
   `sept. 26 (en cours)`.

Ne jamais tracer un mois partiel comme un mois clos. La même règle vaut pour le premier mois de
l'historique s'il est incomplet.

### 1.2 Des échelles qui écrasent l'information

- **Épargne & investissements** : `N26 Safety` (4 700 €) et `N26 Voyage` (3 700 €) écrasent
  `Fortuneo Livret +`, `Fortuneo PEA` et `Kraken`, tous collés à zéro sur 40 px de hauteur. Trois des
  cinq séries sont illisibles.
- **Réel par catégorie** : `Revenus` (2 400 €) est tracé sur le même axe que des catégories de
  dépenses à 0–800 €. Un revenu et une dépense ne sont pas la même grandeur, et l'axe est dicté par
  la plus grande.

Correction : voir §3, chaque panneau reçoit un type de graphique adapté à ce qu'il représente.

### 1.3 La légende de « Dépenses par thème »

**30 pastilles sur trois lignes**, occupant plus de hauteur que le graphique lui-même, dont **une
seule est active**. Le résultat est un graphique à une courbe (`Assurance habitation`, ~16 €/mois)
surmonté d'un mur de couleurs.

Ce n'est pas une légende, c'est un filtre déguisé. Correction en §5.

---

## 2. Incohérence de données à trancher — trois « dépenses prévues » différentes

Le même concept affiche trois valeurs selon la page :

| Page | Dépenses prévues | Ce qui est exclu |
|---|---|---|
| Template | 647,50 € | rien |
| Mois | 595,28 € | les lignes annuelles lissées (Strava 79,99 € + N26 118,80 €), + le loyer compté |
| Stats → Répartition du mois | 448,71 € | les lignes lissées **et** le loyer calculé (146,57 €) |

Chaque page applique sa propre règle d'exclusion, sans jamais le dire. C'est le genre d'écart qui te
fera perdre une heure dans six mois à chercher un bug qui n'existe pas.

À trancher avant l'implémentation : **une seule fonction de calcul**, un seul résultat, et si une
exclusion est volontaire elle doit être écrite à l'écran (`hors charges lissées`, `hors lignes
calculées`).

---

## 3. Un type de graphique par nature de donnée

Règle générale, à appliquer partout : **un stock se trace en aire ou en ligne, un flux se trace en
barres.** Aujourd'hui tout est en courbes, y compris les flux mensuels, ce qui suggère à tort une
continuité entre deux mois.

| Panneau | Aujourd'hui | À la place | Pourquoi |
|---|---|---|---|
| **Épargne & investissements** | 5 courbes | **Aire empilée** : total du patrimoine, composition visible par compte. Ligne fine `--c-ink` par-dessus pour le total. | C'est un stock, et la question réelle est « combien j'ai au total et comment c'est réparti », pas « quelle courbe croise l'autre ». Règle les trois séries écrasées. |
| **Mis de côté par enveloppe** | 2 courbes | **Barres groupées** par mois, une couleur par enveloppe. | C'est un flux mensuel. Une courbe entre juin (475 €) et juillet (680 €) suggère des valeurs intermédiaires qui n'existent pas. |
| **Dépenses par thème** | 30 courbes potentielles | **Barres empilées** par mois, top 5 thèmes + `Autres` agrégé. | Composition d'un flux. Permet de voir le total mensuel **et** sa répartition, ce qu'aucune courbe ne donne. |
| **Réel par catégorie** | courbes, revenus inclus | **Deux panneaux séparés** : `Revenus vs dépenses` (deux barres par mois, ou une ligne chacune) et `Dépenses par catégorie` (barres empilées). | Sépare deux grandeurs qui n'ont pas la même échelle ni le même sens. |
| **Répartition du mois** | anneau double | **Deux barres empilées horizontales** superposées : `prévu` au-dessus, `réel` en dessous, même largeur totale. | Voir §6. |

---

## 4. Palette de graphiques — nouvelle extension du système

Les couleurs actuelles (bleu vif, orange, turquoise, jaune, rose, plus 30 pastels) n'ont aucun
rapport avec les tokens de l'application. À ajouter dans `tokens.css` :

```css
:root {
  --chart-1: #3B6EA5; /* bleu ardoise */
  --chart-2: #C97B2C; /* ambre */
  --chart-3: #4B8A6E; /* vert-gris */
  --chart-4: #A05270; /* framboise */
  --chart-5: #6E7A88; /* ardoise */
  --chart-6: #B04A3F; /* brique */
  --chart-other: #B8C0BB; /* « Autres » — toujours ce gris, jamais une couleur */
}

:root[data-theme="dark"] {
  --chart-1: #6FA3D2; --chart-2: #E0A05B; --chart-3: #74B695;
  --chart-4: #CE86A0; --chart-5: #9AA6B2; --chart-6: #D97A6D;
  --chart-other: #4A544F;
}
```

Règles d'usage :

- **Six séries colorées au maximum** à l'écran. Au-delà, agréger dans `Autres` (`--chart-other`).
- La couleur d'accent `--c-accent` (violet) **n'est jamais** une couleur de série : elle reste la
  couleur de l'interaction, y compris dans un graphique (série survolée, sélection).
- `--c-credit` et `--c-over` ne sont jamais des couleurs de série non plus : elles restent réservées
  au sens (gain / perte, dépassement). Elles peuvent en revanche colorer un **écart** ou un
  dépassement de budget tracé explicitement.
- Une même entité (compte, enveloppe, thème) garde **la même couleur d'un graphique à l'autre** :
  affectation stable par identifiant, pas par ordre d'affichage.
- Vérifier la palette en deutéranopie ; ne jamais faire reposer la lecture sur la seule couleur — la
  légende, l'ordre d'empilement et l'infobulle portent aussi l'information.

---

## 5. Sélection des séries

Remplacer les rangées de pastilles par un contrôle unique, placé à droite du titre du panneau :

```
 Dépenses par thème                      5 thèmes sur 30  ⌄
```

- Au clic, un menu déroulant (`--shadow-overlay`, `--r-container`, 320 px) avec un champ de
  recherche, la liste des thèmes triés par **montant décroissant sur la période**, chacun avec sa
  case, sa pastille de couleur et son montant moyen mensuel.
- **Sélection par défaut : les 5 premiers thèmes par montant**, plus `Autres`. Pas un seul thème
  choisi au hasard comme aujourd'hui.
- Actions rapides dans le menu : `Top 5`, `Tout désélectionner`.
- Sous le graphique, une légende **compacte** sur une seule ligne : pastille + nom + montant moyen,
  éléments espacés de 16 px. Elle affiche uniquement ce qui est tracé, elle ne sert plus de filtre.
- Le même contrôle sert pour `Épargne & investissements` et `Réel par catégorie`.

---

## 6. Répartition du mois

L'anneau double est à remplacer. Deux raisons : les deux anneaux imbriqués (extérieur = réel,
intérieur = prévu) sont indéchiffrables sans la note en 11 px qui l'explique, et à zéro le graphique
affiche **un cercle vert quasi complet**, ce qui se lit comme « tout est fait » alors que rien ne
l'est.

À la place, deux barres empilées horizontales, même composant que les barres de composition des
autres pages :

```
 Septembre 2026                                            [ mois ⌄ ]

 Prévu   ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
         Dépenses 448,71 €   Épargne 0,00 €   Reste 1 969,29 €

 Réel    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
         Aucune dépense enregistrée pour l'instant.
```

- Les deux barres partagent la même échelle (les revenus prévus), donc leur comparaison est directe.
- Segments : dépenses `--chart-1`, épargne `--chart-3`, reste `--c-track`.
- Si le réel est vide, afficher une piste vide + une phrase, jamais un graphique qui semble plein.
- Le sélecteur de mois passe en haut à droite du panneau, restylé comme celui de la page Mois
  (`‹ Septembre 2026 ›`), pas un `<select>` natif.
- Le point violet de `Épargne` et le point rouge de `Dépenses` disparaissent : ce sont des couleurs
  de série, elles suivent §4.

---

## 7. Style commun des graphiques

- **Hauteur 260 px** (contre ~380 px aujourd'hui). Quatre panneaux à 550 px de haut font une page de
  2 500 px pour cinq informations.
- Panneau : `--c-surface`, `--r-container`, filet `--c-line`, **aucune ombre**. Titre 15 px / 600.
  Les pastilles `?` disparaissent, l'explication passe en infobulle sur le titre.
- **Padding droit de 24 px** dans la zone de tracé : aujourd'hui `sept. 26` est tronqué sur les
  quatre graphiques.
- Grille : lignes horizontales 1 px `--c-line`, **quatre graduations maximum**, aucune ligne
  verticale. Pas d'axe vertical tracé.
- Étiquettes d'axe : 11 px `--c-ink-3`. Unité indiquée une seule fois, sur la graduation du haut
  (`6 000 €`), pas sur chacune.
- Traits : 2 px, pas de lissage `cardinal` (il invente des courbes entre deux points mensuels) —
  utiliser une interpolation linéaire ou `monotone`. Aucun point marqué sauf le dernier et celui
  survolé.
- Aires empilées : opacité 100 %, séparées par un filet 1 px `--c-surface` — pas de transparence
  superposée qui crée des couleurs fantômes.
- **Infobulle** : `--c-surface`, filet `--c-line`, `--r-control`, `--shadow-overlay`, 12 px. Séries
  triées par valeur décroissante, valeur en `--c-ink` 500, nom en `--c-ink-2`, total en bas séparé
  par un filet. Ligne de repère verticale 1 px `--c-line-strong`.
- Animation d'entrée : aucune. Transition uniquement au changement de période ou de sélection,
  `--dur-base`, neutralisée sous `prefers-reduced-motion`.

---

## 8. En-tête de page

La page s'ouvre sur un titre et un filtre. Elle devrait s'ouvrir sur des chiffres — c'est une page de
statistiques.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Stats                                     [3 mois] [6 mois] [12 mois] [Tout]│
│ Vos chiffres dans le temps                                                 │
├────────────────────────────────────────────────────────────────────────────┤
│  38 %              Épargne / mois    Dépenses / mois    Patrimoine         │
│  Taux d'épargne     912,00 €          1 506,00 €         10 552,07 €       │
│  moyen, 7 mois                                           +1 240 € sur 7 mois│
└────────────────────────────────────────────────────────────────────────────┘
```

- Même structure que les bandeaux des autres pages : un chiffre en 28 px, trois secondaires séparés
  par des filets. Toutes les valeurs sont calculées **sur la période sélectionnée**, mois en cours
  exclu, et l'étiquette le rappelle (`moyen, 7 mois`).
- Le variateur de période garde sa place mais se restyle : boutons secondaires, actif en
  `--c-accent-soft` + texte `--c-accent`. C'est le seul violet de la page avec les liens.

---

## 9. Vue tableau

Le lien `▸ tableau` existe déjà en bas de chaque panneau : bonne idée, mal exploitée. Le promouvoir
en **bascule explicite** en haut à droite du panneau, deux libellés texte (`Graphique` / `Tableau`),
l'actif souligné 2 px `--c-accent`.

Le tableau doit être un vrai `<table>` : `<th scope="col">` pour les mois, `<th scope="row">` pour les
séries, montants `tabular-nums` alignés à droite, ligne de total. Il sert aussi d'**alternative
accessible** au graphique — mentionner le lien via `aria-describedby` sur le conteneur du graphique.

---

## 10. Micro-copie

| Actuel | Remplacer par |
|---|---|
| `Vos chiffres dans le temps` | garder |
| `Épargne & investissements` | `Patrimoine par compte` — le graphique montre des soldes, pas des flux d'épargne |
| `Mis de côté par enveloppe` | `Versé par enveloppe, par mois` |
| `Dépenses par thème` | garder |
| `Réel par catégorie` | `Dépenses réelles par catégorie` une fois les revenus sortis |
| `Extérieur : réel · intérieur : prévu` | supprimé avec l'anneau |
| `reste réel` | `Reste réel` avec majuscule, ou supprimé si la valeur est nulle |
| `▸ tableau` | bascule `Graphique` / `Tableau` |
| `≈ 135,16 €/mois` | `135,16 € par mois en moyenne`, dans l'infobulle de la légende |

---

## 11. Ordre d'implémentation

1. **Traitement du mois en cours** (§1.1). Une ligne de code, et la page arrête de mentir.
2. Unification du calcul des dépenses prévues (§2) — à trancher côté métier.
3. Palette `--chart-*` et affectation stable des couleurs (§4).
4. Style commun des graphiques : hauteur, grille, padding droit, infobulle (§7).
5. Changements de type de graphique (§3), panneau par panneau, en commençant par
   `Dépenses par thème` (le plus cassé).
6. Sélecteur de séries et légende compacte (§5).
7. Remplacement de l'anneau (§6).
8. Bandeau d'indicateurs (§8).
9. Bascule tableau (§9) et micro-copie (§10).

### Recette

- [ ] Aucune courbe ne tombe à zéro sur le dernier point.
- [ ] Jamais plus de six séries colorées à l'écran.
- [ ] Une même entité a la même couleur sur tous les graphiques.
- [ ] Le violet n'apparaît que sur le filtre de période, les liens et les états de sélection.
- [ ] `sept. 26` est entièrement visible sur tous les graphiques.
- [ ] Aucune légende ne dépasse une ligne.
- [ ] Les flux mensuels sont en barres, les stocks en aires ou en lignes.
- [ ] `Dépenses prévues` affiche la même valeur ici, sur la page Mois et sur le Template — ou dit ce
      qu'elle exclut.
- [ ] Chaque graphique a une vue tableau équivalente et accessible.
- [ ] La page tient sous 1 600 px de hauteur totale.
