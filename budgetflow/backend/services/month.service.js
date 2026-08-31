import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";
import * as budgetLines from "./budgetLine.service.js";

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export function monthName(period) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function serialize(row) {
  return {
    id: row.id,
    period: row.period,
    name: monthName(row.period),
    isClosed: !!row.closed_at,
    createdAt: row.created_at,
  };
}

export function list() {
  return all("SELECT * FROM months ORDER BY period DESC").map(serialize);
}

export function getById(id) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  return serialize(row);
}

export function assertOpen(monthId) {
  const row = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!row) throw httpError(404, "Mois introuvable");
  if (row.closed_at) throw httpError(409, `${monthName(row.period)} est clôturé`);
  return row;
}

// Lignes du mois avec le réel calculé (somme des entrées)
export function getLines(monthId) {
  const rows = all(
    `SELECT bl.*, COALESCE((SELECT SUM(e.amount_cents) FROM entries e WHERE e.line_id = bl.id), 0) AS actual_cents,
       (SELECT COUNT(*) FROM entries e WHERE e.line_id = bl.id) AS entry_count
     FROM budget_lines bl WHERE bl.month_id = ? ORDER BY bl.sort_order, bl.id`,
    monthId
  );
  return rows.map((r) => ({
    ...budgetLines.serialize(r),
    actualAmount: fromCents(r.actual_cents),
    entryCount: r.entry_count,
  }));
}

// ─── Snapshots ────────────────────────────────────────────
export function getSnapshots(monthId) {
  return all("SELECT * FROM account_snapshots WHERE month_id = ?", monthId).map((s) => ({
    id: s.id,
    accountId: s.account_id,
    balance: fromCents(s.balance_cents),
  }));
}

export function upsertSnapshots(monthId, snapshots) {
  assertOpen(monthId);
  tx(() => {
    for (const s of snapshots) {
      if (s.balance === null || s.balance === undefined || s.balance === "") continue;
      run(
        `INSERT INTO account_snapshots (month_id, account_id, balance_cents) VALUES (?, ?, ?)
         ON CONFLICT (month_id, account_id) DO UPDATE SET balance_cents = excluded.balance_cents`,
        monthId, s.accountId, toCents(s.balance)
      );
    }
  });
  return getSnapshots(monthId);
}

// ─── Pré-remplissage du formulaire de création ────────────
// Période proposée = mois suivant le dernier mois existant, sinon mois courant.
// Soldes proposés = snapshots du dernier mois (à affiner avec le solde live — étape bilan).
export function prefill() {
  const latest = get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  let period;
  if (latest) {
    const [y, m] = latest.period.split("-").map(Number);
    period = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  } else {
    const now = new Date();
    period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  const snapshots = latest ? getSnapshots(latest.id) : [];
  return { period, snapshots: snapshots.map(({ accountId, balance }) => ({ accountId, balance })) };
}

// ─── Création : duplication du template ───────────────────
export function create({ period, snapshots = [] }) {
  if (!PERIOD_RE.test(period || "")) throw httpError(400, "Période invalide (attendu : YYYY-MM)");
  const existing = get("SELECT id FROM months WHERE period = ?", period);
  if (existing) throw httpError(409, `Un mois existe déjà pour ${monthName(period)}`);

  return tx(() => {
    const { lastInsertRowid: monthId } = run("INSERT INTO months (period) VALUES (?)", period);

    // Duplication des lignes du template (ordre conservé, origine tracée)
    const templateLines = all("SELECT * FROM budget_lines WHERE month_id IS NULL ORDER BY sort_order, id");
    for (const line of templateLines) {
      run(
        `INSERT INTO budget_lines
          (month_id, template_line_id, label, category_id, theme_id, kind, planned_amount_cents,
           from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        monthId, line.id, line.label, line.category_id, line.theme_id, line.kind,
        line.planned_amount_cents, line.from_account_id, line.to_account_id,
        line.payment_method, line.is_shared, line.recurring_day, line.sort_order, line.notes
      );
    }

    for (const s of snapshots) {
      if (s.balance === null || s.balance === undefined || s.balance === "") continue;
      run(
        "INSERT INTO account_snapshots (month_id, account_id, balance_cents) VALUES (?, ?, ?)",
        monthId, s.accountId, toCents(s.balance)
      );
    }

    return getById(Number(monthId));
  });
}

export function setClosed(id, isClosed) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  run("UPDATE months SET closed_at = ? WHERE id = ?", isClosed ? new Date().toISOString() : null, id);
  return getById(id);
}

export function remove(id) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  run("DELETE FROM months WHERE id = ?", id); // lignes, entrées et snapshots suivent (CASCADE)
  return { message: `${monthName(row.period)} supprimé` };
}
