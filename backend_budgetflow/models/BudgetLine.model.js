import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const BudgetLineSchema = new Schema({
  sheet: {
    type: Types.ObjectId,
    ref: "MonthlySheet",
    required: true,
  }, // mois

  label: {
    type: String,
    required: true,
  }, // ex: alimentation

  section: {
    type: Types.ObjectId,
    ref: "Section",
  }, // bloc UI

  theme: {
    type: Types.ObjectId,
    ref: "Theme",
  }, // catégorie

  flow: {
    type: String,
    enum: ["expense", "income"],
    default: "expense",
  }, // dépense ou revenu

  plannedAmount: {
    type: Number,
    default: 0,
  }, // budget prévu

  type: {
    type: String,
    enum: ["fixed", "variable"],
    default: "variable",
  }, // type de dépense

  fromAccount: {
    type: Types.ObjectId,
    ref: "Account",
  }, // compte source par défaut (Depuis)

  toAccount: {
    type: Types.ObjectId,
    ref: "Account",
  }, // compte destination par défaut (Vers)

  paymentMethod: {
    type: String,
  }, // moyen de paiement (liste configurable dans AppSettings)

  isShared: {
    type: Boolean,
    default: false,
  }, // dépense partagée 50/50 (calcul rééquilibrage)

  templateLine: {
    type: Types.ObjectId,
    ref: "BudgetLine",
  }, // référence vers la ligne du template dont elle est issue

  date: {
    type: Date,
    default: Date.now,
  }, // date de la dépense/recette (pour les stats)

  recurringDay: {
    type: Number,
    min: 1,
    max: 31,
  }, // jour du mois pour une dépense récurrente (facture) — pré-remplit la date des entrées

  order: Number, // ordre affichage

  notes: String, // commentaire

  actualAmount: {
    type: Number,
    default: 0,
  }, // montant réel dépensé, saisi directement sur la ligne
});

BudgetLineSchema.index({ sheet: 1 });

export default mongoose.model("BudgetLine", BudgetLineSchema);
