import { Router } from "express";
import * as utilityMeterController from "../controllers/utilityMeter.controller.js";

const router = Router();

router.get("/", utilityMeterController.getAll);
router.post("/", utilityMeterController.create);
router.put("/:id", utilityMeterController.update);
router.delete("/:id", utilityMeterController.remove);

export default router;
