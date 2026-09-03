# Refonte UI — Page « Paramètres »

Complément à `refonte-ui-budgetflow.md` et aux specs Comptes, Investissements, Template et Stats.

**Cette page est la cause racine du désordre chromatique de toute l'application.** Les tags
multicolores du Template, les points de catégorie de la page Mois, les 30 pastilles de la page Stats
viennent tous d'ici. Tant que le sélecteur de couleur reste un `<input type="color">` libre, chaque
correction faite ailleurs sera défaite à la première catégorie créée. C'est donc la page à traiter en
priorité, avant même les autres correctifs de couleur.

---

## 1. Diagnostic

### A. La couleur libre

Les couleurs actuellement stockées sont des primaires saturées : vert pur `#00FF00`, magenta
`#FF00FF`, rouge pur, noir pur, cyan. Aucune ne peut cohabiter avec la palette de l'application, et
aucune n'est lisible en fond de tag.

**Correction en deux temps :**

1. **Supprimer la couleur des thèmes.** Un thème est une étiquette d'analyse. Dans les specs
   précédentes, il devient une colonne de texte sur le Template et n'est colorié que dans les
   graphiques — où la palette `--chart-*` lui attribue une couleur automatiquement, et seulement aux
   cinq thèmes affichés. Trente couleurs stockées pour en afficher cinq, choisies par une machine,
   c'est trente occasions de se tromper. Ça supprime 30 sélecteurs de couleur d'un coup.
2. **Encadrer la couleur des catégories.** Elle reste utile : c'est le point de section sur la page
   Mois. Mais elle se choisit dans une **palette fermée de 12 pastilles**, pas dans un sélecteur
   libre.

```css
:root {
  --cat-1:  #3B6EA5; --cat-2:  #4B8A6E; --cat-3:  #C97B2C; --cat-4:  #A05270;
  --cat-5:  #6E7A88; --cat-6:  #B04A3F; --cat-7:  #7C6BB0; --cat-8:  #2F8C8C;
  --cat-9:  #8C7A3F; --cat-10: #5A7D3F; --cat-11: #96566B; --cat-12: #55606B;
}
```

Rendu du sélecteur : une grille de 12 pastilles de 20 px, `--r-control`, la sélectionnée portant un
anneau `--c-accent`. Pas de champ hexadécimal, pas de roue chromatique.

**Migration** : mapper chaque couleur existante sur la plus proche de la palette (distance en espace
Lab, pas en RVB), une seule fois, au déploiement.

### B. Structure de page

| # | Problème | Correction |
|---|---|---|
| B1 | **Deux colonnes de longueurs incomparables** : la gauche s'arrête après 7 catégories, la droite continue sur 30 thèmes. Environ 1 000 px de vide à gauche, puis `Général` et `Calculateurs` qui apparaissent à des largeurs différentes. La mise en page est un accident, pas un choix. | Une seule colonne de panneaux empilés (§2). |
| B2 | **37 champs de saisie bordés visibles en permanence.** Une page de réglages qu'on consulte plus souvent qu'on ne modifie ne doit pas ressembler à un formulaire ouvert. | Édition au clic (§3). |
| B3 | Un **`<select>` vide et sans étiquette** sur chaque ligne de thème. Sa fonction n'est pas devinable. | À étiqueter (`Catégorie par défaut`) ou à supprimer (§4). |
| B4 | **Corbeille rouge visible en permanence sur 37 lignes**, sans confirmation. Supprimer une catégorie utilisée par 7 lignes du template est irréversible. | Menu `⋯` + confirmation chiffrée (§5). |
| B5 | **Aucun compteur d'usage.** Impossible de savoir lesquels de tes 30 thèmes sont morts. | Colonne `utilisé par` (§5). |
| B6 | **Modèle d'enregistrement incohérent** : `Général` a un bouton `Sauvegarder`, les listes semblent s'enregistrer en direct. On ne sait jamais ce qui est acquis. | Un seul modèle (§6). |
| B7 | Spinners `▲▼` sur `Objectif d'épargne`, `<select>` natifs, flèches de réordonnancement minuscules. | §3, §7. |
| B8 | Pastilles `?` sur les titres de panneaux. | Supprimées. |

### C. Fautes dans les libellés livrés

`Week-end / activitées` → `activités` · `Vetements` → `Vêtements` · `impots et taxes` →
`Impôts et taxes` · `especes` → `Espèces` · `Prevision EDF` → `Prévision EDF` · `courses` /
`dettes` en minuscules alors que le reste est capitalisé.

Normaliser la casse à la saisie (première lettre en majuscule) et corriger les valeurs existantes.
Ces libellés s'affichent sur toutes les autres pages.

---

## 2. Structure de page

Une seule colonne, `--w-content`, panneaux empilés dans cet ordre :

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Paramètres                                                                 │
│ Catégories, thèmes et réglages généraux                                    │
├────────────────────────────────────────────────────────────────────────────┤
│ Général                                                                    │
│  Devise · Objectif d'épargne · Moyens de paiement · Types d'investissement  │
├────────────────────────────────────────────────────────────────────────────┤
│ Catégories                          7                                      │
│  ⠿ ●  Logement & factures      Dépense      utilisé par 7 lignes       ⋯   │
├────────────────────────────────────────────────────────────────────────────┤
│ Thèmes                             30           [ rechercher un thème ]    │
│  (grille 3 colonnes de lignes compactes)                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ Calculateurs                        1                          [+ Calculateur]│
└────────────────────────────────────────────────────────────────────────────┘
```

`Général` passe **en premier** : c'est le bloc le plus court et le plus fondamental (devise, objectif
d'épargne). Aujourd'hui il est enterré au milieu de la colonne de droite, sous 30 thèmes.

Chaque panneau : `--c-surface`, `--r-container`, filet `--c-line`, **aucune ombre**. Titre 15 px /
600 + compteur 13 px `--c-ink-3`. Sous-titre explicatif 13 px `--c-ink-2`, une ligne, conservé —
il est bien écrit.

---

## 3. Lignes éditables

Le principe : **une ligne se lit comme du texte, et devient un champ quand on la modifie.**

- Au repos : nom en 14 px `--c-ink`, **sans bordure ni fond**. La ligne suit la grille du registre
  (`--h-row`, filet bas `--c-line`, survol `--c-surface-hover`).
- Au clic ou au focus clavier sur le nom : le champ apparaît (fond `--c-surface`, filet
  `--c-line-strong`, `--r-control`), le curseur se place en fin de texte.
- Enregistrement à la perte du focus ou sur `Entrée` ; `Échap` annule. Confirmation par le simple
  retour à l'état texte, sans toast.
- `Objectif d'épargne` : champ `40` avec suffixe `%` intégré, **sans spinner** (mêmes règles que les
  montants du Template, §6 de cette spec-là).
- Les `<select>` natifs (`Dépense` / `Transfert` / `Revenu`) sont restylés : hauteur 32 px,
  `--r-control`, filet `--c-line-strong`, chevron dessiné, `--c-surface`. Pas de `appearance: auto`.

Ça fait passer la page de 37 boîtes à 37 lignes de texte, sans rien retirer.

---

## 4. Panneau Catégories

Colonnes :

```
 ⠿  ●  Logement & factures        Dépense        utilisé par 7 lignes       ⋯
```

```css
grid-template-columns:
  24px            /* poignée de glissement */
  24px            /* pastille de couleur */
  minmax(0, 1fr)  /* nom */
  128px           /* type */
  160px           /* usage */
  32px;           /* menu */
```

- **Poignée de glissement** (`⠿`, 6 points) en remplacement des flèches `▲▼` : glisser-déposer avec
  fallback clavier (`Alt + ↑/↓` sur la ligne focalisée, annoncé en `aria-live`).
- **Pastille de couleur** : bouton 20 px ouvrant la palette de 12 (§1.A).
- **Type** : le `<select>` restylé. Une infobulle explique l'effet, en reprenant la phrase déjà
  écrite : `Leur type pilote les calculs.`
- **Usage** : `utilisé par 7 lignes` en 13 px `--c-ink-3`, ou `inutilisée` en `--c-warn` si zéro.
  C'est l'information qui manque le plus pour faire le ménage.
- La ligne d'ajout reste en bas du panneau, avec la même grille que les autres lignes (aujourd'hui
  elle a une largeur et un rythme différents). Le texte d'aide `comptée dans les dépenses et les
  stats` devient l'infobulle du champ `type`, il ne flotte plus sous le panneau.

---

## 5. Panneau Thèmes

Trente entrées : la liste verticale simple gaspille la largeur.

- **Grille de 3 colonnes** de lignes compactes (2 colonnes < 1120 px, 1 < 720 px), hauteur 36 px.
- **Champ de recherche** en haut à droite du panneau, filtrage instantané.
- Tri par défaut : alphabétique. Un second tri `par usage` permet de repérer les thèmes morts.
- Chaque ligne : nom, `utilisé par N lignes`, menu `⋯`. **Plus de pastille de couleur** (§1.A).
- Le `<select>` vide de chaque ligne : soit il est étiqueté `Catégorie par défaut` avec un
  placeholder explicite `Aucune`, soit il disparaît. Un contrôle sans étiquette dont personne ne
  connaît l'effet est pire qu'absent — trancher côté métier.
- Ligne d'ajout en bas, avec le placeholder actuel (`Nouveau thème (IA, Restaurants…)`), qui est bon.

**Suppression** — pour les deux panneaux, la corbeille sort de la ligne et entre dans le menu `⋯`,
en `--c-over`, avec un dialogue qui chiffre l'impact :

> Supprimer « Abonnements » ?
> 8 lignes du template et 24 entrées de l'historique y sont rattachées. Elles passeront en
> « Sans catégorie ».
> [Annuler] [Supprimer la catégorie]

Si le nombre est nul, dialogue simplifié. Ne jamais supprimer sans annoncer les conséquences.

---

## 6. Modèle d'enregistrement

Un seul modèle pour toute la page : **enregistrement immédiat au blur**, comme les listes le font
déjà. Le bouton `Sauvegarder` du bloc `Général` disparaît.

- Retour visuel : le champ revient à l'état texte, et un indicateur discret `Enregistré` en 12 px
  `--c-ink-3` apparaît 2 secondes à droite du panneau modifié. Un seul indicateur à la fois.
- En cas d'échec réseau : le champ reste en édition, filet `--c-over`, message sous le champ
  `Impossible d'enregistrer. Réessayer.` avec un bouton de réessai. Ne jamais perdre la saisie.
- Si tu préfères conserver un enregistrement explicite, alors il doit s'appliquer à **toute la
  page**, avec une barre d'action collée en bas qui n'apparaît qu'en cas de modification en attente.
  Mais pas les deux modèles en même temps, comme aujourd'hui.

---

## 7. Panneau Général

- `Devise` : `<select>` restylé, pas un champ texte libre — `EUR` saisi à la main est une source
  d'erreur.
- `Objectif d'épargne (% du revenu du mois)` : champ numérique sans spinner, suffixe `%`, plus une
  phrase calculée sous le champ : `40 % de 2 418,00 € = 967,20 € par mois.` C'est le chiffre qu'on
  cherche, et il apparaît déjà sur la page Mois.
- `Moyens de paiement` et `Types d'investissement` : les puces sont bonnes dans leur principe. Les
  restyler avec le composant `Tag` variante `neutral`, croix de suppression 12 px `--c-ink-3` qui
  passe en `--c-over` au survol. **Normaliser la casse** : `Espèces`, `Virement`, `ETF`, `Crypto`,
  `Stock`, `Autre`. Les capitales de `CRYPTO`, `STOCK`, `OTHER` sont la source des tags en capitales
  de la page Investissements.
- Ajouter ici la **bascule de thème clair / sombre** si elle n'a pas sa place dans la barre de
  navigation.

---

## 8. Panneau Calculateurs

C'est la fonctionnalité la plus complexe de l'application, et celle qui est la moins bien présentée.

- Le paragraphe d'explication est juste mais dense. Le réduire à une phrase :
  `Un calculateur estime une facture à partir de relevés saisis chaque mois.` et déplacer le détail
  (paramètres, relevés, formule, régularisation) dans l'écran d'édition du calculateur, là où il est
  utile.
- Chaque calculateur s'affiche en ligne de registre :

```
 EDF        (hp × prixHP + hc × prixHC) × (1 + tva / 100) + abo    → EDF        ⋯
            4 paramètres · 2 relevés mensuels
```

  Formule en 12 px dans une puce `--c-surface-sunken`, `--r-control`. C'est le **seul endroit de
  l'application où une police à chasse fixe est justifiée** : c'est du code, pas une étiquette.
- `→ EDF` devient `rattaché à EDF` en 12 px `--c-ink-3`. La flèche seule n'est pas explicite.
- Le bouton `Exemple : électricité HP/HC` est ambigu à côté de `+ Calculateur`. Le transformer en
  entrée du menu du bouton d'ajout : `Créer un calculateur` / `Partir de l'exemple électricité
  HP/HC`.

---

## 9. Micro-copie

| Actuel | Remplacer par |
|---|---|
| `Les blocs de votre mois. Leur type pilote les calculs.` | garder |
| `Étiquettes d'analyse, facultatives. Sur les lignes, modifiables par entrée.` | `Étiquettes d'analyse facultatives, modifiables sur chaque entrée.` |
| `comptée dans les dépenses et les stats` | infobulle du champ `type` |
| `Sauvegarder` | supprimé (§6) |
| `+ Calculateur` | `Ajouter un calculateur` |
| `→ EDF` | `rattaché à EDF` |
| `Nouvelle catégorie` / `Nouveau thème (IA, Restaurants…)` | garder |
| `CRYPTO`, `STOCK`, `OTHER` | `Crypto`, `Stock`, `Autre` |
| `especes` | `Espèces` |

---

## 10. Ordre d'implémentation

1. **Palette fermée pour les catégories + suppression de la couleur des thèmes** (§1.A), avec la
   migration. À faire **avant** les correctifs de couleur des autres pages, sinon ils seront défaits.
2. Normalisation de la casse et correction des fautes (§1.C, §7).
3. Passage en colonne unique, panneaux réordonnés (§2).
4. Lignes éditables au clic à la place des champs permanents (§3).
5. Colonnes `usage` + suppression via menu avec confirmation chiffrée (§4, §5).
6. Modèle d'enregistrement unique (§6).
7. Grille 3 colonnes + recherche pour les thèmes (§5).
8. Panneau Général et panneau Calculateurs (§7, §8).

### Recette

- [ ] Aucun `<input type="color">` dans l'application.
- [ ] Toute couleur de catégorie appartient aux 12 valeurs `--cat-*`.
- [ ] Les thèmes n'ont plus de couleur stockée.
- [ ] Aucun champ bordé visible tant qu'on n'édite pas.
- [ ] Aucune corbeille visible en permanence ; toute suppression annonce son impact chiffré.
- [ ] Chaque catégorie et chaque thème affiche son nombre d'usages.
- [ ] Un seul modèle d'enregistrement sur la page.
- [ ] Aucun spinner, aucun `<select>` au style natif.
- [ ] Aucune faute d'orthographe ni de casse dans les libellés livrés.
- [ ] La police à chasse fixe n'apparaît que dans les formules de calculateur.
