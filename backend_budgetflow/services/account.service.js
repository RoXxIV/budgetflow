import Account from "../models/Account.model.js";

export const getAll = () => Account.find().sort({ name: 1 });

export const getById = (id) => Account.findById(id);

export const create = (data) => Account.create(data);

export const update = (id, data) =>
  Account.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true });

export const remove = (id) => Account.findByIdAndDelete(id);
