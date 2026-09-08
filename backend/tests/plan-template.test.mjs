// Tests unitaires — « importer depuis le Template » du plan de financement.
//
// LE BESOIN — bâtir un plan à partir de son budget type plutôt que d'une page blanche.
// Le Template dit ce qui est PRÉVU ; les moyennes, elles, disent ce qui a été constaté.
//
// LE PIÈGE QU'ON TESTE SURTOUT — les lignes mensualisées, adossées à une enveloppe,
// doivent sortir de leur catégorie et avoir leur propre entrée. Les compter des deux
// côtés les ferait entrer deux fois dans le plan, et gonflerait les charges d'autant.
//
// Lancer depuis backend/ : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, currentPeriod, eq } from "./_setup.mjs";

const S = await boot();
const { accounts, categories, months, budgetLines } = S;
const { templateBreakdown } = await import("../services/planAverages.service.js");

const compte = accounts.create({ name: "Courant", type: "courant" });
const logement = categories.create({ name: "Logement", type: "depense" });
const revenus = categories.create({ name: "Revenus", type: "revenu" });
const vide = categories.create({ name: "Jamais utilisée", type: "depense" });

// Le budget type
budgetLines.create(null, { label: "Loyer", plannedAmount: 800, categoryId: logement.id, fromAccountId: compte.id });
budgetLines.create(null, { label: "Électricité", plannedAmount: 120, categoryId: logement.id, fromAccountId: compte.id });
budgetLines.create(null, { label: "Salaire", plannedAmount: 2400, categoryId: revenus.id, toAccountId: compte.id });
budgetLines.create(null, { label: "Sans étiquette", plannedAmount: 30 });
// Une charge trimestrielle : elle ne pèse qu'un tiers de son montant chaque mois
budgetLines.create(null, { label: "Eau", plannedAmount: 90, intervalMonths: 3, anchorMonth: 2, categoryId: logement.id });

const cat = (nom) => templateBreakdown().categories.find((c) => c.name === nom);
const mens = (label) => templateBreakdown().monthlyized.find((m) => m.label === label);

test("une entrée par catégorie, avec la somme des parts mensuelles", () => {
  // 800 + 120 + 90/3 = 950
  assert.ok(eq(cat("Logement").monthly, 950));
  assert.equal(cat("Logement").lines, 3);
});

test("une charge non mensuelle ne compte que pour sa part du mois", () => {
  // Sans cette règle, 90 € tous les trois mois pèseraient 90 €/mois dans le plan
  const seule = templateBreakdown().categories.find((c) => c.name === "Logement");
  assert.ok(eq(seule.monthly, 950), "et non 800 + 120 + 90 = 1 010");
});

test("le type de la catégorie est conservé : un revenu reste un revenu", () => {
  assert.equal(cat("Revenus").type, "revenu");
  assert.ok(eq(cat("Revenus").monthly, 2400));
  assert.equal(cat("Logement").type, "depense");
});

test("les lignes sans catégorie sont regroupées, pas perdues", () => {
  assert.ok(eq(cat("Sans catégorie").monthly, 30));
  assert.equal(cat("Sans catégorie").id, null);
});

test("une catégorie sans ligne ne figure pas : on n'importe pas du vide", () => {
  assert.equal(cat("Jamais utilisée"), undefined);
});

// ─── Les mensualisées : le vrai piège ───

test("une ligne mensualisée sort de sa catégorie et prend sa propre entrée", () => {
  const avant = cat("Logement").monthly;
  const assurance = budgetLines.create(null, {
    label: "Assurance habitation", plannedAmount: 240, intervalMonths: 12, anchorMonth: 6,
    categoryId: logement.id, fromAccountId: compte.id,
  });
  budgetLines.setMonthlyized(assurance.id, { enabled: true, accountId: compte.id });

  assert.ok(eq(cat("Logement").monthly, avant), "la catégorie n'a pas bougé");
  assert.ok(eq(mens("Assurance habitation").monthly, 20), "240 € / 12 = 20 €/mois");
  assert.equal(mens("Assurance habitation").envelopeName, "Assurance habitation");
});

test("démensualiser la fait revenir dans sa catégorie", () => {
  const ligne = budgetLines.listByMonth(null).find((l) => l.label === "Assurance habitation");
  budgetLines.setMonthlyized(ligne.id, { enabled: false });
  assert.ok(eq(cat("Logement").monthly, 970), "950 + 20 : elle est de retour");
  assert.equal(mens("Assurance habitation"), undefined, "et elle a quitté la liste des mensualisées");
});

test("la part mensuelle est arrondie au centime, ligne par ligne", () => {
  // 79,99 / 12 = 6,665833… — l'écran Template annonce 6,67, le plan doit dire pareil
  const strava = budgetLines.create(null, {
    label: "Strava", plannedAmount: 79.99, intervalMonths: 12, anchorMonth: 3, categoryId: logement.id,
  });
  budgetLines.setMonthlyized(strava.id, { enabled: true, accountId: compte.id });
  assert.ok(eq(mens("Strava").monthly, 6.67));
  assert.ok(eq(mens("Strava").planned, 79.99));
  assert.equal(mens("Strava").intervalMonths, 12);
});

// ─── Ce qui ne doit PAS y entrer ───

test("les lignes d'un mois ne sont pas comptées : seul le Template l'est", () => {
  const avant = cat("Logement").monthly;
  const mois = months.create({ period: currentPeriod(), snapshots: [{ accountId: compte.id, balance: 100 }] });
  budgetLines.create(mois.id, { label: "Achat ponctuel", plannedAmount: 500, categoryId: logement.id });
  assert.ok(eq(cat("Logement").monthly, avant), "le mois n'a rien changé au budget type");
});

test("les mensualisées sont rendues de la plus lourde à la plus légère", () => {
  const m = templateBreakdown().monthlyized;
  assert.ok(m.length >= 1);
  for (let i = 1; i < m.length; i++) {
    assert.ok(m[i - 1].monthly >= m[i].monthly, "l'ordre décroissant guide l'œil vers ce qui pèse");
  }
});
