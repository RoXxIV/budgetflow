// L'accès à SQLite : ouverture de la base, migrations, et les quelques aides que tout
// service utilise pour requêter.
//
// Une seule connexion vit pour tout le processus — `node:sqlite` est **synchrone**,
// il n'y a donc ni pool ni promesse à gérer. C'est ce qui rend les services aussi
// directs à lire : une requête rend son résultat, une transaction est un simple
// try/catch, rien ne s'entrelace.
//
// Deux conversions traversent tout le projet et sont posées ici : les montants vivent
// en **centimes** dans la base et en **euros** dans l'API, et une erreur métier porte
// un statut HTTP que le gestionnaire d'erreur d'Express relaiera tel quel.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Emplacement de la base : ./data/budget.db par défaut, surchargeable (Tauri passera %APPDATA%)
const DB_PATH = process.env.DB_PATH || join(__dirname, "..", "data", "budget.db");

// Le chemin est figé au chargement du module. Un test qui importe ce fichier avant
// d'avoir posé DB_PATH travaillerait donc sur la vraie base : les suites passent par
// boot() dans tests/_setup.mjs, qui règle la variable puis importe.
let db;

/**
 * Ouvre la base et la met à jour.
 *
 * Deux réglages comptent. `journal_mode = WAL` permet de lire pendant qu'on écrit —
 * l'application sollicite beaucoup la lecture. `foreign_keys = ON` n'est pas un
 * confort : SQLite ignore les clés étrangères par défaut, et sans cette ligne les
 * suppressions en cascade dont dépend tout le modèle ne se produiraient jamais.
 *
 * Réouvrable : le service de sauvegarde ferme la base pour remplacer le fichier,
 * puis rappelle cette fonction.
 *
 * @returns {DatabaseSync} La connexion ouverte.
 */
export function initDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  applyMigrations();
  console.log(`SQLite : ${DB_PATH}`);
  return db;
}

// ─── Migrations : fichiers db/migrations/NNN-*.sql appliqués dans l'ordre, une seule fois ───

/**
 * Rejoue les migrations que cette base n'a pas encore vues.
 *
 * Le numéro en tête de nom donne l'ordre, et la table `_migrations` la mémoire : un
 * fichier déjà inscrit est sauté. Une base ancienne se met donc à jour toute seule au
 * démarrage, et une base neuve se bâtit en rejouant tout depuis 001.
 *
 * Chaque fichier s'applique dans SA transaction, et une erreur annule la migration
 * fautive **sans** l'inscrire : le prochain démarrage la retentera. Le serveur, lui,
 * refuse de démarrer — mieux vaut ne pas ouvrir l'application qu'écrire dans un
 * schéma à moitié migré.
 */
function applyMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const dir = join(__dirname, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(db.prepare("SELECT name FROM _migrations").all().map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
      db.exec("COMMIT");
      console.log(`Migration appliquée : ${file}`);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} échouée : ${err.message}`);
    }
  }
}

// ─── Cycle de vie du fichier ─────────────────────────────
// La sauvegarde, l'import et la remise à zéro travaillent sur le FICHIER, pas sur les
// tables : il faut donc pouvoir lâcher la base puis la rouvrir sans redémarrer le
// serveur. C'est ce qui permet de tout remplacer sans écrire une seule requête
// destructrice. Réservé au service de sauvegarde.

export const dbPath = () => DB_PATH;

/** Ferme la base après avoir replié le journal WAL dans le fichier principal. */
export function closeDb() {
  if (!db) return;
  // Sans ce repli, le fichier .db seul serait incomplet : tout ce qui n'a pas encore
  // été recopié depuis le -wal manquerait à l'appel.
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* base déjà en vrac : on ferme quand même */ }
  db.close();
  db = null;
}

// ─── Helpers requêtes ────────────────────────────────────
// Les paramètres passent en variadique : `all("… WHERE id = ?", id)`. Jamais de
// concaténation dans le SQL — c'est ce qui tient les injections à distance.

// Toutes les lignes
export const all = (sql, ...params) => db.prepare(sql).all(...params);
// La première ligne, ou undefined
export const get = (sql, ...params) => db.prepare(sql).get(...params);
// Écriture : rend { changes, lastInsertRowid }
export const run = (sql, ...params) => db.prepare(sql).run(...params);
// Ordre sans paramètre ni résultat (PRAGMA, VACUUM INTO…)
export const exec = (sql) => db.exec(sql);

/**
 * Exécute une suite d'écritures en tout-ou-rien.
 *
 * Indispensable partout où une opération touche plusieurs tables : créer un mois
 * recopie le budget type ligne à ligne, une entrée met à jour son enveloppe. Sans
 * transaction, une erreur au milieu laisserait la base à moitié modifiée — et il n'y
 * a personne pour la réparer ensuite.
 *
 * Le rappel est synchrone, comme tout `node:sqlite` : pas d'`await` à l'intérieur,
 * sans quoi le COMMIT partirait avant la fin du travail.
 *
 * @param {Function} fn Les écritures à mener ensemble.
 * @returns {*} Ce que rend `fn`.
 */
export function tx(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ─── Montants : centimes (INTEGER) en base, euros (Number) dans l'API ───
// Un montant stocké en flottant dérive : 0,1 + 0,2 ne fait pas 0,3, et sur un an de
// budget l'écart devient visible. On stocke donc des entiers de centimes, et on ne
// repasse en euros qu'au moment de répondre.

export const toCents = (euros) => (euros == null ? null : Math.round(Number(euros) * 100));
export const fromCents = (cents) => (cents == null ? null : cents / 100);

/**
 * Erreur métier portant un statut HTTP.
 *
 * Les services ne connaissent pas Express : ils lèvent cette erreur, et le
 * gestionnaire centralisé de `server.js` en fait la réponse. Un refus reste donc
 * exprimé là où vit la règle, pas dans la route.
 *
 * @param {number} status Le statut à renvoyer (409 pour un conflit, 404, 400…).
 * @param {string} message Le texte lu par l'utilisateur.
 * @returns {Error} L'erreur à lever.
 */
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
