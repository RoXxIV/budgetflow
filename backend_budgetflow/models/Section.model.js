import mongoose from "mongoose";

const { Schema } = mongoose;

const SectionSchema = new Schema({
  name: {
    type: String,
    required: true,
  }, // ex: Facture, Dépense

  icon: String, // icône UI

  color: String, // couleur UI

  order: Number, // ordre affichage
});

export default mongoose.model("Section", SectionSchema);
