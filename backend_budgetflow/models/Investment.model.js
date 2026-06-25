import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const InvestmentSchema = new Schema({
  name: {
    type: String,
    required: true,
  }, // ex: MSCI World, BTC

  type: {
    type: String,
    enum: ["ETF", "CRYPTO", "STOCK", "OTHER"],
  }, // type d'actif

  account: {
    type: Types.ObjectId,
    ref: "Account",
    required: true,
  }, // compte associé ex: PEA

  monthlyInvestment: {
    type: Number,
    default: 0,
  }, // montant investi chaque mois (DCA)

  currentValue: {
    type: Number,
    default: 0,
  }, // valeur actuelle totale

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Investment", InvestmentSchema);
