import { Router } from "express";
import * as templateController from "../controllers/template.controller.js";

const router = Router();

router.get("/", templateController.getTemplate);
router.get("/lines", templateController.getLines);
router.post("/lines", templateController.createLine);
router.put("/lines/reorder", templateController.reorderLines);
router.put("/lines/:id", templateController.updateLine);
router.delete("/lines/:id", templateController.deleteLine);

export default router;
