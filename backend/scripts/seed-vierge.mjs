/**
 * Génère la base VIERGE embarquée dans l'installeur.
 *
 * POURQUOI ELLE EST VIDE — la seed n'est copiée qu'au tout premier lancement, sur une
 * machine où l'application n'a jamais tourné (voir src-tauri/src/main.rs : la copie est
 * sautée si %APPDATA%/fr.revaw.budgetflow2/budget.db existe déjà). Elle ne sert donc
 * jamais à Evan sur son poste — mais elle est ce que reçoit **quiconque installe l'exe**.
 *
 * Y mettre la base de dev revenait à distribuer ses comptes bancaires, ses salaires et
 * ses projets d'épargne avec le programme. Une base vierge supprime la fuite sans rien
 * lui coûter, et fait démarrer l'app sur son guide de bienvenue — l'expérience prévue
 * pour une première utilisation, que la seed pré-remplie empêchait de jouer.
 *
 * CE QU'ELLE CONTIENT : le schéma seul. Les 23 migrations sont appliquées, la ligne
 * app_settings existe (posée par la 001), et pas une donnée. Livrer une base déjà migrée
 * plutôt que rien évite un dossier de ressources vide — que le bundler Tauri refuse — et
 * épargne les migrations au premier démarrage.
 *
 * Usage : node scripts/seed-vierge.mjs <dossier-de-sortie>
 */
import { mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const dest = resolve(process.argv[2] || "../src-tauri/seed");

// Les trois fichiers sont retirés d'abord : une base rouverte par-dessus une ancienne
// hériterait de son contenu, et c'est précisément ce qu'on veut éviter ici.
mkdirSync(dest, { recursive: true });
for (const suffixe of ["", "-wal", "-shm"]) rmSync(join(dest, "budget.db" + suffixe), { force: true });

process.env.DB_PATH = join(dest, "budget.db");
const { initDb, all, get, closeDb } = await import("../db/index.js");
initDb();

// Contrôle avant de rendre la main : une seed qui contiendrait des données serait
// distribuée telle quelle. Mieux vaut échouer le build que livrer ça.
const tables = all(
  `SELECT name FROM sqlite_master WHERE type = 'table'
     AND name NOT LIKE 'sqlite_%' AND name != '_migrations' ORDER BY name`
).map((r) => r.name);

const habitees = [];
for (const t of tables) {
  const n = get(`SELECT COUNT(*) AS n FROM "${t}"`).n;
  // app_settings porte sa ligne unique depuis la migration 001 : c'est du réglage, pas une donnée
  if (n > 0 && t !== "app_settings") habitees.push(`${t} (${n})`);
}

const migrations = get("SELECT COUNT(*) AS n FROM _migrations").n;
closeDb();

if (habitees.length) {
  console.error(`ÉCHEC — la seed n'est pas vierge : ${habitees.join(", ")}`);
  process.exit(1);
}

const poids = existsSync(process.env.DB_PATH) ? statSync(process.env.DB_PATH).size : 0;
console.log(`Seed vierge : ${tables.length} tables, ${migrations} migrations, ${Math.round(poids / 1024)} Ko`);
console.log(`  ${process.env.DB_PATH}`);
