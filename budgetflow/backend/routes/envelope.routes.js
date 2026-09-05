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
router.delete("/:id", wrap((req, res) => res.json(service.remove(Number(req.params.id)))));
router.post("/:id/close-into", wrap((req, res) => res.json(service.closeInto(Number(req.params.id), req.body || {}))));
// Mensualisées : vide l'enveloppe vers un compte et fait repartir le cycle (la dépense reste à saisir)
router.post("/:id/liquidate", wrap((req, res) => res.json(service.liquidate(Number(req.params.id), req.body || {}))));

router.post("/:id/reallocate", wrap((req, res) => res.status(201).json(service.reallocate(Number(req.params.id), req.body || {}))));
router.get("/:id/recalibration", wrap((req, res) => res.json(service.recalibrationPreview(Number(req.params.id)))));
router.post("/:id/recalibration", wrap((req, res) => res.status(201).json(service.recalibrate(Number(req.params.id), req.body || {}))));

router.get("/:id/contributions", wrap((req, res) => res.json(service.listContributions(Number(req.params.id)))));
// `kind` est posé par les services (initiale, ajustement, réaffectation…) — l'accepter du client
// permettrait de sauter le contrôle du disponible, réservé aux contributions « normale »
router.post("/:id/contributions", wrap((req, res) => { const { kind, ...body } = req.body || {}; res.status(201).json(service.addContribution(Number(req.params.id), body)); }));
router.delete("/:id/contributions/:contribId", wrap((req, res) => res.json(service.removeContribution(Number(req.params.id), Number(req.params.contribId)))));

export default router;
