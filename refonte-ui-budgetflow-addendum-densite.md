# Addendum — Densité et occupation de l'espace

Complément à `refonte-ui-budgetflow.md`, après première implémentation. La refonte structurelle est
en place ; le problème restant est que l'écran affiche trop peu d'information pour sa surface.

**Principe directeur : ne rien ajouter de décoratif.** Chaque élément ajouté ici doit répondre à une
question que l'utilisateur se pose vraiment. Si un bloc n'a rien à dire, il ne s'affiche pas — une
page légitimement courte vaut mieux qu'une page remplie de vide habillé.

Classé par rapport gain / effort. Faire dans l'ordre.

---

## 1. Corriger la règle de repli par défaut — *correction du document initial*

La règle précédente (« replier les sections dont le réel est à 0 ») est fausse : en début de mois,
tout est à 0, donc tout se replie et l'écran est vide. C'est exactement ce qui se passe sur la
capture actuelle.

**Nouvelle règle :**

```
section.lignes.length === 0        → repliée (état vide, une seule ligne)
section.prévu > 0 || lignes > 0    → dépliée par défaut
```

Persister l'état d'ouverture par section dans `localStorage`, clé `budgetflow.sections.open`, pour
que le choix manuel de l'utilisateur survive au rechargement et prime sur la règle par défaut.

Gain immédiat : les sections `Logement & factures` (7 lignes), `Abonnements` (8), `Revenus` (1),
`Chat` (1) s'ouvrent → environ 17 lignes de plus, soit ~700 px de contenu utile. À elle seule, cette
correction règle l'essentiel du problème.

---

## 2. Occuper le vide horizontal des en-têtes de section

Entre le libellé (`Revenus`) et la colonne `prévu`, il y a ~500 px de vide sur chaque en-tête. C'est
la zone la plus visiblement creuse de l'écran.

Y placer, dans la colonne flexible, deux éléments alignés à gauche après le titre :

```
 ●  Logement & factures  7    3/7 pointées   ▓▓▓▓▓▓░░░░░░░░░░░░░  388,29 €   127,88 €   ⌄
```

- **Compteur de pointage** `3/7 pointées`, 12 px `--c-ink-3`. Répond à « où j'en suis dans ma
  saisie ». Masqué si la section n'a aucune ligne pointable.
- **Barre de progression inline**, largeur fixe 160 px, hauteur 4 px, `--r-pill`, alignée
  verticalement au centre, marge gauche `auto` pour la coller à la colonne `prévu`. Elle remplace la
  barre pleine largeur collée sous l'en-tête : plus discrète, et elle occupe le vide au lieu de
  créer une ligne supplémentaire.
- Toujours masquée si `prévu === 0` (règle A5 inchangée).

Sur les sections **repliées uniquement**, ajouter à la suite du titre un aperçu du contenu en 12 px
`--c-ink-3`, tronqué à une ligne :

```
 ●  Abonnements  8    Netflix, Spotify, iCloud, Strava +4        156,99 €   0,00 €   ⌄
```

Trois libellés maximum puis `+N`. Séparateur : virgule, pas de point médian.

---

## 3. Clore le registre par une ligne de totaux

Un registre se termine toujours par un total. Actuellement le panneau s'arrête sur `Operations 0,00 €`,
ce qui donne une impression d'inachevé.

Ajouter en dernière ligne du panneau, `position: sticky; bottom: 0`, fond `--c-surface-sunken`,
filet haut `--c-line-strong`, hauteur 44 px, mêmes colonnes que le reste :

```
    Total du mois                                   3 013,28 €   30,00 €
                                                    reste 2 983,28 €
```

Montants en 15 px / 600 ; la mention `reste` en 12 px `--c-ink-3` sous la colonne `réel`.

---

## 4. Ajouter le chiffre qui manque : le reste à vivre

C'est le nombre qu'on cherche réellement dans une app de budget, et il n'est nulle part.

```
reste_à_vivre = solde_actuel − Σ(lignes prévues non pointées, hors revenus)
```

Le placer dans la barre de synthèse, en **quatrième indicateur**, avec le même traitement que
`Fin de mois` :

```
 62,99 €        Fin de mois     Reste à vivre    Épargne du mois
 Solde N26 Main  1 667,85 €      -2 950,29 €      0,00 € sur 967,20 €
                                                  ▓▓▓░░░░░
```

Couleur : `--c-ink` si positif, `--c-over` si négatif. Tooltip sur l'étiquette : « Ce qu'il reste
une fois toutes les dépenses prévues du mois honorées. »

Ça remplit aussi le vide de la barre de synthèse, qui n'utilise actuellement que sa moitié gauche.

---

## 5. Bloc « À faire ce mois », au-dessus du registre

Le bloc à plus forte valeur d'usage, et celui qui justifie le mieux l'espace. Il liste les lignes qui
demandent une action, toutes catégories confondues :

- échéance dépassée et non pointée ;
- ligne marquée `à envoyer` (le loyer de Marion, 146,57 €) ;
- échéance dans les 7 jours.

Rendu : même panneau que le registre, `--r-container`, en-tête `À faire ce mois` + compteur, 3 à 6
lignes maximum réutilisant `RegisterRow` tel quel, plus un lien `Voir tout` si dépassement. Barre
verticale gauche `--c-over` sur les lignes en retard, `--c-warn` sur les échéances proches.

**Si la liste est vide, le bloc ne s'affiche pas du tout.** Pas d'état vide illustré, pas de « tout
est à jour 🎉 ».

---

## 6. Répartition du mois — une seule barre, pleine largeur

Sous la barre de synthèse, une barre empilée unique de 10 px de haut, `--r-pill`, découpée par
catégorie au prorata du **prévu**, en réutilisant les points de couleur de catégorie déjà présents
(désaturés à 65 % comme prévu au §5.5).

Sous la barre, une légende sur une ligne : pastille + nom + montant, éléments espacés de 16 px,
scrollable horizontalement en dessous de 900 px. Au survol d'un segment, mise en évidence du segment
et de son entrée de légende ; au clic, scroll vers la section correspondante.

C'est le seul élément purement graphique de la refonte : il exploite la largeur, il donne une lecture
que le registre ne donne pas (les poids relatifs), et il tient en 40 px de haut. Ne pas le doubler
d'un camembert ni d'un second graphique.

---

## 7. Élargir la mise en page sur grand écran

Sur 1920 px, le conteneur fait ~1190 px : 730 px de marges perdues, pendant que la colonne latérale
tronque `MSCI world, ASIE, C...`. Déséquilibre à corriger.

```css
:root { --w-content: 1240px; --w-aside: 340px; }

@media (min-width: 1600px) {
  :root { --w-content: 1440px; --w-aside: 380px; }
}
```

Ne pas aller au-delà de 1440 px : les libellés de ligne deviendraient trop éloignés de leurs
montants, ce qui annulerait le gain d'alignement obtenu au point A2.

---

## 8. Enrichir la colonne latérale

Elle s'arrête à mi-hauteur. Deux ajouts, dans cet ordre :

**a. Comparaison au mois précédent**, panneau `Écart vs août`, une ligne par catégorie ayant un
écart significatif (> 10 % ou > 20 €), triées par écart décroissant, 5 lignes maximum :

```
 Abonnements        +12,99 €
 Alimentation       −48,20 €
```

Signe et couleur : `--c-over` pour une hausse de dépense, `--c-credit` pour une baisse. Attention à
l'inversion pour la catégorie `Revenus`.

**b. Échéances à venir**, panneau listant les 5 prochaines dates avec montant, format `12 sept. ·
Loyer · 146,57 €`. Ne pas construire un calendrier mensuel complet : la liste suffit et coûte dix
fois moins cher.

---

## 9. Ce qu'il ne faut pas faire pour combler

- Augmenter les paddings ou la hauteur de ligne : ça déplace le vide, ça ne le remplit pas, et ça
  dégrade la densité durement gagnée.
- Ajouter des cartes de statistiques décoratives (« moyenne journalière », « jours restants ») que
  personne ne consulte.
- Ajouter un graphique en camembert, un compteur animé, ou une illustration d'état vide.
- Étirer le panneau du registre à la hauteur du viewport avec `min-height: 100vh` : un panneau à
  moitié vide est pire qu'un panneau court.
- Centrer verticalement le contenu dans la page.

---

## Ordre d'implémentation

1. Correction de la règle de repli (§1) — puis **réévaluer visuellement** : ce point seul peut suffire.
2. Ligne de totaux (§3) et reste à vivre (§4) — peu de code, forte valeur.
3. En-têtes de section enrichis (§2).
4. Bloc « À faire ce mois » (§5).
5. Élargissement grand écran (§7).
6. Répartition du mois (§6).
7. Panneaux latéraux supplémentaires (§8).

Après l'étape 4, refaire une capture et juger : il est probable qu'il n'y ait plus de vide à combler
et que les étapes 6 et 8 deviennent superflues.
