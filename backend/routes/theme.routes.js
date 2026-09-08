// Thèmes — monté sur /api/themes.
//
// /merge existe parce que supprimer un thème débranche ce qui le portait : fusionner
// est presque toujours ce qu'on voulait vraiment faire.

import { Router } from "express";
import * as service from "../services/theme.service.js";

const router = Router();
// wrap : passe l'erreur levée par le service à next() (voir account.routes.js)
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.list())));
router.post("/", wrap((req, res) => res.status(201).json(service.create(req.body))));
router.put("/:id", wrap((req, res) => res.json(service.update(Number(req.params.id), req.body))));
router.get("/:id/usage", wrap((req, res) => res.json(service.usage(Number(req.params.id)))));
router.post("/:id/merge", wrap((req, res) => res.json(service.merge(Number(req.params.id), Number(req.body.targetId)))));
router.delete("/:id", wrap((req, res) => res.json(service.remove(Number(req.params.id), { force: req.query.force === "1" }))));

export default router;
