import * as accountService from "../services/account.service.js";

export const getAll = async (req, res) => {
  const accounts = await accountService.getAll();
  res.json(accounts);
};

export const getById = async (req, res) => {
  const account = await accountService.getById(req.params.id);
  if (!account) return res.status(404).json({ message: "Compte introuvable" });
  res.json(account);
};

export const create = async (req, res) => {
  const account = await accountService.create(req.body);
  res.status(201).json(account);
};

export const update = async (req, res) => {
  const account = await accountService.update(req.params.id, req.body);
  if (!account) return res.status(404).json({ message: "Compte introuvable" });
  res.json(account);
};

export const remove = async (req, res) => {
  const account = await accountService.remove(req.params.id);
  if (!account) return res.status(404).json({ message: "Compte introuvable" });
  res.json({ message: "Compte supprimé" });
};
