// Tracker d'abonnements — monté sur /api/subscriptions.
//
// Bac à sable : rien ici ne touche au budget réel.

import { Router } from "express";
import * as service from "../services/subscription.service.js";

const router = Router();
// wrap : passe l'erreur levée par le service à next() (voir account.routes.js)
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };
const id = (req) => Number(req.params.id);

router.get("/", wrap((req, res) => res.json(service.list())));
router.post("/", wrap((req, res) => res.status(201).json(service.create(req.body))));
// Copie les abonnements du mois courant + les mensualisées (doublons de nom ignorés)
router.post("/import", wrap((req, res) => res.json(service.importCurrent())));
router.put("/:id", wrap((req, res) => res.json(service.update(id(req), req.body))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(id(req)))));

export default router;
