import { Router } from "express";
import * as months from "../services/month.service.js";
import * as budgetLines from "../services/budgetLine.service.js";
import * as entries from "../services/entry.service.js";
import * as summary from "../services/summary.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };
const id = (req, name = "id") => Number(req.params[name]);

// Mois
router.get("/", wrap((req, res) => res.json(months.list())));
router.get("/prefill", wrap((req, res) => res.json(months.prefill())));
router.post("/", wrap((req, res) => res.status(201).json(months.create(req.body))));
router.get("/:id", wrap((req, res) => res.json(months.getById(id(req)))));
router.get("/:id/summary", wrap((req, res) => res.json(summary.getSummary(id(req)))));
router.put("/:id", wrap((req, res) => res.json(months.setClosed(id(req), !!req.body.isClosed))));
router.delete("/:id", wrap((req, res) => res.json(months.remove(id(req)))));

// Lignes du mois (réel = somme des entrées)
router.get("/:id/lines", wrap((req, res) => res.json(months.getLines(id(req)))));
router.post("/:id/lines", wrap((req, res) => { months.assertOpen(id(req)); res.status(201).json(budgetLines.create(id(req), req.body)); }));
router.put("/:id/lines/:lineId", wrap((req, res) => { months.assertOpen(id(req)); res.json(budgetLines.update(id(req, "lineId"), req.body)); }));
router.delete("/:id/lines/:lineId", wrap((req, res) => { months.assertOpen(id(req)); res.json(budgetLines.remove(id(req, "lineId"), { force: req.query.force === "1" })); }));
router.post("/:id/lines/:lineId/apply-to-template", wrap((req, res) => res.json(budgetLines.applyToTemplate(id(req, "lineId")))));

// ☐ payé
router.post("/:id/lines/:lineId/pay", wrap((req, res) => res.status(201).json(entries.pay(id(req), id(req, "lineId")))));
router.delete("/:id/lines/:lineId/pay", wrap((req, res) => res.json(entries.unpay(id(req), id(req, "lineId")))));

// Snapshots
router.get("/:id/snapshots", wrap((req, res) => res.json(months.getSnapshots(id(req)))));
router.put("/:id/snapshots", wrap((req, res) => res.json(months.upsertSnapshots(id(req), req.body.snapshots || []))));

// Entrées
router.get("/:id/entries", wrap((req, res) => res.json(entries.listByMonth(id(req)))));
router.post("/:id/entries", wrap((req, res) => res.status(201).json(entries.create(id(req), req.body))));
router.put("/:id/entries/:entryId", wrap((req, res) => res.json(entries.update(id(req, "entryId"), req.body))));
router.delete("/:id/entries/:entryId", wrap((req, res) => res.json(entries.remove(id(req, "entryId")))));

export default router;
