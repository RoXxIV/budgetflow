import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    accountId: row.account_id,
    accountName: row.account_name ?? null,
    targetAmount: fromCents(row.target_amount_cents),
    deadline: row.deadline,
    total: fromCents(row.total_cents ?? 0),
    isClosed: !!row.closed_at,
    createdAt: row.created_at,
  };
}

const LIST_SQL = `
  SELECT e.*, a.name AS account_name,
    COALESCE((SELECT SUM(c.amount_cents) FROM envelope_contributions c WHERE c.envelope_id = e.id), 0) AS total_cents
  FROM envelopes e
  LEFT JOIN accounts a ON a.id = e.account_id
`;

export function list() {
  return all(`${LIST_SQL} ORDER BY e.closed_at IS NOT NULL, e.name`).map(serialize);
}

export function getById(id) {
  const row = get(`${LIST_SQL} WHERE e.id = ?`, id);
  if (!row) throw httpError(404, "Enveloppe introuvable");
  return serialize(row);
}

export function create({ name, accountId = null, targetAmount = null, deadline = null, initialAmount = null }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom de l'enveloppe est requis");

  return tx(() => {
    const { lastInsertRowid: id } = run(
      "INSERT INTO envelopes (name, account_id, target_amount_cents, deadline) VALUES (?, ?, ?, ?)",
      name, accountId, toCents(targetAmount), deadline || null
    );
    const cents = toCents(initialAmount);
    if (cents) {
      run(
        "INSERT INTO envelope_contributions (envelope_id, amount_cents, kind, notes) VALUES (?, ?, 'initiale', ?)",
        id, cents, "Montant initial"
      );
    }
    return getById(Number(id));
  });
}

export function update(id, data) {
  const existing = get("SELECT * FROM envelopes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Enveloppe introuvable");

  return tx(() => {
    const name = data.name !== undefined ? String(data.name).trim() : existing.name;
    if (!name) throw httpError(400, "Le nom de l'enveloppe est requis");
    const accountId = data.accountId !== undefined ? data.accountId : existing.account_id;
    const target = data.targetAmount !== undefined ? toCents(data.targetAmount) : existing.target_amount_cents;
    const deadline = data.deadline !== undefined ? (data.deadline || null) : existing.deadline;
    const closedAt = data.isClosed !== undefined
      ? (data.isClosed ? (existing.closed_at || new Date().toISOString()) : null)
      : existing.closed_at;

    run("UPDATE envelopes SET name = ?, account_id = ?, target_amount_cents = ?, deadline = ?, closed_at = ? WHERE id = ?",
      name, accountId, target, deadline, closedAt, id);

    // Renommage synchronisé inverse : l'enveloppe est seule sur son compte et portait son nom
    if (name !== existing.name && existing.account_id) {
      const account = get("SELECT * FROM accounts WHERE id = ?", existing.account_id);
      const siblings = get("SELECT COUNT(*) AS n FROM envelopes WHERE account_id = ? AND closed_at IS NULL", existing.account_id).n;
      if (account && siblings === 1 && account.name === existing.name) {
        run("UPDATE accounts SET name = ? WHERE id = ?", name, account.id);
      }
    }
    return getById(id);
  });
}

export function remove(id) {
  const existing = get("SELECT * FROM envelopes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Enveloppe introuvable");
  const n = get("SELECT COUNT(*) AS n FROM envelope_contributions WHERE envelope_id = ?", id).n;
  if (n > 0) {
    throw httpError(409, `Cette enveloppe a ${n} contribution(s). Clôturez-la pour garder l'historique, ou supprimez ses contributions d'abord.`);
  }
  run("DELETE FROM envelopes WHERE id = ?", id);
  return { message: "Enveloppe supprimée" };
}

// ─── Contributions ────────────────────────────────────────
export function listContributions(envelopeId) {
  return all(
    `SELECT c.*, a.name AS from_account_name FROM envelope_contributions c
     LEFT JOIN accounts a ON a.id = c.from_account_id
     WHERE c.envelope_id = ? ORDER BY c.date DESC, c.id DESC`, envelopeId
  ).map((c) => ({
    id: c.id,
    envelopeId: c.envelope_id,
    amount: fromCents(c.amount_cents),
    date: c.date,
    kind: c.kind,
    fromAccountId: c.from_account_id,
    fromAccountName: c.from_account_name ?? null,
    notes: c.notes,
  }));
}

export function addContribution(envelopeId, { amount, date = null, kind = "normale", fromAccountId = null, notes = null }) {
  const envelope = get("SELECT * FROM envelopes WHERE id = ?", envelopeId);
  if (!envelope) throw httpError(404, "Enveloppe introuvable");
  if (envelope.closed_at) throw httpError(409, "Enveloppe clôturée");
  const cents = toCents(amount);
  if (!cents) throw httpError(400, "Montant requis");
  run(
    "INSERT INTO envelope_contributions (envelope_id, amount_cents, date, kind, from_account_id, notes) VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?)",
    envelopeId, cents, date, kind, fromAccountId, notes
  );
  return getById(envelopeId);
}

export function removeContribution(envelopeId, contributionId) {
  const c = get("SELECT * FROM envelope_contributions WHERE id = ? AND envelope_id = ?", contributionId, envelopeId);
  if (!c) throw httpError(404, "Contribution introuvable");
  run("DELETE FROM envelope_contributions WHERE id = ?", contributionId);
  return getById(envelopeId);
}
