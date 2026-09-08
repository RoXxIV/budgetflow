// Le point d'entrée du backend : ouvrir la base, monter les routeurs, écouter.
//
// L'ORDRE COMPTE. `initDb()` est appelé AVANT que le serveur écoute : il applique les
// migrations en attente, et une migration en échec doit empêcher le démarrage plutôt
// que laisser l'application écrire dans un schéma à moitié à jour.
//
// L'ARCHITECTURE en trois couches, sans exception : les ROUTES traduisent du HTTP, les
// SERVICES portent toute la règle métier, db/ parle à SQLite. Une règle de calcul dans
// une route serait invisible aux tests, qui appellent les services directement.
//
// LE GESTIONNAIRE D'ERREUR final donne son sens à tout ça : un service lève une erreur
// portant un statut (`httpError`), et elle devient ici une réponse JSON. Les refus
// métier s'écrivent donc là où vit la règle, jamais dans la couche HTTP.

import express from "express";
import cors from "cors";
import { initDb } from "./db/index.js";

import accountRoutes from "./routes/account.routes.js";
import envelopeRoutes from "./routes/envelope.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import themeRoutes from "./routes/theme.routes.js";
import templateRoutes from "./routes/template.routes.js";
import monthRoutes from "./routes/month.routes.js";
import calculatorRoutes from "./routes/calculator.routes.js";
import assetRoutes from "./routes/asset.routes.js";
import statsRoutes from "./routes/stats.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import planRoutes from "./routes/plan.routes.js";
import backupRoutes from "./routes/backup.routes.js";

const PORT = process.env.PORT || 3003;

initDb(); // ouvre la base et applique les migrations en attente

const app = express();
app.use(cors());
app.use(express.json()); // les routes qui reçoivent du binaire posent leur propre parseur

app.use("/api/accounts", accountRoutes);
app.use("/api/envelopes", envelopeRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/themes", themeRoutes);
app.use("/api/template", templateRoutes);
app.use("/api/months", monthRoutes);
app.use("/api/calculators", calculatorRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/plan", planRoutes);
app.use("/api/data", backupRoutes);

// Gestion d'erreur centralisée : les services lèvent des Error avec .status.
// Le `payload` transporte de quoi proposer une suite au refus — un code que le front
// reconnaît, des chiffres à afficher —, ce qui transforme un blocage en question.
// Seules les vraies erreurs serveur (5xx) sont journalisées : un 409 est un dialogue.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: err.message || "Erreur serveur", ...(err.payload || {}) });
});

app.listen(PORT, () => {
  console.log(`BudgetFlow backend démarré sur le port ${PORT}`);
});
