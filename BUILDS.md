# Journal des builds

Un build produit `src-tauri/target/release/bundle/nsis/BudgetFlow2_1.0.0_x64-setup.exe`.
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

## Les builds

### 09/09/2026 — découpage, revue, sauvegarde des données

Commit : `<à compléter>` · migrations : **23** · seed : **vierge**

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

**Le bouton « Télécharger » de la sauvegarde n'a jamais tourné dans l'app packagée.**
Il fonctionne en navigateur ; dans la webview, il peut être inerte. **À vérifier sur ce
build** : Paramètres → Vos données → Télécharger. Si rien ne se passe, le correctif est
prévu (le backend écrit le fichier lui-même et affiche son chemin).

---

### 06/09/2026 22:33 — dernier build avant la revue

Commit : `a4d8e79` · migrations : **20** · seed : base de dev d'alors (401 écritures)

C'est la version installée sur le poste d'Evan jusqu'au 09/09. Elle ne connaît ni la
sauvegarde des données, ni l'annulation d'une ligne, ni le plan de financement.

Sa seed contenait les données réelles — c'est ce build qui a fait découvrir le problème.

---

## Faire un build

```
build-app.cmd
```

Quatre étapes : frontend Vite (API sur le port 3004), runtime backend copié sans
`data/`, `tests/` ni `scripts/`, **seed vierge générée** (le script échoue si elle
contient la moindre donnée), puis `tauri build`.

Après un build, ajouter une entrée ici : date, commit, migrations, et ce qui change pour
la base.
