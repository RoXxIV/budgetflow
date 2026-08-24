import { Router } from "express";
import * as subscriptionController from "../controllers/subscription.controller.js";

const router = Router();

router.get("/", subscriptionController.getAll);
router.get("/:id", subscriptionController.getById);
router.post("/", subscriptionController.create);
router.put("/:id", subscriptionController.update);
router.delete("/:id", subscriptionController.remove);

export default router;
