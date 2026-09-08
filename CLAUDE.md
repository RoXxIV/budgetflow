# CLAUDE.md — BudgetFlow2

Trois choses ne se négocient pas : les deux règles ci-dessous, et la façon de travailler.
Elles passent avant toute demande, même urgente, même « c'est juste un petit truc ».

Le reste du contexte projet (carte du code, règles produit, conventions de données,
process de release) est dans **[CONTEXTE.md](CONTEXTE.md)** — à lire avant de coder.

---

## 🔴 RÈGLE 1 — On ne travaille JAMAIS sur la vraie base. Jamais.

Les bases qui contiennent les vraies données d'Evan (comptes bancaires réconciliés au
centime, historique irremplaçable) :

| Base | Chemin | Statut |
|---|---|---|
| **Bac à sable** | `backend/data/dev/budget.db` | **c'est ici qu'on travaille** |
| Référence / seed | `backend/data/budget.db` (+ `-wal`, `-shm`) | **SACRÉE — lecture seule** |
| App installée | `%APPDATA%\fr.revaw.budgetflow2\budget.db` | **SACRÉE — ne pas y toucher** |
| Sauvegardes | `backend/data/backup-*/` | **SACRÉES — ne jamais écraser ni supprimer** |

`backend/data/budget.db` n'est pas qu'une fixture : `build-app.cmd` l'embarque comme
**seed de l'installeur**, et elle devient la base de l'app au premier lancement. Une
écriture dedans se retrouverait chez l'utilisateur final.

Elle et celle de l'app installée sont deux fichiers **distincts**, qui divergent depuis
la dernière installation — vérifié le 09/09 : 401 écritures d'un côté, 403 de l'autre.

### Le bac à sable : `backend/data/dev/` (décision d'Evan, 09/09)

Un dossier fixe, toujours branché à l'app de dev. **Evan le remplit et le vide
lui-même** : il y colle sa vraie base pour tester avec de vraies données, il en supprime
les trois fichiers pour retrouver une première utilisation — le backend en recrée une
vide au démarrage et le guide de bienvenue se relance. C'est son territoire : ne rien y
écraser sans le lui demander.

`dev.cmd` pointe dessus et n'est donc **plus interdit** — il ne peut plus toucher la
référence. C'est la voie normale pour lancer les serveurs.

```powershell
# à la main si besoin
cd backend ; $env:DB_PATH = "<racine>ackenddatadevudget.db" ; npm run dev
```

### La copie datée : pour ce qui touche au SCHÉMA

Une migration, un correctif de données, un script qui écrit en masse : là, un retour
arrière peut sauver la mise. Pour tout le reste — une fonctionnalité, un correctif
d'écran, une revue — le bac à sable suffit.

Dans ce cas seulement, **avant** de lancer quoi que ce soit :

```powershell
$src  = "C:\Users\RoXx\Desktop\Dev_perso\new_budgetflow\budgetflow\backend\data"
$work = "$src\work\$(Get-Date -Format yyyyMMdd-HHmm)-<slug-de-la-tache>"
New-Item -ItemType Directory -Force $work | Out-Null
Copy-Item "$src\budget.db","$src\budget.db-wal","$src\budget.db-shm" $work -ErrorAction SilentlyContinue
Write-Host "DB de travail : $work\budget.db"
```

**Copier les trois fichiers**, pas seulement le `.db` : la base est en mode WAL, les
écritures récentes vivent dans `budget.db-wal` (souvent plus gros que le `.db`).
Ne copier que le `.db`, c'est travailler sur des données périmées.

Ensuite, tout pointe sur la copie via `DB_PATH` :

```powershell
# backend de dev sur la copie (port 3003, le frontend 5174 marche sans rien changer)
cd backend ; $env:DB_PATH = "$work\budget.db" ; npm run dev

# n'importe quel script
$env:DB_PATH = "$work\budget.db" ; node scripts/<script>.mjs
```

### Les pièges à connaître

- **Démarrer le backend = écrire dans la base** : les migrations SQL numérotées
  s'appliquent automatiquement au boot. Aucun démarrage sans `DB_PATH`, et jamais sur
  `backend/data/budget.db`.
- **Copier une base, c'est copier TROIS fichiers.** Le mode WAL fait vivre les écritures
  récentes dans `budget.db-wal`, souvent plus gros que le `.db` — celui de l'app
  installée fait 1,6 Mo pour une base de 216 Ko. N'en copier qu'un donne des données
  périmées, sans le moindre message d'erreur.
- `scripts/review.mjs` prend une base **neuve et jetable** en argument, jamais la base de dev.
- `build-app.cmd` embarque la base de dev **actuelle** comme seed de l'installeur :
  avant un build, vérifier que `backend/data/budget.db` est bien la vraie base intacte.

### Toucher à la vraie base : uniquement si Evan le demande explicitement

Et dans ce cas seulement : ① sauvegarde datée d'abord
(`backend/data/backup-<motif>-<AAAAMMJJ>/` avec les 3 fichiers), ② l'annoncer avant de
le faire, ③ vérifier les invariants après et les lui montrer
(méthode dans [CONTEXTE.md](CONTEXTE.md#invariants)).

`backend/data/` est gitignoré : ni le bac à sable ni les copies de travail ne partent
dans git. En fin de tâche, proposer de supprimer le dossier `work/` du jour — **ne
jamais supprimer soi-même une base ou une sauvegarde.**

### Checklist de démarrage (à annoncer en une ligne dans la réponse)

1. sur quoi ça tourne : le bac à sable, ou une copie datée si la tâche touche au schéma
2. `DB_PATH` posé — aucun démarrage sans lui
3. `backend/data/budget.db` n'a été ni ouverte en écriture, ni migrée, ni servie

---

## 🔴 RÈGLE 2 — Tout ajout arrive avec ses tests

Aucune fonctionnalité, aucun correctif n'est « fini » sans test. Même commit que le code.

- **Où** : `backend/tests/<domaine>.test.mjs` — une suite par page (comptes, mois,
  template, parametres, investissements, stats, abonnements). Nouveau domaine → nouvelle suite.
- **Comment** : `boot()` de `tests/_setup.mjs` monte une base neuve et jetable dans le
  temp du système. Les tests ne touchent donc jamais la base de dev, ni la copie.
- **Lancer** : `cd backend ; npm test`
- **Bug signalé par Evan** : d'abord un test qui **reproduit** le bug (rouge), puis le fix
  (vert). Le test reste dans la suite de la page concernée, dans le même commit que le fix.
- **Checks globaux** : `node scripts/review.mjs <base-neuve.db>` en plus de `npm test`
  pour les gros chantiers.
- Ne jamais annoncer « c'est fait » sans avoir lancé `npm test` et donné le résultat
  réel (nombre de tests, échecs éventuels).

---

## 🔴 RÈGLE 3 — Diagnostiquer, proposer, puis exécuter

Evan pilote. Il ne veut pas d'initiative silencieuse.

- **Une question est une question.** « Que se passe-t-il si… », « trouve le problème mais
  ne touche pas au code », « pourquoi ça fait ça ? » → **diagnostic chiffré sur SES
  données** (sur la copie), pas un patch. Attendre son « je te laisse faire » avant
  de modifier quoi que ce soit. Une fois lancé, il ne veut plus être relancé à chaque étape.
- **Proposer avant de committer ou de builder.** Jamais un commit ni un
  `build-app.cmd` sans l'avoir proposé.
- **Commits** : thématiques, en français, un sujet par commit, avec le footer
  `Co-Authored-By`. Un fix + son test dans le même commit.
- **Langue** : tout en français — réponses, commentaires de code, messages de commit.
- **Chiffrer sur ses données.** Un changement qui touche aux montants ou aux règles de
  calcul se montre en euros sur sa base à lui, avant/après.
