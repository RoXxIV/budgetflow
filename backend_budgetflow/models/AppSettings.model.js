import mongoose from "mongoose";

const { Schema } = mongoose;

const AppSettingsSchema = new Schema({
  savingRate: {
    type: Number,
    default: 0,
  }, // objectif d'épargne global (%) ex: 40 = économiser 40% des revenus

  currency: {
    type: String,
    default: "EUR",
  }, // devise principale

  paymentMethods: {
    type: [String],
    default: () => ["CB", "virement", "especes", "autre"],
  }, // moyens de paiement proposés sur les entrées

  investmentTypes: {
    type: [String],
    default: () => ["ETF", "CRYPTO", "STOCK", "OTHER"],
  }, // types d'actifs proposés pour les investissements

  createdAt: {
    type: Date,
    default: Date.now,
  },
  includeInvestmentsInSavings: {
    type: Boolean,
    default: true,
  }, // compter les investissements dans l'épargne

  partnerRentAmount: {
    type: Number,
    default: 0,
  }, // montant fixe payé par la copine pour le loyer — utilisé dans le calcul 50/50

  rentBudgetLine: {
    type: Schema.Types.ObjectId,
    ref: "BudgetLine",
  }, // ligne du template correspondant au virement envoyé à la copine (résultat du calcul ½)

  mainAccount: {
    type: Schema.Types.ObjectId,
    ref: "Account",
  }, // compte principal pour le calcul "Reste réel" dans le bilan
});

export default mongoose.model("AppSettings", AppSettingsSchema);
