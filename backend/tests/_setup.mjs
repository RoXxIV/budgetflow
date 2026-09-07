// Socle commun des suites de tests : base SQLite neuve et jetable + services chargés.
// (le nom ne matche pas *.test.mjs : ce fichier n'est pas exécuté comme suite)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

export async function boot() {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "budgetflow-test-")), "budget.db");
  const { initDb } = await import("../db/index.js");
  initDb();
  const accounts = await import("../services/account.service.js");
  const envelopes = await import("../services/envelope.service.js");
  const months = await import("../services/month.service.js");
  const categories = await import("../services/category.service.js");
  const themes = await import("../services/theme.service.js");
  const budgetLines = await import("../services/budgetLine.service.js");
  const entries = await import("../services/entry.service.js");
  const pots = await import("../services/pot.service.js");
  const calculators = await import("../services/calculator.service.js");
  const assets = await import("../services/asset.service.js");
  const summary = await import("../services/summary.service.js");
  const settings = await import("../services/settings.service.js");
  envelopes.bindSummary(summary);
  accounts.bindSummary(summary);
  return { accounts, envelopes, months, categories, themes, budgetLines, entries, pots, calculators, assets, summary, settings };
}

// L'appel doit être refusé avec ce statut (et ce code de payload le cas échéant)
export function refuse(fn, status, code = null) {
  try { fn(); } catch (e) {
    assert.equal(e.status, status, `statut ${e.status} ≠ ${status} : ${e.message}`);
    if (code) assert.equal(e.payload?.code, code);
    return e;
  }
  assert.fail(`aurait dû être refusé (${status})`);
}

// Égalité à l'arrondi monétaire près
export const eq = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005;

// Période calendaire courante et la suivante (les tests restent valables quel que soit le jour)
export const currentPeriod = () => new Date().toISOString().substring(0, 7);
export const nextPeriodOf = (period) => {
  const [y, m] = period.split("-").map(Number);
  const idx = y * 12 + (m - 1) + 1;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
};
