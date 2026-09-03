# Refonte UI — BudgetFlow

Spécification destinée à un agent IA chargé d'implémenter la refonte visuelle de l'application de
gestion de budget mensuel **BudgetFlow**.

**Hypothèses techniques à confirmer avant de commencer :** front en Vue 3 (SFC + `<style scoped>`),
CSS natif avec variables CSS. Si la stack diffère (React, Tailwind, UnoCSS…), transposer les tokens
tels quels — ils sont exprimés en custom properties, donc portables. Ne pas introduire de librairie
de composants (Vuetify, PrimeVue, shadcn) : la refonte tient dans ~15 composants maison.

---

## 1. Ce qu'est le produit (à garder en tête à chaque décision)

Un outil **personnel**, utilisé **quotidiennement**, sur un mois en cours. Ce n'est pas un dashboard
de présentation : c'est un **registre**. L'utilisateur y fait trois gestes, dans cet ordre de
fréquence :

1. **Pointer** une ligne (« c'est passé sur le compte »).
2. **Lire un écart** (prévu vs réel, reste à dépenser, reste à mettre de côté).
3. **Saisir** une ligne ou une entrée.

Toute décision de design qui ralentit ces trois gestes est mauvaise, même si elle est jolie.
Corollaire : **la densité est une fonctionnalité**, pas un défaut. L'écran actuel affiche ~10 lignes
utiles sur 950 px de hauteur ; l'objectif est d'en afficher 25 à 30 sans que ça devienne illisible.

---

## 2. Diagnostic de l'existant

Classé par gravité. L'agent doit traiter les points **A** avant les **B**.

### A. Bloquants

| # | Problème | Où | Correction attendue |
|---|---|---|---|
| A1 | La barre de synthèse sticky **passe par-dessus** le contenu en scroll : elle est semi-transparente/sans fond opaque et recouvre les lignes (capture 3 : « AXA » et « Comptes » tronqués). | Header sticky | Fond opaque, `z-index` dédié, `scroll-margin-top` sur les ancres, hauteur fixe compensée par un `padding-top` sur le conteneur. |
| A2 | **Aucune colonne alignée.** Chaque montant est positionné par le flux du texte : les chiffres ne s'alignent verticalement d'une ligne à l'autre dans aucune section. Impossible de comparer en diagonale. | Toutes les listes | Grille de colonnes commune à tous les niveaux + `font-variant-numeric: tabular-nums`. |
| A3 | Les **8 catégories sont 8 cartes identiques** séparées par 24 px de vide, la plupart affichant `0,00 €`. ~60 % de la hauteur de page est du vide entre cartes. | Liste des catégories | Un seul registre continu, sections séparées par des filets, en-têtes de section sticky. |
| A4 | **Le violet ne veut rien dire.** Il sert à la fois de couleur de marque, de bouton, de lien, de barre de progression et de montant (`0,00 €` mis de côté). Le vert sert à deux chiffres qui n'ont pas le même statut (solde réel vs projection). | Global | Séparer strictement *couleur de chrome* (interaction) et *couleur de donnée* (sémantique). Voir §4.2. |
| A5 | Incohérence de donnée exposée telle quelle : « Achats et shopping — 30,00 € / prévu 0,00 € / **100 %** ». Une barre à 100 % sur un prévu nul n'a pas de sens. | Sections | Si `prévu === 0` : pas de barre, pas de pourcentage, mention « hors budget » et montant en couleur d'alerte douce. |

### B. Importants

| # | Problème | Correction attendue |
|---|---|---|
| B1 | Les **tags sont un arc-en-ciel** (rose, orange, rouge, bleu, jaune, violet) sans système : la couleur ne code aucune information, elle bruite la lecture. | 1 style neutre par défaut + 3 rôles couleur maximum (§5.9). |
| B2 | La **barre jaune-vert `100 %`** est agressive et hors palette. | Palette de progression unifiée à 3 états (§5.8). |
| B3 | **Trois niveaux de hiérarchie** (catégorie → ligne → entrée) rendus avec quasi le même style ; deux boutons « Ajouter » imbriqués (« Ajouter une entrée » / « Ajouter une ligne ») qu'on confond. | Indentation + fond + graisse différenciés, boutons d'ajout hiérarchisés (§5.6, §5.7). |
| B4 | Les **cases à cocher** sont partout sans qu'on sache ce qu'elles font (pointage ? sélection multiple ?). | Affordance de pointage explicite avec libellé accessible et retour visuel fort sur la ligne pointée (§5.10). |
| B5 | Les **enveloppes occupent tout le haut** et repoussent le contenu réel du mois sous la ligne de flottaison, alors qu'on les consulte rarement. | Passage en colonne latérale sur desktop (§4.5). |
| B6 | **Contraste insuffisant** sur les métadonnées (`reste 743,75 €`, `prévu 388,29 €` en gris clair ~11 px). | Ramp de gris recalibrée, minimum 4.5:1 pour tout texte porteur d'information. |
| B7 | Pas de **thème sombre**, pas de **responsive** exploitable, pas de **focus clavier** visible. | §7, §8. |
| B8 | Micro-copie système : « si tout le prévu se réalise », « Clôturer », « ½ », `?` en pastille. | Réécriture (§6). |

### C. Détails

- Pas d'espace fine insécable avant `€` ni comme séparateur de milliers (typographie française).
- Les `?` d'aide en pastille grise sont 3 boutons de plus dans une barre déjà chargée.
- « Voyage au Japon » affiche `+8,58 € ce mois` en badge vert — information utile noyée dans le style des tags décoratifs.
- Le libellé `test` dans « Achats et shopping » : prévoir un rendu correct des libellés courts/vides.

---

## 3. Direction de design

### Le parti pris : **le registre**

Pas un dashboard. Un **livre de comptes** : colonnes strictes, filets fins, chiffres alignés, encre
sobre, et **la couleur réservée aux événements** (un dépassement, une entrée d'argent, une action à
faire). Le fond emprunte le vert-gris très désaturé du papier de comptabilité ; le texte est une
encre profonde légèrement teintée du même vert pour que l'ensemble tienne. La marque (violet) ne
sert **que** à ce qui est cliquable.

Ce parti pris se justifie par l'usage : un registre se **balaye** verticalement, en colonne, en
cherchant l'anomalie. Chaque règle ci-dessous sert cette lecture.

### Les cinq règles à ne jamais casser

1. **Un chiffre s'aligne.** Tout montant est en chiffres tabulaires, aligné à droite, dans une
   colonne de largeur fixe partagée par toutes les sections.
2. **La couleur est un signal, pas une décoration.** Une dépense normale n'est pas rouge. Le rouge
   est réservé au dépassement et au « à faire ». Le vert est réservé à l'argent qui entre.
3. **Le violet n'est jamais une donnée.** Boutons, liens, focus, onglet actif. C'est tout.
4. **Une seule ombre dans toute l'application** (les surfaces flottantes). Les conteneurs se
   séparent par des filets et des fonds, pas par des ombres.
5. **Le rayon d'arrondi encode la hiérarchie** : contrôles 6 px, conteneurs 12 px. Jamais le même
   rayon partout.

### Ce que l'agent ne doit **pas** faire

- Pas de dégradés décoratifs, pas de glassmorphism, pas de fond flouté.
- Pas d'étiquette en `TEXT-TRANSFORM: UPPERCASE` avec `letter-spacing` généreux au-dessus de chaque bloc.
- Pas de méta-lignes du type « A · B · C » avec points médians.
- Pas de flèche `→` collée au texte des boutons et des liens.
- Pas d'animation d'entrée en fade + translate sur chaque carte au chargement.
- Pas de police monospace pour les petites étiquettes de données : les chiffres tabulaires suffisent
  et sont plus lisibles.
- Pas de carte arrondie + ombre douce autour de chaque bloc de contenu : c'est précisément le défaut
  actuel.
- Pas d'emoji dans l'interface (le 🐷 des enveloppes disparaît, voir §5.5).

---

## 4. Tokens

À placer dans un unique fichier `src/styles/tokens.css` importé globalement. **Aucun hex en dur dans
les composants.**

### 4.1 Couleurs — thème clair

```css
:root {
  /* Surfaces */
  --c-canvas:          #F1F3F1; /* fond de page, papier registre */
  --c-surface:         #FFFFFF; /* conteneurs, lignes */
  --c-surface-sunken:  #F7F8F7; /* zone d'entrées (niveau 3), en-têtes de tableau */
  --c-surface-hover:   #EEF1EF;
  --c-line:            #E2E6E3; /* filet standard */
  --c-line-strong:     #CBD2CD; /* séparateur de section */

  /* Encre */
  --c-ink:             #14201C; /* texte principal, montants */
  --c-ink-2:           #46554F; /* texte secondaire */
  --c-ink-3:           #77857F; /* méta : "prévu", "reste", dates */
  --c-ink-disabled:    #A3AEA9;

  /* Marque / interaction — JAMAIS une donnée */
  --c-accent:          #5A31C4;
  --c-accent-hover:    #4A27A8;
  --c-accent-soft:     #EFEAFB; /* fond d'onglet actif, fond de bouton discret */
  --c-accent-ring:     #5A31C466;

  /* Sémantique de donnée */
  --c-credit:          #0B6B52; /* argent qui entre : revenus, +8,58 € ce mois */
  --c-credit-soft:     #E4F1EC;
  --c-warn:            #A66A00; /* ≥ 85 % du prévu consommé */
  --c-warn-soft:       #FBF0DC;
  --c-over:            #B03024; /* dépassement, retard, action requise */
  --c-over-soft:       #FBE9E7;

  /* Progression */
  --c-track:           #E2E6E3;
  --c-fill:            #4A5A55; /* remplissage neutre par défaut */
  --c-fill-warn:       var(--c-warn);
  --c-fill-over:       var(--c-over);
  --c-fill-goal:       var(--c-credit); /* enveloppes : on épargne, c'est positif */
}
```

### 4.2 Règle d'usage des couleurs (à appliquer littéralement)

| Élément | Couleur |
|---|---|
| Libellé de ligne | `--c-ink` |
| Montant réel (dépense) | `--c-ink` — **pas de rouge** |
| Montant prévu / reste / date | `--c-ink-3` |
| Montant de revenu, gain d'enveloppe | `--c-credit` |
| Montant en dépassement, « à envoyer à Marion » | `--c-over` |
| Ligne pointée | libellé `--c-ink-3`, montant `--c-ink-2`, pas de barré |
| Bouton primaire, lien, onglet actif, focus | `--c-accent` |
| Remplissage de progression d'une dépense | `--c-fill`, puis `--c-fill-warn` ≥ 85 %, `--c-fill-over` > 100 % |
| Remplissage de progression d'une enveloppe | `--c-fill-goal` |

Le solde principal (`62,99 €`) n'est **pas** vert par défaut : il est en `--c-ink`, et passe en
`--c-over` seulement s'il est négatif. Un solde positif est la normale, pas une bonne nouvelle.

### 4.3 Couleurs — thème sombre

Activé par `:root[data-theme="dark"]` **et** par `@media (prefers-color-scheme: dark)` si aucun
choix explicite n'est stocké.

```css
:root[data-theme="dark"] {
  --c-canvas:         #0E1412;
  --c-surface:        #151C1A;
  --c-surface-sunken: #1B2422;
  --c-surface-hover:  #202A27;
  --c-line:           #26302C;
  --c-line-strong:    #354039;

  --c-ink:            #E8EEEB;
  --c-ink-2:          #A6B3AE;
  --c-ink-3:          #7A8781;
  --c-ink-disabled:   #5A665F;

  --c-accent:         #A88BFF;
  --c-accent-hover:   #BCA4FF;
  --c-accent-soft:    #2A2244;
  --c-accent-ring:    #A88BFF66;

  --c-credit:         #4CC79F;
  --c-credit-soft:    #12332A;
  --c-warn:           #E0A83C;
  --c-warn-soft:      #33280F;
  --c-over:           #FF8A7A;
  --c-over-soft:      #3A1A16;

  --c-track:          #26302C;
  --c-fill:           #8A9A94;
}
```

### 4.4 Typographie

Une seule famille : **IBM Plex Sans** (400 / 500 / 600), auto-hébergée en `woff2` avec
`font-display: swap`. Choisie pour ses chiffres tabulaires solides et son dessin un peu sec, qui
convient au registre — et parce qu'elle n'est ni Inter ni Roboto.

```css
:root {
  --font-ui: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;

  --t-meta:      0.6875rem; /* 11px — en-têtes de colonne */
  --t-small:     0.75rem;   /* 12px — prévu, reste, dates */
  --t-tag:       0.75rem;   /* 12px — tags */
  --t-body:      0.875rem;  /* 14px — libellés de ligne (défaut) */
  --t-amount:    0.9375rem; /* 15px — montants de ligne */
  --t-section:   1rem;      /* 16px — titre de catégorie */
  --t-section-n: 1.125rem;  /* 18px — montant de catégorie */
  --t-hero:      1.75rem;   /* 28px — solde du mois */

  --lh-tight: 1.15;
  --lh-body:  1.45;
}
```

Règles :

- **Toute** valeur numérique porte `font-variant-numeric: tabular-nums;` — utiliser une classe
  utilitaire `.num`.
- Montants : `font-weight: 500`, `letter-spacing: -0.01em`. Le solde hero : `600`.
- Titres de catégorie : `600`, taille 16, **pas** de majuscules.
- En-têtes de colonne (`prévu`, `réel`) : 11 px, `500`, `--c-ink-3`, **casse normale**, jamais de
  `text-transform: uppercase`.
- Hauteur de ligne 1.45 pour le texte, 1.15 pour les blocs de chiffres.
- Largeur de texte max 72 caractères pour toute zone de prose (aide, états vides).

**Typographie française (à implémenter dans le formateur de montants) :**

```js
// Utiliser Intl et forcer l'espace fine insécable (U+202F) avant le symbole.
const nf = new Intl.NumberFormat("fr-FR", {
  style: "currency", currency: "EUR",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
export const eur = (v) => nf.format(v).replace(/\u00A0/g, "\u202F");
// → "1 667,85 €" avec espaces fines insécables
```

### 4.5 Espacement, rayons, ombres, durées

```css
:root {
  --s-1: 4px;  --s-2: 6px;  --s-3: 8px;  --s-4: 12px;
  --s-5: 16px; --s-6: 20px; --s-7: 24px; --s-8: 32px; --s-9: 48px;

  --r-control:   6px;  /* boutons, champs, cases, tags */
  --r-container: 12px; /* panneaux, cartes latérales */
  --r-pill:      999px;

  --shadow-overlay: 0 8px 24px -8px rgba(16, 32, 26, 0.18);
  --shadow-sticky:  0 1px 0 var(--c-line), 0 6px 12px -10px rgba(16, 32, 26, 0.22);

  --dur-fast: 120ms;
  --dur-base: 200ms;
  --ease:     cubic-bezier(0.2, 0, 0, 1);

  --h-row:        40px; /* hauteur de ligne desktop */
  --h-row-touch:  48px;
  --h-topbar:     52px;
  --h-summary:    56px;
  --w-content:    1240px;
  --w-aside:      340px;
}
```

Une seule ombre de contenu (`--shadow-overlay`) : menus, popovers, modales. La barre sticky utilise
`--shadow-sticky` **uniquement après scroll** (`.is-scrolled`).

---

## 5. Layout et composants

### 5.1 Grille de page

```
≥ 1120 px                              < 1120 px
┌──────────────────────────────────┐   ┌──────────────────────┐
│ Barre de navigation      52px    │   │ Nav (menu compact)   │
├──────────────────────────────────┤   ├──────────────────────┤
│ Barre de synthèse (sticky) 56px  │   │ Synthèse (sticky)    │
├────────────────────┬─────────────┤   ├──────────────────────┤
│                    │ Enveloppes  │   │ Registre du mois     │
│  Registre du mois  │             │   │  …                   │
│  (colonne 1fr)     │ Investis.   │   ├──────────────────────┤
│                    │             │   │ Enveloppes (repliées)│
│                    │ (340px,     │   │ Investissements      │
│                    │  sticky)    │   │                      │
└────────────────────┴─────────────┘   └──────────────────────┘
   gap 24px · max-width 1240px           padding latéral 16px
```

Le contenu **principal** est le registre du mois : il passe à gauche et occupe la largeur. Les
enveloppes et investissements, consultés ponctuellement, passent en colonne latérale `sticky`
(`top: calc(var(--h-topbar) + var(--h-summary) + 16px)`). Sur mobile, ils passent **sous** le
registre, repliés par défaut, avec un résumé d'une ligne visible.

### 5.2 Barre de navigation

- Hauteur 52 px, fond `--c-surface`, filet bas `--c-line`, **non sticky** (seule la synthèse l'est).
- Logo : carré 28 px, rayon `--r-control`, fond `--c-accent`, lettre `B` blanche 600. Le mot-symbole
  « BudgetFlow » en 15 px / 600 / `--c-ink`.
- Onglets : 14 px / 500 / `--c-ink-2`. Actif : `--c-ink` + soulignement 2 px `--c-accent` collé au
  bas de la barre (pas de pastille de fond arrondie).
- Ajouter à droite : bouton icône **thème clair/sombre** et **profil**. `Paramètres` sort de la
  barre d'onglets et devient une icône engrenage à droite.
- < 900 px : les onglets deviennent un tiroir accessible par un bouton menu ; `Mois` reste visible.

### 5.3 Barre de synthèse (sticky) — corrige A1

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  62,99 €        Fin de mois 1 667,85 €   Épargne 0 / 967,20 € ▓▓░░░░ 40 %    │
│  N26 Main                                                                    │
│                              ‹  Septembre 2026  ›   • Ouvert    [Clôturer]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Spécifications :

- `position: sticky; top: 0; z-index: 30;` **fond `--c-surface` opaque** — pas de transparence, pas
  de `backdrop-filter`. Ajouter `--shadow-sticky` via la classe `.is-scrolled` (IntersectionObserver
  sur une sentinelle de 1 px placée au-dessus).
- Compenser la hauteur : le conteneur de page reçoit `scroll-padding-top: calc(var(--h-summary) + 8px)`
  et toutes les ancres de section `scroll-margin-top` identique.
- **Une seule valeur en grand** : le solde actuel (28 px / 600 / `--c-ink`, `--c-over` si négatif),
  avec le nom du compte en 11 px `--c-ink-3` en dessous.
- Les deux autres indicateurs passent en format `étiquette + valeur` sur une ligne, 12 px + 15 px,
  séparés par un filet vertical 1 px `--c-line` (pas par un point médian).
- L'objectif d'épargne intègre une micro-barre de 4 px de haut, 64 px de large.
- Le sélecteur de mois devient `‹ Septembre 2026 ›` avec deux boutons icônes de navigation + menu au
  clic sur le libellé. Bien plus rapide que le menu déroulant seul.
- Le statut « Ouvert » devient une pastille discrète : point 6 px `--c-credit` + libellé 12 px
  `--c-ink-2`. Pas de fond coloré.
- Actions : `Comptes` et `Soldes de début` deviennent des **liens texte** `--c-accent`. `Clôturer`
  devient le bouton **secondaire**. `+ Nouveau mois` disparaît de cette barre : c'est une action
  rare, elle appartient au menu du sélecteur de mois (« Créer octobre 2026 »).
- Les trois pastilles `?` sont supprimées. Les explications passent en `title`/tooltip sur
  l'étiquette elle-même, qui reçoit un soulignement pointillé.
- < 720 px : la barre garde le solde + le mois sur une ligne (44 px) ; les autres indicateurs
  passent dans un bandeau scrollable horizontalement juste en dessous.

### 5.4 Registre du mois — structure

Remplace les 8 cartes indépendantes par **un panneau unique** : `--c-surface`, `--r-container`,
filet `--c-line`, aucune ombre. À l'intérieur, des sections séparées par un filet
`--c-line-strong`.

En-tête de colonnes, affiché **une seule fois** en haut du panneau, sticky sous la synthèse :

```
                                                         prévu        réel
```

Grille partagée par tous les niveaux :

```css
.reg-grid {
  display: grid;
  grid-template-columns:
    28px            /* pointage */
    minmax(0, 1fr)  /* libellé + tags */
    92px            /* prévu */
    112px           /* réel */
    32px;           /* actions */
  align-items: center;
  gap: var(--s-3);
  padding-inline: var(--s-5);
  min-height: var(--h-row);
}
```

Les colonnes `prévu` et `réel` sont `text-align: right`. C'est cette grille, appliquée partout, qui
règle A2.

### 5.5 En-tête de section (catégorie)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ●  Logement & factures   7                        388,29 €      0,00 €   ⌄ │
│    ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░  0 %                                   │
└────────────────────────────────────────────────────────────────────────────┘
```

- Hauteur 48 px, fond `--c-surface-sunken`, sticky (`top` = synthèse + en-tête de colonnes),
  `z-index: 10`.
- Point de couleur 8 px : garder la couleur de catégorie choisie par l'utilisateur, **désaturée à
  ~65 %** pour rester dans la palette. C'est le seul endroit où une couleur libre est admise.
- Titre 16 px / 600. Compteur de lignes : nombre en 12 px `--c-ink-3`, **sans pastille de fond**.
- Montants : prévu en `--c-ink-3`, réel en `--c-ink` 18 px / 600.
- Barre de progression 3 px collée au bas de l'en-tête, sur toute la largeur. Masquée si
  `prévu === 0` (A5).
- Chevron d'ouverture à droite, rotation 180° en `--dur-fast`.
- **État replié** : c'est l'état par défaut pour une section dont le réel est à 0 et qui n'a aucune
  ligne en retard. Les sections avec activité s'ouvrent automatiquement.

### 5.6 Ligne budgétaire (niveau 2)

```
 ☐  Loyer            Marion · à envoyer            146,57 €     —        ✎
 ☑  EDF              ½   Prévision EDF             127,88 €   127,88 €   ✎
```

- Hauteur `--h-row`, filet bas `--c-line` (sauf dernière).
- `:hover` → fond `--c-surface-hover`, révèle les actions (`✎` modifier, `⋯` menu). Les actions
  restent focusables au clavier même masquées visuellement (`opacity: 0` + `:focus-visible`
  → `opacity: 1`, jamais `display: none`).
- Le libellé tronque en `text-overflow: ellipsis` ; les tags ne poussent jamais le montant.
- Le marqueur `½` (dépense partagée) devient un tag de rôle `info` avec le libellé `½ partagé`.
- La ligne « à envoyer à Marion » : au lieu du surlignage jaune pleine largeur, une **barre verticale
  3 px `--c-over`** collée au bord gauche de la ligne + montant en `--c-over` + tag `à envoyer`.
  Discret mais repérable au balayage.
- **État pointé** : libellé `--c-ink-3`, fond inchangé, case cochée `--c-accent`. **Pas de texte
  barré** (illisible sur des chiffres).
- **État en retard** (échéance passée, non pointée) : barre verticale gauche `--c-over`.

### 5.7 Entrée (niveau 3)

Le troisième niveau doit être visiblement subordonné :

- Conteneur `--c-surface-sunken`, indenté de 28 px à gauche, `--r-control`, marge verticale 4 px.
- Lignes de 32 px : date (12 px `--c-ink-3`, format `2 sept.`), libellé, tag, montant, compte
  (12 px `--c-ink-3`), bouton supprimer.
- Le bouton **« Ajouter une entrée »** vit à l'intérieur de ce bloc, en style *discret* (texte
  `--c-accent` 12 px, icône `+`, pas de bordure pointillée).
- Le bouton **« Ajouter une ligne »** vit au bas de la section, en style *bordé pointillé* pleine
  largeur, 36 px. Deux styles distincts = plus de confusion (B3).

### 5.8 Barre de progression

Composant unique `<ProgressBar :value :max :variant />`.

- Piste `--c-track`, hauteur 3 px (section) ou 4 px (enveloppe), `--r-pill`, `overflow: hidden`.
- Remplissage : `--c-fill` par défaut ; `--c-fill-warn` si ratio ≥ 0.85 ; `--c-fill-over` si > 1 ;
  `--c-fill-goal` pour `variant="goal"` (enveloppes, épargne).
- Au-delà de 100 % : la barre reste pleine et un **liseré de 2 px `--c-over`** apparaît à l'extrémité
  droite ; le pourcentage s'affiche en `--c-over`.
- Si `max === 0` : ne rien rendre du tout (A5).
- Transition `width var(--dur-base) var(--ease)`, neutralisée sous `prefers-reduced-motion`.
- `role="progressbar"` + `aria-valuenow/min/max` + `aria-label` explicite.

### 5.9 Tags — corrige B1

Un seul composant, **quatre variantes maximum** :

| Variante | Usage | Style |
|---|---|---|
| `neutral` (défaut) | catégorie de rattachement, compte, note (`Prévision EDF`, `Frais banque`, `Mutuel`) | fond `--c-surface-sunken`, texte `--c-ink-2`, filet `--c-line` |
| `info` | information structurelle (`½ partagé`, `N26 Facture`) | fond `--c-accent-soft`, texte `--c-accent` |
| `credit` | gain (`+8,58 € ce mois`) | fond `--c-credit-soft`, texte `--c-credit` |
| `alert` | action requise (`à envoyer`, `en retard`) | fond `--c-over-soft`, texte `--c-over` |

Style commun : 12 px / 500, hauteur 20 px, padding `2px 8px`, `--r-control` (pas `--r-pill` : le pill
plein est déjà surexploité dans l'écran actuel). **Supprimer toutes les autres couleurs de tag.** Si
l'utilisateur peut choisir une couleur de tag en base, mapper ses choix existants sur ces quatre
variantes lors de la migration.

### 5.10 Case de pointage — corrige B4

- Carré 18 px, `--r-control` (4 px), filet 1.5 px `--c-line-strong`, fond `--c-surface`.
- Cochée : fond `--c-accent`, coche blanche, filet `--c-accent`.
- Zone de clic étendue à 28 × 40 px via pseudo-élément, sans agrandir le visuel.
- `<input type="checkbox">` réel, visuellement masqué mais focusable, avec
  `aria-label="Pointer {libellé} — {montant}"`.
- `:focus-visible` → anneau `0 0 0 3px var(--c-accent-ring)`.
- Ajouter un raccourci : `Espace` pointe la ligne focalisée, `j`/`k` naviguent entre lignes.

### 5.11 Panneau latéral — Enveloppes & Investissements

Deux panneaux empilés dans la colonne de droite, `--c-surface`, `--r-container`, filet `--c-line`.

- Les onglets « Enveloppes / Investissements » **disparaissent** : ce sont deux objets différents,
  ils n'ont pas à se cacher l'un l'autre. Chacun a son panneau avec un titre 13 px / 600 et un total
  aligné à droite.
- Supprimer l'emoji 🐷 et l'icône graphique : les titres suffisent.
- Ligne d'enveloppe :

```
 Matelas de sécurité                       4 756,25 € / 5 500,00 €
 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  86 %          reste 743,75 €
 N26 Safety · 247,92 €/mois
```

  Titre 14 px / 500 ; montants 13 px avec le courant en `--c-ink` et la cible en `--c-ink-3` ; barre
  `variant="goal"` ; ligne méta 11 px `--c-ink-3`. Une enveloppe à 0 % n'affiche pas de barre pleine
  largeur grise : afficher la piste seule, très discrète.
- Ligne d'investissement : libellé, tag support (`ETF`, `CRYPTO` → variante `neutral`), courtier en
  méta, montant prévu aligné à droite.
- < 1120 px : les deux panneaux passent sous le registre, repliés, en-tête cliquable affichant le
  total.

### 5.12 Boutons

| Style | Usage | Spéc |
|---|---|---|
| Primaire | 1 par écran max (`Clôturer le mois`) | fond `--c-accent`, texte blanc, 34 px, `--r-control`, 13 px / 500 |
| Secondaire | actions courantes | fond `--c-surface`, filet `--c-line-strong`, texte `--c-ink` |
| Discret | actions inline (`Ajouter une entrée`) | texte `--c-accent`, pas de fond ni de filet |
| Ajout de ligne | bas de section | pleine largeur, 36 px, filet 1 px **pointillé** `--c-line-strong`, texte `--c-ink-3`, `:hover` → filet et texte `--c-accent` |
| Icône | 28 × 28, `--r-control`, `:hover` fond `--c-surface-hover` | |

Tous : `transition: background-color var(--dur-fast) var(--ease)`, `:focus-visible` avec anneau
`--c-accent-ring`, `:active` sans `transform: scale()`.

### 5.13 États vides — corrige B8

Une catégorie sans ligne n'affiche pas `0,00 € / prévu 0,00 €` : elle affiche une invitation.

```
Aucune ligne dans Alimentation & restau.
[ Ajouter une ligne ]
```

Texte 13 px `--c-ink-2`, centré, 24 px de padding vertical, **sans illustration**.

Mois vide (« Operations », « Calculateurs ») : même traitement, avec une phrase qui dit ce que la
section sert à faire.

---

## 6. Micro-copie à réécrire

| Actuel | Remplacer par |
|---|---|
| `Solde actuel · N26 Main` | `Solde N26 Main` (le « actuel » est implicite) |
| `Projeté fin de mois` / `si tout le prévu se réalise` | `Fin de mois` + tooltip : « Solde estimé si toutes les lignes prévues sont réalisées. » |
| `Mis de côté ce mois` / `objectif 967,20 € (40 %)` | `Épargne du mois` · `0 € sur 967,20 €` |
| `Ouvert` | `Mois ouvert` |
| `Clôturer` | `Clôturer le mois` |
| `+ Nouveau mois` | `Créer octobre 2026` (dans le menu du sélecteur de mois) |
| `Soldes de début` | `Soldes d'ouverture` |
| `½` | tag `½ partagé` + tooltip « Dépense partagée : 50 % à votre charge. » |
| `à envoyer à Marion` | garder, c'est bon — juste retypographié en tag `alert` + montant |
| `Ajouter une entrée` / `Ajouter une ligne` | `Ajouter une entrée` (mouvement réel) / `Ajouter une ligne budgétaire` |
| `relevés du mois` | `Relevés du mois` |
| `test` (libellé) | rien à faire côté design, mais gérer le rendu d'un libellé vide : afficher `Sans libellé` en `--c-ink-3` italique |

Ton : phrases courtes, verbes actifs, casse de phrase. Un bouton nomme ce qui se passe
(`Clôturer le mois` → toast `Mois clôturé`).

---

## 7. Mouvement

Un seul moment orchestré, et il répond à une action : **le pointage d'une ligne**.

1. La case se remplit (`--dur-fast`).
2. Le libellé passe en `--c-ink-3` (`--dur-base`).
3. Le total de la section et la barre de progression s'animent vers leur nouvelle valeur
   (`--dur-base`, `--ease`) — c'est l'information utile : montrer ce qui a changé.

Rien d'autre. Pas d'entrée en cascade au chargement, pas de transition sur `:hover` autre que la
couleur de fond, pas de skeleton animé (utiliser un bloc `--c-surface-sunken` statique).

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. Accessibilité — critères de recette

- Contraste ≥ 4.5:1 pour tout texte porteur d'information, y compris `--c-ink-3` sur
  `--c-surface-sunken`. **Vérifier au colorimètre**, ne pas supposer.
- `:focus-visible` visible sur **tous** les éléments interactifs : `outline: none` interdit sans
  remplacement.
- Ordre de tabulation cohérent avec l'ordre visuel ; les actions révélées au survol restent
  atteignables au clavier.
- Le registre est une liste de données : `role="list"` / `role="listitem"`, ou un vrai `<table>` si
  la structure le permet — dans ce cas, en-têtes `<th scope="col">` pour `prévu` / `réel`.
- Les montants ne dépendent jamais de la seule couleur : un dépassement porte aussi le tag `alert`
  ou un signe explicite.
- Cibles tactiles ≥ 44 px sur mobile (`--h-row-touch`).
- Zoom texte 200 % sans perte de contenu.

---

## 9. Ordre d'implémentation

L'agent procède **étape par étape**, en vérifiant visuellement après chaque étape. Ne pas tout
réécrire d'un bloc.

1. `tokens.css` + reset + chargement de la police + classe utilitaire `.num` + formateur `eur()`.
2. **Correction A1** (sticky opaque, z-index, scroll-padding) — bug fonctionnel, prioritaire.
3. Composants atomiques : `Button`, `Tag`, `Checkbox`, `ProgressBar`, `Amount`.
4. `RegisterRow` + grille de colonnes partagée (**A2**).
5. `SectionHeader` + fusion des cartes en panneau unique (**A3**).
6. Barre de synthèse (§5.3) et barre de navigation (§5.2).
7. Passage des enveloppes/investissements en colonne latérale (§5.11) + grille de page (§5.1).
8. Niveau 3 (entrées) et boutons d'ajout hiérarchisés (§5.7).
9. États vides, micro-copie (§5.13, §6).
10. Thème sombre (§4.3) + bascule persistée en `localStorage`.
11. Responsive : points de rupture 1120 / 900 / 720 / 480.
12. Passe d'accessibilité (§8) puis passe de mouvement (§7).

### Recette finale

- [ ] Aucun hex en dur hors `tokens.css`.
- [ ] Tous les montants alignés en colonne et en chiffres tabulaires, format `1 667,85 €`.
- [ ] Aucune barre ni pourcentage affiché quand `prévu === 0`.
- [ ] Le violet n'apparaît que sur des éléments interactifs.
- [ ] Une seule ombre déclarée dans tout le CSS (`--shadow-overlay`), plus la sticky.
- [ ] Le header sticky ne recouvre plus rien au scroll, à toutes les largeurs.
- [ ] Au moins 25 lignes utiles visibles sur un écran 1440 × 900.
- [ ] Thème sombre complet, sans zone restée blanche.
- [ ] Navigation et pointage possibles entièrement au clavier.
- [ ] `prefers-reduced-motion` respecté.
