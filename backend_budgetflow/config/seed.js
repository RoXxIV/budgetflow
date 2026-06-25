import MonthlySheet from "../models/MonthlySheet.model.js";

// Crée le template par défaut s'il n'existe pas encore
export const seed = async () => {
  const template = await MonthlySheet.findOne({ isTemplate: true });
  if (!template) {
    await MonthlySheet.create({
      isTemplate: true,
      name: "Template",
      periodMonth: new Date("2000-01-01"),
    });
    console.log("Template par défaut créé.");
  }
};
