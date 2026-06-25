import { Router } from "express";
import * as settingsController from "../controllers/settings.controller.js";

const router = Router();

router.get("/", settingsController.get);
router.put("/", settingsController.update);

export default router;
