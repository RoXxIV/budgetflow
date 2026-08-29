// Migration de données : déplace la ligne "SRF BOX" (Logement & factures) vers
// "SFR Box" (Abonnements) dans tous les sheets, alignée sur la ligne du template.
// Idempotente : peut être rejouée sans effet de bord.
//
// Usage : mongosh "mongodb://127.0.0.1:27017" --eval "var DB='budget_app_v3'" migrations/2026-08-24-sfr-box-vers-abonnements.js

const dbName = typeof DB !== "undefined" ? DB : "budget_app_v3";
const target = db.getSiblingDB(dbName);
print(`Base : ${dbName}`);

const section = target.sections.findOne({ name: "Abonnements" });
const theme = target.themes.findOne({ name: "Internet" });
const template = target.monthlysheets.findOne({ isTemplate: true });
const templateLine = target.budgetlines.findOne({ sheet: template._id, label: /^sfr box$/i });
const oldTheme = target.themes.findOne({ name: "Tel" });

if (!section || !theme || !templateLine) {
  print("ERREUR : section Abonnements, thème Internet ou ligne template 'SFR Box' introuvable — abandon.");
  quit(1);
}

// Lignes des sheets (hors template) encore libellées "SRF BOX" ou déjà "SFR Box" mais mal rangées
const lines = target.budgetlines
  .find({ sheet: { $ne: template._id }, label: /^s(r|f)(f|r) box$/i })
  .toArray();

let movedLines = 0;
let movedTx = 0;
for (const l of lines) {
  const res = target.budgetlines.updateOne(
    { _id: l._id },
    {
      $set: {
        label: "SFR Box",
        section: section._id,
        theme: theme._id,
        templateLine: templateLine._id,
      },
    }
  );
  if (res.modifiedCount) movedLines++;

  // Entrées de la ligne qui portaient explicitement l'ancien thème "Tel" → "Internet"
  if (oldTheme) {
    const tx = target.transactions.updateMany(
      { budgetLine: l._id, theme: oldTheme._id },
      { $set: { theme: theme._id } }
    );
    movedTx += tx.modifiedCount;
  }
}

print(`Lignes trouvées : ${lines.length} | modifiées : ${movedLines} | entrées re-thématisées : ${movedTx}`);
