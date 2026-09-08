import { Router, raw } from "express";
import { rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as service from "../services/backup.service.js";

// Sauvegarde, import et remise à zéro. Routes HTTP uniquement : tout ce qui décide
// vit dans backup.service.js.
const router = Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };

// Ce que contient la base : sert à annoncer ce qui va disparaître avant d'effacer
router.get("/", wrap((req, res) => res.json(service.describeData())));

// Télécharge une copie du fichier. Le temporaire est retiré une fois la réponse partie,
// qu'elle ait abouti ou non — sans quoi le dossier temporaire s'accumulerait.
router.get("/export", (req, res, next) => {
  let temp;
  try {
    temp = service.exportToTemp();
  } catch (err) { return next(err); }
  res.download(temp.file, temp.name, () => rmSync(temp.dir, { recursive: true, force: true }));
});

// Remplace les données par une sauvegarde. Le fichier arrive en corps brut : c'est
// une base SQLite, rien à parser, et ça évite une dépendance de plus pour du multipart.
router.post("/import", raw({ type: () => true, limit: "512mb" }), wrap((req, res) => {
  if (!req.body?.length) throw Object.assign(new Error("Aucun fichier reçu."), { status: 400 });
  const dir = mkdtempSync(join(tmpdir(), "budgetflow-import-"));
  const fichier = join(dir, "candidat.db");
  try {
    writeFileSync(fichier, req.body);
    res.json(service.replaceWith(fichier));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}));

// Efface tout, après archivage automatique
router.post("/reset", wrap((req, res) => res.json(service.resetAll())));

export default router;
