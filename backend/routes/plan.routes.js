// Plan de financement — monté sur /api/plan.
//
// Aucune de ces routes n'écrit : le plan est un bac à sable. Le client envoie sa
// situation, le serveur rend le tableau. Seule /averages lit la base, pour proposer
// des chiffres tirés du vécu plutôt que du vide.

import { Router } from "express";
import { computePlan, shareFor } from "../services/plan.service.js";
import { averages } from "../services/planAverages.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

// Le plan est un bac à sable : rien n'est enregistré, le calcul part de ce que le
// client envoie et lui rend le tableau.
router.post("/compute", wrap((req, res) => res.json(computePlan(req.body || {}))));

// L'autre sens : une cible et un délai donnent une mensualité
router.post("/share", wrap((req, res) => {
  const { target = 0, months = 1, already = 0 } = req.body || {};
  res.json({ share: shareFor(Number(target), Number(months), Number(already)) });
}));

// Les moyennes réelles, pour pré-remplir une ligne d'un clic
router.get("/averages", wrap((req, res) => res.json(averages())));

export default router;
