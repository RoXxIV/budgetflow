import * as savingGoalService from "../services/savingGoal.service.js";

export const getAll = async (req, res) => {
  const goals = await savingGoalService.getAll();
  res.json(goals);
};

export const getById = async (req, res) => {
  const goal = await savingGoalService.getById(req.params.id);
  if (!goal) return res.status(404).json({ message: "Objectif introuvable" });
  res.json(goal);
};

export const create = async (req, res) => {
  const goal = await savingGoalService.create(req.body);
  res.status(201).json(goal);
};

export const update = async (req, res) => {
  const goal = await savingGoalService.update(req.params.id, req.body);
  if (!goal) return res.status(404).json({ message: "Objectif introuvable" });
  res.json(goal);
};

export const remove = async (req, res) => {
  const goal = await savingGoalService.remove(req.params.id);
  if (!goal) return res.status(404).json({ message: "Objectif introuvable" });
  res.json({ message: "Objectif supprimé" });
};

// ─── Contributions ────────────────────────────────────────
export const getContributions = async (req, res) => {
  const contributions = await savingGoalService.getContributions(req.params.id);
  res.json(contributions);
};

export const addContribution = async (req, res) => {
  const contribution = await savingGoalService.addContribution({
    ...req.body,
    goal: req.params.id,
  });
  res.status(201).json(contribution);
};

export const removeContribution = async (req, res) => {
  await savingGoalService.removeContribution(req.params.contributionId);
  res.json({ message: "Contribution supprimée" });
};
