import { Router } from "express";
import * as accountController from "../controllers/account.controller.js";

const router = Router();

router.get("/", accountController.getAll);
router.get("/:id", accountController.getById);
router.post("/", accountController.create);
router.put("/:id", accountController.update);
router.delete("/:id", accountController.remove);

export default router;
