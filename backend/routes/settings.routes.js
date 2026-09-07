import { Router } from "express";
import * as service from "../services/settings.service.js";

const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.getSettings())));
// État de la première utilisation : quelle étape reste à faire (déduit de la base)
router.get("/onboarding", wrap((req, res) => res.json(service.getOnboarding())));
// Guide terminé : il ne s'imposera plus (il ne crée pas de mois, rien ne le signerait sinon)
router.post("/onboarding/complete", wrap((req, res) => res.json(service.completeOnboarding())));
// Visite des onglets terminée ou passée
router.post("/onboarding/tour-complete", wrap((req, res) => res.json(service.completeTour())));
router.put("/", wrap((req, res) => res.json(service.updateSettings(req.body))));

export default router;
