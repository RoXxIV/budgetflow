// Comptes bancaires — monté sur /api/accounts.
//
// Les routes ne décident de rien : elles traduisent une requête HTTP en appel de
// service et rendent le résultat en JSON. Toute règle vit dans account.service.js.
//
// `bindSummary` casse la dépendance circulaire entre comptes et bilan : les deux
// modules se lisent mutuellement, l'injection se fait donc ici, une fois chargés.

import { Router } from "express";
import * as service from "../services/account.service.js";
import * as summary from "../services/summary.service.js";

service.bindSummary(summary);

const router = Router();
// `wrap` : les services étant SYNCHRONES (node:sqlite l'est), une erreur levée dans un
// gestionnaire Express 5 remonterait telle quelle et couperait la réponse. Ce petit
// enrobage la passe à next(), donc au gestionnaire centralisé de server.js, qui en fait
// une réponse JSON avec le statut porté par l'erreur.
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.list())));
router.get("/net-worth", wrap((req, res) => res.json(summary.getNetWorth())));
router.get("/:id", wrap((req, res) => res.json(service.getById(Number(req.params.id)))));
router.get("/:id/usage", wrap((req, res) => res.json(service.usage(Number(req.params.id)))));
router.post("/", wrap((req, res) => res.status(201).json(service.create(req.body))));
router.put("/:id", wrap((req, res) => res.json(service.update(Number(req.params.id), req.body))));
router.put("/:id/active", wrap((req, res) => res.json(service.setActive(Number(req.params.id), !!req.body.isActive, { transferToAccountId: req.body.transferTo ? Number(req.body.transferTo) : null }))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(Number(req.params.id)))));

export default router;
