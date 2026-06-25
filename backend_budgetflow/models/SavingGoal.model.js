import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const SavingGoalSchema = new Schema({
  name: {
    type: String,
    required: true,
  }, // ex: Japon

  isCompleted: Boolean, // objectif atteint
  account: {
    type: Types.ObjectId,
    ref: "Account",
    required: true,
  }, // compte où l'argent est stocké (ex: N26 Voyage)

  targetAmount: {
    type: Number,
    required: true,
  }, // montant objectif ex: 4500€

  initialAmount: {
    type: Number,
    default: 0,
  }, // montant déjà disponible au départ

  deadline: {
    type: Date,
    required: true,
  }, // date cible ex: 2026-10-01

  createdAt: {
    type: Date,
    default: Date.now,
  }, // création objectif
});

export default mongoose.model("SavingGoal", SavingGoalSchema);
