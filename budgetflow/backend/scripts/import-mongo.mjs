/**
 * Import de l'ancienne base BudgetFlow (Mongo, exportée en JSON) dans le nouveau modèle SQLite,
 * puis rapport de cohérence : on doit retomber sur les mêmes chiffres.
 *
 * Usage :
 *   1. Exporter Mongo : mongosh budget_app --eval "… JSON.stringify(db.<col>.find().toArray()) …" → dossier JSON
 *   2. node scripts/import-mongo.mjs <dossier-json> [chemin-sqlite]
 *      (la base cible doit être NEUVE : les migrations sont appliquées, rien n'est effacé)
 *
 * Mapping (décisions) :
 *   accounts        → accounts (bank→courant, savings→epargne ; hôte d'un investissement→investissement ; main = appsettings.mainAccount)
 *   sections        → categories type depense ; + catégorie « Revenus » (revenu) pour les lignes flow=income
 *   themes          → themes
 *   sheet template  → budget_lines month_id NULL ; la ligne appsettings.rentBudgetLine devient une CAGNOTTE (partenaire, partnerRentAmount, 50 %)
 *   sheets          → months (period ; archived → clôturé)
 *   budgetlines     → budget_lines (template_line_id via templateLine)
 *   transactions    → entries (details → label ; to_account_id = toAccount de la ligne ; source manuelle)
 *                     + une entrée synthétique par ligne dont le réel ≠ somme des transactions (réel saisi directement, ex. Salaire)
 *   accountsnapshots→ account_snapshots
 *   savinggoals     → envelopes (+ contribution « initiale » = initialAmount) ; savingcontributions → contributions (depuis le compte principal)
 *   investments     → assets (+ valorisation = currentValue à aujourd'hui) ; investmenttransactions → mouvements versement (depuis le principal)
 *   utilitymeters   → calculators (params prixHP/prixHC/abo/tva, relevés hp/hc index, formule) ; utilityreadings → calculator_readings
 *   appsettings     → app_settings
 *   subscriptions   → ignorés (module abonnements pas encore modélisé)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, dbPath] = process.argv.slice(2);
if (!dir) { console.error("Usage : node scripts/import-mongo.mjs <dossier-json> [chemin-sqlite]"); process.exit(1); }
if (dbPath) process.env.DB_PATH = dbPath;

const { initDb, all, get, run, tx, toCents, fromCents } = await import("../db/index.js");
initDb();
const summary = await import("../services/summary.service.js");
const pots = await import("../services/pot.service.js");
const calculators = await import("../services/calculator.service.js");

const load = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf-8"));
const M = {};
for (const c of ["accounts", "sections", "themes", "monthlysheets", "budgetlines", "transactions", "accountsnapshots",
  "savinggoals", "savingcontributions", "investments", "investmenttransactions", "utilitymeters", "utilityreadings", "subscriptions", "appsettings"]) {
  M[c] = load(c);
}
const settings = M.appsettings[0] || {};
const day = (d) => (d ? String(d).substring(0, 10) : null);
const period = (d) => String(d).substring(0, 7);
const sheetPeriodById = Object.fromEntries(M.monthlysheets.filter((s) => !s.isTemplate).map((s) => [s._id, period(s.periodMonth)]));

// L'ancienne app rattachait un mouvement au SHEET choisi, la nouvelle à sa DATE. Quand les deux
// divergent (versement saisi sur août avec une date de septembre), on redate dans le mois du sheet
// en gardant le jour — sinon les soldes changent de mois. La date d'origine est conservée en note.
function dateInSheet(dateStr, sheetId) {
  const d = day(dateStr) || `${sheetPeriodById[sheetId] || "2026-01"}-01`;
  const p = sheetPeriodById[sheetId];
  if (!p || d.startsWith(p)) return { date: d, note: null };
  const dd = Math.min(Number(d.substring(8, 10)) || 1, 28);
  return { date: `${p}-${String(dd).padStart(2, "0")}`, note: `date d'origine ${d}` };
}
const withNote = (base, note) => [base, note].filter(Boolean).join(" — ") || null;

if (get("SELECT COUNT(*) AS n FROM accounts").n > 0) {
  console.error("La base cible n'est pas vide — abandon (l'import attend une base neuve).");
  process.exit(1);
}

const idMap = { account: {}, category: {}, theme: {}, month: {}, line: {}, envelope: {}, asset: {}, calcDef: {} };
const PALETTE = ["#0891b2", "#7c3aed", "#ea580c", "#16a34a", "#d97706", "#6b7280", "#db2777", "#0d9488"];

tx(() => {
  // ─── Comptes ───
  const investmentHosts = new Set(M.investments.map((i) => i.account));
  const first = M.accounts[0]?._id;
  for (const a of M.accounts) {
    const type = investmentHosts.has(a._id) ? "investissement" : a.type === "savings" ? "epargne" : a.type === "cash" ? "especes" : "courant";
    const isMain = settings.mainAccount ? a._id === settings.mainAccount : a._id === first;
    const { lastInsertRowid } = run("INSERT INTO accounts (name, type, is_main, include_in_net_worth) VALUES (?, ?, ?, ?)",
      a.name, type, isMain ? 1 : 0, a.includeInNetWorth === false ? 0 : 1);
    idMap.account[a._id] = Number(lastInsertRowid);
  }

  // ─── Catégories (sections + Revenus) ───
  M.sections.sort((x, y) => (x.order ?? 99) - (y.order ?? 99)).forEach((s, i) => {
    const { lastInsertRowid } = run("INSERT INTO categories (name, type, color, sort_order) VALUES (?, 'depense', ?, ?)", s.name, s.color || PALETTE[i % PALETTE.length], i);
    idMap.category[s._id] = Number(lastInsertRowid);
  });
  const revenusId = Number(run("INSERT INTO categories (name, type, color, sort_order) VALUES ('Revenus', 'revenu', '#65a30d', ?)", M.sections.length).lastInsertRowid);

  // ─── Thèmes ───
  M.themes.forEach((t, i) => {
    const { lastInsertRowid } = run("INSERT INTO themes (name, color) VALUES (?, ?)", t.name.trim(), t.color || PALETTE[i % PALETTE.length]);
    idMap.theme[t._id] = Number(lastInsertRowid);
  });

  // ─── Paramètres ───
  run("UPDATE app_settings SET currency = ?, saving_rate = ?, payment_methods = ?, investment_types = ? WHERE id = 1",
    settings.currency || "EUR", settings.savingRate || 0,
    JSON.stringify(settings.paymentMethods || ["CB", "virement", "especes", "autre"]),
    JSON.stringify(settings.investmentTypes || ["ETF", "CRYPTO", "STOCK", "OTHER"]));

  // ─── Lignes (template puis mois) ───
  const template = M.monthlysheets.find((s) => s.isTemplate);
  const rentLineId = settings.rentBudgetLine;
  const insertLine = (l, monthId, templateLineId, order) => {
    const isPot = l._id === rentLineId || (l.templateLine && l.templateLine === rentLineId);
    const { lastInsertRowid } = run(
      `INSERT INTO budget_lines (month_id, template_line_id, label, category_id, theme_id, planned_amount_cents,
         from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes,
         is_pot, pot_partner_name, pot_partner_paid_cents, pot_my_share)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      monthId, templateLineId, l.label,
      l.flow === "income" ? revenusId : (idMap.category[l.section] ?? null),
      idMap.theme[l.theme] ?? null,
      isPot ? 0 : (toCents(l.plannedAmount) ?? 0),
      idMap.account[l.fromAccount] ?? null, idMap.account[l.toAccount] ?? null,
      l.paymentMethod ?? null, l.isShared ? 1 : 0, l.recurringDay ?? null, order, l.notes ?? null,
      isPot ? 1 : 0, isPot ? "Marion" : null, isPot ? (toCents(settings.partnerRentAmount) ?? 0) : 0, 50
    );
    idMap.line[l._id] = Number(lastInsertRowid);
  };
  const templateLines = M.budgetlines.filter((l) => l.sheet === template._id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  templateLines.forEach((l, i) => insertLine(l, null, null, i));

  // ─── Mois, lignes, snapshots ───
  const sheets = M.monthlysheets.filter((s) => !s.isTemplate).sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  for (const s of sheets) {
    const { lastInsertRowid } = run("INSERT INTO months (period, closed_at) VALUES (?, ?)", period(s.periodMonth), s.status === "archived" ? new Date().toISOString() : null);
    const monthId = Number(lastInsertRowid);
    idMap.month[s._id] = monthId;
    const lines = M.budgetlines.filter((l) => l.sheet === s._id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    lines.forEach((l, i) => insertLine(l, monthId, idMap.line[l.templateLine] ?? null, i));
    for (const snap of M.accountsnapshots.filter((x) => x.sheet === s._id)) {
      run("INSERT INTO account_snapshots (month_id, account_id, balance_cents) VALUES (?, ?, ?)", monthId, idMap.account[snap.account], toCents(snap.balance));
    }
  }

  // ─── Entrées (transactions + réel saisi directement) ───
  const lineById = Object.fromEntries(M.budgetlines.map((l) => [l._id, l]));
  for (const t of M.transactions) {
    if (t.source === "cancellation" || t.source === "rounding") continue;
    const line = lineById[t.budgetLine];
    const monthId = idMap.month[t.sheet];
    if (!monthId) continue;
    run(
      `INSERT INTO entries (month_id, line_id, label, amount_cents, date, account_id, to_account_id, payment_method, theme_id, is_shared, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manuelle', ?)`,
      monthId, idMap.line[t.budgetLine] ?? null, t.details || null, toCents(t.amount), day(t.date),
      idMap.account[t.account] ?? idMap.account[line?.fromAccount] ?? null,
      idMap.account[line?.toAccount] ?? null,
      t.paymentMethod ?? null, idMap.theme[t.theme] ?? null, t.isShared ? 1 : 0, t.notes ?? null
    );
  }
  let synthetic = 0;
  for (const l of M.budgetlines) {
    if (l.sheet === template._id) continue;
    const sum = M.transactions.filter((t) => t.budgetLine === l._id && t.source !== "cancellation" && t.source !== "rounding").reduce((s, t) => s + t.amount, 0);
    const diff = Math.round(((l.actualAmount || 0) - sum) * 100);
    if (diff !== 0) {
      const s = M.monthlysheets.find((x) => x._id === l.sheet);
      run(
        `INSERT INTO entries (month_id, line_id, label, amount_cents, date, account_id, to_account_id, is_shared, source)
         VALUES (?, ?, 'réel saisi directement (import)', ?, ?, ?, ?, ?, 'manuelle')`,
        idMap.month[l.sheet], idMap.line[l._id], diff, `${period(s.periodMonth)}-01`,
        l.flow === "income" ? (idMap.account[l.toAccount] ?? null) : (idMap.account[l.fromAccount] ?? null),
        l.flow === "income" ? null : (idMap.account[l.toAccount] ?? null), l.isShared ? 1 : 0
      );
      synthetic++;
    }
  }
  console.log(`entrées synthétiques (réel saisi directement) : ${synthetic}`);

  // ─── Enveloppes ───
  const mainId = get("SELECT id FROM accounts WHERE is_main = 1").id;
  for (const g of M.savinggoals) {
    const { lastInsertRowid } = run("INSERT INTO envelopes (name, account_id, target_amount_cents, deadline, closed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      g.name, idMap.account[g.account] ?? null, toCents(g.targetAmount), day(g.deadline), g.isCompleted ? new Date().toISOString() : null, g.createdAt || new Date().toISOString());
    idMap.envelope[g._id] = Number(lastInsertRowid);
    if (g.initialAmount) {
      run("INSERT INTO envelope_contributions (envelope_id, amount_cents, date, kind, notes) VALUES (?, ?, ?, 'initiale', 'Montant initial (import)')",
        idMap.envelope[g._id], toCents(g.initialAmount), day(g.createdAt) || "2026-01-01");
    }
  }
  let redated = 0;
  for (const c of M.savingcontributions) {
    const { date, note } = dateInSheet(c.date, c.sheet);
    if (note) redated++;
    run("INSERT INTO envelope_contributions (envelope_id, amount_cents, date, kind, from_account_id, notes) VALUES (?, ?, ?, 'normale', ?, ?)",
      idMap.envelope[c.goal], toCents(c.amount), date, mainId, withNote(c.notes, note));
  }

  // ─── Investissements ───
  for (const inv of M.investments) {
    const { lastInsertRowid } = run("INSERT INTO assets (name, type, account_id, monthly_dca_cents) VALUES (?, ?, ?, ?)",
      inv.name, inv.type || null, idMap.account[inv.account] ?? null, toCents(inv.monthlyInvestment) ?? 0);
    idMap.asset[inv._id] = Number(lastInsertRowid);
    if (inv.currentValue) run("INSERT INTO asset_valuations (asset_id, date, value_cents) VALUES (?, date('now'), ?)", idMap.asset[inv._id], toCents(inv.currentValue));
  }
  for (const t of M.investmenttransactions) {
    const { date, note } = dateInSheet(t.date, t.sheet);
    if (note) redated++;
    run("INSERT INTO asset_movements (asset_id, kind, amount_cents, date, counterpart_account_id, notes) VALUES (?, 'versement', ?, ?, ?, ?)",
      idMap.asset[t.investment], toCents(t.amount), date, mainId, withNote(t.notes, note));
  }
  console.log(`mouvements redatés dans le mois de leur sheet : ${redated}`);

  // ─── Calculateurs (compteurs) ───
  for (const m of M.utilitymeters) {
    const cfg = m.config || {};
    const themeId = idMap.theme[m.theme] ?? get("SELECT id FROM themes WHERE name LIKE 'Prevision EDF%'")?.id ?? null;
    const { lastInsertRowid } = run("INSERT INTO calculators (name, formula, line_id, theme_id) VALUES (?, ?, ?, ?)",
      m.name || "Compteur", "(hp × prixHP + hc × prixHC) × (1 + tva / 100) + abo", idMap.line[m.budgetLine] ?? null, themeId);
    const calcId = Number(lastInsertRowid);
    [["prixHP", "Prix heure pleine", cfg.hpPrice, "€/kWh"], ["prixHC", "Prix heure creuse", cfg.hcPrice, "€/kWh"], ["abo", "Abonnement", cfg.subscriptionPrice, "€"], ["tva", "TVA", cfg.tvaRate ?? 20, "%"]]
      .forEach(([symbol, label, value, unit], i) => run("INSERT INTO calculator_params (calculator_id, symbol, label, value, unit, sort_order) VALUES (?, ?, ?, ?, ?, ?)", calcId, symbol, label, value || 0, unit, i));
    const hpDef = Number(run("INSERT INTO calculator_reading_defs (calculator_id, symbol, label, kind, unit, sort_order) VALUES (?, 'hp', 'Heures pleines', 'index', 'kWh', 0)", calcId).lastInsertRowid);
    const hcDef = Number(run("INSERT INTO calculator_reading_defs (calculator_id, symbol, label, kind, unit, sort_order) VALUES (?, 'hc', 'Heures creuses', 'index', 'kWh', 1)", calcId).lastInsertRowid);
    for (const r of M.utilityreadings.filter((x) => x.meter === m._id)) {
      const monthId = idMap.month[r.sheet];
      if (!monthId) continue;
      run("INSERT INTO calculator_readings (def_id, month_id, previous_value, current_value) VALUES (?, ?, ?, ?)", hpDef, monthId, r.hpPrevious ?? null, r.hpCurrent || null);
      run("INSERT INTO calculator_readings (def_id, month_id, previous_value, current_value) VALUES (?, ?, ?, ?)", hcDef, monthId, r.hcPrevious ?? null, r.hcCurrent || null);
    }
  }
});

console.log(`abonnements ignorés : ${M.subscriptions.length}`);
console.log("Import terminé.\n");

// ═══════════════════════════════ RAPPORT DE COHÉRENCE ═══════════════════════════════
const eur = (n) => (n ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ok = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005;
let issues = 0;
const check = (label, oldV, newV) => {
  const good = ok(oldV, newV);
  if (!good) issues++;
  console.log(`${good ? " ✓" : " ✗"} ${label.padEnd(46)} ancien ${eur(oldV).padStart(11)}   nouveau ${eur(newV).padStart(11)}${good ? "" : "   Δ " + eur((newV ?? 0) - (oldV ?? 0))}`);
};

const template = M.monthlysheets.find((s) => s.isTemplate);
const sheets = M.monthlysheets.filter((s) => !s.isTemplate).sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
const accName = Object.fromEntries(M.accounts.map((a) => [a._id, a.name]));
const mainOld = settings.mainAccount;

for (const s of sheets) {
  const monthId = idMap.month[s._id];
  const p = period(s.periodMonth);
  console.log(`\n── ${p}`);
  const oldLines = M.budgetlines.filter((l) => l.sheet === s._id);
  const newLines = all(
    `SELECT bl.*, c.type AS ctype, COALESCE((SELECT SUM(e.amount_cents) FROM entries e WHERE e.line_id = bl.id), 0) AS actual_cents
     FROM budget_lines bl LEFT JOIN categories c ON c.id = bl.category_id WHERE bl.month_id = ?`, monthId);
  check("réel dépenses (Σ lignes)", oldLines.filter((l) => l.flow !== "income").reduce((x, l) => x + (l.actualAmount || 0), 0),
    fromCents(newLines.filter((l) => l.ctype !== "revenu").reduce((x, l) => x + l.actual_cents, 0)));
  check("réel revenus", oldLines.filter((l) => l.flow === "income").reduce((x, l) => x + (l.actualAmount || 0), 0),
    fromCents(newLines.filter((l) => l.ctype === "revenu").reduce((x, l) => x + l.actual_cents, 0)));

  // Soldes live : ancienne formule (liveBalances.js) vs nouveau summary
  const oldDelta = {};
  const add = (id, v) => { if (id) oldDelta[id] = (oldDelta[id] || 0) + v; };
  for (const l of oldLines) { if (l.actualAmount) { add(l.toAccount, l.actualAmount); add(l.fromAccount, -l.actualAmount); } }
  for (const c of M.savingcontributions.filter((c) => c.sheet === s._id)) { const g = M.savinggoals.find((g) => g._id === c.goal); add(mainOld, -c.amount); add(g?.account, c.amount); }
  for (const t of M.investmenttransactions.filter((t) => t.sheet === s._id)) { const inv = M.investments.find((i) => i._id === t.investment); add(mainOld, -t.amount); add(inv?.account, t.amount); }
  const sum = summary.getSummary(monthId);
  for (const snap of M.accountsnapshots.filter((x) => x.sheet === s._id)) {
    const oldLive = snap.balance + (oldDelta[snap.account] || 0);
    const newAcc = sum.accounts.find((a) => a.accountId === idMap.account[snap.account]);
    check(`solde live ${accName[snap.account]}`, oldLive, newAcc?.current);
  }

  // Cagnotte loyer — INFORMATIF : l'ancien prévu était figé au moment du clic « appliquer »
  // (et incluait un dépassement EDF estimé), le nouveau est recalculé en direct sur les ½ actuels.
  const oldRent = oldLines.find((l) => l.templateLine === settings.rentBudgetLine);
  if (oldRent) {
    const pot = pots.computeAll(monthId).find((x) => x.id === idMap.line[oldRent._id]);
    if (pot) console.log(` ℹ ${"loyer : ancien prévu figé vs cagnotte en direct".padEnd(46)} ancien ${eur(oldRent.plannedAmount).padStart(11)}   nouveau ${eur(pot.toSend).padStart(11)}`);
  }

  // EDF : ancien calcul vs calculateur
  for (const r of M.utilityreadings.filter((x) => x.sheet === s._id)) {
    const cfg = M.utilitymeters.find((m) => m._id === r.meter)?.config || {};
    const hp = (r.hpCurrent || 0) - (r.hpPrevious || 0), hc = (r.hcCurrent || 0) - (r.hcPrevious || 0);
    const oldEdf = hp < 0 || hc < 0 || !r.hpCurrent ? null : Math.round(((hp * cfg.hpPrice + hc * cfg.hcPrice) * (1 + (cfg.tvaRate ?? 20) / 100) + cfg.subscriptionPrice) * 100) / 100;
    const st = calculators.monthState(monthId)[0];
    if (oldEdf !== null) check("EDF estimé", oldEdf, st?.estimate);
  }
}

console.log("\n── Enveloppes (ancien = initial + contributions)");
for (const g of M.savinggoals) {
  const oldTotal = (g.initialAmount || 0) + M.savingcontributions.filter((c) => c.goal === g._id).reduce((x, c) => x + c.amount, 0);
  const newTotal = fromCents(get("SELECT COALESCE(SUM(amount_cents),0) AS s FROM envelope_contributions WHERE envelope_id = ?", idMap.envelope[g._id]).s);
  check(g.name, oldTotal, newTotal);
}
console.log("\n── Investissements (investi)");
for (const inv of M.investments) {
  const oldInv = M.investmenttransactions.filter((t) => t.investment === inv._id).reduce((x, t) => x + t.amount, 0);
  const newInv = fromCents(get("SELECT COALESCE(SUM(amount_cents),0) AS s FROM asset_movements WHERE asset_id = ? AND kind = 'versement'", idMap.asset[inv._id]).s);
  check(inv.name, oldInv, newInv);
}

console.log(`\n${issues === 0 ? "✓ Tout concorde." : `✗ ${issues} écart(s) — voir ci-dessus.`}`);
