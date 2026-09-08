// Statistiques — monté sur /api/stats.
//
// Une seule route : tous les agrégats de la page arrivent ensemble. Les séparer par
// graphique les ferait diverger au premier changement de règle d'exclusion.

import { Router } from "express";
import * as service from "../services/stats.service.js";

const router = Router();
// wrap : passe l'erreur levée par le service à next() (voir account.routes.js)
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

router.get("/", wrap((req, res) => res.json(service.overview())));

export default router;
