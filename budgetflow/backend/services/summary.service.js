import { all, get, fromCents, httpError } from "../db/index.js";
import { getSnapshots } from "./month.service.js";
import * as pots from "./pot.service.js";
import * as envelopesModule from "./envelope.service.js";

/**
 * Patrimoine total : comptes inclus, au solde live du mois en cours ; pour un compte investissement
 * hébergeant des actifs valorisés, la VALEUR DE MARCHÉ (dernières valorisations) remplace le solde.
 */
export function getNetWorth() {
  const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1")
    || get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  if (!month) return { total: 0, monthPeriod: null, accounts: [] };
  const { accounts } = getSummary(month.id);
  const rows = accounts.map((a) => {
    const valued = all(
      `SELECT a.id, (SELECT value_cents FROM asset_valuations v WHERE v.asset_id = a.id ORDER BY v.date DESC, v.id DESC LIMIT 1) AS value_cents
       FROM assets a WHERE a.account_id = ? AND a.closed_at IS NULL`, a.accountId
    ).filter((x) => x.value_cents !== null);
    const marketValue = valued.length ? fromCents(valued.reduce((s, x) => s + x.value_cents, 0)) : null;
    const used = marketValue !== null ? marketValue : a.current;
    return { accountId: a.accountId, name: a.name, type: a.type, includeInNetWorth: a.includeInNetWorth, balance: a.current, marketValue, used };
  });
  const total = rows.filter((r) => r.includeInNetWorth && r.used !== null).reduce((s, r) => s + r.used, 0);
  return { total: Math.round(total * 100) / 100, monthPeriod: month.period, accounts: rows };
}

/**
 * Bilan d'un mois — toute la logique de calcul vit ici (le front n'additionne rien).
 *
 * Règles (brainstorm) :
 * - le TYPE de la catégorie pilote l'effet d'une entrée sur les comptes :
 *     depense  → débite account_id
 *     revenu   → crédite account_id
 *     epargne/transfert → débite account_id, crédite to_account_id
 * - disponible = solde courant du compte principal − enveloppes ouvertes hébergées dessus
 * - le réel remplace le prévu : une ligne sans entrée compte pour son prévu, sinon pour son réel
 * - projeté fin de mois = solde actuel + revenus prévus non encaissés − sorties prévues non réalisées
 *                         [périmètre : compte principal ; le réel est déjà dans le solde]
 * - mis de côté = entrées des lignes épargne + contributions « normales » du mois
 * - objectif épargne = savingRate % × revenu de référence (max(réel, prévu) des lignes revenu)
 */
export function getSummary(monthId) {
  const month = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!month) throw httpError(404, "Mois introuvable");

  const accounts = all("SELECT * FROM accounts ORDER BY is_main DESC, name");
  const settings = get("SELECT * FROM app_settings WHERE id = 1");
  const snapshots = getSnapshots(monthId);

  // Lignes du mois avec type de catégorie et réel
  const lines = all(
    `SELECT bl.*, COALESCE(c.type, 'depense') AS category_type,
       COALESCE((SELECT SUM(e.amount_cents) FROM entries e WHERE e.line_id = bl.id), 0) AS actual_cents,
       (SELECT COUNT(*) FROM entries e WHERE e.line_id = bl.id) AS entry_count
     FROM budget_lines bl LEFT JOIN categories c ON c.id = bl.category_id
     WHERE bl.month_id = ?`,
    monthId
  );
  const lineById = Object.fromEntries(lines.map((l) => [l.id, l]));

  const entries = all("SELECT * FROM entries WHERE month_id = ?", monthId);

  // Contributions d'enveloppes datées dans le mois (avec le compte hôte)
  const monthStart = `${month.period}-01`;
  const contributions = all(
    `SELECT c.*, e.account_id AS env_account_id FROM envelope_contributions c
     JOIN envelopes e ON e.id = c.envelope_id
     WHERE c.date >= ? AND c.date < date(?, '+1 month')`,
    monthStart, monthStart
  );

  // Mouvements d'investissement datés dans le mois (versement : contrepartie → hôte ; retrait : hôte → contrepartie)
  const assetMovements = all(
    `SELECT m.*, a.account_id AS host_account_id, a.monthly_dca_cents FROM asset_movements m
     JOIN assets a ON a.id = m.asset_id
     WHERE m.date >= ? AND m.date < date(?, '+1 month')`,
    monthStart, monthStart
  );
  const openAssets = all("SELECT * FROM assets WHERE closed_at IS NULL");

  // Enveloppes ouvertes par compte hôte (total = somme des contributions)
  const envelopeRows = all(
    `SELECT e.account_id, SUM(c.amount_cents) AS total_cents
     FROM envelopes e LEFT JOIN envelope_contributions c ON c.envelope_id = e.id
     WHERE e.closed_at IS NULL AND e.account_id IS NOT NULL
     GROUP BY e.account_id`
  );
  const envelopesByAccount = Object.fromEntries(envelopeRows.map((r) => [r.account_id, r.total_cents || 0]));

  // ─── Deltas par compte (mouvements réels du mois) ───────
  const delta = {};
  const move = (accountId, cents) => {
    if (accountId) delta[accountId] = (delta[accountId] || 0) + cents;
  };
  for (const e of entries) {
    const type = e.line_id ? lineById[e.line_id]?.category_type || "depense" : "depense";
    if (type === "revenu") {
      move(e.account_id, e.amount_cents);
    } else {
      move(e.account_id, -e.amount_cents);
      move(e.to_account_id, e.amount_cents);
    }
  }
  // Une contribution ne bouge les comptes que si un compte source est renseigné (transfert réel)
  for (const c of contributions) {
    if (c.from_account_id) {
      move(c.from_account_id, -c.amount_cents);
      move(c.env_account_id, c.amount_cents);
    }
  }
  for (const m of assetMovements) {
    if (m.kind === "versement") {
      move(m.counterpart_account_id, -m.amount_cents);
      move(m.host_account_id, m.amount_cents);
    } else {
      move(m.host_account_id, -m.amount_cents);
      move(m.counterpart_account_id, m.amount_cents);
    }
  }

  // ─── Soldes par compte ──────────────────────────────────
  const snapshotByAccount = Object.fromEntries(snapshots.map((s) => [s.accountId, s.balance]));
  const accountRows = accounts.map((a) => {
    const start = snapshotByAccount[a.id] ?? null;
    const d = fromCents(delta[a.id] || 0);
    const current = start === null && d === 0 ? null : (start ?? 0) + d;
    const envelopesTotal = fromCents(envelopesByAccount[a.id] || 0);
    return {
      accountId: a.id,
      name: a.name,
      type: a.type,
      isMain: !!a.is_main,
      includeInNetWorth: !!a.include_in_net_worth,
      start,
      current,
      envelopesTotal,
      unallocated: current !== null && envelopesByAccount[a.id] !== undefined ? current - envelopesTotal : null,
    };
  });

  // ─── Tuiles ─────────────────────────────────────────────
  const main = accountRows.find((a) => a.isMain) || null;
  const disponible = main && main.current !== null
    ? main.current - (envelopesByAccount[main.accountId] ? fromCents(envelopesByAccount[main.accountId]) : 0)
    : null;

  // Périmètre compte principal : from/to absent = compte principal par défaut
  const isMainOrNull = (id) => !main || !id || id === main.accountId;
  // Le réel remplace le prévu : seules les lignes SANS entrée comptent pour leur prévu
  // Une cagnotte compte pour son « à envoyer » calculé (négatif = rentrée d'argent)
  const potById = Object.fromEntries(pots.computeAll(monthId).map((p) => [p.id, p]));
  let prevusRestants = 0;   // sorties prévues non encore réalisées
  let revenusRestants = 0;  // revenus prévus non encore encaissés
  for (const l of lines) {
    if (l.entry_count > 0) continue;
    const plannedCents = l.is_pot ? (potById[l.id]?.toSendCents || 0) : l.planned_amount_cents;
    if (l.category_type === "revenu") {
      if (isMainOrNull(l.to_account_id)) revenusRestants += plannedCents;
    } else if (isMainOrNull(l.from_account_id)) {
      prevusRestants += plannedCents;
    }
  }
  // DCA prévu non encore versé ce mois : présumé versé depuis le compte principal
  const dcaDone = new Set(assetMovements.filter((m) => m.source === "dca").map((m) => m.asset_id));
  let dcaRestants = 0;
  for (const a of openAssets) {
    if (a.monthly_dca_cents && !dcaDone.has(a.id)) dcaRestants += a.monthly_dca_cents;
  }
  prevusRestants += dcaRestants;

  // Mensualités des lignes mensualisées (enveloppe liée) non encore versées ce mois : présumées versées
  const contributedThisMonth = new Set(contributions.filter((c) => c.kind === "normale").map((c) => c.envelope_id));
  const linkedEnvelopeIds = all("SELECT DISTINCT envelope_id FROM budget_lines WHERE month_id IS NULL AND envelope_id IS NOT NULL").map((r) => r.envelope_id);
  if (linkedEnvelopeIds.length) {
    const { list: listEnvelopes } = envelopesModule;
    for (const e of listEnvelopes()) {
      if (linkedEnvelopeIds.includes(e.id) && !e.isClosed && e.monthlySuggestion && !contributedThisMonth.has(e.id)) {
        prevusRestants += Math.round(e.monthlySuggestion * 100);
      }
    }
  }

  const projete = disponible !== null
    ? disponible + fromCents(revenusRestants - prevusRestants)
    : null;

  // ─── Mis de côté / objectif ─────────────────────────────
  const savingsFromLines = lines
    .filter((l) => l.category_type === "epargne")
    .reduce((s, l) => s + l.actual_cents, 0);
  const savingsFromContribs = contributions
    .filter((c) => c.kind === "normale")
    .reduce((s, c) => s + c.amount_cents, 0);
  const savingsFromAssets = assetMovements
    .filter((m) => m.kind === "versement")
    .reduce((s, m) => s + m.amount_cents, 0);
  const misDeCote = fromCents(savingsFromLines + savingsFromContribs + savingsFromAssets);

  const revActual = lines.filter((l) => l.category_type === "revenu").reduce((s, l) => s + l.actual_cents, 0);
  const revPlanned = lines.filter((l) => l.category_type === "revenu").reduce((s, l) => s + l.planned_amount_cents, 0);
  const incomeReference = fromCents(Math.max(revActual, revPlanned));
  const savingRate = settings.saving_rate || 0;
  const objectifEpargne = Math.round(incomeReference * savingRate) / 100;

  return {
    tiles: {
      disponible,
      projete,
      misDeCote,
      objectifEpargne,
      savingRate,
      incomeReference,
      detail: {
        revenusRestants: fromCents(revenusRestants),
        prevusRestants: fromCents(prevusRestants),
      },
    },
    mainAccount: main ? { id: main.accountId, name: main.name } : null,
    accounts: accountRows,
  };
}
