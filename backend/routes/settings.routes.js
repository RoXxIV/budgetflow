import { Router } from "express";
import * as service from "../services/settings.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.getSettings())));
router.put("/", wrap((req, res) => res.json(service.updateSettings(req.body))));

export default router;
