import * as templateService from "../services/template.service.js";

export const getTemplate = async (req, res) => {
  const template = await templateService.getTemplate();
  res.json(template);
};

export const getLines = async (req, res) => {
  const template = await templateService.getTemplate();
  const lines = await templateService.getLines(template._id);
  res.json(lines);
};

export const createLine = async (req, res) => {
  const template = await templateService.getTemplate();
  const line = await templateService.createLine(template._id, req.body);
  res.status(201).json(line);
};

export const updateLine = async (req, res) => {
  const line = await templateService.updateLine(req.params.id, req.body);
  if (!line) return res.status(404).json({ message: "Ligne introuvable" });
  res.json(line);
};

export const deleteLine = async (req, res) => {
  const line = await templateService.deleteLine(req.params.id);
  if (!line) return res.status(404).json({ message: "Ligne introuvable" });
  res.json({ message: "Ligne supprimée" });
};

export const reorderLines = async (req, res) => {
  await templateService.reorderLines(req.body);
  res.json({ message: "Ordre mis à jour" });
};
