// Tests unitaires — page Paramètres : catégories, thèmes (fusion), calculateurs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, eq, currentPeriod, nextPeriodOf } from "./_setup.mjs";

const { accounts, categories, themes, budgetLines: lines, months, entries, calculators, summary } = await boot();

const period = currentPeriod();
let main, catDep, catRev, th, courses, m, calc;

test("décor : compte, mois, ligne Courses", () => {
  main = accounts.create({ name: "Courant" });
  catDep = categories.create({ name: "Factures", type: "depense" });
  catRev = categories.create({ name: "Revenus", type: "revenu" });
  th = themes.create({ name: "IA" });
  courses = lines.create(null, { label: "Courses", categoryId: catDep.id, plannedAmount: 300, fromAccountId: main.id, themeId: th.id });
  m = months.create({ period, snapshots: [{ accountId: main.id, balance: 500 }] });
});

test("catégories : 4 types seulement, noms uniques, réordonnancement", () => {
  refuse(() => categories.create({ name: "X", type: "foo" }), 400);
  refuse(() => categories.create({ name: "factures" }), 409);
  categories.reorder([{ id: catRev.id, order: 0 }, { id: catDep.id, order: 1 }]);
  assert.equal(categories.list()[0].id, catRev.id);
});

test("catégorie utilisée : suppression refusée sans force, lignes conservées avec force", () => {
  refuse(() => categories.remove(catDep.id), 409);
  const spare = categories.create({ name: "Divers", type: "depense" });
  categories.remove(spare.id); // inutilisée : OK direct
  categories.remove(catDep.id, { force: true });
  assert.ok(lines.listByMonth(null).some((l) => l.categoryId === null), "la ligne survit, sans catégorie");
  catDep = categories.create({ name: "Factures", type: "depense" });
  lines.update(courses.id, { categoryId: catDep.id });
});

test("thèmes : unicité (casse ignorée), suppression protégée, fusion", () => {
  refuse(() => themes.create({ name: "ia" }), 409);
  refuse(() => themes.remove(th.id), 409); // utilisé par Courses
  const th2 = themes.create({ name: "Culture" });
  themes.merge(th.id, th2.id);
  assert.ok(!themes.list().some((t) => t.id === th.id), "le thème source disparaît");
  assert.equal(lines.getById(courses.id).themeId, th2.id, "les références sont déplacées");
  th = th2;
});

test("listes : compteurs d'usage portés par catégories et thèmes (page Paramètres)", () => {
  const c = categories.list().find((x) => x.id === catDep.id);
  assert.equal(c.templateLines, 1, "Courses est rattachée au template");
  assert.equal(typeof c.monthLines, "number");
  const t = themes.list().find((x) => x.id === th.id);
  assert.ok(t.lines >= 1, `le thème est porté par au moins la ligne Courses (${t.lines})`);
  assert.equal(typeof t.entries, "number");
});

test("calculateur : formule fermée (symboles déclarés uniquement)", () => {
  calc = calculators.save(null, {
    name: "Élec", formula: "(hp × prixHP) × (1 + tva / 100) + abo", lineId: courses.id,
    params: [{ symbol: "prixHP", value: 0.2 }, { symbol: "abo", value: 10 }, { symbol: "tva", value: 20 }],
    readings: [{ symbol: "hp", kind: "index" }],
  });
  refuse(() => calculators.save(null, { name: "X", formula: "a + b", params: [{ symbol: "a", value: 1 }], readings: [] }), 400);
});

test("relevés du mois : estimé, écart, report de l'index au mois suivant", () => {
  let st = calculators.monthState(m.id).find((c) => c.id === calc.id);
  calculators.saveReadings(m.id, calc.id, [{ defId: st.readings[0].defId, previous: 100, current: 200 }]);
  st = calculators.monthState(m.id).find((c) => c.id === calc.id);
  assert.ok(eq(st.estimate, 34), "100 × 0,2 × 1,2 + 10");
  assert.ok(eq(st.gap, -266), "estimé − prévu (300)");
  const m2 = months.create({ period: nextPeriodOf(period) });
  const st2 = calculators.monthState(m2.id).find((c) => c.id === calc.id);
  assert.equal(st2.readings[0].previous, 200, "l'index de fin devient l'index de début suivant");
  months.remove(m2.id);
});

test("régularisation : posée sur la ligne, remplacée si relancée", () => {
  const mCourses = months.getLines(m.id).find((l) => l.templateLineId === courses.id);
  entries.create(m.id, { lineId: mCourses.id, amount: 40 });
  calculators.regularize(m.id, calc.id);
  assert.ok(eq(months.getLines(m.id).find((l) => l.id === mCourses.id).actualAmount, 40 - 266), "réel = 40 + écart (−266)");
  calculators.regularize(m.id, calc.id);
  assert.ok(eq(months.getLines(m.id).find((l) => l.id === mCourses.id).actualAmount, 40 - 266), "pas de doublon");
});
