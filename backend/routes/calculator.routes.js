// Calculateurs — monté sur /api/calculators.
//
// Ici, seulement la DÉFINITION (paramètres, relevés attendus, formule). Les relevés
// saisis mois par mois passent par /api/months/:id/calculators : ils appartiennent au
// mois, pas au calculateur.
//
// /check est particulier : il ne touche à rien, il valide une formule pendant qu'on
// la tape.

import { Router } from "express";
import * as service from "../services/calculator.service.js";

const router = Router();
// wrap : passe l'erreur levée par le service à next() (voir account.routes.js)
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.list())));
router.post("/check", wrap((req, res) => res.json(service.check(req.body.formula, req.body.symbols || []))));
router.post("/", wrap((req, res) => res.status(201).json(service.save(null, req.body))));
router.put("/:id", wrap((req, res) => res.json(service.save(Number(req.params.id), req.body))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(Number(req.params.id)))));

export default router;
