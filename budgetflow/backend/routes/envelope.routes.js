import { Router } from "express";
import * as service from "../services/envelope.service.js";
import * as summary from "../services/summary.service.js";

service.bindSummary(summary);

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.list())));
// Disponible hors enveloppes d'un compte (avant /:id)
router.get("/availability/:accountId", wrap((req, res) => res.json(service.availability(Number(req.params.accountId)))));
router.get("/:id", wrap((req, res) => res.json(service.getById(Number(req.params.id)))));
router.post("/", wrap((req, res) => res.status(201).json(service.create(req.body))));
router.put("/:id", wrap((req, res) => res.json(service.update(Number(req.params.id), req.body))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(Number(req.params.id), {
  mode: req.query.mode || null,
  toEnvelopeId: req.query.toEnvelope ? Number(req.query.toEnvelope) : null,
}))));

router.post("/:id/reallocate", wrap((req, res) => res.status(201).json(service.reallocate(Number(req.params.id), req.body || {}))));
router.get("/:id/recalibration", wrap((req, res) => res.json(service.recalibrationPreview(Number(req.params.id)))));
router.post("/:id/recalibration", wrap((req, res) => res.status(201).json(service.recalibrate(Number(req.params.id), req.body || {}))));

router.get("/:id/contributions", wrap((req, res) => res.json(service.listContributions(Number(req.params.id)))));
router.post("/:id/contributions", wrap((req, res) => res.status(201).json(service.addContribution(Number(req.params.id), req.body))));
router.delete("/:id/contributions/:contribId", wrap((req, res) => res.json(service.removeContribution(Number(req.params.id), Number(req.params.contribId)))));

export default router;
