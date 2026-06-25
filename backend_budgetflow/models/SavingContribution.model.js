import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const SavingContributionSchema = new Schema({
  goal: {
    type: Types.ObjectId,
    ref: "SavingGoal",
    required: true,
  }, // objectif concerné

  sheet: {
    type: Types.ObjectId,
    ref: "MonthlySheet",
  }, // mois où l'argent a été ajouté

  amount: {
    type: Number,
    required: true,
  }, // montant ajouté

  date: {
    type: Date,
    default: Date.now,
  }, // date du mouvement

  notes: String,
});

SavingContributionSchema.index({ goal: 1 });

export default mongoose.model("SavingContribution", SavingContributionSchema);
