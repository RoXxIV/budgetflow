import * as investmentService from "../services/investment.service.js";

export const getAll = async (req, res) => {
  const investments = await investmentService.getAll();
  res.json(investments);
};

export const getById = async (req, res) => {
  const investment = await investmentService.getById(req.params.id);
  if (!investment) return res.status(404).json({ message: "Investissement introuvable" });
  res.json(investment);
};

export const create = async (req, res) => {
  const investment = await investmentService.create(req.body);
  res.status(201).json(investment);
};

export const update = async (req, res) => {
  const investment = await investmentService.update(req.params.id, req.body);
  if (!investment) return res.status(404).json({ message: "Investissement introuvable" });
  res.json(investment);
};

export const remove = async (req, res) => {
  const investment = await investmentService.remove(req.params.id);
  if (!investment) return res.status(404).json({ message: "Investissement introuvable" });
  res.json({ message: "Investissement supprimé" });
};
