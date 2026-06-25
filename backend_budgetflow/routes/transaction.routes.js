import { Router } from "express";
import * as transactionController from "../controllers/transaction.controller.js";

const router = Router();

router.get("/line/:lineId", transactionController.getByLine);
router.post("/", transactionController.create);
router.put("/:id", transactionController.update);
router.delete("/:id", transactionController.remove);

export default router;
