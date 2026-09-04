import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";
import * as budgetLines from "./budgetLine.service.js";
import * as pots from "./pot.service.js";

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export function monthName(period) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
const formatPeriodName = monthName;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function serialize(row) {
  return {
    id: row.id,
    period: row.period,
    name: monthName(row.period),
    isClosed: !!row.closed_at,
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

// Note libre du mois — du contexte, pas de l'argent : autorisée aussi sur un mois clôturé
export function setNotes(id, notes) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  run("UPDATE months SET notes = ? WHERE id = ?", String(notes ?? "").trim() || null, id);
  return getById(id);
}

export function list() {
  return all("SELECT * FROM months ORDER BY period DESC").map(serialize);
}

export function getById(id) {
  const row = get("SELECT * FROM months WHERE id = ?", id);
  if (!row) throw httpError(404, "Mois introuvable");
  return serialize(row);
}

// « Mois en cours » : le mois ouvert du calendrier, sinon le mois ouvert le plus récent, sinon null
export function current() {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const row = get("SELECT * FROM months WHERE period = ? AND closed_at IS NULL", period)
    || get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1");
  return row ? serialize(row) : null;
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
  // Cagnottes : le prévu affiché est le « à envoyer » calculé
  const potById = Object.fromEntries(pots.computeAll(monthId).map((p) => [p.id, p]));
  return rows.map((r) => {
    const line = {
      ...budgetLines.serialize(r),
      actualAmount: fromCents(r.actual_cents),
      entryCount: r.entry_count,
    };
    if (r.is_pot && potById[r.id]) {
      const { toSendCents, ...pot } = potById[r.id];
      line.pot = pot;
      line.plannedAmount = pot.toSend;
    }
    return line;
  });
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
// Soldes proposés = solde LIVE de fin du dernier mois (début + mouvements) : une suggestion
// que l'utilisateur corrige (arrondis bancaires, intérêts…) — chaque mois repart de sa saisie.
export async function prefill() {
  const latest = get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  let period;
  if (latest) {
    const [y, m] = latest.period.split("-").map(Number);
    period = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  } else {
    const now = new Date();
    period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  let snapshots = [];
  if (latest) {
    const { getSummary } = await import("./summary.service.js"); // import différé (dépendance circulaire)
    snapshots = getSummary(latest.id).accounts
      .filter((a) => a.current !== null)
      .map((a) => ({ accountId: a.accountId, balance: a.current }));
  }
  // Enveloppes ouvertes : cumul actuel, à recaler en même temps que les comptes
  const { list: listEnvelopes } = await import("./envelope.service.js");
  const envelopes = listEnvelopes()
    .filter((e) => !e.isClosed)
    .map((e) => ({ id: e.id, name: e.name, accountId: e.accountId, accountName: e.accountName, total: e.total }));
  return { period, previousPeriod: latest?.period ?? null, snapshots, envelopes };
}

// ─── Création : duplication du template ───────────────────
export function create({ period, snapshots = [], envelopes = [] }) {
  if (!PERIOD_RE.test(period || "")) throw httpError(400, "Période invalide (attendu : YYYY-MM)");
  const existing = get("SELECT id FROM months WHERE period = ?", period);
  if (existing) throw httpError(409, `Un mois existe déjà pour ${monthName(period)}`);
  // Un mois sans compte n'a pas de sens : pas de solde à suivre, pas de bilan (retour de test à vide)
  if (!get("SELECT id FROM accounts WHERE is_active = 1 LIMIT 1")) {
    throw httpError(409, "Créez d'abord un compte (page Comptes) : un mois suit des soldes, il lui faut au moins un compte actif.");
  }

  return tx(() => {
    const { lastInsertRowid: monthId } = run("INSERT INTO months (period) VALUES (?)", period);

    // Duplication des lignes du template (ordre conservé, origine tracée)
    // Seules les lignes dont le cycle tombe sur ce mois sont copiées (mensuelles : toujours)
    const templateLines = all("SELECT * FROM budget_lines WHERE month_id IS NULL ORDER BY sort_order, id")
      .filter((line) => budgetLines.cycleMatches(line, period));
    const newIdByTemplateId = {};
    for (const line of templateLines) {
      const { lastInsertRowid } = run(
        `INSERT INTO budget_lines
          (month_id, template_line_id, label, category_id, theme_id, planned_amount_cents,
           from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes,
           is_pot, pot_partner_name, pot_partner_paid_cents, pot_my_share,
           interval_months, anchor_month, envelope_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        monthId, line.id, line.label, line.category_id, line.theme_id,
        line.planned_amount_cents, line.from_account_id, line.to_account_id,
        line.payment_method, line.is_shared, line.recurring_day, line.sort_order, line.notes,
        line.is_pot, line.pot_partner_name, line.pot_partner_paid_cents, line.pot_my_share,
        line.interval_months || 1, line.anchor_month, line.envelope_id
      );
      newIdByTemplateId[line.id] = Number(lastInsertRowid);
    }
    // Rattachement ½ → cagnotte : on pointe vers la COPIE de la cagnotte dans ce mois
    for (const line of templateLines) {
      if (line.pot_line_id && newIdByTemplateId[line.pot_line_id]) {
        run("UPDATE budget_lines SET pot_line_id = ? WHERE id = ?", newIdByTemplateId[line.pot_line_id], newIdByTemplateId[line.id]);
      }
    }

    for (const s of snapshots) {
      if (s.balance === null || s.balance === undefined || s.balance === "") continue;
      run(
        "INSERT INTO account_snapshots (month_id, account_id, balance_cents) VALUES (?, ?, ?)",
        monthId, s.accountId, toCents(s.balance)
      );
    }

    // Recalage des enveloppes : l'écart entre le cumul et le montant réel saisi devient
    // une contribution « ajustement » datée du 1er du mois (historique conservé)
    for (const e of envelopes) {
      if (e.total === null || e.total === undefined || e.total === "") continue;
      const env = get("SELECT * FROM envelopes WHERE id = ? AND closed_at IS NULL", e.envelopeId);
      if (!env) continue;
      const current = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM envelope_contributions WHERE envelope_id = ?", env.id).s;
      const delta = toCents(e.total) - current;
      if (delta === 0) continue;
      run(
        "INSERT INTO envelope_contributions (envelope_id, amount_cents, date, kind, notes) VALUES (?, ?, ?, 'ajustement', ?)",
        env.id, delta, `${period}-01`, e.notes || `Recalage à la création de ${formatPeriodName(period)}`
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
