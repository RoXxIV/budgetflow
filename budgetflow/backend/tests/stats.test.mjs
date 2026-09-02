// Tests unitaires — page Stats : agrégats par mois (réel = entrées, virements et transferts exclus).
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, eq, currentPeriod } from "./_setup.mjs";

const S = await boot();
const { accounts, categories, themes, budgetLines: lines, months, entries } = S;
const stats = await import("../services/stats.service.js");

const period = currentPeriod();
let main, livret, catDep, catRev, catTr, th, m, o;

test("décor : comptes, catégories, thème, mois, entrées", () => {
  main = accounts.create({ name: "Courant" });
  livret = accounts.create({ name: "Livret", type: "epargne", multiProjects: true });
  catDep = categories.create({ name: "Factures", type: "depense" });
  catRev = categories.create({ name: "Revenus", type: "revenu" });
  catTr = categories.create({ name: "Virements", type: "transfert" });
  th = themes.create({ name: "IA" });
  m = months.create({ period, snapshots: [{ accountId: main.id, balance: 500 }, { accountId: livret.id, balance: 1000 }] });
  const dep = lines.create(m.id, { label: "Courses", categoryId: catDep.id, fromAccountId: main.id, themeId: th.id });
  entries.create(m.id, { lineId: dep.id, amount: 50 });
  const rev = lines.create(m.id, { label: "Salaire", categoryId: catRev.id, toAccountId: main.id });
  entries.create(m.id, { lineId: rev.id, amount: 2000 });
  const tr = lines.create(m.id, { label: "Op interne", categoryId: catTr.id, fromAccountId: main.id, toAccountId: livret.id });
  entries.create(m.id, { lineId: tr.id, amount: 300 });
  entries.create(m.id, { amount: 40, accountId: main.id, toAccountId: livret.id }); // virement libre, sans ligne
  const japon = S.envelopes.create({ name: "Japon", accountId: livret.id });
  S.envelopes.addContribution(japon.id, { amount: 450, fromAccountId: main.id, notes: "Mensualité" });
  o = stats.overview();
});

test("périodes : un point par mois existant", () => {
  assert.ok(o.periods.includes(period));
});

test("épargne : le snapshot du Livret alimente sa courbe", () => {
  const s = o.savings.find((x) => x.name === "Livret");
  assert.ok(s && eq(s.points[o.periods.indexOf(period)], 1000));
});

test("thèmes : dépenses du mois par thème (50 sur IA)", () => {
  const t = o.themes.find((x) => x.name === "IA");
  assert.ok(t && eq(t.points[o.periods.indexOf(period)], 50));
});

test("catégories : les transferts sont exclus, le réel est là", () => {
  assert.ok(!o.categories.some((c) => c.name === "Virements"));
  const c = o.categories.find((x) => x.name === "Factures");
  assert.ok(c && eq(c.points[o.periods.indexOf(period)], 50));
});

test("mis de côté par enveloppe : la contribution normale du Japon apparaît", () => {
  const e = o.envelopes.find((x) => x.name === "Japon");
  assert.ok(e && eq(e.points[o.periods.indexOf(period)], 450));
});

test("totaux par type : réel dépense/revenu, épargne = contributions normales, virements exclus", () => {
  const t = o.types.find((x) => x.period === period);
  assert.ok(eq(t.real.depense, 50), `dépense = ${t.real.depense}`);
  assert.ok(eq(t.real.revenu, 2000));
  assert.ok(eq(t.real.epargne, 450), `épargne = ${t.real.epargne}`);
});
