// Tests unitaires — périmètre « vos données » : sauvegarder, importer, tout effacer.
// Base SQLite neuve et jetable ; les tests sont séquentiels et la font vivre.
//
// Ce qui compte ici n'est pas qu'une sauvegarde se crée, c'est qu'aucune opération ne
// perde de données : chaque test qui écrase quelque chose vérifie aussi ce qui a été
// mis de côté avant. Lancer depuis backend/ : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boot, refuse, currentPeriod } from "./_setup.mjs";

const S = await boot();
const { accounts, categories, themes, months, settings, backup } = S;

const bacASable = () => mkdtempSync(join(tmpdir(), "budgetflow-essai-"));
const compter = (fichier, table) => {
  const b = new DatabaseSync(fichier, { readOnly: true });
  try { return b.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; } finally { b.close(); }
};

// Le jeu de départ : de quoi reconnaître ces données dans une sauvegarde
accounts.create({ name: "Compte courant", type: "courant", initialBalance: 1000 });
accounts.create({ name: "Livret A", type: "epargne", initialBalance: 5000 });
categories.create({ name: "Courses", color: 1 });
themes.create({ name: "Vacances" });
months.create({ period: currentPeriod() });

// ─── Ce que contient la base ──────────────────────────────

test("l'inventaire annonce ce qu'il y a, avec les mots de l'utilisateur", () => {
  const d = backup.describeData();
  const trouve = (t) => d.lignes.find((l) => l.table === t);
  assert.equal(trouve("accounts").count, 2);
  assert.equal(trouve("accounts").label, "comptes", "au pluriel quand il y en a plusieurs");
  assert.equal(trouve("themes").count, 1);
  assert.equal(trouve("themes").label, "thème", "au singulier quand il n'y en a qu'un");
  assert.ok(d.total >= 4);
});

test("une table vide ne figure pas dans l'inventaire : on n'annonce pas du néant", () => {
  const d = backup.describeData();
  assert.equal(d.lignes.find((l) => l.table === "assets"), undefined);
});

// ─── Sauvegarder ──────────────────────────────────────────

test("la sauvegarde produit un fichier relisible, avec les mêmes données", () => {
  const fichier = join(bacASable(), "sauvegarde.db");
  backup.copyTo(fichier);
  assert.ok(existsSync(fichier));
  assert.equal(compter(fichier, "accounts"), 2);
  assert.equal(compter(fichier, "categories"), 1);
});

test("la sauvegarde tient dans UN fichier : pas de journal laissé derrière", () => {
  // C'est tout l'intérêt de VACUUM INTO. Une copie manuelle de budget.db laisserait
  // le -wal à côté, et la sauvegarde serait amputée des dernières écritures.
  const fichier = join(bacASable(), "sauvegarde.db");
  backup.copyTo(fichier);
  assert.equal(existsSync(fichier + "-wal"), false);
  assert.equal(existsSync(fichier + "-shm"), false);
});

test("la sauvegarde emporte ce qui vient d'être écrit, pas l'état d'il y a dix minutes", () => {
  accounts.create({ name: "Compte de la dernière minute", type: "courant" });
  const fichier = join(bacASable(), "sauvegarde.db");
  backup.copyTo(fichier);
  assert.equal(compter(fichier, "accounts"), 3);
});

test("le nom du fichier proposé porte la date, pour s'y retrouver dans un dossier", () => {
  assert.equal(backup.exportFileName(new Date(2026, 8, 8)), "budgetflow-2026-09-08.db");
});

// ─── Refuser ce qui n'est pas une sauvegarde ──────────────

test("un fichier qui n'est pas une base est refusé", () => {
  const fichier = join(bacASable(), "photo.db");
  writeFileSync(fichier, "ceci n'est pas une base de données");
  refuse(() => backup.inspectFile(fichier), 400);
});

test("une base SQLite étrangère est refusée : les tables attendues manquent", () => {
  const fichier = join(bacASable(), "autre-appli.db");
  const b = new DatabaseSync(fichier);
  b.exec("CREATE TABLE recettes (id INTEGER PRIMARY KEY, nom TEXT)");
  b.close();
  const e = refuse(() => backup.inspectFile(fichier), 400);
  assert.match(e.message, /BudgetFlow/);
});

test("une sauvegarde venue d'une version plus récente est refusée plutôt qu'ouverte", () => {
  // Une migration que cette version ne connaît pas : le schéma serait en avance sur le
  // code. On refuse au lieu d'aller voir ce que ça donne.
  const fichier = join(bacASable(), "du-futur.db");
  backup.copyTo(fichier);
  const b = new DatabaseSync(fichier);
  b.exec("INSERT INTO _migrations (name) VALUES ('099-le-futur.sql')");
  b.close();
  const e = refuse(() => backup.inspectFile(fichier), 400);
  assert.match(e.message, /plus récente/);
});

test("une sauvegarde valide est acceptée, et dit ce qu'elle contient", () => {
  const fichier = join(bacASable(), "sauvegarde.db");
  backup.copyTo(fichier);
  const info = backup.inspectFile(fichier);
  assert.equal(info.lignes.find((l) => l.table === "accounts").count, 3);
  assert.ok(info.migrations > 0, "elle porte l'historique du schéma");
});

// ─── Importer ─────────────────────────────────────────────

test("importer remplace les données, et archive celles d'avant", () => {
  const fichier = join(bacASable(), "trois-comptes.db");
  backup.copyTo(fichier); // 3 comptes

  accounts.create({ name: "Quatrième", type: "courant" });
  assert.equal(accounts.list().length, 4);

  const res = backup.replaceWith(fichier);
  assert.equal(accounts.list().length, 3, "les données du fichier ont pris la place");
  assert.equal(compter(res.archive, "accounts"), 4, "l'état d'avant est retrouvable dans l'archive");
});

test("après un import, la base répond normalement : elle est bien rouverte", () => {
  // Le service ferme puis rouvre le fichier ; si la poignée n'était pas rétablie,
  // la moindre requête échouerait ici.
  assert.equal(categories.list().length, 1);
  assert.equal(settings.getSettings().currency, "EUR");
  accounts.create({ name: "Après import", type: "courant" });
  assert.equal(accounts.list().length, 4);
});

test("un fichier illisible ne détruit rien : rien n'est fermé avant d'avoir été vérifié", () => {
  const avant = accounts.list().length;
  const fichier = join(bacASable(), "cassé.db");
  writeFileSync(fichier, "n'importe quoi");
  refuse(() => backup.replaceWith(fichier), 400);
  assert.equal(accounts.list().length, avant, "les données sont toujours là");
});

// ─── Tout effacer ─────────────────────────────────────────

test("la remise à zéro archive avant d'effacer, et l'archive contient tout", () => {
  const avant = accounts.list().length;
  const res = backup.resetAll();
  assert.equal(compter(res.archive, "accounts"), avant, "l'archive est complète");
  assert.ok(res.efface.total > 0, "elle annonce ce qui a disparu");
});

test("après la remise à zéro, la base est vide mais utilisable", () => {
  assert.equal(accounts.list().length, 0);
  assert.equal(categories.list().length, 0);
  assert.equal(months.list().length, 0);
  // Le schéma est bien rebâti : les réglages existent et sont ceux d'origine
  assert.equal(settings.getSettings().currency, "EUR");
});

test("après la remise à zéro, le guide de bienvenue se redéclenche tout seul", () => {
  // Son état se déduit du contenu : plus de compte, donc première étape.
  const s = settings.getOnboarding();
  assert.equal(s.needsOnboarding, true);
  assert.equal(s.step, "compte");
});

test("on peut repartir de zéro, ou recharger une sauvegarde d'avant", () => {
  accounts.create({ name: "La suite", type: "courant" });
  assert.equal(accounts.list().length, 1, "une base neuve s'écrit comme n'importe quelle autre");
});
