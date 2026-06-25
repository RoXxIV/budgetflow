import { Router } from "express";
import * as sheetController from "../controllers/sheet.controller.js";

const router = Router();

// Sheets CRUD
router.get("/", sheetController.getAll);
router.post("/", sheetController.create);
router.get("/:id", sheetController.getById);
router.put("/:id", sheetController.update);
router.delete("/:id", sheetController.remove);

// Lignes
router.get("/:id/lines", sheetController.getLines);
router.post("/:id/lines", sheetController.createLine);
router.put("/:id/lines/:lineId", sheetController.updateLine);
router.delete("/:id/lines/:lineId", sheetController.deleteLine);

// Snapshots
router.get("/:id/snapshots", sheetController.getSnapshots);
router.put("/:id/snapshots", sheetController.upsertSnapshot);

// Transactions du sheet
router.get("/:id/transactions", sheetController.getTransactions);

// Relevés EDF
router.get("/:id/readings", sheetController.getReadings);
router.put("/:id/readings/:readingId", sheetController.updateReading);

// Contributions objectifs
router.get("/:id/contributions", sheetController.getContributions);
router.post("/:id/contributions", sheetController.addContribution);
router.delete("/:id/contributions/:contribId", sheetController.removeContribution);

// Transactions investissement
router.get("/:id/investment-transactions", sheetController.getInvestmentTransactions);
router.post("/:id/investment-transactions", sheetController.addInvestmentTransaction);
router.delete("/:id/investment-transactions/:txId", sheetController.removeInvestmentTransaction);

export default router;
