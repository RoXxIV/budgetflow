import { Router } from "express";
import * as service from "../services/account.service.js";
import * as summary from "../services/summary.service.js";

service.bindSummary(summary);

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.list())));
router.get("/net-worth", wrap((req, res) => res.json(summary.getNetWorth())));
router.get("/:id", wrap((req, res) => res.json(service.getById(Number(req.params.id)))));
router.get("/:id/usage", wrap((req, res) => res.json(service.usage(Number(req.params.id)))));
router.post("/", wrap((req, res) => res.status(201).json(service.create(req.body))));
router.put("/:id", wrap((req, res) => res.json(service.update(Number(req.params.id), req.body))));
router.put("/:id/active", wrap((req, res) => res.json(service.setActive(Number(req.params.id), !!req.body.isActive, { transferToAccountId: req.body.transferTo ? Number(req.body.transferTo) : null }))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(Number(req.params.id)))));

export default router;
