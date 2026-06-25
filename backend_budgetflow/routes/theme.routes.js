import { Router } from "express";
import * as themeController from "../controllers/theme.controller.js";

const router = Router();

router.get("/", themeController.getAll);
router.get("/:id", themeController.getById);
router.post("/", themeController.create);
router.put("/:id", themeController.update);
router.delete("/:id", themeController.remove);

export default router;
