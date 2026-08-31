import { Router } from "express";
import * as service from "../services/account.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.list())));
router.get("/:id", wrap((req, res) => res.json(service.getById(Number(req.params.id)))));
router.post("/", wrap((req, res) => res.status(201).json(service.create(req.body))));
router.put("/:id", wrap((req, res) => res.json(service.update(Number(req.params.id), req.body))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(Number(req.params.id)))));

export default router;
