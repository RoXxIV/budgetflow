import MonthlySheet from "../models/MonthlySheet.model.js";
import BudgetLine from "../models/BudgetLine.model.js";

const POPULATE = [
  { path: "section", select: "name color" },
  { path: "theme", select: "name color" },
  { path: "fromAccount", select: "name type" },
  { path: "toAccount", select: "name type" },
];

// Récupère le template, le crée s'il n'existe pas
export const getTemplate = async () => {
  let template = await MonthlySheet.findOne({ isTemplate: true });
  if (!template) {
    template = await MonthlySheet.create({
      isTemplate: true,
      name: "Template",
      periodMonth: new Date("2000-01-01"),
    });
  }
  return template;
};

export const getLines = async (templateId) => {
  return BudgetLine.find({ sheet: templateId })
    .populate(POPULATE)
    .sort({ section: 1, order: 1, _id: 1 });
};

export const createLine = async (templateId, data) => {
  const line = await BudgetLine.create({ ...data, sheet: templateId });
  return line.populate(POPULATE);
};

export const updateLine = async (id, data) => {
  const line = await BudgetLine.findByIdAndUpdate(id, data, {
    returnDocument: 'after',
    runValidators: true,
  });
  return line?.populate(POPULATE);
};

export const deleteLine = (id) => BudgetLine.findByIdAndDelete(id);

export const reorderLines = async (orders) => {
  // orders = [{ id, order }, ...]
  await Promise.all(
    orders.map(({ id, order }) =>
      BudgetLine.findByIdAndUpdate(id, { order })
    )
  );
};
