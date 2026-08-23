import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const TransactionSchema = new Schema({
  sheet: {
    type: Types.ObjectId,
    ref: "MonthlySheet",
    required: true,
  }, // mois

  budgetLine: {
    type: Types.ObjectId,
    ref: "BudgetLine",
  }, // enveloppe associée

  label: String, // ex: Carrefour

  details: String, // précision de l'entrée, affichée "label - details" (ex: Amazon - écouteurs)

  theme: {
    type: Types.ObjectId,
    ref: "Theme",
  }, // catégorie propre à cette entrée (gérée comme details : par entrée)

  amount: {
    type: Number,
    required: true,
  }, // montant réel

  flow: {
    type: String,
    enum: ["income", "expense"],
    required: true,
  }, // type flux

  account: {
    type: Types.ObjectId,
    ref: "Account",
  }, // compte utilisé

  paymentMethod: {
    type: String,
  }, // moyen de paiement de cette entrée (liste configurable dans AppSettings)

  isShared: {
    type: Boolean,
    default: false,
  }, // dépense partagée 50/50, propre à cette entrée

  date: {
    type: Date,
    default: Date.now,
  }, // date transaction

  source: {
    type: String,
    enum: ["manual", "bank_import", "meter", "cancellation", "rounding"],
    default: "manual",
  }, // origine

  goal: {
    type: Types.ObjectId,
    ref: "SavingGoal",
  }, // contribution à un objectif d'épargne

  notes: String,
});

TransactionSchema.index({ sheet: 1 });
TransactionSchema.index({ budgetLine: 1 });

export default mongoose.model("Transaction", TransactionSchema);
