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

  renewalDate: {
    type: Date,
    required: true,
  }, // date de prélèvement (ancre — les échéances suivantes se déduisent de la périodicité)

  period: {
    type: String,
    enum: ["weekly", "monthly", "yearly"],
    default: "monthly",
  }, // périodicité du prélèvement

  price: {
    type: Number,
    required: true,
    default: 0,
  }, // prix par échéance

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Subscription", SubscriptionSchema);
