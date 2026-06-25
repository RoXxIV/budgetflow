import * as sheetService from "../services/sheet.service.js";

export const getAll = async (req, res) => {
  const sheets = await sheetService.getAll();
  res.json(sheets);
};

export const getById = async (req, res) => {
  const sheet = await sheetService.getById(req.params.id);
  if (!sheet) return res.status(404).json({ message: "Sheet introuvable" });
  res.json(sheet);
};

export const create = async (req, res) => {
  const sheet = await sheetService.createFromTemplate(req.body);
  res.status(201).json(sheet);
};

export const update = async (req, res) => {
  const sheet = await sheetService.update(req.params.id, req.body);
  if (!sheet) return res.status(404).json({ message: "Sheet introuvable" });
  res.json(sheet);
};

export const remove = async (req, res) => {
  await sheetService.remove(req.params.id);
  res.json({ message: "Sheet supprimé" });
};

// ─── Lignes ───────────────────────────────────────────────
export const getLines = async (req, res) => {
  const lines = await sheetService.getLines(req.params.id);
  res.json(lines);
};

export const createLine = async (req, res) => {
  const line = await sheetService.createLine(req.params.id, req.body);
  res.status(201).json(line);
};

export const updateLine = async (req, res) => {
  const line = await sheetService.updateLine(req.params.lineId, req.body);
  if (!line) return res.status(404).json({ message: "Ligne introuvable" });
  res.json(line);
};

export const deleteLine = async (req, res) => {
  await sheetService.deleteLine(req.params.lineId);
  res.json({ message: "Ligne supprimée" });
};

// ─── Snapshots ────────────────────────────────────────────
export const getSnapshots = async (req, res) => {
  const snapshots = await sheetService.getSnapshots(req.params.id);
  res.json(snapshots);
};

export const upsertSnapshot = async (req, res) => {
  const { accountId, balance } = req.body;
  const snapshot = await sheetService.upsertSnapshot(req.params.id, accountId, balance);
  res.json(snapshot);
};

// ─── Relevés EDF ─────────────────────────────────────────
export const getReadings = async (req, res) => {
  const readings = await sheetService.getReadings(req.params.id);
  res.json(readings);
};

export const updateReading = async (req, res) => {
  const reading = await sheetService.updateReading(req.params.readingId, req.body);
  res.json(reading);
};

// ─── Contributions objectifs ──────────────────────────────
export const getTransactions = async (req, res) => {
  const transactions = await sheetService.getTransactions(req.params.id);
  res.json(transactions);
};

export const getContributions = async (req, res) => {
  const contributions = await sheetService.getContributions(req.params.id);
  res.json(contributions);
};

export const addContribution = async (req, res) => {
  const contribution = await sheetService.addContribution(req.params.id, req.body);
  res.status(201).json(contribution);
};

export const removeContribution = async (req, res) => {
  await sheetService.removeContribution(req.params.contribId);
  res.json({ message: "Contribution supprimée" });
};

// ─── Transactions investissement ──────────────────────────
export const getInvestmentTransactions = async (req, res) => {
  const txs = await sheetService.getInvestmentTransactions(req.params.id);
  res.json(txs);
};

export const addInvestmentTransaction = async (req, res) => {
  const tx = await sheetService.addInvestmentTransaction(req.params.id, req.body);
  res.status(201).json(tx);
};

export const removeInvestmentTransaction = async (req, res) => {
  await sheetService.removeInvestmentTransaction(req.params.txId);
  res.json({ message: "Transaction supprimée" });
};
