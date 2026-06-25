import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const UtilityMeterSchema = new Schema({
  name: String, // ex: EDF

  theme: {
    type: Types.ObjectId,
    ref: "Theme",
  }, // catégorie

  budgetLine: {
    type: Types.ObjectId,
    ref: "BudgetLine",
  }, // ligne du template correspondant à la mensualité (ex: ligne EDF)

  config: {
    hpPrice: Number, // prix heure pleine

    hcPrice: Number, // prix heure creuse

    subscriptionPrice: Number, // abonnement

    tvaRate: {
      type: Number,
      default: 20,
    }, // taux TVA en % (20% par défaut)
  },
});

export default mongoose.model("UtilityMeter", UtilityMeterSchema);
