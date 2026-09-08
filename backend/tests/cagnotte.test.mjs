// Tests unitaires — la formule des cagnottes, des DEUX côtés.
//
// POURQUOI CE FICHIER — le calcul existe en deux exemplaires : `compute()` dans
// pot.service.js pour les mois, et `potCalc()` dans frontend/src/lib/potCalc.js pour le
// Template, qui n'a pas d'entrées à interroger. La revue du 08/09 a trouvé qu'ils
// divergeaient d'un centime dès que le total commun était impair — une fois sur deux,
// et avril 2026 était touché en base.
//
// Ces tests confrontent les deux implémentations sur un balayage de valeurs. Le module
// front est du JavaScript ordinaire, sans Vue : il s'importe tel quel depuis ici, sans
// monter d'outillage de test côté frontend.
//
// Lancer depuis backend/ : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, currentPeriod } from "./_setup.mjs";
import { potCalc } from "../../frontend/src/lib/potCalc.js";

const S = await boot();
const { accounts, categories, months, budgetLines } = S;
const pots = await import("../services/pot.service.js");
const { run, get } = await import("../db/index.js");

const compte = accounts.create({ name: "Courant", type: "courant" });
const cat = categories.create({ name: "Charges", type: "depense" });
const mois = months.create({ period: currentPeriod(), snapshots: [{ accountId: compte.id, balance: 1000 }] });

const cagnotte = budgetLines.create(mois.id, {
  label: "Cagnotte", isPot: true, potPartnerName: "Marion", potPartnerPaid: 0, potMyShare: 50, categoryId: cat.id,
});
const partagee = budgetLines.create(mois.id, {
  label: "Loyer", plannedAmount: 0, isShared: true, categoryId: cat.id, fromAccountId: compte.id,
});

/** Pose une situation et rend les deux résultats, backend puis front. */
function comparer(centimesMoi, centimesPartenaire, part) {
  run("UPDATE budget_lines SET planned_amount_cents = ? WHERE id = ?", centimesMoi, partagee.id);
  run("UPDATE budget_lines SET pot_partner_paid_cents = ?, pot_my_share = ? WHERE id = ?",
    centimesPartenaire, part, cagnotte.id);

  const ligne = get("SELECT * FROM budget_lines WHERE id = ?", cagnotte.id);
  const backend = pots.compute(mois.id, ligne, cagnotte.id);

  // Les mêmes données, dans la forme que reçoit l'écran (euros, camelCase)
  const front = potCalc(
    { id: cagnotte.id, potPartnerPaid: centimesPartenaire / 100, potMyShare: part, potPartnerName: "Marion" },
    [{ id: partagee.id, isShared: true, isPot: false, potLineId: null, plannedAmount: centimesMoi / 100 }],
    cagnotte.id
  );
  return { backend, front };
}

test("les deux implémentations donnent le même « à envoyer » — balayage", () => {
  const parts = [50, 60, 40, 33.33, 66.67, 100, 0, 75.5];
  const ecarts = [];
  for (const part of parts) {
    for (let moi = 0; moi <= 40000; moi += 1111) {          // jusqu'à 400 €
      for (const partenaire of [0, 1, 99, 4999, 63002]) {    // dont 630,02 €, le cas réel
        const { backend, front } = comparer(moi, partenaire, part);
        if (Math.abs(backend.toSend - front.toSend) > 0.0001) {
          ecarts.push({ part, moi, partenaire, backend: backend.toSend, front: front.toSend });
        }
      }
    }
  }
  assert.deepEqual(ecarts, [], `écarts entre le backend et le front : ${JSON.stringify(ecarts.slice(0, 5))}`);
});

test("le cas réel d'avril 2026, qui divergeait d'un centime", () => {
  // Total commun impair : 297,09 € payés par moi + 630,02 € par Marion = 927,11 €
  const { backend, front } = comparer(29709, 63002, 50);
  assert.equal(backend.total, 927.11);
  assert.equal(backend.toSend, 166.47, "la référence, calculée en centimes");
  assert.equal(front.toSend, backend.toSend, "l'écran doit annoncer le même chiffre");
});

test("un total impair ne crée plus d'écart, quelle que soit la parité", () => {
  for (const [moi, partenaire] of [[274, 1], [411, 0], [137, 123456], [1, 0], [0, 1]]) {
    const { backend, front } = comparer(moi, partenaire, 50);
    const totalCentimes = moi + partenaire;
    assert.equal(front.toSend, backend.toSend,
      `total ${totalCentimes} centimes (${totalCentimes % 2 ? "impair" : "pair"}) : ${front.toSend} ≠ ${backend.toSend}`);
  }
});

test("les montants intermédiaires concordent aussi, pas seulement le résultat", () => {
  const { backend, front } = comparer(29709, 63002, 50);
  assert.equal(front.sharedByMe, backend.sharedByMe);
  assert.equal(front.partnerPaid, backend.partnerPaid);
  assert.equal(front.total, backend.total);
  assert.equal(front.myPart, backend.myPart, "ma part est arrondie au même moment des deux côtés");
});

test("j'ai trop payé : le « à envoyer » est négatif des deux côtés", () => {
  const { backend, front } = comparer(20000, 0, 50); // 200 € payés, ma part 100 €
  assert.equal(backend.toSend, -100);
  assert.equal(front.toSend, -100, "le partenaire me doit 100 €");
});

test("une part de 0 % ou 100 % ne casse ni l'un ni l'autre", () => {
  for (const part of [0, 100]) {
    const { backend, front } = comparer(15000, 5000, part);
    assert.equal(front.toSend, backend.toSend, `part ${part} %`);
  }
});

test("une ligne ½ sans cagnotte désignée rejoint la cagnotte par défaut", () => {
  // C'est la règle qui évite qu'un « partagé » coché sans y penser disparaisse du partage
  const { backend, front } = comparer(10000, 0, 50);
  assert.equal(backend.sharedByMe, 100, "le serveur la compte");
  assert.equal(front.sharedByMe, 100, "l'écran aussi");
});
