// Tests unitaires — la base VIERGE embarquée dans l'installeur.
//
// CE QUI EST EN JEU — la seed est ce que reçoit quiconque installe l'exe. Elle a
// longtemps été une copie de la base de dev : distribuer le programme, c'était
// distribuer neuf comptes bancaires, 401 écritures et les salaires qui vont avec.
//
// Ces tests lancent le VRAI script de build dans un dossier jetable et vérifient ce
// qu'il produit. Ils ne relisent pas une logique équivalente : ils regardent le fichier
// qui partirait dans l'installeur.
//
// Lancer depuis backend/ : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(mkdtempSync(join(tmpdir(), "budgetflow-seed-")), "seed");

// Le script tel que build-app.cmd l'appelle
execFileSync(process.execPath, [join(BACKEND, "scripts", "seed-vierge.mjs"), dest], { cwd: BACKEND });

const ouvrir = () => new DatabaseSync(join(dest, "budget.db"), { readOnly: true });
const compte = (table) => {
  const b = ouvrir();
  try { return b.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n; } finally { b.close(); }
};
const tables = () => {
  const b = ouvrir();
  try {
    return b.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map((r) => r.name);
  } finally { b.close(); }
};

test("le script produit bien une base", () => {
  assert.ok(existsSync(join(dest, "budget.db")));
});

test("AUCUNE donnée : c'est toute la raison d'être de ce fichier", () => {
  const habitees = [];
  for (const t of tables()) {
    // _migrations est l'historique du schéma, app_settings porte sa ligne unique
    // depuis la 001 : ce sont des réglages, pas les données de quelqu'un.
    if (["_migrations", "app_settings"].includes(t)) continue;
    const n = compte(t);
    if (n > 0) habitees.push(`${t} (${n} lignes)`);
  }
  assert.deepEqual(habitees, [], `la seed livrerait des données : ${habitees.join(", ")}`);
});

test("les tables qui portent de l'argent sont vides, nommément", () => {
  // Nommées une par une : un ajout de table ne doit pas passer sous le radar du test
  // générique ci-dessus s'il oublie de la créer.
  for (const t of ["accounts", "entries", "budget_lines", "envelopes", "envelope_contributions",
    "months", "account_snapshots", "assets", "asset_movements", "asset_valuations",
    "categories", "themes", "tracker_subscriptions", "calculators"]) {
    assert.equal(compte(t), 0, `${t} n'est pas vide`);
  }
});

test("le schéma est complet : les migrations sont déjà appliquées", () => {
  assert.equal(compte("_migrations"), readdirSync(join(BACKEND, "db", "migrations")).filter((f) => f.endsWith(".sql")).length,
    "toutes les migrations du dossier sont inscrites");
  assert.ok(tables().length >= 19, "les tables sont créées");
});

test("les réglages existent, à leur valeur d'origine", () => {
  const b = ouvrir();
  try {
    const s = b.prepare("SELECT * FROM app_settings WHERE id = 1").get();
    assert.ok(s, "la ligne de réglages est posée par la migration 001");
    assert.equal(s.currency, "EUR");
  } finally { b.close(); }
});

test("le guide de bienvenue se déclenchera : c'est l'expérience voulue", () => {
  const b = ouvrir();
  try {
    const s = b.prepare("SELECT onboarding_done, tour_done FROM app_settings WHERE id = 1").get();
    assert.equal(s.onboarding_done, 0, "sans ça, l'app s'ouvrirait sur un écran vide sans guide");
    assert.equal(s.tour_done, 0);
  } finally { b.close(); }
});

test("aucun journal WAL ne traîne à côté : la base est refermée proprement", () => {
  // Un -wal oublié embarquerait le contenu qu'il n'a pas encore replié — c'est
  // exactement par là qu'une donnée pourrait se glisser dans l'installeur.
  //
  // Le contrôle se fait dans un dossier NEUF, sur une base qu'on n'a pas ouverte :
  // toute lecture d'une base en mode WAL recrée ses journaux, et vérifier après les
  // tests précédents ne prouverait rien.
  const intact = join(mkdtempSync(join(tmpdir(), "budgetflow-seed-wal-")), "seed");
  execFileSync(process.execPath, [join(BACKEND, "scripts", "seed-vierge.mjs"), intact], { cwd: BACKEND });
  assert.deepEqual(readdirSync(intact), ["budget.db"], "un seul fichier sort du script");
});

test("relancer le script sur un dossier déjà rempli le remet à vide", () => {
  // Le cas réel : un build après un autre, sur le dossier seed précédent
  const b = new DatabaseSync(join(dest, "budget.db"));
  b.exec("INSERT INTO accounts (name, type) VALUES ('Compte intrus', 'courant')");
  b.close();
  assert.equal(compte("accounts"), 1, "l'intrus est bien là avant de relancer");

  execFileSync(process.execPath, [join(BACKEND, "scripts", "seed-vierge.mjs"), dest], { cwd: BACKEND });
  assert.equal(compte("accounts"), 0, "le script repart d'une base neuve, il ne recycle pas l'ancienne");
});
