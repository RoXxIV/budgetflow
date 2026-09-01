import { Router } from "express";
import * as service from "../services/category.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.list())));
router.post("/", wrap((req, res) => res.status(201).json(service.create(req.body))));
// /reorder avant /:id pour ne pas être capturé par le paramètre
router.put("/reorder", wrap((req, res) => res.json(service.reorder(req.body.orders || []))));
router.put("/:id", wrap((req, res) => res.json(service.update(Number(req.params.id), req.body))));
router.get("/:id/usage", wrap((req, res) => res.json(service.usage(Number(req.params.id)))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(Number(req.params.id), { force: req.query.force === "1" }))));

export default router;
