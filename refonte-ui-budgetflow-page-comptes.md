# Refonte UI — Page « Comptes & enveloppes »

Complément à `refonte-ui-budgetflow.md`. Cette page n'a pas encore été migrée : elle utilise encore
les anciens styles (grille de cartes, ombres, tags multicolores, remplissage violet). L'objectif est
qu'elle devienne **le même objet visuel que la page Mois** : un registre, pas une galerie de cartes.

Tous les tokens, composants (`Tag`, `ProgressBar`, `Amount`, `Button`, `SectionHeader`,
`RegisterRow`) et règles du document principal s'appliquent sans exception. Cette page ne doit
introduire **aucun** nouveau token ni composant.

---

## 1. Diagnostic

### A. Incohérences avec le design system

| # | Problème | Correction |
|---|---|---|
| A1 | Remplissage des barres de progression en **violet**. Le violet est réservé à l'interaction (règle 3). | `ProgressBar variant="goal"` → `--c-fill-goal`. Identique au panneau Enveloppes de la page Mois. |
| A2 | **Tags multicolores** : `Courant` bleu, `Épargne` vert, `Investissement` violet, `★ principal` rose. | Voir §3 — les tags de type disparaissent purement et simplement. |
| A3 | **Cartes avec ombre**, rayon uniforme, grille 2 colonnes. | Panneau unique + sections + filets, comme le registre du mois. |
| A4 | **Aucun alignement des soldes** : `92,99 €`, `84,13 €`, `585,13 €` sont à des abscisses différentes selon la longueur du nom et du tag. | Colonne de solde de largeur fixe, alignée à droite, `tabular-nums`. |
| A5 | Format de date ISO : `soldes de 2026-09`. | `soldes de septembre 2026`. |
| A6 | Pastille `?` d'aide dans le titre. | Supprimée (règle §5.3 du document principal). |

### B. Problèmes de structure

| # | Problème | Correction |
|---|---|---|
| B1 | **Grille 2 colonnes de hauteurs inégales** : la carte `N26 Safety` traîne ~90 px de vide pour s'aligner sur sa voisine. Et l'ordre de lecture est ambigu (gauche→droite ou haut→bas ?). | Liste verticale unique. |
| B2 | Les types de comptes sont **mélangés** dans la grille (Courant, Épargne, Investissement, Courant, Épargne…). | Regroupement par type avec sous-totaux (§4). |
| B3 | « **Aucune enveloppe sur ce compte.** » répété 5 fois, et « + enveloppe sur ce compte » répété 8 fois. Une page où le texte le plus fréquent dit qu'il n'y a rien à voir. | Le message disparaît ; l'action passe en action de survol (§5). |
| B4 | Le bloc patrimoine consacre **la moitié de sa largeur à un paragraphe d'aide** de deux lignes, en permanence. | Le paragraphe devient une infobulle ; la largeur sert à la répartition par type (§3). |
| B5 | Trois icônes toujours visibles sur chaque ligne, dont une **suppression** et une icône « power » dont l'effet n'est pas devinable. | Modifier reste visible au survol, le reste passe dans un menu `⋯` (§6). |
| B6 | `Revolut Duo` n'affiche **aucun solde** là où les autres affichent un montant. | Cas limite à traiter : afficher `0,00 €`, jamais rien. |

---

## 2. Structure de page

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Comptes & enveloppes                       [+ Enveloppe]  [+ Compte]       │
├────────────────────────────────────────────────────────────────────────────┤
│  10 552,07 €      Courant        Épargne         Investissement            │
│  Patrimoine total  910,97 €       8 560,88 €      1 080,22 €               │
│  septembre 2026                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                        enveloppes    solde │
│ ─ Comptes courants  4                                              910,97 €│
│   ★ N26 Main                                              —         92,99 €│
│     N26 Facture                                            2       793,64 €│
│        └ N26                              0,00 € / 118,80 €   reste 118,80 €│
│        └ Strava                            0,00 € / 79,99 €    reste 79,99 €│
│     Revolut Duo                                           —          0,00 €│
│     Revolut Main                                          —         24,34 €│
│ ─ Épargne  3                                                     8 560,88 €│
│     …                                                                      │
│ ─ Investissement  2                                              1 080,22 €│
│     Fortuneo PEA                            marché        —        585,13 €│
│     Kraken                                  marché        —        495,09 €│
└────────────────────────────────────────────────────────────────────────────┘
```

- Largeur : `--w-content`, **une seule colonne**, pas de colonne latérale sur cette page (il n'y a
  pas de contenu secondaire à y mettre).
- En-tête de page : titre 20 px / 600 `--c-ink`, sous-titre 13 px `--c-ink-2` sur une ligne. Les deux
  boutons en haut à droite : `+ Compte` primaire, `+ Enveloppe` secondaire. Conserver.
- Le panneau du registre reprend exactement les styles du §5.4 du document principal :
  `--c-surface`, `--r-container`, filet `--c-line`, aucune ombre, en-têtes de colonnes affichés une
  seule fois en haut et sticky.

---

## 3. Bloc patrimoine

Même traitement que la barre de synthèse de la page Mois, pour que les deux pages se ressemblent.

- Une seule valeur en grand : `10 552,07 €`, 28 px / 600 `--c-ink`, étiquette `Patrimoine total` +
  `septembre 2026` en 11 px `--c-ink-3` dessous.
- À droite du filet vertical, **trois sous-totaux par type** en format `étiquette 12 px` +
  `valeur 15 px`, séparés par des filets 1 px `--c-line`. C'est ce qui remplit la largeur, et c'est
  une information réelle : la répartition courant / épargne / investissement.
- Le paragraphe explicatif (« Somme des comptes inclus, au solde du mois en cours… ») devient
  l'infobulle de l'étiquette `Patrimoine total`, qui reçoit un soulignement pointillé. Il ne
  s'affiche plus en permanence.
- Le bloc n'est **pas** sticky ici : la page est courte et il n'y a pas de saisie répétée.

---

## 4. Groupes par type — le tag de type disparaît

Regrouper les comptes par type dans trois sections, réutilisant `SectionHeader` :
`Comptes courants`, `Épargne`, `Investissement`. En-tête sticky, compteur de comptes, **sous-total
aligné dans la colonne solde**.

Conséquence directe : **les tags `Courant` / `Épargne` / `Investissement` sont supprimés des lignes.**
Le groupe porte déjà l'information ; la répéter sur chaque ligne est du bruit. C'est le meilleur
moyen de tuer l'arc-en-ciel de tags sans perdre d'information.

Il ne reste alors que trois marqueurs, tous justifiés :

| Marqueur | Rendu |
|---|---|
| Compte principal | icône étoile pleine 14 px `--c-ink-2` **avant** le nom, pas un tag rose. Infobulle « Compte principal ». |
| Valorisé au marché | tag `neutral` `marché`, uniquement dans le groupe Investissement. |
| Exclu du patrimoine | tag `neutral` `exclu` + ligne entière en `--c-ink-3`. |

Ordre à l'intérieur d'un groupe : le compte principal en premier, puis par solde décroissant.

---

## 5. Ligne de compte et enveloppes

**Ligne de compte** — grille du §5.4, adaptée :

```css
grid-template-columns:
  20px            /* étoile / marqueur, vide sinon */
  minmax(0, 1fr)  /* nom + tags */
  96px            /* nombre d'enveloppes */
  140px           /* solde */
  32px;           /* actions */
```

- Nom 14 px / 500 `--c-ink`. Hauteur `--h-row`, filet bas `--c-line`.
- Colonne enveloppes : `2` en 13 px `--c-ink-2`, ou `—` en `--c-ink-3` si aucune. **Le texte
  « Aucune enveloppe sur ce compte. » disparaît** (B3).
- Solde 15 px / 500, aligné à droite, tabulaire. `--c-over` si négatif.
- Chevron d'ouverture uniquement si le compte porte des enveloppes.

**Enveloppes (niveau 2)** — traitement identique aux entrées du §5.7 : conteneur
`--c-surface-sunken`, indenté de 28 px, `--r-control`, lignes de 36 px.

```
 Matelas de sécurité              4 756,25 € / 5 500,00 €   86 %
 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░                reste 743,75 €
```

- Montant courant `--c-ink`, cible `--c-ink-3`, `reste` 12 px `--c-ink-3`.
- `ProgressBar variant="goal"` (vert), largeur 200 px, alignée à gauche sous le nom — **pas** pleine
  largeur du conteneur : une barre de 640 px pour représenter un ratio est du remplissage.
- Enveloppe à 0 % : afficher la piste seule, très discrète, jamais une barre grise pleine largeur.
- Le lien `+ enveloppe sur ce compte` sort de la ligne : il devient une entrée du menu `⋯` du compte,
  et une ligne d'ajout discrète en bas du bloc d'enveloppes lorsque le compte en a déjà.

---

## 6. Actions de ligne

Les trois icônes permanentes deviennent :

- **Modifier** (crayon) : visible au survol et au focus clavier, `opacity: 0` par défaut, jamais
  `display: none`.
- **Menu `⋯`** : toujours visible, 28 × 28. Il contient :
  - `Ajouter une enveloppe`
  - `Définir comme compte principal` (masqué si déjà principal)
  - `Inclure dans le patrimoine` / `Exclure du patrimoine` — remplace l'icône « power »
    incompréhensible par un libellé explicite
  - séparateur
  - `Supprimer le compte`, en `--c-over`, avec **dialogue de confirmation** rappelant le nom du
    compte et le nombre d'enveloppes qui seront supprimées. Supprimer un compte d'un clic sur une
    icône poubelle toujours visible est un risque de perte de données.

---

## 7. États vides

- **Aucun compte du tout** : le panneau affiche une seule phrase centrée, 13 px `--c-ink-2` :
  `Aucun compte pour l'instant.` + bouton `Ajouter un compte`. Sans illustration.
- **Groupe vide** (aucun compte d'investissement, par exemple) : la section ne s'affiche pas.
- **Compte sans enveloppe** : rien. Le `—` de la colonne enveloppes suffit.

---

## 8. Micro-copie

| Actuel | Remplacer par |
|---|---|
| `Vos comptes bancaires et vos projets d'épargne` | garder, c'est juste |
| `soldes de 2026-09` | `septembre 2026` |
| `Aucune enveloppe sur ce compte.` | supprimé |
| `+ enveloppe sur ce compte` | `Ajouter une enveloppe` (dans le menu) |
| `585,13 € marché` | `585,13 €` + tag `marché` |
| `★ principal` | étoile seule + infobulle `Compte principal` |
| icône power | `Exclure du patrimoine` / `Inclure dans le patrimoine` |

---

## 9. Responsive

- ≥ 900 px : structure décrite ci-dessus.
- < 900 px : la colonne `enveloppes` disparaît (l'information est portée par le chevron) ; le solde
  reste aligné à droite ; hauteur de ligne `--h-row-touch`.
- < 600 px : les trois sous-totaux du bloc patrimoine passent sous le montant total, sur une ligne
  scrollable horizontalement.

---

## 10. Ordre d'implémentation

1. Remplacer la grille de cartes par le panneau + sections groupées par type (§2, §4) — c'est le
   changement qui règle B1, B2 et A3 d'un coup.
2. Appliquer `RegisterRow` et la grille de colonnes (§5) → règle A4.
3. Supprimer les tags de type, l'étoile en tag, et les messages d'état vide (§4, §7).
4. Migrer les barres vers `ProgressBar variant="goal"` (§5) → règle A1.
5. Bloc patrimoine avec répartition par type (§3).
6. Menu d'actions `⋯` + confirmation de suppression (§6).
7. Micro-copie (§8) et responsive (§9).

### Recette

- [ ] Aucun violet sur cette page en dehors des boutons, liens et de l'onglet actif.
- [ ] Tous les soldes alignés sur une même colonne, y compris les sous-totaux de groupe.
- [ ] Aucune ombre portée sur les blocs de contenu.
- [ ] Aucune occurrence du mot « Aucune enveloppe » à l'écran.
- [ ] La suppression d'un compte demande confirmation.
- [ ] Un compte sans solde affiche `0,00 €`, jamais une case vide.
- [ ] La page passe le même contrôle de contraste et de focus clavier que la page Mois.
