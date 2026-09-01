/**
 * Revue fonctionnelle : exerce toutes les règles métier sur une base NEUVE (jamais la base de dev)
 * et rapporte ✓ / ✗. Usage : node scripts/review.mjs <chemin-sqlite-neuf>
 */
const dbPath = process.argv[2];
if (!dbPath) { console.error("Usage : node scripts/review.mjs <chemin-sqlite-neuf>"); process.exit(1); }
process.env.DB_PATH = dbPath;

const { initDb, all, get, run } = await import("../db/index.js");
initDb();
const accounts = await import("../services/account.service.js");
const envelopes = await import("../services/envelope.service.js");
const categories = await import("../services/category.service.js");
const themes = await import("../services/theme.service.js");
const lines = await import("../services/budgetLine.service.js");
const months = await import("../services/month.service.js");
const entries = await import("../services/entry.service.js");
const pots = await import("../services/pot.service.js");
const calculators = await import("../services/calculator.service.js");
const assets = await import("../services/asset.service.js");
const summary = await import("../services/summary.service.js");
const settings = await import("../services/settings.service.js");
envelopes.bindSummary(summary);

let pass = 0, fail = 0;
const issues = [];
function check(label, cond, detail = "") {
  if (cond) { pass++; console.log(` ✓ ${label}`); }
  else { fail++; issues.push(label + (detail ? ` — ${detail}` : "")); console.log(` ✗ ${label}${detail ? " — " + detail : ""}`); }
}
function throws(label, fn, expectStatus) {
  try { fn(); check(label, false, "aucune erreur levée"); }
  catch (e) { check(label, !expectStatus || e.status === expectStatus, `status ${e.status} : ${e.message}`); }
}
const eq = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005;
const section = (t) => console.log(`\n── ${t}`);

// ═══ Comptes & enveloppes ═══
section("Comptes & enveloppes");
const main = accounts.create({ name: "Courant", type: "courant" });
check("premier compte → principal d'office", main.isMain);
const livret = accounts.create({ name: "Livret", type: "epargne", initialBalance: 1000 });
check("compte épargne → enveloppe auto avec solde initial", livret.envelopes.length === 1 && eq(livret.envelopes[0].total, 1000));
const livretEnv = livret.envelopes[0];
const renamed = accounts.update(livret.id, { name: "Livret A" });
check("renommage compte → enveloppe 1:1 renommée", renamed.envelopes[0].name === "Livret A");
const back = envelopes.update(livretEnv.id, { name: "Livret" });
check("renommage enveloppe → compte 1:1 renommé", accounts.getById(livret.id).name === "Livret");
const multi = accounts.create({ name: "Réserve", type: "epargne", multiProjects: true });
check("compte épargne multi-projets → pas d'enveloppe auto", multi.envelopes.length === 0);
const second = accounts.create({ name: "Second", type: "courant", isMain: true });
check("nouveau principal → l'ancien ne l'est plus", second.isMain && !accounts.getById(main.id).isMain);
accounts.update(main.id, { isMain: true });
const virt = envelopes.create({ name: "Virtuelle", targetAmount: 500, initialAmount: 100 });
check("enveloppe virtuelle (sans compte) créée avec montant initial", virt.accountId === null && eq(virt.total, 100));
throws("suppression d'une enveloppe avec contributions → 409", () => envelopes.remove(virt.id), 409);
const closed = envelopes.update(virt.id, { isClosed: true });
check("clôture d'enveloppe", closed.isClosed);
throws("contribution sur enveloppe clôturée → 409", () => envelopes.addContribution(virt.id, { amount: 10 }), 409);
envelopes.update(virt.id, { isClosed: false });
check("mensualité suggérée = (cible − total) / mois restants", (() => {
  const e = envelopes.update(virt.id, { deadline: new Date(Date.now() + 4 * 31 * 86400000).toISOString().substring(0, 10) });
  return e.monthlySuggestion > 0 && e.monthlySuggestion <= 400;
})());

// ═══ Catégories & thèmes ═══
section("Catégories & thèmes");
const catDep = categories.create({ name: "Factures", type: "depense" });
const catRev = categories.create({ name: "Revenus", type: "revenu" });
const catEp = categories.create({ name: "Épargne", type: "epargne" });
const catTr = categories.create({ name: "Virements", type: "transfert" });
throws("type de catégorie invalide → 400", () => categories.create({ name: "X", type: "foo" }), 400);
const th = themes.create({ name: "IA" });
throws("doublon de thème insensible à la casse → 409", () => themes.create({ name: "ia" }), 409);
categories.reorder([{ id: catRev.id, order: 0 }, { id: catDep.id, order: 1 }]);
check("réordonnancement des catégories", categories.list()[0].id === catRev.id);

// ═══ Template & périodicité ═══
section("Template");
const salaire = lines.create(null, { label: "Salaire", categoryId: catRev.id, plannedAmount: 2000, toAccountId: main.id, recurringDay: 1 });
const loyer = lines.create(null, { label: "Loyer", categoryId: catDep.id, plannedAmount: 700, fromAccountId: main.id, recurringDay: 5, isShared: true });
const courses = lines.create(null, { label: "Courses", categoryId: catDep.id, plannedAmount: 300, fromAccountId: main.id, themeId: th.id });
const epargneLine = lines.create(null, { label: "Virement livret", categoryId: catEp.id, plannedAmount: 100, fromAccountId: main.id, toAccountId: livret.id });
throws("ligne non mensuelle sans mois d'ancrage → 400", () => lines.create(null, { label: "Annuel", plannedAmount: 120, intervalMonths: 12 }), 400);
const annuel = lines.create(null, { label: "Assurance", categoryId: catDep.id, plannedAmount: 120, fromAccountId: main.id, intervalMonths: 12, anchorMonth: 3, recurringDay: 10 });
check("prochaine échéance calculée pour une ligne annuelle", /^\d{4}-03-10$/.test(annuel.nextDue || ""));
const mensualisee = lines.setMonthlyized(annuel.id, { enabled: true });
const annEnv = envelopes.getById(mensualisee.envelopeId);
check("mensualiser → enveloppe liée (cible = prévu, échéance = prochaine occurrence)", eq(annEnv.targetAmount, 120) && annEnv.deadline === annuel.nextDue);
throws("mensualiser une ligne mensuelle → 400", () => lines.setMonthlyized(courses.id, { enabled: true }), 400);
const pot = lines.create(null, { label: "Loyer — partenaire", categoryId: catTr.id, isPot: true, potPartnerName: "Alex", potPartnerPaid: 600, potMyShare: 50, fromAccountId: main.id });
check("cagnotte du template (prévu forcé à 0)", pot.isPot && eq(pot.plannedAmount, 0));
lines.update(loyer.id, { potLineId: pot.id });
check("½ rattaché à la cagnotte", lines.getById(loyer.id).potLineId === pot.id);

// ═══ Mois ═══
section("Mois");
const now = new Date();
const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const prefill0 = await months.prefill();
check("prefill sans mois : période courante, enveloppes listées", prefill0.period === period && prefill0.envelopes.length >= 2);
const m = months.create({ period, snapshots: [{ accountId: main.id, balance: 500 }, { accountId: livret.id, balance: 1000 }], envelopes: [{ envelopeId: virt.id, total: 150 }] });
check("recalage d'enveloppe à la création (ajustement +50)", eq(envelopes.getById(virt.id).total, 150));
throws("mois en double → 409", () => months.create({ period }), 409);
const mLines = months.getLines(m.id);
const inCycle = lines.cycleMatches({ interval_months: 12, anchor_month: 3 }, period);
check("lignes du template dupliquées (annuelle seulement si le cycle tombe)", mLines.some((l) => l.label === "Loyer") && (mLines.some((l) => l.label === "Assurance") === inCycle));
const mPot = mLines.find((l) => l.isPot);
const mLoyer = mLines.find((l) => l.label === "Loyer");
check("rattachement ½ → cagnotte remappé sur la copie du mois", mLoyer.potLineId === mPot.id);
check("cagnotte : prévu = à envoyer (prévu du ½ compté) = (700+600)/2 − 700 = −50", eq(mPot.pot.toSend, -50));

// ═══ Entrées & ☐ payé ═══
section("Entrées");
const mSal = mLines.find((l) => l.label === "Salaire");
const paid = entries.pay(m.id, mSal.id);
check("☐ payé revenu → entrée au prévu, compte crédité, datée du jour récurrent", eq(paid.amount, 2000) && paid.accountId === main.id && paid.date === `${period}-01`);
throws("second ☐ payé → 409", () => entries.pay(m.id, mSal.id), 409);
entries.unpay(m.id, mSal.id);
check("décocher → réel 0", eq(months.getLines(m.id).find((l) => l.id === mSal.id).actualAmount, 0));
entries.pay(m.id, mSal.id);
const mCourses = mLines.find((l) => l.label === "Courses");
const e1 = entries.create(m.id, { lineId: mCourses.id, amount: 40, themeId: th.id });
const e2 = entries.create(m.id, { lineId: mCourses.id, amount: 25.5 });
check("réel = somme des entrées (65,50)", eq(months.getLines(m.id).find((l) => l.id === mCourses.id).actualAmount, 65.5));
check("entrée sans compte → compte principal par défaut", e2.accountId === main.id);
entries.update(e1.id, { amount: 50 });
check("modification d'entrée → réel 75,50", eq(months.getLines(m.id).find((l) => l.id === mCourses.id).actualAmount, 75.5));
throws("☐ payé sur une ligne qui a des entrées → 409", () => entries.pay(m.id, mCourses.id), 409);
const mEp = mLines.find((l) => l.label === "Virement livret");
const ep = entries.pay(m.id, mEp.id);
check("☐ payé épargne → Depuis et Vers copiés", ep.accountId === main.id && ep.toAccountId === livret.id);
let s = summary.getSummary(m.id);
const acc = (id) => s.accounts.find((a) => a.accountId === id);
check("bilan : Courant = 500 + 2000 − 75,50 − 100", eq(acc(main.id).current, 2324.5));
check("bilan : Livret = 1000 + 100 (virement épargne)", eq(acc(livret.id).current, 1100));
check("bilan : mis de côté = 100 (ligne épargne)", eq(s.tiles.misDeCote, 100));
check("bilan : projeté = solde − loyer non payé (700) − cagnotte à envoyer (−50 → +50)… ", s.tiles.projete !== null);
// dépense depuis une enveloppe
const eEnv = entries.create(m.id, { lineId: mCourses.id, amount: 30, envelopeId: virt.id, envelopeInTarget: true });
const vAfter = envelopes.getById(virt.id);
check("dépense depuis enveloppe → total −30, cible corrigée −30", eq(vAfter.total, 120) && eq(vAfter.effectiveTarget, 470));
entries.update(eEnv.id, { envelopeInTarget: false });
check("case objectif décochée → cible intacte", eq(envelopes.getById(virt.id).effectiveTarget, 500));
throws("suppression directe d'une contribution liée → 409", () => envelopes.removeContribution(virt.id, envelopes.listContributions(virt.id).find((c) => c.entryId === eEnv.id).id), 409);
entries.remove(eEnv.id);
check("suppression de l'entrée → contribution liée retirée", eq(envelopes.getById(virt.id).total, 150));

// ═══ Cagnottes ═══
section("Cagnottes");
entries.create(m.id, { lineId: mLoyer.id, amount: 700, isShared: true });
check("cagnotte recalculée sur le réel ½ : (700+600)/2 − 700 = −50 (Alex me doit)", eq(pots.computeAll(m.id)[0].toSend, -50));
entries.create(m.id, { lineId: mCourses.id, amount: 200, isShared: true, potLineId: mPot.id });
check("½ supplémentaire → (900+600)/2 − 900 = −150", eq(pots.computeAll(m.id)[0].toSend, -150));
const potPay = entries.pay(m.id, mPot.id);
check("☐ payé cagnotte négative → entrée négative (rentrée d'argent)", eq(potPay.amount, -150));
entries.unpay(m.id, mPot.id);

// ═══ Enveloppes : invariant, réaffectation, recalage ═══
section("Invariant enveloppes");
const av = envelopes.availability(livret.id);
check("disponible hors enveloppes du Livret = 1100 − 1000", eq(av.available, 100));
throws("montant initial > disponible → 409", () => envelopes.create({ name: "Trop", accountId: livret.id, initialAmount: 200 }), 409);
const pris = envelopes.create({ name: "PC", accountId: livret.id, initialAmount: 300, fromEnvelopeId: livretEnv.id });
check("« pris dans une autre enveloppe » → réaffectation des deux côtés", eq(pris.total, 300) && eq(envelopes.getById(livretEnv.id).total, 700));
envelopes.reallocate(pris.id, { toEnvelopeId: livretEnv.id, amount: 300 });
check("réaffectation retour", eq(envelopes.getById(livretEnv.id).total, 1000) && eq(envelopes.getById(pris.id).total, 0));
throws("contribution virtuelle > disponible → 409", () => envelopes.addContribution(livretEnv.id, { amount: 500 }), 409);
envelopes.addContribution(livretEnv.id, { amount: 50, fromAccountId: main.id });
check("contribution réelle depuis un autre compte : acceptée, Livret +50", eq(summary.getSummary(m.id).accounts.find((a) => a.accountId === livret.id).current, 1150));
const rec = envelopes.recalibrationPreview(livretEnv.id);
check("aperçu de recalage : delta = solde − enveloppes = 1150 − 1050 = 100", eq(rec.delta, 100));
envelopes.recalibrate(livretEnv.id, {});
check("recalage → enveloppe alignée sur le compte", eq(envelopes.getById(livretEnv.id).total, 1150));

// ═══ Ligne mensualisée : cycle complet ═══
section("Mensualisation");
const nextPeriod = (() => { const [y, mo] = period.split("-").map(Number); const idx = y * 12 + (mo - 1) + 1; return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`; })();
const anchorNext = Number(nextPeriod.split("-")[1]);
lines.update(annuel.id, { anchorMonth: anchorNext });
const m2 = months.create({ period: nextPeriod });
const m2Ann = months.getLines(m2.id).find((l) => l.templateLineId === annuel.id);
check("ligne annuelle présente le mois de son cycle", !!m2Ann && m2Ann.envelopeId === annEnv.id);
throws("☐ payé sans fonds dans l'enveloppe → 409 ENVELOPE_SHORT", () => entries.pay(m2.id, m2Ann.id), 409);
envelopes.addContribution(annEnv.id, { amount: 20, fromAccountId: main.id });
entries.pay(m2.id, m2Ann.id, { shortfallAccountId: main.id });
const sys = entries.listByMonth(m2.id).filter((e) => e.relatedLineId === m2Ann.id);
check("☐ payé mensualisé → entrée réelle 120 + virement système 20 (enveloppe → compte prélevé)", sys.length === 1 && eq(sys[0].amount, 20) && sys[0].lineId === null);
check("enveloppe vidée, cible intacte, échéance avancée d'un an", eq(envelopes.getById(annEnv.id).total, 0) && eq(envelopes.getById(annEnv.id).effectiveTarget, 120) && envelopes.getById(annEnv.id).deadline > `${nextPeriod}-31`);
check("virement système jamais compté en dépense (réel ligne = 120)", eq(months.getLines(m2.id).find((l) => l.id === m2Ann.id).actualAmount, 120));
entries.unpay(m2.id, m2Ann.id);
check("décocher → virement retiré, enveloppe 20, échéance revenue", entries.listByMonth(m2.id).filter((e) => e.relatedLineId === m2Ann.id).length === 0 && eq(envelopes.getById(annEnv.id).total, 20));

// ═══ Calculateur ═══
section("Calculateur");
const calc = calculators.save(null, { name: "Élec", formula: "(hp × prixHP) × (1 + tva / 100) + abo", lineId: courses.id,
  params: [{ symbol: "prixHP", value: 0.2 }, { symbol: "abo", value: 10 }, { symbol: "tva", value: 20 }], readings: [{ symbol: "hp", kind: "index" }] });
throws("formule avec symbole inconnu → 400", () => calculators.save(null, { name: "X", formula: "a + b", params: [{ symbol: "a", value: 1 }], readings: [] }), 400);
let st = calculators.monthState(m.id).find((c) => c.id === calc.id);
calculators.saveReadings(m.id, calc.id, [{ defId: st.readings[0].defId, previous: 100, current: 200 }]);
st = calculators.monthState(m.id).find((c) => c.id === calc.id);
check("estimé = 100 × 0,2 × 1,2 + 10 = 34", eq(st.estimate, 34));
check("écart = estimé − prévu (300) = −266", eq(st.gap, -266));
const st2 = calculators.monthState(m2.id).find((c) => c.id === calc.id);
check("report de l'index de fin au mois suivant", st2.readings[0].previous === 200);
calculators.regularize(m.id, calc.id);
check("régularisation posée sur la ligne (réel = 275,5 − 266 = 9,5)", eq(months.getLines(m.id).find((l) => l.id === mCourses.id).actualAmount, 9.5));
calculators.regularize(m.id, calc.id);
check("re-régularisation remplace (pas de doublon)", eq(months.getLines(m.id).find((l) => l.id === mCourses.id).actualAmount, 9.5));

// ═══ Investissements ═══
section("Investissements");
const pea = accounts.create({ name: "PEA", type: "investissement" });
const etf = assets.create({ name: "ETF", type: "ETF", accountId: pea.id, monthlyDca: 50 });
assets.addMovement(etf.id, { kind: "versement", amount: 1000, date: `${period}-05` });
assets.addValuation(etf.id, { value: 1100 });
assets.addMovement(etf.id, { kind: "retrait", amount: 100, date: `${period}-06` });
assets.addValuation(etf.id, { value: 1000 });
check("performance = (1000 + 100 − 1000) / 1000 = +10 %", eq(assets.getById(etf.id).gainPct, 10));
assets.dca(m.id, etf.id);
throws("second DCA le même mois → 409", () => assets.dca(m.id, etf.id), 409);
s = summary.getSummary(m.id);
check("bilan : PEA = 1000 − 100 + 50", eq(s.accounts.find((a) => a.accountId === pea.id).current, 950));
const nw = summary.getNetWorth();
check("patrimoine : PEA à la valeur de marché (1000)", eq(nw.accounts.find((a) => a.accountId === pea.id).used, 1000));
throws("suppression d'un actif avec mouvements → 409", () => assets.remove(etf.id), 409);

// ═══ Clôture & garde-fous ═══
section("Clôture");
months.setClosed(m.id, true);
throws("entrée sur mois clôturé → 409", () => entries.create(m.id, { lineId: mCourses.id, amount: 1 }), 409);
throws("contribution datée dans un mois clôturé → 409", () => envelopes.addContribution(livretEnv.id, { amount: 1, date: `${period}-15`, fromAccountId: main.id }), 409);
throws("mouvement d'actif daté dans un mois clôturé → 409", () => assets.addMovement(etf.id, { kind: "versement", amount: 1, date: `${period}-15` }), 409);
throws("☐ payé sur mois clôturé → 409", () => entries.pay(m.id, mLoyer.id), 409);
months.setClosed(m.id, false);
throws("suppression d'une ligne avec entrées sans force → 409", () => lines.remove(mCourses.id), 409);
lines.remove(mCourses.id, { force: true });
check("suppression forcée → entrées et régularisation parties", entries.listByMonth(m.id).every((e) => e.lineId !== mCourses.id));
const tplBefore = lines.listByMonth(null).length;
lines.remove(courses.id);
check("suppression d'une ligne du template : les copies des mois restent (origine détachée)", lines.listByMonth(null).length === tplBefore - 1);
throws("suppression du compte principal alors qu'il en existe d'autres → 409", () => accounts.remove(main.id), 409);
throws("suppression d'une catégorie utilisée sans force → 409", () => categories.remove(catDep.id), 409);
categories.remove(catDep.id, { force: true });
check("suppression forcée d'une catégorie : lignes conservées sans catégorie", lines.listByMonth(null).some((l) => l.categoryId === null));
const th2 = themes.create({ name: "Culture" });
throws("suppression d'un thème utilisé sans force → 409", () => themes.remove(th.id), 409);
themes.merge(th.id, th2.id);
check("fusion de thèmes : références déplacées, source supprimée", !themes.list().some((t) => t.id === th.id) && entries.listByMonth(m.id).every((e) => e.themeId !== th.id));
months.remove(m2.id);
check("suppression d'un mois : lignes/entrées en cascade", months.list().length === 1);

console.log(`\n${pass} ✓  ${fail} ✗`);
if (issues.length) { console.log("\nProblèmes :"); issues.forEach((i) => console.log(" -", i)); }
