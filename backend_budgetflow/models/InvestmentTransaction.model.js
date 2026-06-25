import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const InvestmentTransactionSchema = new Schema({
  investment: {
    type: Types.ObjectId,
    ref: "Investment",
    required: true,
  }, // actif concerné

  amount: {
    type: Number,
    required: true,
  }, // montant investi

  date: {
    type: Date,
    default: Date.now,
  }, // date achat

  sheet: {
    type: Types.ObjectId,
    ref: "MonthlySheet",
  }, // mois (optionnel)

  notes: String,
});

InvestmentTransactionSchema.index({ investment: 1 });

export default mongoose.model(
  "InvestmentTransaction",
  InvestmentTransactionSchema,
);
