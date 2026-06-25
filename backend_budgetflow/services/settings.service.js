import AppSettings from "../models/AppSettings.model.js";

// Singleton : on récupère le premier document, on le crée s'il n'existe pas
const POPULATE = [
  { path: "rentBudgetLine", select: "label plannedAmount" },
  { path: "mainAccount", select: "name type" },
];

export const get = async () => {
  let settings = await AppSettings.findOne().populate(POPULATE);

  if (!settings) {
    settings = await AppSettings.create({});
    await settings.populate(POPULATE);
  }

  return settings;
};

export const update = async (data) => {
  let settings = await AppSettings.findOne();

  if (!settings) {
    settings = await AppSettings.create(data);
  } else {
    Object.assign(settings, data);
    await settings.save();
  }

  return settings.populate(POPULATE);
};
