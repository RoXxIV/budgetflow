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
});

export default mongoose.model("Account", AccountSchema);
