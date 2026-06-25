import UtilityMeter from "../models/UtilityMeter.model.js";

const POPULATE = [
  { path: "theme", select: "name color" },
  { path: "budgetLine", select: "label plannedAmount" },
];

export const getAll = () => UtilityMeter.find().populate(POPULATE);

export const getById = (id) => UtilityMeter.findById(id).populate(POPULATE);

export const create = (data) => UtilityMeter.create(data);

export const update = (id, data) =>
  UtilityMeter.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true }).populate(POPULATE);

export const remove = (id) => UtilityMeter.findByIdAndDelete(id);
