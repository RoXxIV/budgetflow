// Tests unitaires — « Annuler ce mois-ci » sur une ligne du budget.
//
// LE BESOIN — dire « ce mois-ci, pas de loyer » sans supprimer la ligne. Le mécanisme
// existait depuis la 019 pour les mensualités d'enveloppe et les DCA ; il s'étend ici
// aux lignes. L'alternative était de supprimer la ligne du mois : destructif, et sans
// trace du geste.
//
// CE QUI EST VÉRIFIÉ — qu'annuler retire bien la ligne du Reste à vivre, que ça ne
// touche à rien d'autre, et que c'est réversible. Plus les refus qui protègent le
// chiffre affiché. Lancer depuis backend/ : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, currentPeriod, nextPeriodOf, eq } from "./_setup.mjs";

const S = await boot();
const { accounts, categories, months, budgetLines, entries, summary } = S;

const compte = accounts.create({ name: "Courant", type: "courant" });
const catDep = categories.create({ name: "Charges", type: "depense" });
const catRev = categories.create({ name: "Revenus", type: "revenu" });

const periode = currentPeriod();
const mois = months.create({ period: periode, snapshots: [{ accountId: compte.id, balance: 1000 }] });
const loyer = budgetLines.create(mois.id, { label: "Loyer", plannedAmount: 400, categoryId: catDep.id, fromAccountId: compte.id });
const salaire = budgetLines.create(mois.id, { label: "Salaire", plannedAmount: 2000, categoryId: catRev.id, toAccountId: compte.id });

const tuiles = () => summary.getSummary(mois.id).tiles;
const ligne = (id) => months.getLines(mois.id).find((l) => l.id === id);

test("au départ, le loyer pèse dans les sorties à venir", () => {
  assert.ok(eq(tuiles().detail.prevusRestants, 400));
  assert.ok(eq(tuiles().detail.revenusRestants, 2000));
  assert.equal(ligne(loyer.id).isSkipped, false, "rien n'est annulé");
});

test("annuler une ligne la retire des sorties à venir", () => {
  months.addSkip(mois.id, { kind: "line", targetId: loyer.id });
  assert.ok(eq(tuiles().detail.prevusRestants, 0), "les 400 € ne sont plus attendus");
  assert.ok(eq(tuiles().detail.revenusRestants, 2000), "le salaire n'a pas bougé");
});

test("le projeté remonte d'autant : c'est tout l'intérêt du geste", () => {
  // disponible 1 000 € + 2 000 € de salaire à venir − 0 € de sorties
  assert.ok(eq(tuiles().projete, 3000));
});

test("la ligne reste là, marquée annulée — elle n'est pas supprimée", () => {
  const l = ligne(loyer.id);
  assert.ok(l, "la ligne existe toujours");
  assert.equal(l.isSkipped, true);
  assert.equal(l.plannedAmount, 400, "son montant prévu est intact");
});

test("annuler ne touche ni au solde, ni au mis de côté", () => {
  assert.ok(eq(tuiles().disponible, 1000), "aucun argent n'a bougé");
  assert.ok(eq(tuiles().misDeCote, 0));
});

test("annuler deux fois la même ligne ne casse rien", () => {
  months.addSkip(mois.id, { kind: "line", targetId: loyer.id });
  const skips = months.listSkips(mois.id).filter((s) => s.kind === "line");
  assert.equal(skips.length, 1, "une seule exception, pas deux");
});

test("un revenu s'annule aussi, et sort des revenus à venir", () => {
  months.addSkip(mois.id, { kind: "line", targetId: salaire.id });
  assert.ok(eq(tuiles().revenusRestants, 0), "le salaire n'est plus attendu");
  assert.ok(eq(tuiles().projete, 1000), "le projeté retombe sur le disponible");
  months.removeSkip(mois.id, "line", salaire.id);
});

test("rétablir remet la ligne dans le calcul", () => {
  months.removeSkip(mois.id, "line", loyer.id);
  assert.ok(eq(tuiles().detail.prevusRestants, 400), "les 400 € sont de nouveau attendus");
  assert.equal(ligne(loyer.id).isSkipped, false);
});

// ─── Ce qui est refusé, et pourquoi ───

test("on ne peut pas annuler la ligne d'un autre mois", () => {
  // Sans ce contrôle, passer l'id d'une ligne étrangère fausserait le chiffre du mois
  const autre = months.create({ period: nextPeriodOf(periode), snapshots: [{ accountId: compte.id, balance: 500 }] });
  const ailleurs = budgetLines.create(autre.id, { label: "Ailleurs", plannedAmount: 50, categoryId: catDep.id });
  refuse(() => months.addSkip(mois.id, { kind: "line", targetId: ailleurs.id }), 404);
});

test("on ne peut pas annuler une ligne du template", () => {
  const tpl = budgetLines.create(null, { label: "Modèle", plannedAmount: 50, categoryId: catDep.id });
  refuse(() => months.addSkip(mois.id, { kind: "line", targetId: tpl.id }), 404);
});

test("un genre inconnu est refusé", () => {
  refuse(() => months.addSkip(mois.id, { kind: "chaussette", targetId: loyer.id }), 400);
});

// ─── Ce que le geste remplace ───

test("saisir 0 € reste refusé, avec un message qui indique le bon geste", () => {
  const e = refuse(() => entries.create(mois.id, { lineId: loyer.id, amount: 0, accountId: compte.id }), 400);
  assert.match(e.message, /Annuler ce mois-ci/, "le message doit orienter vers le bouton");
});

test("supprimer une ligne emporte son annulation : pas d'exception orpheline", () => {
  const jetable = budgetLines.create(mois.id, { label: "Jetable", plannedAmount: 10, categoryId: catDep.id });
  months.addSkip(mois.id, { kind: "line", targetId: jetable.id });
  assert.equal(months.listSkips(mois.id).some((s) => s.kind === "line" && s.targetId === jetable.id), true);
  budgetLines.remove(jetable.id);
  assert.equal(months.listSkips(mois.id).some((s) => s.kind === "line" && s.targetId === jetable.id), false,
    "l'exception est partie avec la ligne");
});

test("une ligne annulée qui reçoit une entrée compte quand même pour son réel", () => {
  // L'annulation porte sur le PRÉVU. Si de l'argent est réellement sorti, il est sorti.
  months.addSkip(mois.id, { kind: "line", targetId: loyer.id });
  const avant = tuiles().disponible;
  entries.create(mois.id, { lineId: loyer.id, label: "Loyer payé finalement", amount: 400, accountId: compte.id });
  assert.ok(eq(tuiles().disponible, avant - 400), "le solde baisse : l'argent est bien parti");
  assert.ok(eq(tuiles().detail.prevusRestants, 0), "et rien n'est compté deux fois");
});
