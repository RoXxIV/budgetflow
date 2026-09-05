// Tests unitaires — tracker d'abonnements (bac à sable) : CRUD, validations, import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, eq, currentPeriod } from "./_setup.mjs";

const S = await boot();
const { accounts, categories, themes, budgetLines: lines, months } = S;
const subs = await import("../services/subscription.service.js");

const period = currentPeriod();
let main, catAbo, th, m;

test("décor : compte, catégorie Abonnements, mois, mensualisée", () => {
  main = accounts.create({ name: "Courant" });
  catAbo = categories.create({ name: "Abonnements", type: "depense" });
  th = themes.create({ name: "Streaming" });
  lines.create(null, { label: "Vidéo à la demande", categoryId: catAbo.id, plannedAmount: 13, recurringDay: 22, themeId: th.id, fromAccountId: main.id });
  const ann = lines.create(null, { label: "Sport annuel", categoryId: catAbo.id, plannedAmount: 80, intervalMonths: 12, anchorMonth: 7, recurringDay: 15, fromAccountId: main.id });
  lines.setMonthlyized(ann.id, { enabled: true });
  m = months.create({ period, snapshots: [{ accountId: main.id, balance: 500 }] });
});

test("import : abonnements du mois (mensuel) + mensualisées (annuel), sans doublon", () => {
  const { imported, subscriptions } = subs.importCurrent();
  assert.equal(imported, 2);
  const video = subscriptions.find((s) => s.name === "Vidéo à la demande");
  assert.ok(video && video.period === "mensuel" && eq(video.price, 13) && video.day === 22 && video.themeName === "Streaming");
  const sport = subscriptions.find((s) => s.name === "Sport annuel");
  assert.ok(sport && sport.period === "annuel" && eq(sport.price, 80) && sport.month === 7 && sport.day === 15);
  assert.equal(subs.importCurrent().imported, 0, "réimporter n'ajoute aucun doublon");
});

test("création : validations (périodicité, jour selon période, prix)", () => {
  refuse(() => subs.create({ name: "", price: 5 }), 400);
  refuse(() => subs.create({ name: "X", period: "quotidien" }), 400);
  refuse(() => subs.create({ name: "X", period: "hebdo", day: 8 }), 400); // hebdo : jour 1-7
  refuse(() => subs.create({ name: "X", price: -3 }), 400);
  const hebdo = subs.create({ name: "Presse", period: "hebdo", price: 2.5, day: 6 });
  assert.equal(hebdo.day, 6);
  // le mois n'a de sens qu'en annuel : ignoré ailleurs
  const mensuel = subs.create({ name: "Musique", period: "mensuel", price: 10, day: 3, month: 5 });
  assert.equal(mensuel.month, null);
});

test("simulation et désactivation : le bac à sable vit sa vie", () => {
  const s = subs.create({ name: "Salle de sport", price: 30, sim: 19.9 });
  assert.ok(eq(s.sim, 19.9));
  const cleared = subs.update(s.id, { sim: null });
  assert.equal(cleared.sim, null, "simulation effaçable");
  const zero = subs.update(s.id, { sim: 0 });
  assert.ok(eq(zero.sim, 0), "sim 0 = résiliation simulée, distinct de « pas de simulation »");
  const off = subs.update(s.id, { isActive: false });
  assert.equal(off.isActive, false);
  subs.remove(s.id);
  refuse(() => subs.remove(s.id), 404);
});

test("bac à sable : rien ne fuit vers le mois ni le template", () => {
  const before = months.getLines(m.id).length;
  subs.create({ name: "Hypothétique", price: 0, sim: 15 });
  assert.equal(months.getLines(m.id).length, before, "aucune ligne de mois créée");
  assert.ok(!lines.listByMonth(null).some((l) => l.label === "Hypothétique"), "aucune ligne de template créée");
});
