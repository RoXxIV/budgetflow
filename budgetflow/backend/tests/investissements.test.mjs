// Tests unitaires — page Investissements : actifs, mouvements, valorisations,
// performance, DCA mensuel, bilan et patrimoine à la valeur de marché.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, eq, currentPeriod } from "./_setup.mjs";

const { accounts, months, assets, summary } = await boot();

const period = currentPeriod();
let main, pea, m, etf;

test("décor : comptes, mois", () => {
  main = accounts.create({ name: "Courant" });
  pea = accounts.create({ name: "PEA", type: "investissement" });
  m = months.create({ period, snapshots: [{ accountId: main.id, balance: 5000 }, { accountId: pea.id, balance: 0 }] });
});

test("mouvements : versement et retrait avec contrepartie, soldes à jour", () => {
  etf = assets.create({ name: "ETF Monde", type: "ETF", accountId: pea.id, monthlyDca: 50 });
  assets.addMovement(etf.id, { kind: "versement", amount: 1000, date: `${period}-05`, counterpartAccountId: main.id });
  assets.addMovement(etf.id, { kind: "retrait", amount: 100, date: `${period}-06`, counterpartAccountId: main.id });
  const s = summary.getSummary(m.id);
  assert.ok(eq(s.accounts.find((a) => a.accountId === pea.id).current, 900), "PEA = 1000 − 100");
  assert.ok(eq(s.accounts.find((a) => a.accountId === main.id).current, 4100), "Courant = 5000 − 1000 + 100");
});

test("performance : (valeur + retiré − investi) / investi, un retrait n'est pas une perte", () => {
  assets.addValuation(etf.id, { value: 1000 });
  assert.ok(eq(assets.getById(etf.id).gainPct, 10), "(1000 + 100 − 1000) / 1000 = +10 %");
});

test("DCA : une fois par mois, décochable", () => {
  assets.dca(m.id, etf.id);
  refuse(() => assets.dca(m.id, etf.id), 409);
  assert.ok(eq(summary.getSummary(m.id).accounts.find((a) => a.accountId === pea.id).current, 950));
  assets.undca(m.id, etf.id);
  assert.ok(eq(summary.getSummary(m.id).accounts.find((a) => a.accountId === pea.id).current, 900));
});

test("patrimoine : la valeur de marché remplace le solde d'un compte investissement valorisé", () => {
  const nw = summary.getNetWorth();
  const row = nw.accounts.find((a) => a.accountId === pea.id);
  assert.ok(eq(row.used, 1000), "valeur de marché (1000), pas le solde (900)");
  assert.ok(eq(row.balance, 900));
});

test("garde-fous : suppression d'un actif avec mouvements, désactivation du compte hôte", () => {
  refuse(() => assets.remove(etf.id), 409);
  refuse(() => accounts.setActive(pea.id, false), 409); // actif ouvert hébergé
});

test("clôture d'un actif : plus de mouvement possible", () => {
  const old = assets.create({ name: "Vieux fonds", accountId: pea.id });
  assets.update(old.id, { isClosed: true });
  refuse(() => assets.addMovement(old.id, { kind: "versement", amount: 10, date: `${period}-10` }), 409);
});
