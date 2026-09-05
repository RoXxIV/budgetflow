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

const PORT = process.env.PORT || 3003;

initDb(); // ouvre la base et applique les migrations en attente

const app = express();
app.use(cors());
app.use(express.json());

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

// Gestion d'erreur centralisée : les services lèvent des Error avec .status
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: err.message || "Erreur serveur", ...(err.payload || {}) });
});

app.listen(PORT, () => {
  console.log(`BudgetFlow backend démarré sur le port ${PORT}`);
});
