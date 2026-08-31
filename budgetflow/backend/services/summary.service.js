import { all, get, fromCents, httpError } from "../db/index.js";
import { getSnapshots } from "./month.service.js";

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
  let prevusRestants = 0;   // sorties prévues non encore réalisées
  let revenusRestants = 0;  // revenus prévus non encore encaissés
  for (const l of lines) {
    if (l.entry_count > 0) continue;
    if (l.category_type === "revenu") {
      if (isMainOrNull(l.to_account_id)) revenusRestants += l.planned_amount_cents;
    } else if (isMainOrNull(l.from_account_id)) {
      prevusRestants += l.planned_amount_cents;
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
  const misDeCote = fromCents(savingsFromLines + savingsFromContribs);

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
