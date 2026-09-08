// Sauvegarde, import et remise à zéro des données.
//
// LE PRINCIPE : on ne touche jamais aux tables, on manipule le FICHIER.
//
// Un « effacer tout » écrit en SQL, ce serait vider dix-neuf tables sur la base
// vivante — l'opération la plus dangereuse de toute l'application, et celle dont la
// moindre erreur est irrattrapable. À la place : on archive le fichier, on le
// remplace, et les migrations rebâtissent une base neuve à la réouverture. Aucune
// requête destructrice n'existe donc dans ce module.
//
// La deuxième règle est qu'on n'écrase rien sans avoir d'abord mis de côté ce qui
// existe : import comme remise à zéro archivent avant d'agir, et l'import restaure
// l'archive si la base entrante se révèle inutilisable.

import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, dbPath, exec, get, httpError, initDb } from "../db/index.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

// Ce que contient la base, dit avec les mots de l'utilisateur : c'est ce texte
// qu'affiche la confirmation avant d'effacer.
const CONTENU = [
  ["entries", "écriture", "écritures"],
  ["budget_lines", "ligne de budget", "lignes de budget"],
  ["months", "mois", "mois"],
  ["accounts", "compte", "comptes"],
  ["envelopes", "enveloppe", "enveloppes"],
  ["categories", "catégorie", "catégories"],
  ["themes", "thème", "thèmes"],
  ["assets", "investissement", "investissements"],
  ["tracker_subscriptions", "abonnement", "abonnements"],
];

// Une base sans ces tables n'est pas une base BudgetFlow, quoi qu'en dise l'extension
const TABLES_ATTENDUES = ["_migrations", "app_settings", "accounts", "months", "budget_lines", "entries"];

const p2 = (n) => String(n).padStart(2, "0");
const horodatage = (d = new Date()) =>
  `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

// SQLite n'accepte pas de paramètre lié dans un VACUUM INTO : le chemin part dans le
// texte de la requête, on double donc les apostrophes qu'il pourrait contenir.
const litteral = (chemin) => `'${chemin.replace(/\\/g, "/").replace(/'/g, "''")}'`;

/** Nom de fichier proposé au téléchargement, daté pour s'y retrouver dans un dossier. */
export function exportFileName(d = new Date()) {
  return `budgetflow-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.db`;
}

/**
 * Inventaire de ce que contient la base.
 *
 * Sert à annoncer ce qui va disparaître avant une remise à zéro : « 401 écritures,
 * 8 mois, 9 comptes… ». Un chiffre concret pèse plus qu'un avertissement générique.
 *
 * @returns {{lignes: Array<{table: string, label: string, count: number}>, total: number, taille: number}}
 */
export function describeData() {
  const lignes = CONTENU.map(([table, singulier, pluriel]) => {
    const count = get(`SELECT COUNT(*) AS n FROM ${table}`).n;
    return { table, label: count > 1 ? pluriel : singulier, count };
  }).filter((l) => l.count > 0);

  let taille = 0;
  try { taille = statSync(dbPath()).size; } catch { /* base jamais repliée sur disque */ }
  return { lignes, total: lignes.reduce((s, l) => s + l.count, 0), taille };
}

/**
 * Écrit une copie cohérente de la base dans un fichier.
 *
 * `VACUUM INTO` est l'outil juste ici : il produit **un seul fichier** déjà compacté,
 * là où une copie manuelle de `budget.db` laisserait le journal `-wal` derrière elle —
 * et donnerait donc une sauvegarde silencieusement amputée des dernières écritures.
 *
 * @param {string} destination Chemin du fichier à créer.
 * @returns {string} Le chemin écrit.
 */
export function copyTo(destination) {
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { force: true }); // VACUUM INTO refuse d'écraser un fichier existant
  exec(`VACUUM INTO ${litteral(destination)}`);
  return destination;
}

/**
 * Prépare le fichier à télécharger, dans un dossier temporaire.
 *
 * @returns {{file: string, dir: string, name: string}} Le dossier est à supprimer une fois servi.
 */
export function exportToTemp() {
  const dir = mkdtempSync(join(tmpdir(), "budgetflow-export-"));
  const name = exportFileName();
  return { file: copyTo(join(dir, name)), dir, name };
}

/**
 * Range une copie de l'état actuel à côté de la base, avant une opération qui l'écrase.
 *
 * Ces archives ne sont jamais supprimées automatiquement : c'est le dernier recours
 * quand quelque chose s'est mal passé, et le disque coûte moins cher que les données.
 *
 * @param {string} raison Suffixe du dossier, pour savoir de quoi on se protégeait.
 * @returns {string} Le chemin de l'archive.
 */
export function archive(raison) {
  return copyTo(join(dirname(dbPath()), `backup-${horodatage()}-${raison}`, "budget.db"));
}

/**
 * Vérifie qu'un fichier est une base BudgetFlow saine avant de l'installer.
 *
 * Trois contrôles, du plus grossier au plus subtil : le fichier s'ouvre-t-il, SQLite
 * le juge-t-il intègre, et porte-t-il les tables attendues. Le dernier est le moins
 * évident : une sauvegarde qui contient des migrations que cette version ne connaît
 * pas vient d'une version **plus récente** de l'application. L'installer ferait
 * tourner du code ancien sur un schéma neuf — on refuse plutôt que d'aller voir.
 *
 * @param {string} fichier Chemin du fichier candidat.
 * @returns {{migrations: number, lignes: Array, total: number}} Ce que le fichier contient.
 */
export function inspectFile(fichier) {
  let base = null;
  try {
    // Ouvrir ne touche pas au disque : SQLite est paresseux. C'est `integrity_check`,
    // première vraie lecture, qui rejette un fichier qui n'en est pas une — d'où le
    // filet unique autour des deux, qui traduit toute erreur brute en refus lisible.
    base = new DatabaseSync(fichier, { readOnly: true });
    const verdict = Object.values(base.prepare("PRAGMA integrity_check").get())[0];
    if (verdict !== "ok") throw httpError(400, "Ce fichier est endommagé : SQLite refuse de le lire.");

    const tables = new Set(base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const manquantes = TABLES_ATTENDUES.filter((t) => !tables.has(t));
    if (manquantes.length) {
      throw httpError(400, `Ce fichier ne ressemble pas à une base BudgetFlow (il manque : ${manquantes.join(", ")}).`);
    }

    const connues = new Set(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")));
    const appliquees = base.prepare("SELECT name FROM _migrations").all().map((r) => r.name);
    const inconnues = appliquees.filter((n) => !connues.has(n));
    if (inconnues.length) {
      const s = inconnues.length > 1 ? "s" : "";
      throw httpError(400, `Cette sauvegarde vient d'une version plus récente de BudgetFlow (${inconnues.length} évolution${s} inconnue${s}). Mettez l'application à jour avant de l'importer.`);
    }

    // Le même inventaire que describeData, mais lu dans le fichier entrant
    const lignes = CONTENU.map(([table, singulier, pluriel]) => {
      if (!tables.has(table)) return { table, label: pluriel, count: 0 };
      const count = base.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      return { table, label: count > 1 ? pluriel : singulier, count };
    }).filter((l) => l.count > 0);

    return { migrations: appliquees.length, lignes, total: lignes.reduce((s, l) => s + l.count, 0) };
  } catch (err) {
    if (err.status) throw err; // un refus déjà formulé garde son message
    throw httpError(400, "Ce fichier n'est pas une base de données BudgetFlow.");
  } finally {
    base?.close();
  }
}

/** Efface le fichier de base et ses journaux : la prochaine ouverture repart de zéro. */
function effacerFichiers() {
  for (const suffixe of ["", "-wal", "-shm"]) rmSync(dbPath() + suffixe, { force: true });
}

/**
 * Remplace les données par celles d'une sauvegarde.
 *
 * L'ordre compte : on inspecte AVANT de fermer quoi que ce soit, puis on archive
 * l'existant, et seulement là on substitue. Si la base entrante refuse de s'ouvrir —
 * une migration en échec, par exemple — l'archive reprend sa place et l'erreur
 * remonte : une importation ratée ne coûte rien.
 *
 * @param {string} fichier Chemin de la sauvegarde à installer.
 * @returns {{archive: string, importe: object}}
 */
export function replaceWith(fichier) {
  const importe = inspectFile(fichier);
  const sauvegarde = archive("avant-import");

  closeDb();
  effacerFichiers();
  copyFileSync(fichier, dbPath());
  try {
    initDb(); // rejoue les migrations manquantes : une sauvegarde ancienne se met à jour
  } catch (err) {
    effacerFichiers();
    copyFileSync(sauvegarde, dbPath());
    initDb();
    throw httpError(400, `Import refusé : ${err.message}. Vos données ont été remises en place.`);
  }
  return { archive: sauvegarde, importe };
}

/**
 * Remet l'application à neuf, après avoir archivé l'existant.
 *
 * La base repart vide, donc sans compte : le guide de bienvenue se redéclenche de
 * lui-même au prochain chargement, puisque son état se déduit du contenu.
 *
 * @returns {{archive: string, efface: object}}
 */
export function resetAll() {
  const efface = describeData();
  const sauvegarde = archive("avant-remise-a-zero");

  closeDb();
  effacerFichiers();
  initDb(); // les migrations rebâtissent le schéma, vide
  return { archive: sauvegarde, efface };
}
