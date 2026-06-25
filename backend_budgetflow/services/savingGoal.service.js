import SavingGoal from "../models/SavingGoal.model.js";
import SavingContribution from "../models/SavingContribution.model.js";

const POPULATE = [{ path: "account", select: "name type" }];

export const getAll = async () => {
  const goals = await SavingGoal.find().populate(POPULATE).sort({ createdAt: -1 });

  // Ajoute le total des contributions à chaque objectif
  const withTotals = await Promise.all(
    goals.map(async (goal) => {
      const contributions = await SavingContribution.find({ goal: goal._id });
      const totalContributed = contributions.reduce((sum, c) => sum + c.amount, 0);
      const obj = goal.toObject();
      obj.totalContributed = totalContributed;
      obj.currentAmount = (obj.initialAmount || 0) + totalContributed;
      return obj;
    })
  );

  return withTotals;
};

export const getById = (id) => SavingGoal.findById(id).populate(POPULATE);

export const create = (data) => SavingGoal.create(data);

export const update = (id, data) =>
  SavingGoal.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true }).populate(POPULATE);

export const remove = (id) => SavingGoal.findByIdAndDelete(id);

// ─── Contributions ────────────────────────────────────────
export const getContributions = (goalId) =>
  SavingContribution.find({ goal: goalId }).sort({ date: -1 });

export const addContribution = (data) => SavingContribution.create(data);

export const removeContribution = (id) => SavingContribution.findByIdAndDelete(id);
