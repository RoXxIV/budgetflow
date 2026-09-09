// Tests unitaires — page Template : lignes récurrentes, périodicité, mensualisation,
// cagnottes, réordonnancement, propagation vers le mois et retour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, eq, currentPeriod, nextPeriodOf } from "./_setup.mjs";

const { accounts, categories, themes, budgetLines: lines, envelopes, months, entries } = await boot();

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

test("part mensuelle : une ligne non mensuelle ne pèse que sa fraction dans un mois-type", () => {
  // Sinon les totaux du template additionnent des euros par an et des euros par mois
  // (Strava 79,99/an + N26 118,80/an comptés en entier : +182,22 € de dépenses fantômes).
  assert.ok(eq(loyer.monthlyAmount, loyer.plannedAmount), "une mensuelle vaut son montant");
  assert.ok(eq(annuel.monthlyAmount, 10), "120 €/an → 10 €/mois");

  const trim = lines.create(null, { label: "Trimestriel", categoryId: catDep.id, plannedAmount: 60, fromAccountId: main.id, intervalMonths: 3, anchorMonth: 1 });
  assert.ok(eq(trim.monthlyAmount, 20), "60 € tous les 3 mois → 20 €/mois");

  // Arrondi au centime, pas de fraction qui traîne (cas réel : Strava)
  const strava = lines.create(null, { label: "Strava", categoryId: catDep.id, plannedAmount: 79.99, fromAccountId: main.id, intervalMonths: 12, anchorMonth: 7 });
  assert.equal(strava.monthlyAmount, 6.67, "79,99 €/an → 6,67 €/mois");

  // La part mensuelle suit le montant et la périodicité
  const maj = lines.update(strava.id, { plannedAmount: 120, intervalMonths: 12 });
  assert.ok(eq(maj.monthlyAmount, 10), "le montant change → la part mensuelle suit");
  const redevenue = lines.update(strava.id, { intervalMonths: 1 });
  assert.ok(eq(redevenue.monthlyAmount, 120), "repassée en mensuel → part mensuelle = montant");

  lines.remove(strava.id);
  lines.remove(trim.id);
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

test("revue 04/09 : mensualiser propage l'enveloppe aux copies des mois ouverts", () => {
  const anchor = Number(currentPeriod().split("-")[1]);
  const l = lines.create(null, { label: "Taxe habitation", categoryId: catDep.id, plannedAmount: 120, intervalMonths: 12, anchorMonth: anchor, fromAccountId: main.id });
  const copy = lines.applyToMonth(l.id, month.id);
  const envId = lines.setMonthlyized(l.id, { enabled: true }).envelopeId;
  assert.equal(lines.getById(copy.id).envelopeId, envId, "la copie du mois ouvert est liée à l'enveloppe");
});

test("revue 04/09 : « le 31 » est borné au dernier jour du mois cible (jamais de date invalide)", () => {
  const l = lines.create(null, { label: "Prime fevrier", categoryId: catDep.id, plannedAmount: 60, intervalMonths: 12, anchorMonth: 2, recurringDay: 31, fromAccountId: main.id });
  assert.match(l.nextDue, /-02-2[89]$/, `échéance bornée à fin février (${l.nextDue})`);
});

// ─── Appliquer tout le Template à un mois, en une fois ───
// Un mois ne se remplit du Template qu'à sa naissance : ce geste comble le décalage
// pour les lignes ajoutées ou corrigées ensuite, sans jamais toucher au réel saisi.
// Décor autonome : les lignes du haut de fichier ont été supprimées en chemin.

let mBulk, dejaLa, nouvelle;

test("propagation groupée : le plan distingue à créer, à mettre à jour, et ignoré", () => {
  // Une ligne présente à la naissance du mois, qu'on pointe ensuite
  dejaLa = lines.create(null, { label: "Loyer groupé", categoryId: catDep.id, plannedAmount: 800, fromAccountId: main.id, recurringDay: 5 });
  mBulk = months.create({ period: nextPeriodOf(nextPeriodOf(currentPeriod())), snapshots: [{ accountId: main.id, balance: 500 }] });

  const copie = months.getLines(mBulk.id).find((l) => l.templateLineId === dejaLa.id);
  assert.ok(copie, "décor : la ligne du Template est bien dans le mois");
  entries.create(mBulk.id, { lineId: copie.id, amount: 800, date: `${mBulk.period}-05`, accountId: main.id });

  // Une ligne ajoutée au Template APRÈS la naissance du mois : absente de ce mois
  nouvelle = lines.create(null, { label: "Assurance moto", categoryId: catDep.id, plannedAmount: 42, fromAccountId: main.id });

  const plan = lines.planApplyAll(mBulk.id);
  assert.ok(plan.toCreate.some((l) => l.id === nouvelle.id), "la nouvelle ligne est à créer");
  assert.ok(plan.skipped.some((l) => l.id === dejaLa.id), "la ligne pointée est ignorée");
  assert.ok(!plan.toUpdate.some((l) => l.id === dejaLa.id), "et surtout pas mise à jour");

  assert.equal(months.getLines(mBulk.id).some((l) => l.templateLineId === nouvelle.id), false,
    "prévisualiser n'écrit rien");
});

test("propagation groupée : onlyUnpaid = false reprend aussi les lignes pointées", () => {
  const plan = lines.planApplyAll(mBulk.id, { onlyUnpaid: false });
  assert.ok(plan.toUpdate.some((l) => l.id === dejaLa.id), "la ligne pointée passe en mise à jour");
  assert.equal(plan.skipped.length, 0, "plus rien n'est ignoré");
});

test("propagation groupée : applique tout, sans toucher au réel", () => {
  const avant = months.getLines(mBulk.id).find((l) => l.templateLineId === dejaLa.id);

  const res = lines.applyAllToMonth(mBulk.id);
  assert.equal(res.applied, res.toCreate.length + res.toUpdate.length);

  const apres = months.getLines(mBulk.id);
  assert.ok(apres.some((l) => l.templateLineId === nouvelle.id), "la ligne manquante est arrivée");
  const pointeeApres = apres.find((l) => l.templateLineId === dejaLa.id);
  assert.ok(eq(pointeeApres.actualAmount, avant.actualAmount), "le réel de la ligne pointée est intact");
  assert.equal(pointeeApres.entryCount, 1, "son entrée est toujours là");
});

test("propagation groupée : une ligne non mensuelle hors cycle n'est pas copiée", () => {
  const period = nextPeriodOf(nextPeriodOf(nextPeriodOf(currentPeriod())));
  const [, mois] = period.split("-").map(Number);
  // Ancrage sur le mois suivant : le cycle annuel ne tombe pas sur celui-ci
  const ancrage = (mois % 12) + 1;
  const annuelle = lines.create(null, { label: "Taxe hors cycle", categoryId: catDep.id, plannedAmount: 300, intervalMonths: 12, anchorMonth: ancrage, fromAccountId: main.id });

  const m = months.create({ period });
  const plan = lines.planApplyAll(m.id);
  assert.ok(!plan.toCreate.some((l) => l.id === annuelle.id), "hors cycle : écartée du plan");
  lines.applyAllToMonth(m.id);
  assert.ok(!months.getLines(m.id).some((l) => l.templateLineId === annuelle.id), "et jamais copiée");
});

// Une ligne « ½ » pointe sur la COPIE de sa cagnotte dans le mois. Si la cagnotte est
// traitée après elle, ce rattachement retombe à null — d'où l'ordre imposé par
// applyAllToMonth, que ce test verrouille.
test("propagation groupée : les cagnottes passent avant les lignes qui les référencent", () => {
  const cagnotte = lines.create(null, { label: "Cagnotte commune", categoryId: catDep.id, isPot: true, potPartnerName: "Léa", potMyShare: 50 });
  const demi = lines.create(null, { label: "Courses partagées", categoryId: catDep.id, plannedAmount: 200, isShared: true, potLineId: cagnotte.id, fromAccountId: main.id });

  const m = months.create({ period: nextPeriodOf(nextPeriodOf(nextPeriodOf(nextPeriodOf(currentPeriod())))) });
  // Le mois naît avec les deux : on les retire pour forcer une création groupée
  for (const l of months.getLines(m.id).filter((x) => [cagnotte.id, demi.id].includes(x.templateLineId))) {
    lines.remove(l.id, { force: true });
  }
  assert.equal(months.getLines(m.id).some((l) => l.templateLineId === demi.id), false, "décor : la ½ n'est plus dans le mois");

  lines.applyAllToMonth(m.id);

  const copies = months.getLines(m.id);
  const potCopy = copies.find((l) => l.templateLineId === cagnotte.id);
  const demiCopy = copies.find((l) => l.templateLineId === demi.id);
  assert.ok(potCopy, "la cagnotte est copiée");
  assert.ok(demiCopy, "la ligne ½ aussi");
  assert.equal(demiCopy.potLineId, potCopy.id, "la ½ pointe sur la cagnotte DU MOIS, pas sur celle du Template");
});

test("propagation groupée : refusée sur un mois clôturé", () => {
  const m = months.create({ period: nextPeriodOf(nextPeriodOf(nextPeriodOf(nextPeriodOf(nextPeriodOf(currentPeriod()))))) });
  months.setClosed(m.id, true);
  refuse(() => lines.planApplyAll(m.id), 409);
  refuse(() => lines.applyAllToMonth(m.id), 409);
});

// ─── Le cycle fait foi AUSSI ligne par ligne (09/09) ─────
// Trouvé à l'usage par Evan. « Appliquer à ce mois » — la route par ligne, et le bouton
// de la modale d'édition — posait une charge ANNUELLE dans un mois qui ne la doit pas.
// Sur ses données réelles : Strava, ancrée en JUILLET, atterrie dans septembre avec ses
// 79,99 €, retirés du Reste à vivre pour une charge qui n'aurait pas lieu (600,15 €
// affichés au lieu de 680,14 €). `planApplyAll` filtrait déjà ; ce chemin-ci, non.
//
// Les mois créés ici partent à +6 et au-delà : les tests précédents occupent jusqu'à +5,
// et la base est partagée par tout le fichier.

test("appliquer au mois : une annuelle est refusée hors de son mois d'ancrage", () => {
  const [, m] = currentPeriod().split("-").map(Number);
  const ailleurs = (m % 12) + 1; // le mois suivant : jamais celui du mois courant
  const annuelle = lines.create(null, {
    label: "Strava", categoryId: catDep.id, plannedAmount: 79.99,
    fromAccountId: main.id, intervalMonths: 12, anchorMonth: ailleurs,
  });
  refuse(() => lines.applyToMonth(annuelle.id, month.id), 409);
  assert.ok(!months.getLines(month.id).some((l) => l.templateLineId === annuelle.id),
    "et rien n'a été créé au passage");
});

test("appliquer au mois : le refus dit QUAND la ligne revient, en toutes lettres", () => {
  const juillet = lines.create(null, {
    label: "Assurance moto", categoryId: catDep.id, plannedAmount: 200,
    fromAccountId: main.id, intervalMonths: 12, anchorMonth: 7,
  });
  const cible = months.create({ period: [...Array(6)].reduce(nextPeriodOf, currentPeriod()) });
  const e = refuse(() => lines.applyToMonth(juillet.id, cible.id), 409);
  assert.match(e.message, /Assurance moto/, "la ligne est nommée");
  assert.match(e.message, /chaque juillet/, "et son cycle est écrit en français");
  assert.ok(!e.message.includes(cible.period),
    `le mois est nommé, pas affiché en 'YYYY-MM' (${e.message})`);
});

test("appliquer au mois : une trimestrielle passe sur son mois, pas sur le suivant", () => {
  const period = [...Array(7)].reduce(nextPeriodOf, currentPeriod());
  const [, m] = period.split("-").map(Number);
  const trim = lines.create(null, {
    label: "Eau", categoryId: catDep.id, plannedAmount: 90,
    fromAccountId: main.id, intervalMonths: 3, anchorMonth: m,
  });
  const sien = months.create({ period });
  assert.ok(lines.applyToMonth(trim.id, sien.id).id, "sur son mois, elle passe");
  const suivant = months.create({ period: nextPeriodOf(period) });
  refuse(() => lines.applyToMonth(trim.id, suivant.id), 409);
});

test("appliquer au mois : une ligne MENSUELLE n'est jamais concernée par ce refus", () => {
  // Le garde-fou ne doit pas gêner le geste quotidien : sans cycle, tous les mois sont
  // les siens. C'est le cas de l'immense majorité des lignes.
  // La ligne est créée ici et pas reprise du décor : `loyer` a pu être supprimée par les
  // tests de suppression qui précèdent, et ce test ne parle pas de ça.
  const mensuelle = lines.create(null, { label: "Cantine", categoryId: catDep.id, plannedAmount: 45, fromAccountId: main.id });
  assert.ok(lines.applyToMonth(mensuelle.id, month.id), "une mensuelle passe partout");
});

test("appliquer au mois : une copie devenue hors cycle ne se rafraîchit plus non plus", () => {
  // Le cas tordu : la ligne était mensuelle, sa copie existe déjà dans le mois, puis on
  // la passe en annuelle ancrée ailleurs. Le refus doit valoir pour la MISE À JOUR comme
  // pour la création — sinon la copie continuerait de se recharger dans un mois qui ne
  // la doit pas.
  const [, m] = currentPeriod().split("-").map(Number);
  const l = lines.create(null, { label: "Antivirus", categoryId: catDep.id, plannedAmount: 60, fromAccountId: main.id });
  lines.applyToMonth(l.id, month.id);
  assert.ok(months.getLines(month.id).some((c) => c.templateLineId === l.id), "la copie existe");
  lines.update(l.id, { intervalMonths: 12, anchorMonth: (m % 12) + 1 });
  refuse(() => lines.applyToMonth(l.id, month.id), 409);
});

// ─── Enveloppe mensualisée : la cible et le prévu sont UN SEUL montant (09/09) ───
// La ligne propageait déjà vers son enveloppe ; la réciproque manquait. Vécu par Evan
// sur « N26 Go » : enveloppe ramenée à 95 €, ligne restée à 118,80 €, et « Appliquer le
// Template » proposait donc d'injecter 118,80 € dans septembre.
//
// En fin de fichier : ces tests changent le prévu d'`annuel`, et rien ne doit s'appuyer
// dessus après eux.

test("mensualisée : corriger la cible de l'enveloppe corrige le prévu de la ligne", () => {
  const envId = lines.getById(annuel.id).envelopeId;
  envelopes.update(envId, { targetAmount: 95 });
  assert.ok(eq(lines.getById(annuel.id).plannedAmount, 95), "le prélèvement suit la tirelire");
  assert.ok(eq(envelopes.getById(envId).targetAmount, 95), "et l'enveloppe garde sa valeur");
});

test("mensualisée : le sens historique marche toujours, et les deux ne bouclent pas", () => {
  const envId = lines.getById(annuel.id).envelopeId;
  lines.update(annuel.id, { plannedAmount: 150 });
  assert.ok(eq(envelopes.getById(envId).targetAmount, 150), "la tirelire suit le prélèvement");
  assert.ok(eq(lines.getById(annuel.id).plannedAmount, 150), "et rien ne l'a réécrite au retour");
});

test("mensualisée : l'échéance envoyée à l'enveloppe est ignorée — elle vient du cycle", () => {
  const envId = lines.getById(annuel.id).envelopeId;
  const avant = envelopes.getById(envId).deadline;
  envelopes.update(envId, { deadline: "2099-01-01" });
  assert.equal(envelopes.getById(envId).deadline, avant,
    "d'une date on ne déduit pas une périodicité : l'échéance reste celle de la ligne");
});

test("mensualisée : changer la cible ne touche QUE sa ligne", () => {
  const autre = lines.create(null, { label: "Assurance vélo", categoryId: catDep.id, plannedAmount: 60, fromAccountId: main.id, intervalMonths: 12, anchorMonth: 5 });
  const envId = lines.getById(annuel.id).envelopeId;
  envelopes.update(envId, { targetAmount: 300 });
  assert.ok(eq(lines.getById(autre.id).plannedAmount, 60), "la ligne voisine n'a pas bougé");
});

test("enveloppe LIBRE : ni cible ni échéance ne sont contraintes", () => {
  const libre = envelopes.create({ name: "Vacances", accountId: main.id, targetAmount: 800, deadline: "2099-01-01" });
  envelopes.update(libre.id, { targetAmount: 900, deadline: "2098-06-01" });
  const apres = envelopes.getById(libre.id);
  assert.ok(eq(apres.targetAmount, 900));
  assert.equal(apres.deadline, "2098-06-01", "sans ligne derrière, l'échéance reste éditable");
});
