import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const AccountSnapshotSchema = new Schema({
  sheet: {
    type: Types.ObjectId,
    ref: "MonthlySheet",
    required: true,
  }, // mois concerné

  account: {
    type: Types.ObjectId,
    ref: "Account",
    required: true,
  }, // compte

  balance: {
    type: Number,
    required: true,
  }, // solde début mois
});

AccountSnapshotSchema.index({ sheet: 1, account: 1 }, { unique: true });

export default mongoose.model("AccountSnapshot", AccountSnapshotSchema);
