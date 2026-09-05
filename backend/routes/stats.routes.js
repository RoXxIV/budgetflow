import { Router } from "express";
import * as service from "../services/stats.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.overview())));

export default router;
