# Journal des builds

Un build produit `src-tauri/target/release/bundle/nsis/BudgetFlow2_<version>_x64-setup.exe`.
Chaque ligne dit **d'où il vient** (le commit) et **ce qu'il change pour la base** — c'est
la seule information qu'on regrette de ne pas avoir le jour où quelque chose cloche.

## Ce qu'il faut savoir avant d'installer

**Installer n'écrase jamais les données en place.** `src-tauri/src/main.rs` ne copie la
seed que si `%APPDATA%\fr.revaw.budgetflow2\budget.db` n'existe pas. Sur une machine où
l'app a déjà tourné, ce bloc est sauté.

**Les migrations manquantes s'appliquent au premier démarrage**, dans l'ordre, chacune
dans sa transaction. Rien à lancer à la main. Une migration qui échoue est annulée et
non inscrite : le serveur refuse de démarrer plutôt que de servir un schéma à moitié
migré.

**Une migration ne se rejoue pas à l'envers.** Revenir à un exe plus ancien ferait
tourner du code sur un schéma plus récent. C'est le seul cas où une copie des trois
fichiers (`budget.db`, `-wal`, `-shm`) sauve la mise — à faire avant chaque installation.

**La seed est vierge depuis le 09/09.** Avant, elle contenait une copie de la base de
dev : donner l'exe revenait à donner ses comptes bancaires avec. Aujourd'hui qui installe
sur une machine neuve démarre sur le guide de bienvenue.

---

## Les versions

`MAJEUR.MINEUR.CORRECTIF`, décidé le 09/09/2026.

| | Quand il bouge |
|---|---|
| **MAJEUR** | la génération d'app. `1` = celle retirée du repo, **`2` = celle-ci** |
| **MINEUR** | une nouvelle fonctionnalité |
| **CORRECTIF** | uniquement des corrections, aucun comportement nouveau |

Le numéro vit à **cinq endroits, qui doivent rester identiques** — `tauri.conf.json` et
`Cargo.toml` (+ `Cargo.lock`) parce que le build les exige, `frontend/package.json` et
`backend/package.json` par cohérence :

```
src-tauri/tauri.conf.json    src-tauri/Cargo.toml    src-tauri/Cargo.lock
frontend/package.json        backend/package.json
```

**Une couture assumée** : les installeurs du 06/09 et du 09/09 portent `1.0.0`, gravé
dans leurs fichiers. On ne réécrit pas l'histoire — le versionnage commence à **2.0.0**,
et le premier exe à le porter sera le prochain.

**Changer le numéro ne touche pas la base.** La copie de la seed est gardée par
`if !db_path.exists()`, qui ne connaît pas la version. Seuls le nom de l'installeur et
l'entrée « Programmes et fonctionnalités » de Windows changent.

Chaque branche de travail porte la version qu'elle produira : `v2.0.1-fix`, `v2.1.0-…`.

---

## Les builds

### 09/09/2026 23:02 — 2.0.1, cinq corrections

Version : **2.0.1** · commit : `79a1f63` · migrations : **23** · seed : **vierge**

**Le premier installeur qui porte un vrai numéro de version**, et le premier à en
remplacer un autre dans « Programmes et fonctionnalités » (la 1.0.0).

**Aucune migration nouvelle** — la base reste au niveau 23. Une installation par-dessus
la 1.0.0 ne touche donc pas au schéma : rien à migrer, rien à redouter de ce côté.

Cinq corrections, dont **une seule faussait un chiffre** :

| | Ce que ça corrige |
|---|---|
| `029a9b7` | « Appliquer à ce mois » posait une charge **annuelle** dans un mois qui ne la doit pas — et la retirait aussitôt du Reste à vivre. Vécu sur Strava, ancrée en juillet, posée dans septembre : **600,15 € affichés au lieu de 680,14 €**. Le refus vit dans le service, pas dans le bouton |
| `6125713` | la **cible** d'une enveloppe mensualisée redescend dans sa ligne du Template |
| `12278ee` | son **nom** aussi — même piège, la ligne l'écrasait au coup suivant |
| `f711c23` | « À faire ce mois » se replie ; son en-tête avait perdu tout style au découpage de MonthView |
| `1a991fc` | le message d'attente des valorisations dit l'état réel au lieu d'une règle trompeuse |

**Sorti de la version** : la ligne annuelle sans année d'ancrage. C'est un chantier
(migration + `cycleMatches` + `nextDueDate` + Template + plan), pas un correctif.

**Vérifié avant le build** — `npm test` 247/247 ; la vraie route interrogée sur le serveur
de dev répond **409** avec le bon message et ne crée aucune ligne ; la synchro d'enveloppe
rejouée sur une copie de la base réelle. Seed vierge : 19 tables, 23 migrations, un seul
fichier, aucune donnée (le script casse le build sinon).

---

### 09/09/2026 — découpage, revue, sauvegarde des données

Version : **1.0.0** *(avant le versionnage)* · commit : `652b845` · migrations : **23** · seed : **vierge**

Le premier build depuis la revue complète du code. Beaucoup de choses, dont trois qui
touchent la base.

**Migrations ajoutées depuis le build précédent — 021, 022, 023.** Une base au niveau 20
passe à 23 au premier démarrage :

| | Ce que ça fait | Effet sur les données |
|---|---|---|
| `021-guide-termine` | colonne `app_settings.onboarding_done` | mise à 1 s'il existe des comptes — **une installation existante ne repasse pas par le guide** |
| `022-visite-guidee` | colonne `app_settings.tour_done` | idem |
| `023-annuler-une-ligne` | reconstruit `month_skips` pour accepter le genre `line` | les lignes existantes sont recopiées |

Vérifié avant ce build sur une copie de la base réelle (403 écritures, 45 079,08 €) :
après migration, **pas une écriture ni un centime de différence**, et
`onboarding_done = 1`.

**Fonctionnalités** — sauvegarde, import et effacement des données (Paramètres, tout en
bas) ; « Annuler ce mois-ci » sur une ligne du budget ; plan de financement par zones et
pourcentages, avec import depuis le Template ; guide de bienvenue et visite guidée.

**Sous le capot** — revue complète en trois étapes (logique métier, tests,
front/back), 236 tests, refonte du CSS commun, page Mois découpée en trois composants,
backend documenté.

**Installation vérifiée le 09/09, rien perdu.** La base en place n'a pas été touchée :
403 écritures, 45 167,04 €, 9 comptes, 294 lignes de budget, dernière écriture au 05/09,
`integrity_check` à `ok`. Les migrations 021 à 023 se sont appliquées au démarrage.

**Le bouton « Télécharger » fonctionne dans l'app packagée** — c'était le point
d'interrogation de ce build, il est levé. `Paramètres → Vos données → Télécharger` a
produit un fichier de 233 Ko, intègre, contenant exactement la base installée.

**Et il vaut mieux que la copie des trois fichiers.** La sauvegarde passe par
`VACUUM INTO` : un fichier unique, cohérent, le `-wal` déjà replié dedans. Mesuré le même
jour sur cette installation, dont le `-wal` pesait **1,68 Mo pour un `.db` de 221 Ko** —
presque tout le travail récent vivait dans le journal. Le `.db` seul, isolé de ses
journaux, ne rend que **390 écritures et 41 523,02 €**, dernière écriture au 31/08 :
**13 écritures et 3 644,02 € disparues sans un message**. Copier à la main reste possible,
mais alors les TROIS fichiers.

---

### 06/09/2026 22:33 — dernier build avant la revue

Version : **1.0.0** *(avant le versionnage)* · commit : `a4d8e79` · migrations : **20** · seed : base de dev d'alors (401 écritures)

C'est la version installée sur le poste d'Evan jusqu'au 09/09. Elle ne connaît ni la
sauvegarde des données, ni l'annulation d'une ligne, ni le plan de financement.

Sa seed contenait les données réelles — c'est ce build qui a fait découvrir le problème.

---

## Faire un build

```
build-app.cmd
```

**Toujours avec son chemin absolu** depuis un shell qui n'est pas `cmd` : `cmd /c
"build-app.cmd"` ne resout pas un `.cmd` du dossier courant et echoue avant la premiere
etape. Le piege s'est presente deux fois le 09/09.

Quatre étapes : frontend Vite (API sur le port 3004), runtime backend copié sans
`data/`, `tests/` ni `scripts/`, **seed vierge générée** (le script échoue si elle
contient la moindre donnée), puis `tauri build`.

Après un build, ajouter une entrée ici : date, **version**, commit, migrations, et ce qui
change pour la base. Le numéro de version se pose AVANT le build, sur les cinq fichiers.
