import { Router } from "express";
import * as savingGoalController from "../controllers/savingGoal.controller.js";

const router = Router();

router.get("/", savingGoalController.getAll);
router.get("/:id", savingGoalController.getById);
router.post("/", savingGoalController.create);
router.put("/:id", savingGoalController.update);
router.delete("/:id", savingGoalController.remove);

// Contributions
router.get("/:id/contributions", savingGoalController.getContributions);
router.post("/:id/contributions", savingGoalController.addContribution);
router.delete("/:id/contributions/:contributionId", savingGoalController.removeContribution);

export default router;
