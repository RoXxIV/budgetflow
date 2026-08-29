// Migration de données : suppression de l'ancien circuit d'épargne "catégorie Épargnes".
//  1. Les lignes Février 2026 "Japon" (500 €) et "Matelas" (56 €) deviennent des versements
//     d'objectifs datés du 28/02/2026 (historique conservé, aucune incidence sur les soldes :
//     février est archivé, les soldes actuels viennent des snapshots suivants).
//  2. Les 3 lignes de la catégorie (dont la correction manuelle "BTC −200 €") et leurs entrées sont supprimées.
//  3. Le thème "Epargnes" et la catégorie "Épargnes" sont supprimés (plus aucune référence).
// Idempotente : rejouable sans effet de bord.
//
// Usage : mongosh "mongodb://127.0.0.1:27017" --eval "var DB='budget_app_v3'" migrations/2026-08-24-suppression-categorie-epargnes.js

const dbName = typeof DB !== "undefined" ? DB : "budget_app_v3";
const target = db.getSiblingDB(dbName);
print(`Base : ${dbName}`);

const section = target.sections.findOne({ name: /^épargnes$/i });
const theme = target.themes.findOne({ name: /^epargnes\s*$/i });
const template = target.monthlysheets.findOne({ isTemplate: true });
const goalJapon = target.savinggoals.findOne({ name: /japon/i });
const goalMatelas = target.savinggoals.findOne({ name: /matelas/i });

if (!goalJapon || !goalMatelas || !template) {
  print("ERREUR : objectifs Japon / Matelas ou sheet template introuvables — abandon.");
  quit(1);
}

// ── 1. Conversion des lignes Japon / Matelas en versements ──────────────
const CONVERSIONS = [
  { label: /^japon$/i, goal: goalJapon, note: "Migration : ancienne ligne Épargnes « Japon » (février 2026)" },
  { label: /^matelas$/i, goal: goalMatelas, note: "Migration : ancienne ligne Épargnes « Matelas » (février 2026)" },
];
for (const c of CONVERSIONS) {
  if (target.savingcontributions.findOne({ notes: c.note })) {
    print(`  versement déjà créé : ${c.note}`);
    continue;
  }
  // Uniquement une ligne de sheet réel (jamais le template) avec un montant réellement versé
  const line =
    section &&
    target.budgetlines.findOne({
      section: section._id,
      label: c.label,
      sheet: { $ne: template._id },
      actualAmount: { $gt: 0 },
    });
  if (!line) {
    print(`  ligne ${c.label} absente (déjà migrée ?)`);
    continue;
  }
  target.savingcontributions.insertOne({
    goal: c.goal._id,
    sheet: line.sheet,
    amount: line.actualAmount,
    date: new Date("2026-02-28T12:00:00Z"),
    notes: c.note,
  });
  print(`  versement créé : ${c.goal.name} +${line.actualAmount} € (février 2026)`);
}

// ── 2. Suppression des lignes de la catégorie et de leurs entrées ───────
if (section) {
  const lines = target.budgetlines.find({ section: section._id }).toArray();
  const lineIds = lines.map((l) => l._id);
  const tx = target.transactions.deleteMany({ budgetLine: { $in: lineIds } });
  const bl = target.budgetlines.deleteMany({ _id: { $in: lineIds } });
  print(`  lignes supprimées : ${bl.deletedCount} (${lines.map((l) => l.label + " " + l.actualAmount + "€").join(", ") || "aucune"}) | entrées supprimées : ${tx.deletedCount}`);
}

// ── 3. Thème "Epargnes" ─────────────────────────────────────────────────
if (theme) {
  const refs =
    target.budgetlines.countDocuments({ theme: theme._id }) +
    target.transactions.countDocuments({ theme: theme._id }) +
    target.utilitymeters.countDocuments({ theme: theme._id });
  if (refs > 0) {
    print(`  thème « ${theme.name.trim()} » conservé : encore ${refs} référence(s)`);
  } else {
    target.themes.deleteOne({ _id: theme._id });
    print(`  thème « ${theme.name.trim()} » supprimé`);
  }
} else {
  print("  thème Epargnes déjà absent");
}

// ── 4. Catégorie "Épargnes" ─────────────────────────────────────────────
if (section) {
  const refs = target.budgetlines.countDocuments({ section: section._id });
  target.themes.updateMany({ section: section._id }, { $unset: { section: "" } });
  if (refs > 0) {
    print(`  catégorie conservée : encore ${refs} ligne(s) rattachée(s)`);
  } else {
    target.sections.deleteOne({ _id: section._id });
    print("  catégorie « Épargnes » supprimée");
  }
} else {
  print("  catégorie Épargnes déjà absente");
}

print("Migration terminée.");
