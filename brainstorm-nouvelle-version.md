# Nouvelle version — brainstorm et décisions

Projet distinct, fortement inspiré de BudgetFlow, pensé pour être configurable par un utilisateur quelconque (pas de distribution grand public, mais une architecture propre et sans spécificités en dur).

Dernière mise à jour : 31/08/2026.

---

## Principes de cadre (validés)

1. **Données génériques, spécificités en configuration.** Le noyau ne connaît que : comptes, catégories, thèmes, lignes, entrées, mois. Tout le reste (EDF, loyer, abonnements…) est un module optionnel ou une donnée créée par l'utilisateur. Aucun libellé en dur dans le code (leçon des migrations v3 qui cherchaient des noms de thèmes).
2. **Pas de formules libres.** Deux briques génériques couvrent les besoins : un *calculateur* (paramètres + relevés + formule arithmétique locale) et un module *partage* (règles, pas formule). Le reste passe par une ligne manuelle.
3. **Calcul côté backend.** Bilan, soldes live, partage, stats = endpoints (`/sheets/:id/summary`, `/stats/...`). Une seule vérité, testable sans UI, plus de N×5 requêtes dans les stats.
4. **Ce qui n'est pas configuré n'est pas affiché.** 0 thème → pas de champ thème ni de graphe par thème. Pas d'enveloppe → pas de bloc épargne. Idem pour chaque module.
5. **Le modèle absorbe la complexité, l'interface la cache derrière des défauts intelligents** (enveloppe auto à la création d'un compte épargne, compte principal auto-coché en mono-compte, presets de catégories…).

---

## Décisions validées par fonctionnalité

### 1. Comptes

- Un compte = nom + **type** (courant / épargne / investissement / espèces) + **compte principal** (case à cocher, un seul) + **inclus dans le patrimoine** (oui/non).
- Le type est **purement informatif** (icône, regroupement, défauts d'affichage). **Aucun calcul ne dépend du type de compte.**
- Le compte principal remplace `AppSettings.mainAccount` ; il sert de valeur par défaut « depuis quel compte » à la saisie. En mono-compte, coché automatiquement, jamais demandé.
- `trackInSavingsChart` supprimé : le graphe épargne montre les comptes épargne/investissement, avec masquage de courbe dans le graphe.
- Solde de début de mois par compte (snapshot) conservé comme **recalage mensuel**, pré-rempli depuis le solde live du mois précédent. L'écart saisi (arrondis bancaires, intérêts, mouvements hors app) est affiché (« +12,37 € non expliqués ») et, pour un compte 1:1 avec son enveloppe, alimente l'enveloppe.

### 2. Enveloppes (ex-objectifs d'épargne)

- **L'épargne est une propriété du mouvement, pas du compte.** Compte comme « mis de côté » : contribution à une enveloppe, versement sur un actif d'investissement, ligne d'une catégorie de type épargne.
- **L'enveloppe est l'unité d'épargne, le compte n'est que son emplacement physique.**

| Situation | Fonctionnement |
|---|---|
| Un seul compte bancaire | Épargne gérée avec des enveloppes virtuelles |
| Plusieurs comptes | Transferts réels entre comptes |
| Livret consacré à un seul objectif | Enveloppe liée au livret |
| Un compte contenant plusieurs projets | Plusieurs enveloppes sur le même compte |

- Enveloppe = nom + montant cible (optionnel) + échéance (optionnelle) + compte hôte (optionnel).
- **Montant d'une enveloppe = somme de ses contributions.** Une seule règle, y compris pour un livret dédié. Le solde du compte sert de contrôle : bouton **recaler** qui crée une contribution d'ajustement tracée (intérêts / recalage). Pas de mode « enveloppe = solde du compte ».
- Contribution = mouvement vers/depuis une enveloppe. Si compte hôte ≠ compte source → transfert réel entre comptes en plus ; sinon purement virtuel.
- **Disponible d'un compte = solde − somme des enveloppes hébergées.** C'est le chiffre à mettre en avant. Vue compte : solde = enveloppe A + enveloppe B + non affecté.
- Plusieurs enveloppes sur un même compte : possible (impossible dans BudgetFlow, qui prend le solde du compte).
- Réaffectation entre enveloppes du même compte (−/+ sans mouvement bancaire), clôture d'enveloppe avec historique conservé.
- **UX sans double saisie** : création d'un compte épargne → enveloppe du même nom créée d'office avec le solde initial en première contribution (case « ce compte sert à plusieurs projets » pour désactiver) ; création d'enveloppe → compte hôte optionnel, créable en ligne ; renommage synchronisé quand 1:1.

### 3. Catégories et thèmes

- **Deux niveaux conservés** (le thème est un axe transversal aux catégories, indispensable pour les courbes d'évolution par thème).
- **Catégorie** = bloc du sheet. Nom libre, nombre libre, presets au premier lancement. Porte un **type** qui pilote les calculs : dépense / revenu / épargne / **transfert** (bouge les soldes, exclu des stats de dépenses — ex. virement vers livret, remboursement).
- **Thème** = liste plate gérée (nom + couleur), 0 à N, posé sur la ligne (défaut) et surchargeable par entrée. Sert à l'analyse.
- Supprimés : `Theme.section`, `Theme.role: rent_base` (le module partage désigne sa ligne cible lui-même), `Theme.isSharedDefault` (le ½ par défaut vit sur la ligne du template).
- Outils : **création de thème à la volée** à la saisie (couleur auto), **fusion** de thèmes avec réaffectation des entrées, **garde-fou à la suppression** (« utilisé par 47 entrées, fusionner plutôt ? »). La fusion est un outil, jamais imposé (Prévision EDF et Prévision EAU restent distincts).
- Le calculateur (ex-EDF) pourra rattacher sa régularisation à son propre thème → distinction mensualité / régularisation sans intervention manuelle.
- Thèmes = **dépenses uniquement** (pas sur les contributions ni les versements d'investissement) — accepté par défaut, à confirmer explicitement si besoin.
- Stats : un thème = une courbe, multi-sélection, vue « top thèmes du mois » (plutôt que masquer 30 pastilles).

### 4. Template et mois

- Template unique, lignes dupliquées à la création du mois avec traçabilité (`templateLine`).
- **Création du mois en un clic**, soldes pré-remplis depuis le solde live du mois précédent, corrigés par l'utilisateur.
- Statut réduit à **ouvert / clôturé** (brouillon supprimé, plus de flag « actif » : le mois courant est celui du calendrier). La clôture verrouille les saisies et fige les soldes de fin.
- Ajout d'une ligne au template → proposition **« appliquer aussi au mois en cours ? »**.
- Montant prévu modifiable localement dans un mois, avec bouton **« reporter dans le template »**.

### 5. Lignes et entrées

- Conservé : ligne = enveloppe budgétaire du mois (prévu / réel), entrées multiples par ligne (date, montant, détails, compte, moyen de paiement, thème, ½), clic sur « Réel » d'une ligne vide = ajout direct.
- **Réel calculé** (somme des entrées à la lecture, côté backend), plus de compteur `$inc`.
- **Plus de fixe / variable** (révisé le 01/09/2026 après test en conditions réelles : la distinction induisait en erreur — une ligne d'épargne ressemblait à une facture sans que l'utilisateur sache pourquoi). Règle unique :
  - une ligne a un **prévu** et un **réel** (somme des entrées) ; **le réel remplace le prévu dès qu'il existe**, à l'affichage comme dans le projeté ;
  - **☐ payé** sur toute ligne qui a un prévu et aucune entrée (héritée du template ou ajoutée au mois avec un prévu) : cocher crée l'entrée au prévu, datée du *jour du mois* de la ligne sinon d'aujourd'hui ; décocher ne retire que cette entrée-là ;
  - **ajout d'une ligne au mois : Prévu + Montant**. Montant rempli → entrée créée immédiatement (ligne « déjà passée »). Prévu seul → ligne à cocher plus tard (« la semaine prochaine on me rend 100 € », « je vais au ciné »). Une seule saisie dans les deux cas ;
  - conséquence assumée : plus de notion de plafond pour les lignes à entrées multiples (Courses 300 € compte 40 € dès la première course). Un « plafond » optionnel par ligne pourra être ajouté si le besoin se confirme.
- Jour du mois conservé (date par défaut du « payé », future vue « échéances »). Affiché « le 3 » tant que la ligne n'est pas payée.
- **Ajout rapide global** : bouton « + dépense » toujours accessible (raccourci clavier), montant + ligne, défauts de la ligne appliqués.

### 6. Bilan et soldes live

- **Trois chiffres en tête** :
  - **Disponible aujourd'hui** = solde live du compte principal − enveloppes hébergées dessus.
  - **Projeté fin de mois** = solde actuel + revenus prévus non encaissés − sorties prévues non réalisées (règle « le réel remplace le prévu » : seules les lignes sans entrée comptent pour leur prévu, le réel est déjà dans le solde). Répond à « est-ce que je peux me le permettre ? ».
  - La tuile 1 s'appelle **« Solde actuel — <compte principal> »** (« Disponible » induisait en erreur), avec « enveloppes déduites » quand il y en a.
  - **Mis de côté ce mois** = contributions + investissements + lignes de catégorie épargne, comparé à l'objectif en % du revenu.
- **Objectif d'épargne en % du revenu du mois uniquement.** La formule BudgetFlow `(revenu + solde initial) × taux` est un bug confirmé : le solde de début de mois ne doit pas entrer dans la base.
- Répartition du revenu (anneaux) conservée : catégories + enveloppes + investissements, référence = max(revenu réel, revenu prévu).
- Soldes par compte : début → actuel → projeté fin de mois, avec « non affecté » pour les comptes hébergeant des enveloppes.
- Tout calculé par `GET /months/:id/summary` ; le front n'additionne rien.

### 7. Investissements

- **Actif** = nom + type (liste configurable) + compte hôte (type investissement) + DCA mensuel optionnel (alimente le prévu des anneaux).
- **Versement** = montant + date + **compte source** (défaut compte principal, modifiable).
- **Valeur actuelle avec historique** : chaque saisie est horodatée → courbe investi vs valeur dans les stats. Saisie manuelle uniquement, pas d'API de cours.
- **Retrait = transfert**, pas un bouton. Un transfert *depuis* un compte investissement vers un autre compte, avec l'actif indiqué, est un retrait ; un transfert *vers* est un versement (le versement depuis le sheet n'est qu'un raccourci).
- **Trois compteurs par actif : investi, retiré, valeur.** Performance = (valeur + retiré − investi) / investi. Un retrait de 100 € sur 1 000 € investis ne change pas le pourcentage. Jamais de « investi négatif ».
- Plus-value en € et % au niveau actif, compte et global.
- Actif et enveloppe restent deux objets distincts (la valeur fluctue pour l'un, pas l'autre), mais partagent le bloc « Épargne & investissements » du sheet et la logique de disponible (solde d'un compte investissement = somme des actifs hébergés).
- **Bouton « ☐ versé » (DCA) dans le sheet du mois**, même mécanique que « ☐ payé » des lignes fixes. Pas de bouton d'action dans l'onglet Investissements, qui reste une vue de suivi. Règle : on agit dans le mois, on consulte dans les onglets.

### 8. Calculateurs (généralisation d'EDF)

Objet défini par l'utilisateur en trois blocs, dans l'esprit des formules Notion mais à périmètre fermé :

- **Paramètres** (constants, modifiables dans les paramètres) : symbole + valeur + unité. Ex. `prixHP = 0,27 €/kWh`, `abo = 12,50 €`, `tva = 20 %`.
- **Relevés** (saisis chaque mois dans le sheet) : symbole + type. Type **index** = compteur cumulatif, valeur du mois = actuel − précédent, précédent pré-rempli depuis le mois d'avant. Type **valeur** = saisie directe.
- **Formule** : expression arithmétique sur ces seuls symboles (+ − × ÷, parenthèses, nombres). Pas de fonctions en v1 (`min`/`max`/`round` ajoutables si besoin réel). Pas d'accès aux données du budget — volontairement.
- Éditeur : pastilles cliquables pour insérer un symbole, résultat en direct sur le dernier mois saisi, erreurs lisibles (« symbole inconnu »).
- **Rattachement optionnel** à une ligne du template → le sheet montre *estimé / mensualité / écart* et un bouton **« créer la régularisation »** qui ajoute l'écart en entrée sur une ligne au choix, avec un thème dédié et le ½ si partagé.
- Exemples couverts : EDF (HP/HC), essence (odomètre × conso × prix), eau (m³), garde d'enfant à l'heure…
- **Mensuel uniquement en v1** : un relevé bimestriel se laisse vide un mois sur deux.
- Implémentation : évaluateur arithmétique côté backend (~100 lignes), aucun `eval`, testé unitairement.

Vue sheet (bloc « Calculateurs ») :

| Calculateur | Relevés du mois | Consommation | Estimé | Mensualité | Écart | Action |
|---|---|---|---|---|---|---|
| EDF | HP : 48 210 → **48 492** · HC : 31 004 → **31 243** | 282 kWh HP · 239 kWh HC | **86,30 €** | 58,00 € | **+28,30 €** | Créer la régularisation |
| Essence | km : 84 120 → **85 010** | 890 km | **107,03 €** | 120,00 € | −12,97 € | — |
| Eau | m³ : 1 204 → **1 211** | 7 m³ | **36,70 €** | — | — | — |

### 9. Cagnottes (partage — révisé le 01/09/2026, « une sorte de Lydia »)

Première version (module global dans les Paramètres : partenaire, « paie directement », ligne cible) jugée confuse à l'usage — deux endroits pour une idée. Remplacée par : **une cagnotte EST une ligne du budget**.

- Une ligne peut être marquée **Cagnotte**, dans le template (présente chaque mois, ex. « Loyer — Marion ») ou ajoutée dans un mois (ex. « Vacances — Tom »). Elle porte : **partenaire**, **ce qu'il/elle a payé** (une valeur, modifiable dans le mois), **ma part en %**.
- Les entrées marquées **½** s'y rattachent. Une seule cagnotte dans le mois → rattachement implicite ; plusieurs → un select « quelle cagnotte ? » apparaît à côté du ½ (défaut : celle du template / la première).
- **Le prévu de la cagnotte est calculé, jamais saisi** : à envoyer = (Σ mes ½ rattachés + payé par le partenaire) × ma part − Σ mes ½. Les lignes ½ sans entrée comptent pour leur prévu (même règle que le projeté). Négatif = le partenaire me doit.
- Affichage sur la ligne : « à envoyer à Marion **70 €** » / « Tom vous doit 40 € » / « équilibré », détail dépliable (payé par moi, payé par l'autre, total, ma part). **☐ payé** enregistre le virement au montant calculé (entrée négative si c'est une rentrée). Le projeté compte le « à envoyer » tant que ce n'est pas payé.
- Aucune cagnotte → aucun ½ nulle part (Template, mois, entrées). Le bouton « Cagnotte » du formulaire de ligne est le seul point d'entrée.
- v1 : un partenaire par cagnotte (part ajustable : 33 % à trois), pas de dette cumulée entre mois. Le cas d'Evan : ligne « Loyer — Marion » dans Virements, Marion paie 630, part 50 %, ses factures communes en ½.
- Plus de réglages Partage dans `app_settings` (table reconstruite en migration 009).

### 10. Abonnements

- **Un abonnement = une ligne fixe du template marquée « abonnement »**, pas un objet à part. Le marquage débloque : périodicité (hebdo / mensuel / annuel), jour de prélèvement, prix effort. Plus de doublon Netflix.
- L'onglet Abonnements est une **vue** : la liste et les totaux théoriques (coût mensuel lissé, annuel, scénario d'économies) viennent du template ; les faits (payé, montant réel, utilisations) viennent des mois.

| | Template | Sheet du mois |
|---|---|---|
| Définit | nom, prix, périodicité, jour, prix effort, partagé | ☐ payé, montant réel, utilisations |
| Répond à | coût annuel, économies si effort | prélevé ?, utilisé combien de fois ? |

- **Périodicité non mensuelle** : un abonnement annuel n'apparaît dans le sheet que le mois du prélèvement (lissé dans les totaux de l'onglet) ; hebdo = 4 ou 5 occurrences selon le mois.
- **Dépense ponctuelle rangée dans la catégorie Abonnements** (ex. Canva un mois) : ligne ajoutée au mois, sans `templateLine` → compte dans le réel du mois et les stats, **pas** dans la liste ni le coût annuel. Pas de case « ponctuel » : la distinction est *template vs mois*. « Reporter dans le template » si ça devient permanent.
- **Check-in d'usage** (optionnel par abonnement) : compteur d'utilisations dans le mois → coût par utilisation, signal « 8,99 € pour 1 utilisation ». À l'échéance annuelle, le sheet demande « se renouvelle ce mois — garder ? » avec l'historique d'usage.
- Prix effort / scénario d'économies conservés. Un abonnement partagé hérite du flag de la ligne.

### 11. Stats

Tout servi par `GET /stats/...` (agrégations backend), plus de rechargement de tous les sheets côté front.

- **Évolution par thème** (conservé, graphe principal) : multi-sélection, « top 5 du mois » par défaut, même vue par catégorie.
- **Moyenne mensuelle lissée par thème** (nouveau, demandé) : tableau sur une période choisie (6 / 12 mois / tout) — moyenne/mois, total, min–max, part des dépenses. Les mois à zéro comptent (annuel 70 € → 5,83 €/mois). Option « mois clôturés uniquement ». Même tableau par catégorie.
- **Revenus / dépenses / épargne par mois** : barres empilées + taux d'épargne réel en courbe.
- **Épargne & investissements** : alimenté par les enveloppes (contributions cumulées, cible en pointillé) et les actifs (investi vs valeur via l'historique de valorisation).
- **Patrimoine** : total des comptes inclus, mois par mois, depuis les soldes de début de mois.
- **Supprimé** : le comparatif 3 mois vs 3 mois (non utilisé). Pourra revenir plus tard sous une forme plus générale (évolution de l'épargne ou des dépenses).
- **Plus tard, non structurant** : dérives prévu vs réel par ligne (« Courses : 5 mois sur 6 au-dessus du plafond ») → suggestion d'ajuster le template.
- Exclusions : catégories *transfert* hors dépenses ; régularisations de calculateurs incluses (vraie dépense) ; contributions et versements dans « épargne », pas dans « dépenses ».

### 12. Transverse

- **Stack : Vue 3 + Tauri 2 + sidecar Node/Express + SQLite** (`node:sqlite`, intégré à Node ≥ 22.13, pas de module natif à compiler avec pkg). Seul changement structurel par rapport à BudgetFlow : Mongoose → SQLite. Workflow de dev inchangé (`npm run dev` + backend Node, puis `tauri build`).
- **Migrations : fichiers SQL numérotés maison** (`backend/db/migrations/NNN-*.sql`, table `_migrations`, appliqués au démarrage) — Drizzle écarté au démarrage du dev (adaptateur `node:sqlite` incertain, une dépendance de moins pour pkg). Montants en **centimes (INTEGER)** en base, euros dans l'API.
- Ports de dev : backend **3003**, frontend **5174** (pas de collision avec l'app installée 3001 ni l'ancien front 5173).
- Livrable : **un seul installeur NSIS**, sans Mongo. Base = fichier `budget.db` dans `%APPDATA%`, sauvegarde = copie du fichier.
- **Sidecar orphelin** : kill explicite du sidecar à la fermeture de la fenêtre + arrêt automatique du backend sans heartbeat du front pendant 30 s.
- **Devise unique**, pas de conversion.
- **Données : on part vide** (nécessaire pour créer comptes, enveloppes, catégories proprement). Un script d'import depuis la base Mongo de BudgetFlow sera écrit pendant ou après le dev pour vérifier qu'on retombe sur les mêmes chiffres (invariants connus : solde N26 Voyage 3 711,92 €, BTC investi 499 €…).
- Onboarding minimal : premier lancement = créer un compte + presets de catégories/thèmes (ou vide).
- Export / import JSON complet de la base.
- Import/backfill : couvert par « créer un mois à n'importe quelle date » + ajout rapide, pas de module dédié.

---

## Organisation du projet

- La nouvelle app s'appelle simplement **« budgetflow »** et vit **dans ce repo**, à côté de `backend_budgetflow/` et `frontend_budgetflow/`.
- `backend_budgetflow/` (et l'app installée qui tourne dessus) **restent intacts tant que le dev n'est pas terminé et validé**. Suppression uniquement après validation complète, décision d'Evan.
- Prochaine étape : démarrer le squelette (structure, schéma SQLite, premier écran comptes) à partir de ce document.

## Questions ouvertes

- Thèmes sur l'épargne : confirmé « non » par défaut.
- Point 6 des stats (dérives prévu vs réel par ligne) : plus tard.
