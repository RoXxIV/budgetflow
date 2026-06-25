import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import { seed } from "./config/seed.js";

import accountRoutes from "./routes/account.routes.js";
import sectionRoutes from "./routes/section.routes.js";
import themeRoutes from "./routes/theme.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import templateRoutes from "./routes/template.routes.js";
import utilityMeterRoutes from "./routes/utilityMeter.routes.js";
import investmentRoutes from "./routes/investment.routes.js";
import savingGoalRoutes from "./routes/savingGoal.routes.js";
import sheetRoutes from "./routes/sheet.routes.js";
import transactionRoutes from "./routes/transaction.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/accounts", accountRoutes);
app.use("/api/sections", sectionRoutes);
app.use("/api/themes", themeRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/template", templateRoutes);
app.use("/api/utility-meters", utilityMeterRoutes);
app.use("/api/investments", investmentRoutes);
app.use("/api/saving-goals", savingGoalRoutes);
app.use("/api/sheets", sheetRoutes);
app.use("/api/transactions", transactionRoutes);

connectDB().then(async () => {
  await seed();
  app.listen(process.env.PORT, () => {
    console.log(`Serveur démarré sur le port ${process.env.PORT}`);
  });
});
