import Theme from "../models/Theme.model.js";

export const getAll = () => Theme.find().sort({ name: 1 });

export const getById = (id) => Theme.findById(id);

export const create = (data) => Theme.create(data);

export const update = (id, data) =>
  Theme.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true });

export const remove = (id) => Theme.findByIdAndDelete(id);
