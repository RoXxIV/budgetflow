# Revue du 04/09/2026 — rapport complet

Grosse passe de revue (2 audits exhaustifs backend + frontend, puis corrections vérifiées une à une).
Résultat : **2 commits** (`2dfa1bd` backend, `bbdaeb4` frontend), **83 tests verts** (74 → 83) +
`review.mjs` **85/85**, build OK, les 6 pages vérifiées en headless sans erreur console.
Tout ce qui n'a pas été corrigé est listé en bas, classé « à faire » ou « à trancher ».

---

## 1. Corrigé — backend (`2dfa1bd`)

### Garde-fous (des vraies portes dérobées)
- **Appartenance ligne ↔ mois** : `PUT/DELETE /months/:id/lines/:lineId` vérifiait que le mois de
  l'*URL* était ouvert, jamais que la ligne lui appartenait → en passant l'id d'un mois ouvert, on
  modifiait une ligne d'un **mois clôturé** (ou du template). Garde `assertInMonth` ajoutée.
- **Date d'entrée** : une entrée saisie dans un mois ouvert pouvait être **datée dans un mois
  clôturé** (et sa contribution d'enveloppe dérivée avec) → refusé désormais (création et édition).
- **Valorisations d'actifs** : aucune vérification de clôture (les mouvements l'avaient) → alignées.
- **Suppression d'un mois clôturé** : passait sans broncher alors que la moindre entrée y est
  verrouillée → refusée (rouvrir d'abord).
- **Compte principal désactivé** : `isMain: true` sur un compte désactivé cassait l'invariant
  « exactement un principal visible » (bilan sans disponible, périmètre élargi à tout) → refusé.
- **GET qui écrivait** : consulter les calculateurs d'un mois clôturé *créait* des lignes de relevés →
  le GET renvoie des lignes virtuelles sans rien écrire.
- **Champs client interdits** : les routes n'acceptent plus `source`/`relatedLineId` d'une entrée ni
  `kind` d'une contribution — trois moyens de fausser les stats, le dépointage ou de sauter le
  contrôle du disponible.

### Transactions (multi-écritures atomiques)
`pay` (jusqu'à 3 entrées + échéance d'enveloppe), `unpay`, suppression d'entrée, fusion de thèmes,
désactivation de compte (virement + flag), suppression/mensualisation de ligne : un échec au milieu
ne laisse plus un état à moitié écrit (ex. dépense réelle enregistrée sans le virement qui vide
l'enveloppe).

### Cohérences
- **Mensualiser propage** l'enveloppe liée aux copies des mois **ouverts** (la désactivation le
  faisait, l'activation non : les mois déjà créés restaient démensualisés).
- **« le 31 » en février** : `nextDueDate` fabriquait `2026-02-31` → mensualité suggérée NaN,
  silencieusement absente du Reste à vivre. Jour borné au dernier jour du mois cible.
- **Cagnotte en catégorie transfert** : son prévu calculé était compté en dépense prévue dans les
  stats, contrairement à la règle des transferts → filtré par le type de sa catégorie.
- **Usage des thèmes** : les calculateurs référencent un thème mais n'étaient pas comptés — un thème
  « inutilisé » se supprimait en débranchant un calculateur en silence. Comptés partout (liste,
  suppression, page Paramètres).
- **`review.mjs`** ne bindait pas le summary des comptes : le garde « solde à virer avant
  désactivation » y était muet. Corrigé (+ un check « valeur vivante »).

### Tests ajoutés (9)
Appartenance ligne-mois · date en mois clôturé · suppression de mois clôturé · valorisations vs
clôture · principal désactivé · propagation de mensualisation · clamp du 31 février · cagnotte
transfert hors dépenses prévues · thème porté par un calculateur.

---

## 2. Corrigé — frontend (`bbdaeb4`)

### Bugs
- **Stats décalées d'un mois** (le plus grave) : dès qu'un mois futur existait (créé en avance),
  l'exclusion du mois en cours faisait un *trou au milieu* de la liste, mais la découpe des séries
  restait une tranche contiguë → **toute la page affichait les valeurs d'un mois sous le label d'un
  autre**. Découpe par index de période désormais.
- La case ☐ d'une cagnotte s'affichait même sans calcul reçu (pointage sur du vide possible).
- Panneaux dépliés (contributions d'enveloppes, mouvements d'actifs) : les données de l'élément
  **précédent** restaient visibles pendant le chargement — avec leur × cliquable sur la mauvaise cible.
- Sélecteur de mois et « mois suivant » sans garde (TypeError possible après suppression d'un mois).
- Tri des catégories du Template : NaN sur un type inconnu (ordre incohérent avec la page Mois).
- « +X € ce mois » d'une enveloppe restait **vert** même négatif (réaffectation sortante).
- Objectif d'épargne : taper du texte l'enregistrait à **0 % en silence** → saisie invalide ignorée.
- L'onglet « A–Z » des thèmes ne triait pas (il dépendait de l'ordre du backend).
- Valorisation groupée : un échec au 3ᵉ actif re-postait les 2 premières au clic suivant.
- Panne API sur l'historique d'évolution → affichait « il faut 3 valorisations » (faux) ; message dédié.
- Chargements initiaux des 4 pages sans `try/catch` : backend éteint = **page blanche muette**
  (seul Comptes savait le dire). Toast d'erreur partout désormais.
- Timers non nettoyés au démontage (3 pages).

### Mode discret étanche
~15 montants échappaient au floutage (pas de classe `.num`) — dont les plus sensibles : **solde à
virer** avant désactivation, **disponible hors enveloppes**, contenu d'enveloppe à clôturer, modale
« enveloppe insuffisante », phrase d'objectif d'épargne, infobulle du graphique d'évolution. Tous
couverts. L'infobulle de LineChart passe aussi au format `eur()` commun (espaces fines), et le `%`
d'Investissements a son espace fine partout.

### Code mort supprimé
`DonutChart.vue` et `AppIcon.vue` (fichiers entiers, jamais importés — DonutChart était en prime le
dernier fichier incompatible thème sombre) · 5 icônes Phosphor jamais posées · 8 exports d'API sans
consommateur (`getMonth`, `deleteMonth`, `unpayLine`, `get*Usage` ×3, recalibrage ×2) · 7 membres
morts de MonthView (`amountClass`, `depensePct`, `envelopesPct`, `totalSorties`,
`envelopeTargetLabel`, `mainEnvelopesTotal`, `potById`, `dcaDone`) · 3 blocs CSS orphelins
(`.sec-bar/.sec-fill`, `.badge` ×2, `.link`).

### Divers
Dates des contributions en français (« 4 mars », plus d'ISO à l'écran) · formulaire d'enveloppe
complet à l'édition (`fromEnvelopeId`) · champ invalide en token `--c-over` (dernier utilitaire
rouge en dur) · commentaire du mode discret à jour.

---

## 3. Constaté, pas corrigé — à faire un jour (pas urgent)

- **Virements système datés hors mois** : les entrées système (clôture d'enveloppe, régularisation,
  désactivation) sont datées d'aujourd'hui mais posées dans « le mois ouvert le plus récent » — si ce
  n'est pas le mois calendaire, la date sort de la période du mois.
- **`closeInto` / création d'enveloppe** ne vérifient pas que la *date* de leurs contributions tombe
  dans un mois ouvert (le garde existe sur `addContribution` mais pas sur ces chemins internes).
- **Bilan d'un mois clôturé qui bouge** : `monthlySuggestion` et `nextDue` dépendent d'aujourd'hui →
  le « prévus restants » d'un mois passé évolue avec le calendrier.
- **Patrimoine mixte** : sur un compte hébergeant un actif valorisé et un actif jamais valorisé, la
  part du second disparaît du patrimoine (ni valeur de marché, ni solde).
- **Changer le compte hôte d'un actif** réattribue rétroactivement tous ses mouvements au nouveau
  compte sans virement compensatoire (l'équivalent enveloppe en crée un).
- **Entrée manuelle sur ligne mensualisée** : elle saute le plafond d'enveloppe que ☐ payé impose
  (`ENVELOPE_SHORT`) — voulu ou pas, c'est asymétrique.
- **Stats : comptes désactivés** exclus des courbes de patrimoine — contraire à « rien n'est perdu ».
- **Duplications à résorber côté backend** : `potCalc` (Template) et la phrase d'objectif
  (Paramètres) recalculent en front ce que le backend sait ; l'historique d'Investissements fait
  2×N requêtes reconstruites côté client ; la « valeur vivante » est implémentée deux fois
  (asset.service + summary) ; `desat()` et le bloc CSS `synth-*` recopiés dans 5 vues.
- **Trous de tests restants** (les principaux) : refus de `reallocate`/`closeInto` (5 gardes non
  testées), recalibrage, `applyToTemplate`, gardes des calculateurs, `settings` jamais chargé par
  une suite (objectif d'épargne non asserté).

## 4. À trancher (tes décisions)

1. **Base de l'objectif d'épargne** : l'ancienne app calcule 40 % × (revenus + solde de départ),
   la nouvelle 40 % × revenus. *(question déjà ouverte du rapprochement bancaire)*
2. **Devise** : le réglage EUR/USD/CHF/GBP n'a **aucun effet** (`eur()` est figé fr-FR/EUR).
   Supprimer le réglage, ou rendre le format paramétrable ?
3. **Mode discret et champs de saisie** : le montant inline du Template est flouté aussi — donc
   illisible pendant qu'on le tape. Assumer (on ne budgète pas dans le métro), ou exclure les inputs ?
4. **Soldes inconnus dans les totaux** (page Comptes) : un compte sans solde saisi affiche « — »
   mais compte pour 0 dans le total du groupe et le patrimoine. Total « — » dès qu'un compte est
   inconnu, ou garder 0 ?
5. **Delta mensuel des comptes** : rouge pour toute baisse — un retrait volontaire du Livret est
   marqué comme une alerte. Rouge = baisse, ou rouge = problème ?
6. **Confirmations asymétriques** : le × d'une entrée/contribution/valorisation supprime sans
   confirmer, lignes/comptes/enveloppes confirment. Uniformiser, ou c'est le geste rapide voulu ?
7. **Mois en cours dans Stats** : exclu des graphes, mais navigable dans « Répartition du mois ».
   Exclure partout, ou marquer le mois partiel ?
8. **« Autres » forcé** dans les graphes empilés : agrégat non désactivable des séries non
   sélectionnées. Le laisser, ou permettre de le masquer ?
9. **Enveloppes virtuelles** (page Comptes) : section à part sans total — section de plein droit,
   ou repli sous le compte principal (leur hôte réel) ?
10. **Cinq « restes »** dans l'app (théorique, à vivre, réel, reste de section, reste d'enveloppe) et
    deux « patrimoines » (total vs épargne+invest sur Stats) : vocabulaire à resserrer un jour ?
11. **Total « Enveloppes »** du panneau latéral du Mois : l'en-tête ne compte que les versements
    (mis de côté), les lignes affichent tous les mouvements (réaffectations comprises) — les lignes
    ne totalisent pas l'en-tête. Aligner l'un sur l'autre ?
12. **`projete`** (fin de mois) : toujours calculé et testé côté backend mais plus affiché depuis le
    passage à « Dépenses du mois ». Le réafficher quelque part, ou le retirer ?
