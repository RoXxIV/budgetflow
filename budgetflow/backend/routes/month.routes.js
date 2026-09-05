import { Router } from "express";
import * as months from "../services/month.service.js";
import * as budgetLines from "../services/budgetLine.service.js";
import * as entries from "../services/entry.service.js";
import * as summary from "../services/summary.service.js";
import * as envelopes from "../services/envelope.service.js";
import * as calculators from "../services/calculator.service.js";
import * as assets from "../services/asset.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };
const id = (req, name = "id") => Number(req.params[name]);

// Mois
router.get("/", wrap((req, res) => res.json(months.list())));
router.get("/prefill", (req, res, next) => months.prefill().then((r) => res.json(r)).catch(next));
router.get("/current", wrap((req, res) => res.json(months.current())));
router.post("/", wrap((req, res) => res.status(201).json(months.create(req.body))));
router.get("/:id", wrap((req, res) => res.json(months.getById(id(req)))));
router.get("/:id/summary", wrap((req, res) => res.json(summary.getSummary(id(req)))));
// Calculateurs : relevés du mois, estimation, écart, régularisation
router.get("/:id/calculators", wrap((req, res) => res.json(calculators.monthState(id(req)))));
router.put("/:id/calculators/:calcId/readings", wrap((req, res) => res.json(calculators.saveReadings(id(req), id(req, "calcId"), req.body.readings || []))));
router.post("/:id/calculators/:calcId/regularize", wrap((req, res) => res.json(calculators.regularize(id(req), id(req, "calcId")))));
// Investissements : mouvements datés dans ce mois, ☐ versé (DCA)
router.get("/:id/asset-movements", wrap((req, res) => res.json(assets.listMovementsByPeriod(months.getById(id(req)).period))));
router.post("/:id/assets/:assetId/dca", wrap((req, res) => res.status(201).json(assets.dca(id(req), id(req, "assetId")))));
router.delete("/:id/assets/:assetId/dca", wrap((req, res) => res.json(assets.undca(id(req), id(req, "assetId")))));
// Contributions d'enveloppes datées dans ce mois (la saisie passe par /envelopes/:id/contributions)
router.get("/:id/envelope-contributions", wrap((req, res) => res.json(envelopes.listContributionsByPeriod(months.getById(id(req)).period))));
// « Annuler ce mois-ci » : mensualité d'enveloppe / DCA non versé ce mois (réversible)
router.get("/:id/skips", wrap((req, res) => res.json(months.listSkips(id(req)))));
router.post("/:id/skips", wrap((req, res) => res.status(201).json(months.addSkip(id(req), req.body || {}))));
router.delete("/:id/skips/:kind/:targetId", wrap((req, res) => res.json(months.removeSkip(id(req), req.params.kind, id(req, "targetId")))));
router.put("/:id", wrap((req, res) => res.json(months.setClosed(id(req), !!req.body.isClosed))));
router.put("/:id/notes", wrap((req, res) => res.json(months.setNotes(id(req), req.body.notes))));
router.delete("/:id", wrap((req, res) => res.json(months.remove(id(req)))));

// Lignes du mois (réel = somme des entrées)
router.get("/:id/lines", wrap((req, res) => res.json(months.getLines(id(req)))));
router.post("/:id/lines", wrap((req, res) => { months.assertOpen(id(req)); res.status(201).json(budgetLines.create(id(req), req.body)); }));
router.put("/:id/lines/:lineId", wrap((req, res) => { months.assertOpen(id(req)); budgetLines.assertInMonth(id(req, "lineId"), id(req)); res.json(budgetLines.update(id(req, "lineId"), req.body)); }));
router.delete("/:id/lines/:lineId", wrap((req, res) => { months.assertOpen(id(req)); budgetLines.assertInMonth(id(req, "lineId"), id(req)); res.json(budgetLines.remove(id(req, "lineId"), { force: req.query.force === "1" })); }));
router.post("/:id/lines/:lineId/apply-to-template", wrap((req, res) => res.json(budgetLines.applyToTemplate(id(req, "lineId")))));

// ☐ payé
router.post("/:id/lines/:lineId/pay", wrap((req, res) => res.status(201).json(entries.pay(id(req), id(req, "lineId"), req.body || {}))));
router.delete("/:id/lines/:lineId/pay", wrap((req, res) => res.json(entries.unpay(id(req), id(req, "lineId")))));

// Snapshots
router.get("/:id/snapshots", wrap((req, res) => res.json(months.getSnapshots(id(req)))));
router.put("/:id/snapshots", wrap((req, res) => res.json(months.upsertSnapshots(id(req), req.body.snapshots || []))));

// Entrées — source et relatedLineId sont posés par les services (virements système, ☐ payé),
// jamais par le client : les accepter du body permettrait de fausser stats et dépointage
router.get("/:id/entries", wrap((req, res) => res.json(entries.listByMonth(id(req)))));
router.post("/:id/entries", wrap((req, res) => { const { source, relatedLineId, ...body } = req.body || {}; res.status(201).json(entries.create(id(req), body)); }));
router.put("/:id/entries/:entryId", wrap((req, res) => res.json(entries.update(id(req, "entryId"), req.body))));
router.delete("/:id/entries/:entryId", wrap((req, res) => res.json(entries.remove(id(req, "entryId")))));

export default router;
