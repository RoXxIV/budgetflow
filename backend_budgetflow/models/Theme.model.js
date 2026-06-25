import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const ThemeSchema = new Schema({
  name: {
    type: String,
    required: true,
  }, // ex: alimentation

  color: String, // couleur UI

  section: {
    type: Types.ObjectId,
    ref: "Section",
  }, // section parent (optionnel depuis les paramètres)

  role: {
    type: String,
    enum: ["normal", "rent_base"],
    default: "normal",
  }, // rent_base = loyer

  isSharedDefault: {
    type: Boolean,
    default: false,
  }, // dépense partagée par défaut
});

export default mongoose.model("Theme", ThemeSchema);
