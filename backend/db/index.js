import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Emplacement de la base : ./data/budget.db par défaut, surchargeable (Tauri passera %APPDATA%)
const DB_PATH = process.env.DB_PATH || join(__dirname, "..", "data", "budget.db");

let db;

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
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);
// Ordre sans paramètre ni résultat (PRAGMA, VACUUM INTO…)
export const exec = (sql) => db.exec(sql);

// Transaction synchrone (node:sqlite est synchrone)
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
export const toCents = (euros) => (euros == null ? null : Math.round(Number(euros) * 100));
export const fromCents = (cents) => (cents == null ? null : cents / 100);

// Erreur métier avec statut HTTP
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
