// Migration de données : suppression de la catégorie "Dettes" (vide), le thème "dettes" est conservé.
// Idempotente. Refuse de supprimer si des lignes y sont encore rattachées.
//
// Usage : mongosh "mongodb://127.0.0.1:27017" --eval "var DB='budget_app_v3'" migrations/2026-08-24-suppression-categorie-dettes.js

const dbName = typeof DB !== "undefined" ? DB : "budget_app_v3";
const target = db.getSiblingDB(dbName);
print(`Base : ${dbName}`);

const section = target.sections.findOne({ name: /^dettes$/i });
if (!section) {
  print("  catégorie Dettes déjà absente");
} else {
  const refs = target.budgetlines.countDocuments({ section: section._id });
  if (refs > 0) {
    print(`  ABANDON : ${refs} ligne(s) encore rattachée(s) à la catégorie Dettes`);
    quit(1);
  }
  // Un thème éventuellement rangé sous cette catégorie est détaché, pas supprimé
  const themes = target.themes.updateMany({ section: section._id }, { $unset: { section: "" } });
  target.sections.deleteOne({ _id: section._id });
  print(`  catégorie « Dettes » supprimée (${themes.modifiedCount} thème(s) détaché(s))`);
}
print("Migration terminée.");
