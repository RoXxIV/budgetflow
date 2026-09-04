// Tests unitaires — page Template : lignes récurrentes, périodicité, mensualisation,
// cagnottes, réordonnancement, propagation vers le mois et retour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, eq, currentPeriod } from "./_setup.mjs";

const { accounts, categories, themes, budgetLines: lines, envelopes, months } = await boot();

let main, catDep, catRev, catTr, th, loyer, annuel, month;

test("décor : comptes, catégories, thème", () => {
  main = accounts.create({ name: "Courant" });
  accounts.create({ name: "Livret", type: "epargne", initialBalance: 1000 });
  catDep = categories.create({ name: "Factures", type: "depense" });
  catRev = categories.create({ name: "Revenus", type: "revenu" });
  catTr = categories.create({ name: "Virements", type: "transfert" });
  th = themes.create({ name: "IA" });
});

test("création : libellé requis, valeurs portées", () => {
  refuse(() => lines.create(null, { label: "   " }), 400);
  loyer = lines.create(null, { label: "Loyer", categoryId: catDep.id, plannedAmount: 700, fromAccountId: main.id, recurringDay: 5, themeId: th.id, isShared: true });
  assert.equal(loyer.plannedAmount, 700);
  assert.equal(loyer.recurringDay, 5);
  assert.equal(loyer.themeId, th.id);
});

test("périodicité : ancrage obligatoire au-delà du mensuel, prochaine échéance calculée", () => {
  refuse(() => lines.create(null, { label: "Annuel", plannedAmount: 120, intervalMonths: 12 }), 400);
  annuel = lines.create(null, { label: "Assurance", categoryId: catDep.id, plannedAmount: 120, fromAccountId: main.id, intervalMonths: 12, anchorMonth: 3, recurringDay: 10 });
  assert.match(annuel.nextDue || "", /^\d{4}-03-10$/);
});

test("cycleMatches : la ligne ne tombe que les mois du cycle", () => {
  const l = { interval_months: 6, anchor_month: 3 };
  assert.ok(lines.cycleMatches(l, "2026-03"));
  assert.ok(lines.cycleMatches(l, "2026-09"));
  assert.ok(!lines.cycleMatches(l, "2026-04"));
  assert.ok(lines.cycleMatches({ interval_months: 1, anchor_month: null }, "2026-04"), "une mensuelle tombe chaque mois");
});

test("mensualiser : enveloppe liée (cible = prévu, échéance = prochaine occurrence) ; refusé en mensuel", () => {
  const done = lines.setMonthlyized(annuel.id, { enabled: true });
  const env = envelopes.getById(done.envelopeId);
  assert.ok(eq(env.targetAmount, 120));
  assert.equal(env.deadline, annuel.nextDue);
  refuse(() => lines.setMonthlyized(loyer.id, { enabled: true }), 400);
});

test("démensualiser : la ligne est déliée", () => {
  const off = lines.setMonthlyized(annuel.id, { enabled: false });
  assert.equal(off.envelopeId, null);
  annuel = lines.setMonthlyized(annuel.id, { enabled: true }); // on remensualise pour la suite
});

test("cagnotte du template : prévu forcé à 0, ½ rattachable", () => {
  const pot = lines.create(null, { label: "Loyer partagé", categoryId: catTr.id, isPot: true, potPartnerName: "Alex", potPartnerPaid: 600, potMyShare: 50, fromAccountId: main.id });
  assert.ok(pot.isPot);
  assert.ok(eq(pot.plannedAmount, 0), "le prévu d'une cagnotte est calculé, jamais saisi");
  lines.update(loyer.id, { potLineId: pot.id });
  assert.equal(lines.getById(loyer.id).potLineId, pot.id);
});

test("réordonnancement global", () => {
  const before = lines.listByMonth(null);
  const orders = before.map((l, i) => ({ id: l.id, order: before.length - 1 - i })); // ordre inversé
  lines.reorder(orders);
  assert.equal(lines.listByMonth(null)[0].id, before[before.length - 1].id);
});

test("appliquer au mois : la copie est créée ou mise à jour, le réel n'est pas touché", () => {
  month = months.create({ period: currentPeriod(), snapshots: [{ accountId: main.id, balance: 500 }] });
  lines.update(loyer.id, { plannedAmount: 750 });
  lines.applyToMonth(loyer.id, month.id);
  const copy = months.getLines(month.id).find((l) => l.templateLineId === loyer.id);
  assert.equal(copy.plannedAmount, 750, "la copie du mois reprend le nouveau prévu");
});

test("reporter dans le template : les valeurs de la copie deviennent le standard", () => {
  const copy = months.getLines(month.id).find((l) => l.templateLineId === loyer.id);
  lines.update(copy.id, { plannedAmount: 800 });
  lines.applyToTemplate(copy.id);
  assert.equal(lines.getById(loyer.id).plannedAmount, 800);
});

test("supprimer une ligne du template : les copies des mois restent, détachées", () => {
  lines.remove(loyer.id);
  assert.ok(!lines.listByMonth(null).some((l) => l.id === loyer.id));
  const copy = months.getLines(month.id).find((l) => l.label === "Loyer");
  assert.ok(copy, "la copie du mois reste");
});

test("supprimer une ligne mensualisée : l'enveloppe jamais vécue part avec, la vécue reste", () => {
  const l1 = lines.create(null, { label: "Assurance", categoryId: catDep.id, plannedAmount: 240, intervalMonths: 12, anchorMonth: 1, fromAccountId: main.id });
  const e1 = lines.setMonthlyized(l1.id, { enabled: true }).envelopeId;
  lines.remove(l1.id);
  refuse(() => envelopes.getById(e1), 404);
  const l2 = lines.create(null, { label: "Impôts annuels", categoryId: catDep.id, plannedAmount: 300, intervalMonths: 12, anchorMonth: 2, fromAccountId: main.id });
  const e2 = lines.setMonthlyized(l2.id, { enabled: true }).envelopeId;
  envelopes.addContribution(e2, { amount: 25, fromAccountId: main.id });
  lines.remove(l2.id);
  assert.ok(eq(envelopes.getById(e2).total, 25), "l'enveloppe vécue reste ouverte avec son argent");
});
