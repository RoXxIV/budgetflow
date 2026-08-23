import mongoose from "mongoose";

const { Schema } = mongoose;

const MonthlySheetSchema = new Schema({
  periodMonth: {
    type: Date,
    required: true,
  }, // ex: 2026-04-01

  name: String, // ex: Avril 2026

  isTemplate: {
    type: Boolean,
    default: false,
  }, // feuille template

  status: {
    type: String,
    enum: ["draft", "active", "archived"],
    default: "active",
  }, // état de la feuille

  createdAt: {
    type: Date,
    default: Date.now,
  }, // date création
});

// Un seul sheet par mois calendaire (le template est hors périmètre)
MonthlySheetSchema.index(
  { periodMonth: 1 },
  { unique: true, partialFilterExpression: { isTemplate: false }, name: "periodMonth_unique_nontemplate" }
);

export default mongoose.model("MonthlySheet", MonthlySheetSchema);
