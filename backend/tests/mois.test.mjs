// Tests unitaires — page Mois : création (duplication du template, cycles, recalage),
// entrées et ☐ payé (à sens unique), dépense depuis enveloppe, cagnottes, invariant,
// mensualisation (cycle complet), bilan, clôture, suppressions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, refuse, eq, currentPeriod, nextPeriodOf } from "./_setup.mjs";

const { accounts, envelopes, months, categories, themes, budgetLines: lines, entries, pots, summary, assets } = await boot();

const period = currentPeriod();
const period2 = nextPeriodOf(period);
let main, livret, livretEnv, virt, catDep, catRev, catEp, th;
let salaire, loyer, courses, epargneLine, annuel, annEnv, potTpl;
let m, mLines, mPot, mLoyer, mCourses;

test("création refusée sans compte actif : un mois suit des soldes (retour de test à vide)", () => {
  refuse(() => months.create({ period }), 409);
});

test("décor : comptes, enveloppes, catégories, template", () => {
  main = accounts.create({ name: "Courant" });
  livret = accounts.create({ name: "Livret", type: "epargne", initialBalance: 1000 });
  livretEnv = livret.envelopes[0];
  virt = envelopes.create({ name: "Virtuelle", targetAmount: 500, initialAmount: 100 });
  catDep = categories.create({ name: "Factures", type: "depense" });
  catRev = categories.create({ name: "Revenus", type: "revenu" });
  catEp = categories.create({ name: "Épargne", type: "epargne" });
  const catTr = categories.create({ name: "Virements", type: "transfert" });
  th = themes.create({ name: "IA" });
  salaire = lines.create(null, { label: "Salaire", categoryId: catRev.id, plannedAmount: 2000, toAccountId: main.id, recurringDay: 1 });
  loyer = lines.create(null, { label: "Loyer", categoryId: catDep.id, plannedAmount: 700, fromAccountId: main.id, recurringDay: 5, isShared: true });
  courses = lines.create(null, { label: "Courses", categoryId: catDep.id, plannedAmount: 300, fromAccountId: main.id, themeId: th.id });
  epargneLine = lines.create(null, { label: "Virement livret", categoryId: catEp.id, plannedAmount: 100, fromAccountId: main.id, toAccountId: livret.id });
  annuel = lines.create(null, { label: "Assurance", categoryId: catDep.id, plannedAmount: 120, fromAccountId: main.id, intervalMonths: 12, anchorMonth: 3, recurringDay: 10 });
  annuel = lines.setMonthlyized(annuel.id, { enabled: true });
  annEnv = envelopes.getById(annuel.envelopeId);
  potTpl = lines.create(null, { label: "Loyer partagé", categoryId: catTr.id, isPot: true, potPartnerName: "Alex", potPartnerPaid: 600, potMyShare: 50, fromAccountId: main.id });
  lines.update(loyer.id, { potLineId: potTpl.id });
});

test("création du mois : duplication filtrée par cycle, remap cagnotte, recalage d'enveloppe", () => {
  m = months.create({
    period,
    snapshots: [{ accountId: main.id, balance: 500 }, { accountId: livret.id, balance: 1000 }],
    envelopes: [{ envelopeId: virt.id, total: 150 }],
  });
  assert.ok(eq(envelopes.getById(virt.id).total, 150), "écart posé en ajustement (+50)");
  refuse(() => months.create({ period }), 409); // mois en double
  mLines = months.getLines(m.id);
  const inCycle = lines.cycleMatches({ interval_months: 12, anchor_month: 3 }, period);
  assert.ok(mLines.some((l) => l.label === "Loyer"));
  assert.equal(mLines.some((l) => l.label === "Assurance"), inCycle, "l'annuelle ne tombe que les mois du cycle");
  mPot = mLines.find((l) => l.isPot);
  mLoyer = mLines.find((l) => l.label === "Loyer");
  mCourses = mLines.find((l) => l.label === "Courses");
  assert.equal(mLoyer.potLineId, mPot.id, "½ remappé sur la copie du mois");
  assert.ok(eq(mPot.pot.toSend, -50), "cagnotte : (700 prévu + 600)/2 − 700 = −50");
});

test("☐ payé revenu : entrée au prévu, compte crédité, datée du jour récurrent", () => {
  const paid = entries.pay(m.id, mLines.find((l) => l.label === "Salaire").id);
  assert.ok(eq(paid.amount, 2000));
  assert.equal(paid.accountId, main.id);
  assert.equal(paid.date, `${period}-01`);
  refuse(() => entries.pay(m.id, mLines.find((l) => l.label === "Salaire").id), 409); // déjà payé
});

test("☐ payé sans jour récurrent : la date reste dans le mois de la fiche", () => {
  const ponctuel = lines.create(m.id, { label: "Ponctuel", categoryId: catDep.id, plannedAmount: 10, fromAccountId: main.id });
  const paid = entries.pay(m.id, ponctuel.id);
  assert.ok(paid.date.startsWith(period), `${paid.date} devrait être dans ${period}`);
  entries.remove(paid.id);
  lines.remove(ponctuel.id);
});

test("le réel remplace le prévu : somme des entrées, défauts, modification", () => {
  const e1 = entries.create(m.id, { lineId: mCourses.id, amount: 40, themeId: th.id });
  const e2 = entries.create(m.id, { lineId: mCourses.id, amount: 25.5 });
  assert.ok(eq(months.getLines(m.id).find((l) => l.id === mCourses.id).actualAmount, 65.5));
  assert.equal(e2.accountId, main.id, "entrée sans compte → principal");
  entries.update(e1.id, { amount: 50 });
  assert.ok(eq(months.getLines(m.id).find((l) => l.id === mCourses.id).actualAmount, 75.5));
  refuse(() => entries.pay(m.id, mCourses.id), 409); // ☐ n'existe plus dès qu'il y a des entrées
});

test("virement vers soi-même refusé : entrée comme ligne", () => {
  refuse(() => entries.create(m.id, { lineId: mCourses.id, amount: 10, accountId: main.id, toAccountId: main.id }), 400);
  refuse(() => lines.create(null, { label: "Boucle", categoryId: catDep.id, fromAccountId: main.id, toAccountId: main.id }), 400);
});

test("☐ payé épargne : Depuis et Vers copiés, bilan à jour", () => {
  const mEp = mLines.find((l) => l.label === "Virement livret");
  const ep = entries.pay(m.id, mEp.id);
  assert.equal(ep.accountId, main.id);
  assert.equal(ep.toAccountId, livret.id);
  const s = summary.getSummary(m.id);
  const acc = (id) => s.accounts.find((a) => a.accountId === id);
  assert.ok(eq(acc(main.id).current, 2324.5), "Courant = 500 + 2000 − 75,50 − 100");
  assert.ok(eq(acc(livret.id).current, 1100), "Livret = 1000 + 100");
  assert.ok(eq(s.tiles.misDeCote, 100), "mis de côté = ligne épargne");
  assert.notEqual(s.tiles.projete, null);
});

test("dépense depuis une enveloppe : plafonnée au contenu, sauf découvert autorisé sur l'hôte", () => {
  // virt contient 150, hôte = principal (virtuelle) : dépenser 400 est refusé…
  refuse(() => entries.create(m.id, { lineId: mCourses.id, amount: 400, envelopeId: virt.id }), 409);
  // …sauf si le compte hôte autorise le découvert (l'enveloppe peut plonger)
  accounts.update(main.id, { allowOverdraft: true });
  const big = entries.create(m.id, { lineId: mCourses.id, amount: 400, envelopeId: virt.id, envelopeInTarget: false });
  assert.ok(eq(envelopes.getById(virt.id).total, -250), "l'enveloppe plonge, en connaissance de cause");
  entries.remove(big.id);
  accounts.update(main.id, { allowOverdraft: false });
  assert.ok(eq(envelopes.getById(virt.id).total, 150));
});

test("dépense depuis une enveloppe : total et cible suivent, contribution liée protégée", () => {
  const eEnv = entries.create(m.id, { lineId: mCourses.id, amount: 30, envelopeId: virt.id, envelopeInTarget: true });
  let v = envelopes.getById(virt.id);
  assert.ok(eq(v.total, 120) && eq(v.effectiveTarget, 470));
  entries.update(eEnv.id, { envelopeInTarget: false });
  assert.ok(eq(envelopes.getById(virt.id).effectiveTarget, 500), "hors objectif → cible intacte");
  const contrib = envelopes.listContributions(virt.id).find((c) => c.entryId === eEnv.id);
  refuse(() => envelopes.removeContribution(virt.id, contrib.id), 409);
  entries.remove(eEnv.id);
  assert.ok(eq(envelopes.getById(virt.id).total, 150), "l'entrée part, la contribution liée aussi");
});

test("cagnotte : recalcul sur le réel ½, ☐ payé au « à envoyer » (négatif = rentrée)", () => {
  entries.create(m.id, { lineId: mLoyer.id, amount: 700, isShared: true });
  assert.ok(eq(pots.computeAll(m.id)[0].toSend, -50));
  entries.create(m.id, { lineId: mCourses.id, amount: 200, isShared: true, potLineId: mPot.id });
  assert.ok(eq(pots.computeAll(m.id)[0].toSend, -150), "(900+600)/2 − 900");
  const potPay = entries.pay(m.id, mPot.id);
  assert.ok(eq(potPay.amount, -150));
  entries.unpay(m.id, mPot.id);
});

test("invariant : hors enveloppes plafonné, réaffectation, contribution réelle inter-comptes", () => {
  assert.ok(eq(envelopes.availability(livret.id).available, 100), "1100 − 1000 réservés");
  refuse(() => envelopes.create({ name: "Trop", accountId: livret.id, initialAmount: 200 }), 409);
  const pris = envelopes.create({ name: "PC", accountId: livret.id, initialAmount: 300, fromEnvelopeId: livretEnv.id });
  assert.ok(eq(pris.total, 300) && eq(envelopes.getById(livretEnv.id).total, 700), "pris dans l'autre enveloppe");
  envelopes.reallocate(pris.id, { toEnvelopeId: livretEnv.id, amount: 300 });
  refuse(() => envelopes.addContribution(livretEnv.id, { amount: 500 }), 409); // virtuelle > disponible
  envelopes.addContribution(livretEnv.id, { amount: 50, fromAccountId: main.id }); // transfert réel : OK
  assert.ok(eq(summary.getSummary(m.id).accounts.find((a) => a.accountId === livret.id).current, 1150));
});

test("mensualisation, cycle complet : ENVELOPE_SHORT, virements système, échéance", () => {
  lines.update(annuel.id, { anchorMonth: Number(period2.split("-")[1]) }); // le cycle tombe le mois prochain
  const m2 = months.create({ period: period2 });
  const m2Ann = months.getLines(m2.id).find((l) => l.templateLineId === annuel.id);
  assert.ok(m2Ann && m2Ann.envelopeId === annEnv.id);
  refuse(() => entries.pay(m2.id, m2Ann.id), 409, "ENVELOPE_SHORT");
  envelopes.addContribution(annEnv.id, { amount: 20, fromAccountId: main.id });
  const paid = entries.pay(m2.id, m2Ann.id, { shortfallAccountId: main.id });
  const sys = entries.listByMonth(m2.id).filter((e) => e.relatedLineId === m2Ann.id);
  assert.ok(sys.length === 1 && eq(sys[0].amount, 20) && sys[0].lineId === null, "virement système enveloppe → compte");
  assert.ok(eq(envelopes.getById(annEnv.id).total, 0), "enveloppe vidée");
  assert.ok(envelopes.getById(annEnv.id).deadline > `${period2}-31`, "échéance avancée d'un cycle");
  assert.ok(eq(months.getLines(m2.id).find((l) => l.id === m2Ann.id).actualAmount, 120), "le virement ne compte pas en dépense");
  // ☐ à sens unique : supprimer la dernière entrée emporte les virements et recale l'échéance
  entries.remove(paid.id);
  assert.equal(entries.listByMonth(m2.id).filter((e) => e.relatedLineId === m2Ann.id).length, 0);
  assert.ok(eq(envelopes.getById(annEnv.id).total, 20), "l'enveloppe retrouve ses 20");
  assert.ok(envelopes.getById(annEnv.id).deadline.startsWith(period2), "échéance revenue au cycle courant");
  months.remove(m2.id);
});

test("mensualité d'une enveloppe liée : provision de dépense, pas de l'épargne", () => {
  const before = summary.getSummary(m.id).tiles.misDeCote;
  envelopes.addContribution(annEnv.id, { amount: 30, fromAccountId: main.id });
  assert.ok(eq(summary.getSummary(m.id).tiles.misDeCote, before), "la mensualité vers l'enveloppe liée ne gonfle pas « mis de côté »");
  envelopes.addContribution(virt.id, { amount: 30, fromAccountId: main.id });
  assert.ok(eq(summary.getSummary(m.id).tiles.misDeCote, before + 30), "une enveloppe libre reste de l'épargne");
});

test("DCA : n'importe quel versement du mois vaut « versé » (arrondi manuel compris)", () => {
  const base = summary.getSummary(m.id).tiles.detail.prevusRestants;
  const pea = accounts.create({ name: "PEA test", type: "investissement" });
  const etf = assets.create({ name: "ETF World", accountId: pea.id, monthlyDca: 150 });
  assert.ok(eq(summary.getSummary(m.id).tiles.detail.prevusRestants, base + 150), "le DCA non versé est à venir");
  // Versement manuel arrondi (155 au lieu de 150) : le DCA est fait, plus rien « à venir »
  assets.addMovement(etf.id, { kind: "versement", amount: 155, date: `${period}-10`, counterpartAccountId: main.id });
  assert.ok(eq(summary.getSummary(m.id).tiles.detail.prevusRestants, base), "le versement manuel compte comme DCA versé");
  // Un versement de plus dans le mois ne recrée pas d'attendu
  assets.addMovement(etf.id, { kind: "versement", amount: 20, date: `${period}-20`, counterpartAccountId: main.id });
  assert.ok(eq(summary.getSummary(m.id).tiles.detail.prevusRestants, base), "rajouter des sous plus tard ne change rien");
});

test("liquider et renouveler : virement tracé, enveloppe à zéro, échéance avancée d'un cycle", () => {
  refuse(() => envelopes.liquidate(virt.id, { toAccountId: livret.id }), 409); // pas mensualisée
  const before = envelopes.getById(annEnv.id);
  assert.ok(before.total > 0, "il y a de quoi liquider");
  const after = envelopes.liquidate(annEnv.id, { toAccountId: livret.id });
  assert.ok(eq(after.total, 0), "enveloppe vidée — la dépense reste à saisir par l'utilisateur");
  assert.ok(after.deadline > before.deadline, `échéance avancée (${before.deadline} → ${after.deadline})`);
  const vir = entries.listByMonth(m.id).find((e) => (e.label || "").includes("Liquidation"));
  assert.ok(vir && eq(vir.amount, before.total) && vir.accountId === main.id && vir.toAccountId === livret.id,
    "virement système hôte → compte choisi, tracé dans le mois");
  refuse(() => envelopes.liquidate(annEnv.id, { toAccountId: livret.id }), 409); // vide : rien à liquider
  // Annulation : supprimer le virement restaure l'enveloppe ET l'échéance (retour de test d'Evan —
  // avant ce fix, la contribution restait orpheline et les 8 € semblaient « envolés »)
  entries.remove(vir.id);
  const restored = envelopes.getById(annEnv.id);
  assert.ok(eq(restored.total, before.total), "l'enveloppe retrouve son argent");
  assert.equal(restored.deadline, before.deadline, "l'échéance redescend au cycle courant");
});

test("« annuler ce mois-ci » : DCA et mensualité sautés ne comptent plus, et tout se rétablit", () => {
  const pea2 = accounts.create({ name: "CTO skip", type: "investissement" });
  const etf2 = assets.create({ name: "ETF skip", accountId: pea2.id, monthlyDca: 50 });
  const base = summary.getSummary(m.id).tiles.detail.prevusRestants;
  months.addSkip(m.id, { kind: "asset", targetId: etf2.id });
  assert.ok(eq(summary.getSummary(m.id).tiles.detail.prevusRestants, base - 50), "DCA annulé : −50 des prévus restants");
  months.removeSkip(m.id, "asset", etf2.id);
  assert.ok(eq(summary.getSummary(m.id).tiles.detail.prevusRestants, base), "rétabli : tout revient");
  // Mensualité d'une enveloppe liée
  const lAnn = lines.create(null, { label: "Skip annuelle", categoryId: catDep.id, plannedAmount: 120, intervalMonths: 12, anchorMonth: Number(period2.split("-")[1]), fromAccountId: main.id });
  const envId = lines.setMonthlyized(lAnn.id, { enabled: true }).envelopeId;
  const sugg = envelopes.getById(envId).monthlySuggestion;
  assert.ok(sugg > 0, "une mensualité est suggérée");
  const withSugg = summary.getSummary(m.id).tiles.detail.prevusRestants;
  months.addSkip(m.id, { kind: "envelope", targetId: envId });
  assert.ok(eq(summary.getSummary(m.id).tiles.detail.prevusRestants, withSugg - sugg), "mensualité annulée ce mois");
  lines.remove(lAnn.id); // l'enveloppe jamais vécue part avec la ligne
});

test("modifier une ligne de mois : thème/compte/paiement se propagent à toutes ses entrées", () => {
  const th2 = themes.create({ name: "Sport" });
  lines.update(mCourses.id, { themeId: th2.id });
  assert.ok(entries.listByMonth(m.id).filter((e) => e.lineId === mCourses.id).every((e) => e.themeId === th2.id), "thème propagé");
  lines.update(mCourses.id, { fromAccountId: livret.id });
  assert.ok(entries.listByMonth(m.id).filter((e) => e.lineId === mCourses.id).every((e) => e.accountId === livret.id), "Depuis propagé");
  lines.update(mCourses.id, { fromAccountId: main.id }); // retour
});

test("clôture : toutes les saisies du mois verrouillées, datées comprises", () => {
  months.setClosed(m.id, true);
  refuse(() => entries.create(m.id, { lineId: mCourses.id, amount: 1 }), 409);
  refuse(() => envelopes.addContribution(livretEnv.id, { amount: 1, date: `${period}-15`, fromAccountId: main.id }), 409);
  refuse(() => entries.pay(m.id, mLoyer.id), 409);
  months.setClosed(m.id, false);
});

test("note du mois : persistée, vidable, modifiable même clôturé (du contexte, pas de l'argent)", () => {
  assert.equal(months.getById(m.id).notes, "");
  months.setNotes(m.id, "  Mois du déménagement  ");
  assert.equal(months.getById(m.id).notes, "Mois du déménagement", "trim + persistée");
  months.setClosed(m.id, true);
  months.setNotes(m.id, "Relu après clôture");
  assert.equal(months.getById(m.id).notes, "Relu après clôture", "autorisée sur un mois clôturé");
  months.setClosed(m.id, false);
  months.setNotes(m.id, "");
  assert.equal(months.getById(m.id).notes, "", "vider la note la supprime");
});

test("suppressions : ligne avec entrées (force), mois en cascade", () => {
  refuse(() => lines.remove(mCourses.id), 409);
  lines.remove(mCourses.id, { force: true });
  assert.ok(entries.listByMonth(m.id).every((e) => e.lineId !== mCourses.id));
  const before = months.list().length;
  months.remove(m.id);
  assert.equal(months.list().length, before - 1);
});

test("revue 04/09 : appartenance ligne-mois, date en mois clôturé, suppression d'un mois clôturé", () => {
  const mA = months.create({ period }); // le mois du décor a été supprimé par le test précédent
  // Une ligne du template (ou d'un autre mois) n'est pas modifiable via l'URL d'un mois ouvert
  const tpl = lines.create(null, { label: "Ligne du template", categoryId: catDep.id, fromAccountId: main.id });
  refuse(() => lines.assertInMonth(tpl.id, mA.id), 404);
  lines.remove(tpl.id);
  // Un mois clôturé est verrouillé : sa suppression aussi, et aucune entrée d'un autre mois ne peut y être datée
  months.setClosed(mA.id, true);
  refuse(() => months.remove(mA.id), 409);
  const mB = months.create({ period: period2 });
  refuse(() => entries.create(mB.id, { amount: 10, accountId: main.id, date: `${period}-15` }), 409);
  months.remove(mB.id);
  months.setClosed(mA.id, false);
  months.remove(mA.id);
});

// ─── Changement de compte principal : les soldes du mois n'en dépendent pas ───
// Signalé le 07/09 : « j'ai basculé le principal sur un autre compte, je suis revenu,
// et j'ai perdu le reste à vivre ». Rien n'est perdu : le va-et-vient est réversible.
// Ce qui manquait dans ce cas-là, c'était le solde de départ du mois, jamais saisi.
test("va-et-vient du compte principal : les soldes et les calculs reviennent intacts", () => {
  // Mois autonome (ceux du décor ont été consommés par les tests précédents)
  const periode = nextPeriodOf(nextPeriodOf(nextPeriodOf(m.period)));
  const mois = months.create({ period: periode, snapshots: [{ accountId: main.id, balance: 2000 }] });
  const second = accounts.create({ name: "Compte ajouté après le mois", type: "investissement" });

  const avant = summary.getSummary(mois.id);
  const snapsAvant = months.getSnapshots(mois.id).length;
  assert.ok(avant.tiles.disponible !== null, "décor : le mois a bien un disponible au départ");

  // Le nouveau compte devient principal : il n'a aucun solde de départ pour ce mois
  accounts.update(second.id, { isMain: true });
  const pendant = summary.getSummary(mois.id);
  assert.equal(pendant.mainAccount.id, second.id);
  assert.equal(pendant.tiles.disponible, null, "sans solde de départ, le disponible est inconnu");
  assert.equal(months.getSnapshots(mois.id).length, snapsAvant, "aucun solde n'est effacé pour autant");

  // Retour au compte d'origine : tout revient, au centime près
  accounts.update(main.id, { isMain: true });
  const apres = summary.getSummary(mois.id);
  assert.equal(apres.mainAccount.id, main.id);
  assert.ok(eq(apres.tiles.disponible, avant.tiles.disponible), "le disponible revient à l'identique");
  assert.ok(eq(apres.tiles.projete, avant.tiles.projete), "le projeté aussi");
  assert.equal(months.getSnapshots(mois.id).length, snapsAvant, "les soldes du mois sont intacts");
});

// L'autre moitié du diagnostic : un mois créé sans solde de départ ne peut rien calculer.
// C'est ce que produisait le flux de première utilisation, soldes laissés vides.
test("un mois sans solde de départ ne peut afficher ni disponible ni projeté", () => {
  const vierge = months.create({ period: nextPeriodOf(nextPeriodOf(m.period)) });
  const s = summary.getSummary(vierge.id);
  assert.equal(months.getSnapshots(vierge.id).length, 0);
  assert.equal(s.tiles.disponible, null, "aucun point de départ : rien à calculer");
  assert.equal(s.tiles.projete, null);
});
