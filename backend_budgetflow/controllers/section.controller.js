import * as sectionService from "../services/section.service.js";

export const getAll = async (req, res) => {
  const sections = await sectionService.getAll();
  res.json(sections);
};

export const getById = async (req, res) => {
  const section = await sectionService.getById(req.params.id);
  if (!section) return res.status(404).json({ message: "Section introuvable" });
  res.json(section);
};

export const create = async (req, res) => {
  const section = await sectionService.create(req.body);
  res.status(201).json(section);
};

export const update = async (req, res) => {
  const section = await sectionService.update(req.params.id, req.body);
  if (!section) return res.status(404).json({ message: "Section introuvable" });
  res.json(section);
};

export const remove = async (req, res) => {
  const section = await sectionService.remove(req.params.id);
  if (!section) return res.status(404).json({ message: "Section introuvable" });
  res.json({ message: "Section supprimée" });
};

export const reorder = async (req, res) => {
  await sectionService.reorder(req.body);
  res.json({ message: "Ordre mis à jour" });
};
