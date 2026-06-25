import Section from "../models/Section.model.js";

export const getAll = () => Section.find().sort({ order: 1, name: 1 });

export const getById = (id) => Section.findById(id);

export const create = (data) => Section.create(data);

export const update = (id, data) =>
  Section.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true });

export const remove = (id) => Section.findByIdAndDelete(id);

export const reorder = async (orders) => {
  // orders = [{ id, order }, ...]
  await Promise.all(
    orders.map(({ id, order }) => Section.findByIdAndUpdate(id, { order }))
  );
};
