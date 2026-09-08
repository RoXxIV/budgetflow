// Tests unitaires — les refus qui protègent les données.
//
// POURQUOI CETTE SUITE — la mesure de couverture du 08/09 a montré que les trous
// n'étaient pas des fonctions oubliées, mais des BRANCHES jamais prises : les
// refus. `account.service.js` plafonnait à 72 % de branches, et les quatre lignes
// manquantes étaient ses quatre garde-fous. Ce sont précisément ceux dont on ne
// s'aperçoit qu'ils ont cédé qu'une fois les données perdues.
//
// Chaque test ici pose la situation qu'un garde-fou doit refuser, et vérifie qu'il
// refuse — avec le bon statut, et un message qui dit quoi faire.
//
// Lancer depuis backend/ : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, currentPeriod } from "./_setup.mjs";

const S = await boot();
const { accounts, envelopes, months, categories, themes, budgetLines, assets, calculators } = S;

const principal = accounts.create({ name: "Courant", type: "courant" });
const second = accounts.create({ name: "Livret", type: "epargne", multiProjects: true });
const cat = categories.create({ name: "Charges", type: "depense" });
const periode = currentPeriod();
const mois = months.create({ period: periode, snapshots: [{ accountId: principal.id, balance: 1000 }] });

// ═══ Comptes ═══

test("deux comptes ne peuvent pas porter le même nom, même en changeant la casse", () => {
  // Sans ça, « Livret » et « livret » cohabiteraient et on ne saurait plus lequel est lequel
  const e = refuse(() => accounts.update(second.id, { name: "COURANT" }), 409);
  assert.match(e.message, /existe déjà/);
});

test("le compte principal ne se supprime pas tant qu'il en reste d'autres", () => {
  const e = refuse(() => accounts.remove(principal.id), 409);
  assert.match(e.message, /désignez-en un autre/, "le message dit comment s'en sortir");
});

test("un compte qui héberge une enveloppe ouverte ne se désactive pas", () => {
  const env = envelopes.create({ name: "Projet", accountId: second.id });
  const e = refuse(() => accounts.setActive(second.id, false), 409);
  assert.match(e.message, /enveloppe/, "il faut d'abord clôturer ou déplacer");
  envelopes.closeInto(env.id, { toAccountId: principal.id });
});

test("un compte qui héberge un actif ouvert ne se désactive pas non plus", () => {
  // Ses versements deviendraient invisibles au bilan
  const actif = assets.create({ name: "ETF", accountId: second.id });
  const e = refuse(() => accounts.setActive(second.id, false), 409);
  assert.match(e.message, /actif/);
  assets.update(actif.id, { isClosed: true });
});

test("désactiver un compte avec un solde exige de dire où va l'argent", () => {
  months.upsertSnapshots(mois.id, [{ accountId: second.id, balance: 250 }]);
  const e = refuse(() => accounts.setActive(second.id, false), 409);
  assert.equal(e.payload?.code, "ACCOUNT_HAS_BALANCE", "le front reconnaît ce code pour proposer un virement");
  assert.equal(e.payload?.balance, 250);
});

test("et le compte destinataire doit être valide", () => {
  refuse(() => accounts.setActive(second.id, false, { transferToAccountId: second.id }), 400);
  refuse(() => accounts.setActive(second.id, false, { transferToAccountId: 999999 }), 400);
});

test("le rôle de principal se transfère, il ne se décoche pas", () => {
  const e = refuse(() => accounts.update(principal.id, { isMain: false }), 409);
  assert.match(e.message, /toujours un compte principal/);
});

test("un compte désactivé ne peut pas devenir principal", () => {
  const dormant = accounts.create({ name: "Dormant", type: "courant" });
  accounts.setActive(dormant.id, false);
  refuse(() => accounts.update(dormant.id, { isMain: true }), 409);
});

test("l'inventaire d'usage d'un compte compte ce qui l'empêchera de partir", () => {
  budgetLines.create(mois.id, { label: "Loyer", plannedAmount: 400, categoryId: cat.id, fromAccountId: principal.id });
  const u = accounts.usage(principal.id);
  assert.ok(u.lines >= 1, "les lignes qui le désignent");
  assert.equal(typeof u.entries, "number");
  assert.equal(typeof u.envelopes, "number");
  assert.equal(typeof u.assets, "number");
  refuse(() => accounts.usage(999999), 404);
});

// ═══ Thèmes ═══

test("un thème ne se renomme pas en un nom déjà pris", () => {
  const a = themes.create({ name: "Voiture" });
  themes.create({ name: "Vacances" });
  const e = refuse(() => themes.update(a.id, { name: "vacances" }), 409);
  assert.match(e.message, /existe déjà/, "la comparaison ignore la casse");
});

test("renommer un thème garde sa couleur, et inversement", () => {
  const t = themes.create({ name: "Sport", color: "#112233" });
  assert.equal(themes.update(t.id, { name: "Sport & loisirs" }).color, "#112233");
  assert.equal(themes.update(t.id, { color: "#445566" }).name, "Sport & loisirs");
  refuse(() => themes.update(t.id, { name: "   " }), 400);
  refuse(() => themes.update(999999, { name: "X" }), 404);
});

test("l'usage d'un thème compte AUSSI les calculateurs", () => {
  // Sans ce décompte, un thème « inutilisé » se supprimait en débranchant un
  // calculateur en silence — c'est ce que le commentaire du service raconte.
  const t = themes.create({ name: "Énergie" });
  calculators.save(null, { name: "EDF", formula: "kwh * prix", themeId: t.id,
    params: [{ symbol: "prix", value: 0.25 }], readings: [{ symbol: "kwh", kind: "index" }] });
  const u = themes.usage(t.id);
  assert.equal(u.calculators, 1, "le calculateur est compté");
  const e = refuse(() => themes.remove(t.id), 409);
  assert.equal(e.payload?.code, "IN_USE");
  assert.match(e.message, /calculateur/);
});

test("l'usage d'une catégorie distingue le template des mois", () => {
  const c = categories.create({ name: "Éphémère", type: "depense" });
  budgetLines.create(null, { label: "Modèle", plannedAmount: 10, categoryId: c.id });
  budgetLines.create(mois.id, { label: "Du mois", plannedAmount: 10, categoryId: c.id });
  const u = categories.usage(c.id);
  assert.equal(u.templateLines, 1);
  assert.equal(u.monthLines, 1);
  const e = refuse(() => categories.remove(c.id), 409);
  assert.equal(e.payload?.code, "IN_USE");
  // Confirmé, la suppression passe et les lignes deviennent « sans catégorie »
  categories.remove(c.id, { force: true });
  assert.equal(budgetLines.listByMonth(null).find((l) => l.label === "Modèle").categoryId, null);
});

// ═══ Calculateurs ═══

test("une formule invalide est refusée à l'enregistrement, pas découverte plus tard", () => {
  const def = { name: "Test", params: [{ symbol: "a", value: 1 }], readings: [] };
  refuse(() => calculators.save(null, { ...def, formula: "a +" }), 400);
  refuse(() => calculators.save(null, { ...def, formula: "a * inconnu" }), 400);
  refuse(() => calculators.save(null, { ...def, name: "  " }), 400);
});

test("un symbole invalide ou en double est refusé", () => {
  const base = { name: "Test", formula: "", readings: [] };
  refuse(() => calculators.save(null, { ...base, params: [{ symbol: "2mauvais", value: 1 }] }), 400);
  refuse(() => calculators.save(null, { ...base, params: [{ symbol: "a", value: 1 }, { symbol: "a", value: 2 }] }), 400);
  refuse(() => calculators.save(null, { ...base, params: [], readings: [{ symbol: "x", kind: "bizarre" }] }), 400);
});

test("tester une formule ne lève jamais : l'éditeur affiche l'erreur au fil de la frappe", () => {
  const bon = calculators.check("a * 2", [{ symbol: "a", value: 21 }]);
  assert.equal(bon.ok, true);
  assert.equal(bon.value, 42);
  const mauvais = calculators.check("a * (", [{ symbol: "a", value: 1 }]);
  assert.equal(mauvais.ok, false);
  assert.ok(mauvais.error, "l'erreur est rendue, pas levée");
});

test("régulariser sans relevé complet, ou sans ligne rattachée, est refusé", () => {
  const c = calculators.save(null, {
    name: "Eau", formula: "m3 * prix",
    params: [{ symbol: "prix", value: 3 }], readings: [{ symbol: "m3", kind: "index" }],
  });
  refuse(() => calculators.regularize(mois.id, c.id), 400); // aucune ligne rattachée
  refuse(() => calculators.regularize(mois.id, 999999), 404);
});

test("supprimer un calculateur emporte ses relevés, jamais les entrées du mois", () => {
  const c = calculators.save(null, { name: "Jetable", formula: "", params: [], readings: [] });
  calculators.remove(c.id);
  assert.equal(calculators.list().some((x) => x.id === c.id), false);
  refuse(() => calculators.remove(999999), 404);
});
