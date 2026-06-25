import * as themeService from "../services/theme.service.js";

export const getAll = async (req, res) => {
  const themes = await themeService.getAll();
  res.json(themes);
};

export const getById = async (req, res) => {
  const theme = await themeService.getById(req.params.id);
  if (!theme) return res.status(404).json({ message: "Thème introuvable" });
  res.json(theme);
};

export const create = async (req, res) => {
  const theme = await themeService.create(req.body);
  res.status(201).json(theme);
};

export const update = async (req, res) => {
  const theme = await themeService.update(req.params.id, req.body);
  if (!theme) return res.status(404).json({ message: "Thème introuvable" });
  res.json(theme);
};

export const remove = async (req, res) => {
  const theme = await themeService.remove(req.params.id);
  if (!theme) return res.status(404).json({ message: "Thème introuvable" });
  res.json({ message: "Thème supprimé" });
};
