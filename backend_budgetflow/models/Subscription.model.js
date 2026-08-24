import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const SubscriptionSchema = new Schema({
  name: {
    type: String,
    required: true,
  }, // ex: Netflix

  theme: {
    type: Types.ObjectId,
    ref: "Theme",
  }, // catégorie (ex: Streaming)

  period: {
    type: String,
    enum: ["weekly", "monthly", "yearly"],
    default: "monthly",
  }, // périodicité du prélèvement

  renewalDay: {
    type: Number,
    required: true,
  }, // jour de prélèvement, selon la périodicité :
  // hebdo = jour de semaine (0=dimanche … 6=samedi), mensuel = 1-31, annuel = mois (0=janvier … 11=décembre)

  price: {
    type: Number,
    required: true,
    default: 0,
  }, // prix par échéance

  effortPrice: {
    type: Number,
    default: null,
  }, // prix de comparaison "si effort" (ex: offre moins chère envisagée) — optionnel

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Subscription", SubscriptionSchema);
