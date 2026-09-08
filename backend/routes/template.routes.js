import { Router } from "express";
import * as lines from "../services/budgetLine.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

// Le template = les lignes budgétaires sans mois (month_id IS NULL)
router.get("/lines", wrap((req, res) => res.json(lines.listByMonth(null))));
router.post("/lines", wrap((req, res) => res.status(201).json(lines.create(null, req.body))));
router.put("/lines/reorder", wrap((req, res) => { lines.reorder(req.body.orders || []); res.json(lines.listByMonth(null)); }));
router.put("/lines/:id", wrap((req, res) => res.json(lines.update(Number(req.params.id), req.body))));
router.delete("/lines/:id", wrap((req, res) => res.json(lines.remove(Number(req.params.id)))));
// Mensualisation : enveloppe liée à une ligne non mensuelle
router.put("/lines/:id/monthlyize", wrap((req, res) => res.json(lines.setMonthlyized(Number(req.params.id), req.body || {}))));
// Propagation : copie / met à jour la ligne dans un mois existant
router.post("/lines/:id/apply-to-month/:monthId", wrap((req, res) => res.json(lines.applyToMonth(Number(req.params.id), Number(req.params.monthId)))));

// Propagation groupée : ce que ça donnerait (aucune écriture), puis l'application
const onlyUnpaid = (v) => v !== "0" && v !== false && v !== "false";
router.get("/apply-to-month/:monthId/preview", wrap((req, res) =>
  res.json(lines.planApplyAll(Number(req.params.monthId), { onlyUnpaid: onlyUnpaid(req.query.onlyUnpaid) }))));
router.post("/apply-to-month/:monthId", wrap((req, res) =>
  res.json(lines.applyAllToMonth(Number(req.params.monthId), { onlyUnpaid: onlyUnpaid(req.body?.onlyUnpaid) }))));

export default router;
