import Investment from "../models/Investment.model.js";
import InvestmentTransaction from "../models/InvestmentTransaction.model.js";

const POPULATE = [{ path: "account", select: "name type" }];

export const getAll = async () => {
  const investments = await Investment.find().populate(POPULATE).sort({ name: 1 });
  return Promise.all(
    investments.map(async (inv) => {
      const txs = await InvestmentTransaction.find({ investment: inv._id });
      const totalInvested = txs.reduce((s, t) => s + t.amount, 0);
      const obj = inv.toObject();
      obj.totalInvested = totalInvested;
      return obj;
    })
  );
};

export const getById = (id) => Investment.findById(id).populate(POPULATE);

export const create = (data) => Investment.create(data);

export const update = (id, data) =>
  Investment.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true }).populate(POPULATE);

export const remove = (id) => Investment.findByIdAndDelete(id);
