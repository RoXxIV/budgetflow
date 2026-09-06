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
| Base de dev | `backend/data/budget.db` (+ `-wal`, `-shm`) | **SACRÉE — lecture seule** |
| App installée | `%APPDATA%\fr.revaw.budgetflow2\budget.db` | **SACRÉE — ne pas y toucher** |
| Sauvegardes | `backend/data/backup-*/` | **SACRÉES — ne jamais écraser ni supprimer** |

### Au début de CHAQUE tâche : copier la base, puis bosser sur la copie

Premier réflexe, **avant** de lancer un serveur, un script ou la moindre requête :

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

- **`dev.cmd` est interdit pendant une tâche** : il démarre le backend sans `DB_PATH`,
  donc sur la vraie base. Il est réservé à Evan, ou à la fin, quand il veut revoir ses
  vraies données.
- **Démarrer le backend = écrire dans la base** : les migrations SQL numérotées
  s'appliquent automatiquement au boot. Aucun démarrage sans `DB_PATH`.
- `scripts/review.mjs` prend une base **neuve et jetable** en argument, jamais la base de dev.
- `build-app.cmd` embarque la base de dev **actuelle** comme seed de l'installeur :
  avant un build, vérifier que `backend/data/budget.db` est bien la vraie base intacte.

### Toucher à la vraie base : uniquement si Evan le demande explicitement

Et dans ce cas seulement : ① sauvegarde datée d'abord
(`backend/data/backup-<motif>-<AAAAMMJJ>/` avec les 3 fichiers), ② l'annoncer avant de
le faire, ③ vérifier les invariants après et les lui montrer
(méthode dans [CONTEXTE.md](CONTEXTE.md#invariants)).

`backend/data/` est gitignoré : les copies de travail ne partent jamais dans git.
En fin de tâche, proposer de supprimer le dossier `work/` du jour — ne jamais supprimer
soi-même une base ou une sauvegarde.

### Checklist de démarrage (à annoncer en une ligne dans la réponse)

1. copie faite (3 fichiers) → chemin de la copie
2. tout tourne avec `DB_PATH` sur cette copie
3. la vraie base n'a été ni ouverte en écriture, ni migrée, ni servie

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
