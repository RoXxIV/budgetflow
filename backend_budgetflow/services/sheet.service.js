import MonthlySheet from "../models/MonthlySheet.model.js";
import BudgetLine from "../models/BudgetLine.model.js";
import AccountSnapshot from "../models/AccountSnapshot.model.js";
import UtilityMeter from "../models/UtilityMeter.model.js";
import UtilityReading from "../models/UtilityReading.model.js";
import Transaction from "../models/Transaction.model.js";
import SavingContribution from "../models/SavingContribution.model.js";
import InvestmentTransaction from "../models/InvestmentTransaction.model.js";

const LINE_POPULATE = [
  { path: "section", select: "name color order" },
  { path: "theme", select: "name color role" },
  { path: "fromAccount", select: "name type" },
  { path: "toAccount", select: "name type" },
];

// ─── CRUD sheets ─────────────────────────────────────────
export const getAll = () =>
  MonthlySheet.find({ isTemplate: false }).sort({ periodMonth: -1 });

export const getById = (id) => MonthlySheet.findById(id);

export const update = (id, data) =>
  MonthlySheet.findByIdAndUpdate(id, data, { returnDocument: "after" });

export const remove = async (id) => {
  await Transaction.deleteMany({ sheet: id });
  await BudgetLine.deleteMany({ sheet: id });
  await AccountSnapshot.deleteMany({ sheet: id });
  await UtilityReading.deleteMany({ sheet: id });
  await SavingContribution.deleteMany({ sheet: id });
  await InvestmentTransaction.deleteMany({ sheet: id });
  return MonthlySheet.findByIdAndDelete(id);
};

// ─── Ajout manuel d'une ligne au sheet ───────────────────
export const createLine = async (sheetId, data) => {
  const line = await BudgetLine.create({ ...data, sheet: sheetId });
  return line.populate(LINE_POPULATE);
};

export const updateLine = (lineId, data) =>
  BudgetLine.findByIdAndUpdate(lineId, data, { returnDocument: "after", new: true })
    .populate(LINE_POPULATE);

export const deleteLine = async (lineId) => {
  await Transaction.deleteMany({ budgetLine: lineId });
  return BudgetLine.findByIdAndDelete(lineId);
};

// ─── Création depuis le template ─────────────────────────
export const createFromTemplate = async ({ periodMonth, name, snapshots = [] }) => {
  const template = await MonthlySheet.findOne({ isTemplate: true });
  if (!template) throw new Error("Template introuvable");

  const sheet = await MonthlySheet.create({ periodMonth, name, status: "active" });

  const templateLines = await BudgetLine.find({ sheet: template._id });
  await Promise.all(
    templateLines.map((line) => {
      const { _id, sheet: _s, actualAmount, ...rest } = line.toObject();
      return BudgetLine.create({ ...rest, sheet: sheet._id, actualAmount: 0, templateLine: _id });
    })
  );

  const lastSheet = await MonthlySheet.findOne({
    isTemplate: false,
    _id: { $ne: sheet._id },
  }).sort({ createdAt: -1 });

  const meters = await UtilityMeter.find();
  await Promise.all(
    meters.map(async (meter) => {
      let hpPrevious = 0;
      let hcPrevious = 0;
      if (lastSheet) {
        const lastReading = await UtilityReading.findOne({
          meter: meter._id,
          sheet: lastSheet._id,
        });
        if (lastReading) {
          hpPrevious = lastReading.hpCurrent || 0;
          hcPrevious = lastReading.hcCurrent || 0;
        }
      }
      return UtilityReading.create({
        meter: meter._id,
        sheet: sheet._id,
        hpPrevious,
        hcPrevious,
        hpCurrent: 0,
        hcCurrent: 0,
      });
    })
  );

  // Snapshots des comptes fournis à la création
  if (snapshots.length) {
    await Promise.all(
      snapshots
        .filter((s) => s.balance !== undefined && s.balance !== null && s.balance !== "")
        .map((s) =>
          AccountSnapshot.findOneAndUpdate(
            { sheet: sheet._id, account: s.accountId },
            { balance: parseFloat(s.balance) },
            { upsert: true }
          )
        )
    );
  }

  return sheet;
};

// ─── Lignes d'un sheet ────────────────────────────────────
export const getLines = (sheetId) =>
  BudgetLine.find({ sheet: sheetId })
    .populate(LINE_POPULATE)
    .sort({ order: 1, _id: 1 });

// ─── Snapshots ────────────────────────────────────────────
export const getSnapshots = (sheetId) =>
  AccountSnapshot.find({ sheet: sheetId }).populate({ path: "account", select: "name type" });

export const upsertSnapshot = (sheetId, accountId, balance) =>
  AccountSnapshot.findOneAndUpdate(
    { sheet: sheetId, account: accountId },
    { balance },
    { upsert: true, returnDocument: "after" }
  );

// ─── Relevés EDF ─────────────────────────────────────────
export const getReadings = (sheetId) =>
  UtilityReading.find({ sheet: sheetId }).populate({
    path: "meter",
    populate: { path: "budgetLine", select: "label plannedAmount" },
  });

export const updateReading = (readingId, data) =>
  UtilityReading.findByIdAndUpdate(readingId, data, { returnDocument: "after" });

// ─── Transactions (depuis le sheet) ──────────────────────
export const getTransactions = (sheetId) =>
  Transaction.find({ sheet: sheetId }).sort({ date: 1, _id: 1 });

// ─── Contributions objectifs (depuis le sheet) ────────────
export const getContributions = (sheetId) =>
  SavingContribution.find({ sheet: sheetId }).populate({
    path: "goal",
    select: "name targetAmount",
  });

export const addContribution = (sheetId, data) =>
  SavingContribution.create({ ...data, sheet: sheetId });

export const removeContribution = (contribId) =>
  SavingContribution.findByIdAndDelete(contribId);

// ─── Transactions investissement (depuis le sheet) ────────
export const getInvestmentTransactions = (sheetId) =>
  InvestmentTransaction.find({ sheet: sheetId }).populate({
    path: "investment",
    select: "name type monthlyInvestment account",
    populate: { path: "account", select: "name" },
  });

export const addInvestmentTransaction = (sheetId, data) =>
  InvestmentTransaction.create({ ...data, sheet: sheetId });

export const removeInvestmentTransaction = (txId) =>
  InvestmentTransaction.findByIdAndDelete(txId);
