import * as transactionService from "../services/transaction.service.js";

export const create = async (req, res) => {
  const tx = await transactionService.create(req.body);
  res.status(201).json(tx);
};

export const update = async (req, res) => {
  const tx = await transactionService.update(req.params.id, req.body);
  res.json(tx);
};

export const remove = async (req, res) => {
  await transactionService.remove(req.params.id);
  res.json({ message: "Transaction supprimée" });
};
