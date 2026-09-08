// Tests unitaires — périmètre « plan de financement ».
// Le service est un calcul pur : aucune base, rien à monter, on l'importe directement.
//
// Le modèle : des ZONES et des POURCENTAGES. Une zone est une période où la
// répartition ne change pas ; on passe à la suivante dès qu'un objectif est soldé.
// Lancer depuis backend/ : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlan, shareFor, zoneCount } from "../services/plan.service.js";

const goal = (plan, key) => plan.goals.find((g) => g.key === key);
const row = (plan, period) => plan.rows.find((r) => r.period === period);

// Le plan type : un PC, un apport, un PEA sans fin — 60/30/10 puis 50/50 puis 100
const planZones = (extra = {}) => computePlan({
  capacity: 1000,
  startPeriod: "2026-12",
  goals: [
    { key: "pc", name: "PC", type: "epargne", target: 3000 },
    { key: "apport", name: "Apport", type: "epargne", target: 6000 },
    { key: "pea", name: "PEA", type: "investissement", target: null },
  ],
  zones: [
    { percents: { pc: 60, apport: 30, pea: 10 } },
    { percents: { apport: 50, pea: 50 } },
    { percents: { pea: 100 } },
  ],
  ...extra,
});

test("le nombre de zones découle des objectifs : une par cible, plus une pour le reste", () => {
  assert.equal(zoneCount([{ target: 100 }, { target: 200 }, { target: null }]), 3);
  assert.equal(zoneCount([{ target: 100 }, { target: 200 }]), 2, "sans objectif perpétuel, pas de zone finale");
  assert.equal(zoneCount([{ target: null }]), 1);
  assert.equal(zoneCount([]), 1, "un plan vide a quand même une zone");
});

test("zone 1 : la capacité se répartit selon les pourcentages saisis", () => {
  const p = planZones();
  const r = row(p, "2026-12");
  assert.equal(r.cells.pc, 600, "60 % de 1 000 €");
  assert.equal(r.cells.apport, 300, "30 %");
  assert.equal(r.cells.pea, 100, "10 %");
  assert.equal(r.total, 1000, "toute la capacité est employée");
});

test("le mois où un objectif se solde, le reste bascule sur la zone suivante", () => {
  const p = planZones();
  // 600 €/mois sur 3 000 € : le PC est soldé au 5e mois, sans reliquat
  assert.equal(goal(p, "pc").reached, "2027-04");
  assert.equal(goal(p, "pc").paid, 3000, "pile la cible, jamais au-delà");

  // Le mois suivant, la zone 2 s'applique : 50/50 entre apport et PEA
  const apres = row(p, "2027-05");
  assert.equal(apres.cells.pc, undefined, "le PC a quitté le partage");
  assert.equal(apres.cells.apport, 500);
  assert.equal(apres.cells.pea, 500);
});

test("un objectif ne reçoit jamais plus que son reste, et le surplus repart aux autres", () => {
  // 1 000 € à répartir, mais le PC n'a plus que 100 € à financer
  const p = computePlan({
    capacity: 1000, startPeriod: "2026-12",
    goals: [
      { key: "pc", name: "PC", type: "epargne", target: 3000, already: 2900 },
      { key: "apport", name: "Apport", type: "epargne", target: 6000 },
    ],
    zones: [{ percents: { pc: 60, apport: 40 } }, { percents: { apport: 100 } }],
  });
  const r = row(p, "2026-12");
  assert.equal(r.cells.pc, 100, "il ne prend que ce qui lui manque");
  assert.equal(r.cells.apport, 900, "les 500 € qu'il n'a pas pris sont repartis à l'apport");
  assert.equal(r.total, 1000, "rien n'est perdu en route");
});

test("les deux cibles sont tenues au centime", () => {
  const p = planZones();
  assert.equal(goal(p, "pc").paid, 3000);
  assert.equal(goal(p, "apport").paid, 6000);
});

test("une fois tout soldé, la zone finale reste visible quelques mois", () => {
  const p = planZones();
  const dernierObjectif = goal(p, "apport").reached;
  const apres = p.rows.filter((r) => r.period > dernierObjectif);
  assert.equal(apres.length, 2, "de quoi la voir, pas l'infini");
  // Il ne reste que le PEA : la zone finale est à 100 % pour lui
  assert.ok(apres.every((r) => Object.keys(r.cells).length === 1 && 'pea' in r.cells),
    "seul l'objectif sans fin subsiste");
  assert.ok(apres.every((r) => r.total === 1000), "il encaisse toute la capacité");
});

test("un objectif sans fin encaisse sa part indéfiniment, sans jamais être « atteint »", () => {
  const p = planZones();
  assert.equal(goal(p, "pea").reached, null);
  assert.equal(goal(p, "pea").target, null);
  assert.ok(goal(p, "pea").paid > 0);
});

test("une zone non renseignée répartit à parts égales plutôt que de ne rien produire", () => {
  const p = computePlan({
    capacity: 900, startPeriod: "2026-12",
    goals: [
      { key: "a", name: "A", type: "epargne", target: 9000 },
      { key: "b", name: "B", type: "epargne", target: 9000 },
      { key: "c", name: "C", type: "epargne", target: 9000 },
    ],
    zones: [], // rien de saisi
  });
  const r = row(p, "2026-12");
  assert.equal(r.cells.a, 300);
  assert.equal(r.cells.b, 300);
  assert.equal(r.cells.c, 300);
});

test("des parts qui ne totalisent pas 100 sont normalisées : 6/3/1 vaut 60/30/10", () => {
  const p = computePlan({
    capacity: 1000, startPeriod: "2026-12",
    goals: [
      { key: "pc", name: "PC", type: "epargne", target: 9000 },
      { key: "apport", name: "Apport", type: "epargne", target: 9000 },
      { key: "pea", name: "PEA", type: "investissement", target: null },
    ],
    zones: [{ percents: { pc: 6, apport: 3, pea: 1 } }],
  });
  const r = row(p, "2026-12");
  assert.equal(r.cells.pc, 600);
  assert.equal(r.cells.apport, 300);
  assert.equal(r.cells.pea, 100);
});

test("un objectif à 0 % est simplement en attente : il ne reçoit rien", () => {
  const p = computePlan({
    capacity: 1000, startPeriod: "2026-12",
    goals: [
      { key: "pc", name: "PC", type: "epargne", target: 5000 },
      { key: "plus_tard", name: "Plus tard", type: "epargne", target: 5000 },
    ],
    zones: [{ percents: { pc: 100, plus_tard: 0 } }, { percents: { plus_tard: 100 } }],
  });
  assert.equal(row(p, "2026-12").cells.pc, 1000);
  assert.equal(row(p, "2026-12").cells.plus_tard, undefined, "rien tant que le PC court");
  assert.ok(goal(p, "plus_tard").paid > 0, "il est financé une fois le PC soldé");
});

test("un objectif peut démarrer plus tard que le plan", () => {
  const p = computePlan({
    capacity: 1000, startPeriod: "2026-12",
    goals: [
      { key: "pc", name: "PC", type: "epargne", target: 9000 },
      { key: "apport", name: "Apport", type: "epargne", target: 9000, startPeriod: "2027-03" },
    ],
    zones: [{ percents: { pc: 50, apport: 50 } }],
  });
  assert.equal(row(p, "2026-12").cells.apport, undefined, "il n'a pas commencé");
  assert.equal(row(p, "2026-12").cells.pc, 1000, "le PC prend tout en attendant");
  assert.equal(row(p, "2027-03").cells.apport, 500, "il entre à sa date, avec sa part");
});

test("le plan ouvre au premier mois utile, pas sur des lignes à zéro", () => {
  const p = computePlan({
    capacity: 1000, startPeriod: "2026-10",
    goals: [
      { key: "pc", name: "PC", type: "epargne", target: 3000, startPeriod: "2026-12" },
      { key: "apport", name: "Apport", type: "epargne", target: 3000, startPeriod: "2027-02" },
    ],
    zones: [{ percents: { pc: 100 } }, { percents: { apport: 100 } }],
  });
  assert.equal(p.rows[0].period, "2026-12", "octobre et novembre ne recevaient rien");
  assert.ok(p.rows.every((r) => r.total > 0), "plus aucun mois vide en tête");
  assert.equal(p.zones[0].from, "2026-12", "la zone 1 suit le vrai départ");
});

test("un plan qui ne reçoit jamais rien reste affiché : c'est le diagnostic", () => {
  const p = computePlan({ capacity: 800, startPeriod: "2026-12", goals: [] });
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].total, 0, "le tableau dit qu'il ne se passe rien, il ne disparaît pas");
});

test("une cellule verrouillée est servie d'abord, le reste se répartit autour", () => {
  const p = planZones({ locks: { "2026-12": { pc: 100 } } });
  const r = row(p, "2026-12");
  assert.equal(r.cells.pc, 100, "la valeur saisie est respectée telle quelle");
  assert.equal(r.total, 1000, "la capacité reste employée en entier");
  // Les 900 restants suivent les parts de la zone entre apport (30) et PEA (10)
  assert.equal(r.cells.apport, 675);
  assert.equal(r.cells.pea, 225);
});

test("verrouiller ne dérègle pas les cibles", () => {
  const p = planZones({ locks: { "2026-12": { pc: 100 }, "2027-01": { pc: 900 } } });
  assert.equal(goal(p, "pc").paid, 3000);
  assert.equal(goal(p, "apport").paid, 6000);
});

test("une cellule verrouillée à zéro met l'objectif en pause ce mois-là", () => {
  const p = planZones({ locks: { "2026-12": { pc: 0 } } });
  const r = row(p, "2026-12");
  assert.equal(r.cells.pc, 0);
  assert.equal(r.total, 1000, "sa part est reprise par les autres");
});

test("un objectif déjà commencé part de ce qui est déjà mis de côté", () => {
  // Matelas de sécurité, données réelles : 5 006,25 € sur une cible de 5 500 €
  const p = computePlan({
    capacity: 500, startPeriod: "2026-12",
    goals: [{ key: "matelas", name: "Matelas", type: "epargne", target: 5500, already: 5006.25 }],
    zones: [{ percents: { matelas: 100 } }],
  });
  assert.equal(p.rows.length, 1, "il ne reste que 493,75 € : un mois suffit");
  assert.equal(row(p, "2026-12").cells.matelas, 493.75, "on ne verse que le reste");
});

test("le plan rend la composition de chaque zone, pour que l'écran sache quoi proposer", () => {
  const p = planZones();
  assert.equal(p.zones.length, 3);
  assert.deepEqual(p.zones[0].goals, ["pc", "apport", "pea"]);
  assert.deepEqual(p.zones[1].goals, ["apport", "pea"], "le PC est sorti");
  assert.deepEqual(p.zones[2].goals, ["pea"], "il ne reste que le perpétuel");
  // Le PC se solde en avril, mais la répartition d'avril est encore celle de la zone 1 :
  // les 1 000 € y sont entièrement employés en 60/30/10, il ne reste rien à basculer.
  // La zone 2 s'applique donc à partir de mai.
  assert.equal(goal(p, "pc").reached, "2027-04");
  assert.equal(p.zones[1].from, "2027-05");
});

test("un objectif hors d'atteinte à l'horizon est annoncé, avec ce qui manque", () => {
  const p = computePlan({
    capacity: 100, startPeriod: "2026-12", horizon: 6,
    goals: [{ key: "gros", name: "Trop gros", type: "epargne", target: 5000 }],
    zones: [{ percents: { gros: 100 } }],
  });
  const g = goal(p, "gros");
  assert.equal(g.paid, 600);
  assert.equal(g.shortfall, 4400);
  assert.equal(g.reached, null);
  assert.ok(p.warnings.some((w) => w.includes("Trop gros")));
});

test("une capacité nulle est signalée plutôt que de rendre un tableau vide sans raison", () => {
  const p = computePlan({
    capacity: 0, startPeriod: "2026-12",
    goals: [{ key: "a", name: "A", type: "epargne", target: 1000 }],
  });
  assert.ok(p.warnings.some((w) => w.includes("nulle")));
});

test("l'autre sens du calcul : une cible et un délai donnent une mensualité", () => {
  assert.equal(shareFor(3500, 8), 437.5, "le PC en 8 mois");
  assert.equal(shareFor(10000, 17), 588.24, "l'apport en 17 mois");
  assert.equal(shareFor(5500, 3, 5006.25), 164.59, "en tenant compte du déjà versé");
  assert.equal(shareFor(100, 3), 33.34, "arrondi au centime supérieur");
  assert.equal(shareFor(500, 0), 500, "sans délai, tout est dû tout de suite");
});

test("un plan vide ne plante pas", () => {
  const p = computePlan({ capacity: 800, startPeriod: "2026-12", goals: [] });
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].total, 0);
  assert.deepEqual(p.goals, []);
});
