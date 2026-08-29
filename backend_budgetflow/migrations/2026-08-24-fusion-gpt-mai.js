// Migration de données : Mai 2026, la ligne "GPT" (catégorie Dettes, 21 €) est fusionnée
// dans la ligne "ChatGPT" (Abonnements) — son entrée est rattachée à ChatGPT, la ligne GPT supprimée.
// Idempotente.
//
// Usage : mongosh "mongodb://127.0.0.1:27017" --eval "var DB='budget_app'" migrations/2026-08-24-fusion-gpt-mai.js

const dbName = typeof DB !== "undefined" ? DB : "budget_app_v3";
const target = db.getSiblingDB(dbName);
print(`Base : ${dbName}`);

const mai = target.monthlysheets.findOne({ isTemplate: false, name: "Mai 2026" });
const dettes = target.sections.findOne({ name: /^dettes$/i });
const gpt = mai && dettes && target.budgetlines.findOne({ sheet: mai._id, section: dettes._id, label: /^gpt$/i });
const chatgpt = mai && target.budgetlines.findOne({ sheet: mai._id, label: /^chatgpt$/i });

if (!gpt) {
  print("  ligne GPT (Dettes, mai) absente — rien à faire");
} else if (!chatgpt) {
  print("  ERREUR : ligne ChatGPT de mai introuvable — abandon");
  quit(1);
} else {
  const moved = target.transactions.updateMany({ budgetLine: gpt._id }, { $set: { budgetLine: chatgpt._id } });
  target.budgetlines.updateOne({ _id: chatgpt._id }, { $inc: { actualAmount: gpt.actualAmount || 0 } });
  target.budgetlines.deleteOne({ _id: gpt._id });
  print(`  ${moved.modifiedCount} entrée(s) rattachée(s) à ChatGPT, +${gpt.actualAmount} € sur son réel, ligne GPT supprimée`);
}
print("Migration terminée.");
