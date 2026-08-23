import mongoose from "mongoose";

const { Schema } = mongoose;

const AccountSchema = new Schema({
  name: {
    type: String,
    required: true,
  }, // ex: N26 Main, Revolut

  type: {
    type: String,
    enum: ["bank", "cash", "savings"],
    default: "bank",
  }, // type de compte

  includeInNetWorth: {
    type: Boolean,
    default: true,
  }, // inclure dans le total patrimoine

  trackInSavingsChart: {
    type: Boolean,
    default: true,
  }, // afficher ce compte dans le graphe Épargne & Investissements (comptes épargne)
});

export default mongoose.model("Account", AccountSchema);
