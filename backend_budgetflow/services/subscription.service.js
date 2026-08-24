import Subscription from "../models/Subscription.model.js";

const POPULATE = { path: "theme", select: "name color" };

export const getAll = () => Subscription.find().sort({ name: 1 }).populate(POPULATE);

export const getById = (id) => Subscription.findById(id).populate(POPULATE);

export const create = async (data) => {
  const sub = await Subscription.create(data);
  return sub.populate(POPULATE);
};

export const update = (id, data) =>
  Subscription.findByIdAndUpdate(id, data, { returnDocument: "after", runValidators: true })
    .populate(POPULATE);

export const remove = (id) => Subscription.findByIdAndDelete(id);
