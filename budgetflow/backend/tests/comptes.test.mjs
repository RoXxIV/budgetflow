// Tests unitaires — périmètre « page Comptes » : comptes + enveloppes (services).
// Base SQLite neuve et jetable (migrations appliquées), tests séquentiels qui partagent le décor.
// Lancer depuis backend/ : `npm test` (ou `node --test tests/`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "budgetflow-test-")), "budget.db");
const { initDb } = await import("../db/index.js");
initDb();
const accounts = await import("../services/account.service.js");
const envelopes = await import("../services/envelope.service.js");
const months = await import("../services/month.service.js");
const categories = await import("../services/category.service.js");
const budgetLines = await import("../services/budgetLine.service.js");
const entries = await import("../services/entry.service.js");
const assetsSvc = await import("../services/asset.service.js");
const summary = await import("../services/summary.service.js");
envelopes.bindSummary(summary);
accounts.bindSummary(summary);

// L'appel doit être refusé avec ce statut (et ce code de payload le cas échéant)
function refuse(fn, status, code = null) {
  try { fn(); } catch (e) {
    assert.equal(e.status, status, `statut ${e.status} ≠ ${status} : ${e.message}`);
    if (code) assert.equal(e.payload?.code, code);
    return e;
  }
  assert.fail(`aurait dû être refusé (${status})`);
}

// ─── Décor partagé ───────────────────────────────────────
let main, livret, month, cat;

test("décor : premier compte = principal d'office, mois avec soldes", () => {
  main = accounts.create({ name: "Principal", type: "courant" });
  assert.ok(main.isMain);
  livret = accounts.create({ name: "Livret", type: "epargne", multiProjects: true });
  cat = categories.create({ name: "Dépenses", type: "depense" });
  month = months.create({ period: "2026-09", snapshots: [
    { accountId: main.id, balance: 1000 }, { accountId: livret.id, balance: 500 },
  ] });
  assert.equal(summary.getSummary(month.id).accounts.find((a) => a.isMain).current, 1000);
});

// ─── Comptes ─────────────────────────────────────────────
test("comptes : nom unique, insensible à la casse", () => {
  refuse(() => accounts.create({ name: "principal" }), 409);
});

test("compte épargne mono-projet : enveloppe auto du même nom, solde initial en contribution", () => {
  const lv = accounts.create({ name: "Livret A", type: "epargne", initialBalance: 250 });
  assert.equal(lv.envelopes.length, 1);
  assert.equal(lv.envelopes[0].name, "Livret A");
  assert.equal(lv.envelopes[0].total, 250);
});

test("principal : ne se décoche pas, se transfère en cochant un autre compte", () => {
  refuse(() => accounts.update(main.id, { isMain: false }), 409);
  accounts.update(livret.id, { isMain: true });
  assert.ok(accounts.getById(livret.id).isMain && !accounts.getById(main.id).isMain);
  accounts.update(main.id, { isMain: true }); // retour à la normale
  assert.ok(!accounts.getById(livret.id).isMain);
});

test("suppression : sans historique OK, avec historique 409 (désactiver à la place)", () => {
  const erreur = accounts.create({ name: "Erreur" });
  accounts.remove(erreur.id);
  assert.ok(accounts.list().every((a) => a.name !== "Erreur"));
  refuse(() => accounts.remove(livret.id), 409, "ACCOUNT_HAS_HISTORY"); // snapshot = historique
});

test("désactivation : le solde doit être viré d'abord ; hors bilan ; réactivable", () => {
  const old = accounts.create({ name: "Vieux" });
  months.upsertSnapshots(month.id, [{ accountId: old.id, balance: 120 }]);
  refuse(() => accounts.setActive(old.id, false), 409, "ACCOUNT_HAS_BALANCE");
  accounts.setActive(old.id, false, { transferToAccountId: main.id });
  assert.ok(!accounts.getById(old.id).isActive);
  assert.ok(!summary.getSummary(month.id).accounts.some((a) => a.accountId === old.id), "hors bilan");
  const vir = entries.listByMonth(month.id).find((e) => (e.label || "").includes("Vieux"));
  assert.ok(vir && vir.amount === 120 && vir.accountId === old.id && vir.toAccountId === main.id, "virement du solde");
  accounts.setActive(old.id, true);
  assert.ok(summary.getSummary(month.id).accounts.some((a) => a.accountId === old.id), "de retour au bilan");
});

test("désactivation refusée : principal, enveloppe ouverte hébergée, actif ouvert hébergé", () => {
  refuse(() => accounts.setActive(main.id, false), 409);
  refuse(() => accounts.setActive(livret.id, false), 409); // enveloppes ouvertes dessus (plus bas)
  const pea = accounts.create({ name: "PEA", type: "investissement" });
  assetsSvc.create({ name: "ETF", accountId: pea.id });
  refuse(() => accounts.setActive(pea.id, false), 409);
});

// ─── Enveloppes : invariant et découvert ─────────────────
test("invariant : montant initial plafonné au hors enveloppes ; découvert autorisé lève le plafond", () => {
  refuse(() => envelopes.create({ name: "Trop", accountId: main.id, initialAmount: 2000 }), 409);
  accounts.update(main.id, { allowOverdraft: true });
  const env = envelopes.create({ name: "Trop", accountId: main.id, initialAmount: 2000 });
  const avail = envelopes.availability(main.id);
  assert.ok(avail.allowOverdraft && avail.available < 0, "hors enveloppes négatif accepté (ambre)");
  envelopes.closeInto(env.id, { toAccountId: main.id }); // même hôte : clôture, aucun virement
  accounts.update(main.id, { allowOverdraft: false });
  // 1000 de départ + 120 virés depuis « Vieux » à sa désactivation (test précédent)
  assert.equal(envelopes.availability(main.id).available, 1120);
});

test("montant initial négatif refusé", () => {
  refuse(() => envelopes.create({ name: "Neg", initialAmount: -50 }), 400);
});

test("nom unique par hôte : doublon refusé, autre hôte permis, clôturée ne bloque pas", () => {
  envelopes.create({ name: "Dup", accountId: livret.id });
  refuse(() => envelopes.create({ name: "dup", accountId: livret.id }), 409);
  const virtuelle = envelopes.create({ name: "Dup" }); // hôte différent (virtuelle) : OK
  envelopes.remove(virtuelle.id);
});

test("hôte désactivé : refusé à la création comme au déplacement", () => {
  const parking = accounts.create({ name: "Parking" });
  accounts.setActive(parking.id, false);
  refuse(() => envelopes.create({ name: "Fantôme", accountId: parking.id }), 400);
  const mobile = envelopes.create({ name: "Mobile", accountId: livret.id });
  refuse(() => envelopes.update(mobile.id, { accountId: parking.id }), 400);
  envelopes.remove(mobile.id);
  accounts.setActive(parking.id, true);
  accounts.remove(parking.id);
});

// ─── Enveloppes : réaffectation, clôture, suppression ────
let envA, envB;

test("réaffectation partielle entre enveloppes d'un même compte", () => {
  envA = envelopes.create({ name: "A", accountId: livret.id, initialAmount: 200 });
  envB = envelopes.create({ name: "B", accountId: livret.id });
  envelopes.reallocate(envA.id, { toEnvelopeId: envB.id, amount: 80 });
  assert.equal(envelopes.getById(envA.id).total, 120);
  assert.equal(envelopes.getById(envB.id).total, 80);
});

test("suppression : sans historique OK, avec historique 409 ENVELOPE_HAS_FUNDS", () => {
  const vide = envelopes.create({ name: "Vide", accountId: livret.id });
  envelopes.remove(vide.id);
  refuse(() => envelopes.remove(envA.id), 409, "ENVELOPE_HAS_FUNDS");
});

test("closeInto vers une enveloppe : contenu transféré, source clôturée, historique conservé", () => {
  envelopes.closeInto(envA.id, { toEnvelopeId: envB.id });
  const a = envelopes.getById(envA.id);
  assert.ok(a.isClosed && a.total === 0);
  assert.equal(envelopes.getById(envB.id).total, 200);
  assert.ok(envelopes.listContributions(envA.id).length >= 2, "l'historique reste");
});

test("closeInto vers un autre compte : virement système, hors enveloppes ajusté", () => {
  envelopes.closeInto(envB.id, { toAccountId: main.id });
  const vir = entries.listByMonth(month.id).find((e) => (e.label || "").includes("« B »"));
  assert.ok(vir && vir.amount === 200 && vir.accountId === livret.id && vir.toAccountId === main.id);
  assert.equal(envelopes.availability(livret.id).available, 300); // 500 − 200 partis, plus rien de réservé… sauf Dup(0)
});

test("déplacement d'une enveloppe pleine : virement système ancien hôte → nouvel hôte", () => {
  const move = envelopes.create({ name: "Move", accountId: livret.id, initialAmount: 50 });
  envelopes.update(move.id, { accountId: main.id });
  const vir = entries.listByMonth(month.id).find((e) => (e.label || "").includes("Move"));
  assert.ok(vir && vir.amount === 50 && vir.accountId === livret.id && vir.toAccountId === main.id);
  envelopes.update(move.id, { targetAmount: 100 });
  assert.equal(entries.listByMonth(month.id).filter((e) => (e.label || "").includes("Move")).length, 1, "pas de virement sans changement d'hôte");
});

test("enveloppe d'une ligne mensualisée : ni suppression ni clôture-réaffectation (démensualiser d'abord)", () => {
  const line = budgetLines.create(null, { label: "Strava", categoryId: cat.id, plannedAmount: 60, intervalMonths: 12, anchorMonth: 9, fromAccountId: main.id });
  budgetLines.setMonthlyized(line.id, { enabled: true, accountId: null });
  const envId = budgetLines.getById(line.id).envelopeId;
  refuse(() => envelopes.remove(envId), 409);
  refuse(() => envelopes.closeInto(envId, { toAccountId: main.id }), 409);
});

test("renommage synchronisé 1:1 dans les deux sens, sans casser l'unicité des comptes", () => {
  const lv = accounts.create({ name: "Jeune", type: "epargne", initialBalance: 10 });
  accounts.update(lv.id, { name: "Jeune2" });
  assert.equal(accounts.getById(lv.id).envelopes[0].name, "Jeune2", "l'enveloppe suit le compte");
  const envId = accounts.getById(lv.id).envelopes[0].id;
  envelopes.update(envId, { name: "Jeune3" });
  assert.equal(accounts.getById(lv.id).name, "Jeune3", "le compte suit l'enveloppe");
  envelopes.update(envId, { name: "Principal" }); // nom déjà pris par un compte
  assert.equal(envelopes.getById(envId).name, "Principal", "l'enveloppe est renommée");
  assert.equal(accounts.getById(lv.id).name, "Jeune3", "mais le compte ne suit pas (unicité)");
});

test("enveloppe soldée à 0 : supprimable si historique purement administratif, refusée après de la vraie vie", () => {
  // Que des mouvements administratifs (initiale + réaffectation de clôture) → supprimable (créée par erreur, test)
  const cible = envelopes.create({ name: "Cible réaffectation" });
  const admin = envelopes.create({ name: "Créée par erreur", initialAmount: 10 });
  envelopes.closeInto(admin.id, { toEnvelopeId: cible.id });
  envelopes.remove(admin.id);
  assert.ok(!envelopes.list().some((e) => e.id === admin.id), "l'enveloppe administrative disparaît");
  // Un versement réel (kind normale) → l'historique reste, suppression refusée même soldée à 0
  const vecue = envelopes.create({ name: "Vécue" });
  envelopes.addContribution(vecue.id, { amount: 50, fromAccountId: main.id });
  envelopes.closeInto(vecue.id, { toEnvelopeId: cible.id });
  refuse(() => envelopes.remove(vecue.id), 409);
});
