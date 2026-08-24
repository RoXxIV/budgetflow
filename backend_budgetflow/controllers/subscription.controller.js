import * as subscriptionService from "../services/subscription.service.js";

export const getAll = async (req, res) => {
  const subs = await subscriptionService.getAll();
  res.json(subs);
};

export const getById = async (req, res) => {
  const sub = await subscriptionService.getById(req.params.id);
  if (!sub) return res.status(404).json({ message: "Abonnement introuvable" });
  res.json(sub);
};

export const create = async (req, res) => {
  const sub = await subscriptionService.create(req.body);
  res.status(201).json(sub);
};

export const update = async (req, res) => {
  const sub = await subscriptionService.update(req.params.id, req.body);
  if (!sub) return res.status(404).json({ message: "Abonnement introuvable" });
  res.json(sub);
};

export const remove = async (req, res) => {
  const sub = await subscriptionService.remove(req.params.id);
  if (!sub) return res.status(404).json({ message: "Abonnement introuvable" });
  res.json({ message: "Abonnement supprimé" });
};
