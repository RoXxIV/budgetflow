import Transaction from "../models/Transaction.model.js";
import BudgetLine from "../models/BudgetLine.model.js";

// Liste des transactions d'une ligne budgétaire (ordre chronologique)
export const getByLine = (lineId) =>
  Transaction.find({ budgetLine: lineId }).sort({ date: 1, _id: 1 });

// Création d'une transaction + report sur le total réel de la ligne
export const create = async (data) => {
  const tx = await Transaction.create(data);

  if (tx.budgetLine && tx.source !== "cancellation" && tx.source !== "rounding") {
    await BudgetLine.findByIdAndUpdate(tx.budgetLine, {
      $inc: { actualAmount: tx.amount },
    });
  }

  return tx;
};

// Mise à jour d'une transaction + report du delta de montant sur la ligne
export const update = async (id, data) => {
  const tx = await Transaction.findById(id);
  if (!tx) return null;

  const oldAmount = tx.amount;
  const affectsLine =
    tx.budgetLine && tx.source !== "cancellation" && tx.source !== "rounding";

  Object.assign(tx, data);
  await tx.save();

  if (affectsLine && typeof tx.amount === "number" && tx.amount !== oldAmount) {
    await BudgetLine.findByIdAndUpdate(tx.budgetLine, {
      $inc: { actualAmount: tx.amount - oldAmount },
    });
  }

  return tx;
};

// Suppression d'une transaction (cleanup données existantes)
export const remove = async (transactionId) => {
  const tx = await Transaction.findById(transactionId);
  if (!tx) return null;

  if (tx.budgetLine && tx.source !== "cancellation" && tx.source !== "rounding") {
    await BudgetLine.findByIdAndUpdate(tx.budgetLine, {
      $inc: { actualAmount: -tx.amount },
    });
  }

  return Transaction.findByIdAndDelete(transactionId);
};
