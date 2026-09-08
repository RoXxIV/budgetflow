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
  // Valorisation datée APRÈS les mouvements : elle les reflète déjà (ancrage exact)
  assets.addValuation(etf.id, { value: 1000, date: `${period}-06` });
  assert.ok(eq(assets.getById(etf.id).gainPct, 10), "(1000 + 100 − 1000) / 1000 = +10 %");
});

test("valeur vivante : les mouvements postérieurs à la valorisation l'ajustent, une nouvelle ré-ancre", () => {
  // Compte dédié : ne pollue ni les soldes du PEA ni le test patrimoine
  const cto = accounts.create({ name: "CTO vivant", type: "investissement" });
  const live = assets.create({ name: "ETF vivant", accountId: cto.id });
  assets.addMovement(live.id, { kind: "versement", amount: 500, date: `${period}-01`, counterpartAccountId: main.id });
  assets.addValuation(live.id, { value: 490, date: `${period}-02` });
  assets.addMovement(live.id, { kind: "versement", amount: 150, date: `${period}-03`, counterpartAccountId: main.id });
  let a = assets.getById(live.id);
  assert.ok(eq(a.value, 640), `490 + 150 versés après la valorisation (${a.value})`);
  assert.ok(eq(a.gain, -10), "640 − 650 investis : le versement n'est pas compté en perte");
  assets.addMovement(live.id, { kind: "retrait", amount: 40, date: `${period}-04`, counterpartAccountId: main.id });
  a = assets.getById(live.id);
  assert.ok(eq(a.value, 600), "un retrait postérieur réduit la valeur");
  assert.ok(eq(a.gain, -10), "et ne change pas la performance (600 + 40 − 650)");
  assets.addValuation(live.id, { value: 700, date: `${period}-05` });
  assert.ok(eq(assets.getById(live.id).value, 700), "une nouvelle valorisation remplace l'ancrage");
});

test("DCA : refusé dès qu'un mouvement du mois existe (le réel remplace le prévu)", () => {
  refuse(() => assets.dca(m.id, etf.id), 409); // l'ETF a déjà des versements manuels ce mois
});

test("DCA : une fois par mois sur un actif sans mouvement, décochable", () => {
  const reg = assets.create({ name: "ETF mensuel", accountId: pea.id, monthlyDca: 50 });
  assets.dca(m.id, reg.id);
  refuse(() => assets.dca(m.id, reg.id), 409);
  assert.ok(eq(summary.getSummary(m.id).accounts.find((a) => a.accountId === pea.id).current, 950));
  assets.undca(m.id, reg.id);
  assert.ok(eq(summary.getSummary(m.id).accounts.find((a) => a.accountId === pea.id).current, 900));
  assets.update(reg.id, { isClosed: true });
});

test("patrimoine : la valeur de marché remplace le solde d'un compte investissement valorisé", () => {
  const nw = summary.getNetWorth();
  const row = nw.accounts.find((a) => a.accountId === pea.id);
  assert.ok(eq(row.used, 1000), "valeur de marché (1000), pas le solde (900)");
  assert.ok(eq(row.balance, 900));
  assert.ok(eq(row.start, 0) && eq(row.balance - row.start, 900), "écart depuis le début du mois disponible");
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

test("revue 04/09 : les valorisations respectent la clôture du mois", () => {
  months.setClosed(m.id, true);
  refuse(() => assets.addValuation(etf.id, { value: 1200, date: `${period}-15` }), 409);
  const valId = assets.listValuations(etf.id)[0].id; // datée dans le mois désormais clôturé
  refuse(() => assets.removeValuation(etf.id, valId), 409);
  months.setClosed(m.id, false);
});

// ─── Lire les mouvements, et les retirer ──────────────────
// Ces fonctions n'étaient exercées par aucune suite (couverture du 08/09) : c'est
// pourtant ce que la page Mois et la page Investissements affichent.

test("l'historique d'un actif se lit du plus récent au plus ancien", () => {
  const mouvements = assets.listMovements(etf.id);
  assert.ok(mouvements.length >= 2, "les mouvements du décor sont là");
  for (let i = 1; i < mouvements.length; i++) {
    assert.ok(mouvements[i - 1].date >= mouvements[i].date, "l'ordre est décroissant");
  }
  const versement = mouvements.find((x) => x.kind === "versement");
  assert.equal(versement.assetName, "ETF Monde", "le nom de l'actif accompagne le mouvement");
  assert.ok(versement.counterpartAccountName, "et celui du compte de contrepartie");
});

test("les mouvements d'un mois se lisent par période, tous actifs confondus", () => {
  const duMois = assets.listMovementsByPeriod(period);
  assert.ok(duMois.length >= 2);
  assert.ok(duMois.every((x) => x.date.startsWith(period)), "rien d'un autre mois");
  // Un mois sans mouvement rend une liste vide, pas une erreur
  assert.deepEqual(assets.listMovementsByPeriod("2020-01"), []);
});

test("retirer un mouvement corrige l'investi et la valeur", () => {
  const cible = assets.create({ name: "Fonds test", accountId: pea.id });
  assets.addMovement(cible.id, { kind: "versement", amount: 300, date: `${period}-12`, counterpartAccountId: main.id });
  assert.ok(eq(assets.getById(cible.id).invested, 300));
  const mvt = assets.listMovements(cible.id)[0];
  assets.removeMovement(cible.id, mvt.id);
  assert.ok(eq(assets.getById(cible.id).invested, 0), "l'investi est revenu à zéro");
  assert.equal(assets.listMovements(cible.id).length, 0);
});

test("retirer un mouvement qui n'existe pas, ou d'un autre actif, est refusé", () => {
  refuse(() => assets.removeMovement(etf.id, 999999), 404);
});

test("un actif qui a vécu ne se supprime pas : la clôture garde l'historique", () => {
  const e = refuse(() => assets.remove(etf.id), 409);
  assert.match(e.message, /Clôturez-le/, "le message oriente vers le bon geste");
});

test("un actif créé par erreur, lui, s'efface", () => {
  const erreur = assets.create({ name: "Créé par erreur", accountId: pea.id });
  assets.remove(erreur.id);
  assert.equal(assets.list().some((a) => a.name === "Créé par erreur"), false);
  refuse(() => assets.remove(999999), 404);
});
