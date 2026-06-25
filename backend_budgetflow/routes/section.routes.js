import { Router } from "express";
import * as sectionController from "../controllers/section.controller.js";

const router = Router();

router.get("/", sectionController.getAll);
router.get("/:id", sectionController.getById);
router.post("/", sectionController.create);
router.put("/reorder", sectionController.reorder);
router.put("/:id", sectionController.update);
router.delete("/:id", sectionController.remove);

export default router;
