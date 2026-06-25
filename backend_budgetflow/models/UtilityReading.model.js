import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const UtilityReadingSchema = new Schema({
  meter: {
    type: Types.ObjectId,
    ref: "UtilityMeter",
  }, // compteur

  sheet: {
    type: Types.ObjectId,
    ref: "MonthlySheet",
  }, // mois

  hpPrevious: Number, // index HP début

  hpCurrent: Number, // index HP fin

  hcPrevious: Number, // index HC début

  hcCurrent: Number, // index HC fin
});

export default mongoose.model("UtilityReading", UtilityReadingSchema);
