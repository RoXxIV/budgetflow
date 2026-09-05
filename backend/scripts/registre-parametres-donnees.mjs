/**
 * Migration de données — refonte registre de la page Paramètres (brief §1.A / §1.C).
 * À lancer UNE FOIS par base (base de dev + sauvegarde de référence + prod à la release) :
 *   node scripts/registre-parametres-donnees.mjs <chemin-sqlite>
 *
 * 1. Couleurs de catégories : mappées sur la plus proche des 12 pastilles --cat-* (distance Lab).
 * 2. Fautes de casse / accents dans les libellés livrés (catégories, thèmes, lignes).
 * 3. Moyens de paiement et types d'investissement : casse normalisée, valeurs propagées
 *    aux lignes, entrées et actifs qui les stockent en texte.
 * Idempotent : relancer ne change rien de plus.
 */
const dbPath = process.argv[2];
if (!dbPath) { console.error("Usage : node scripts/registre-parametres-donnees.mjs <chemin-sqlite>"); process.exit(1); }
process.env.DB_PATH = dbPath;

const { initDb, all, get, run } = await import("../db/index.js");
initDb();

// ─── 1. Palette fermée (mêmes valeurs que --cat-1..12 dans tokens.css) ───
const PALETTE = [
  "#3B6EA5", "#4B8A6E", "#C97B2C", "#A05270",
  "#6E7A88", "#B04A3F", "#7C6BB0", "#2F8C8C",
  "#8C7A3F", "#5A7D3F", "#96566B", "#55606B",
];

// sRGB → Lab (D65) pour une distance perceptuelle honnête (deltaE76 suffit ici)
function hexToLab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = srgb;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const labs = PALETTE.map(hexToLab);
function nearest(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) return PALETTE[0];
  const [l, a, b] = hexToLab(hex);
  let best = 0, bestD = Infinity;
  labs.forEach(([l2, a2, b2], i) => {
    const d = (l - l2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return PALETTE[best];
}

let colorChanges = 0;
for (const c of all("SELECT id, name, color FROM categories")) {
  const target = nearest(c.color);
  if (target !== (c.color || "").toUpperCase()) {
    run("UPDATE categories SET color = ? WHERE id = ?", target, c.id);
    console.log(`  couleur : ${c.name} ${c.color} → ${target}`);
    colorChanges++;
  }
}

// ─── 2. Libellés livrés : accents et casse (briefs Template §9 et Paramètres §1.C) ───
const RENAMES = [
  ["Week-end / activitées", "Week-end / activités"],
  ["Vetements", "Vêtements"],
  ["impots et taxes", "Impôts et taxes"],
  ["Prevision EDF", "Prévision EDF"],
  ["courses", "Courses"],
  ["dettes", "Dettes"],
  ["Alimentation & litiere", "Alimentation & litière"],
  ["Xbox Game pass", "Xbox Game Pass"],
  ["Salaire revaw", "Salaire Revaw"],
];
let renameChanges = 0;
for (const [from, to] of RENAMES) {
  for (const [table, col] of [["categories", "name"], ["themes", "name"], ["budget_lines", "label"]]) {
    const r = run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, to, from);
    if (r.changes) { console.log(`  libellé : ${table}.${col} « ${from} » → « ${to} » (${r.changes})`); renameChanges += r.changes; }
  }
}

// ─── 3. Settings : casse des moyens de paiement et types d'investissement, avec propagation ───
const cap = (s) => (s.length > 1 && s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s.charAt(0).toUpperCase() + s.slice(1));
const PM_MAP = { especes: "Espèces", virement: "Virement", autre: "Autre", CB: "CB" };
const IT_MAP = { CRYPTO: "Crypto", STOCK: "Stock", OTHER: "Autre", ETF: "ETF", PEA: "PEA" };

const settings = get("SELECT * FROM app_settings WHERE id = 1");
let settingsChanges = 0;
if (settings) {
  const fixList = (raw, map, propagate) => {
    const list = JSON.parse(raw || "[]");
    const fixed = [];
    for (const v of list) {
      const nv = map[v] ?? cap(v);
      fixed.push(nv);
      if (nv !== v) {
        propagate(v, nv);
        console.log(`  valeur : « ${v} » → « ${nv} »`);
        settingsChanges++;
      }
    }
    return JSON.stringify([...new Set(fixed)]);
  };
  const pm = fixList(settings.payment_methods, PM_MAP, (from, to) => {
    run("UPDATE budget_lines SET payment_method = ? WHERE payment_method = ?", to, from);
    run("UPDATE entries SET payment_method = ? WHERE payment_method = ?", to, from);
  });
  const it = fixList(settings.investment_types, IT_MAP, (from, to) => {
    run("UPDATE assets SET type = ? WHERE type = ?", to, from);
  });
  run("UPDATE app_settings SET payment_methods = ?, investment_types = ? WHERE id = 1", pm, it);
}

console.log(`\nTerminé : ${colorChanges} couleur(s), ${renameChanges} libellé(s), ${settingsChanges} valeur(s) de réglage.`);
