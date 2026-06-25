import * as settingsService from "../services/settings.service.js";

export const get = async (req, res) => {
  const settings = await settingsService.get();
  res.json(settings);
};

export const update = async (req, res) => {
  const settings = await settingsService.update(req.body);
  res.json(settings);
};
