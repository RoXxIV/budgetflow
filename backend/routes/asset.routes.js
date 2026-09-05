import { Router } from "express";
import * as service from "../services/asset.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };
const id = (req, name = "id") => Number(req.params[name]);

router.get("/", wrap((req, res) => res.json(service.list())));
router.get("/:id", wrap((req, res) => res.json(service.getById(id(req)))));
router.post("/", wrap((req, res) => res.status(201).json(service.create(req.body))));
router.put("/:id", wrap((req, res) => res.json(service.update(id(req), req.body))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(id(req)))));

router.get("/:id/movements", wrap((req, res) => res.json(service.listMovements(id(req)))));
router.post("/:id/movements", wrap((req, res) => res.status(201).json(service.addMovement(id(req), req.body))));
router.delete("/:id/movements/:movementId", wrap((req, res) => res.json(service.removeMovement(id(req), id(req, "movementId")))));

router.get("/:id/valuations", wrap((req, res) => res.json(service.listValuations(id(req)))));
router.post("/:id/valuations", wrap((req, res) => res.status(201).json(service.addValuation(id(req), req.body))));
router.delete("/:id/valuations/:valuationId", wrap((req, res) => res.json(service.removeValuation(id(req), id(req, "valuationId")))));

export default router;
