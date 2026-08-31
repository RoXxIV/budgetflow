import { all, get, run, toCents, fromCents, httpError } from "../db/index.js";
import { assertOpen } from "./month.service.js";

function serialize(row) {
  return {
    id: row.id,
    monthId: row.month_id,
    lineId: row.line_id,
    label: row.label,
    amount: fromCents(row.amount_cents),
    date: row.date,
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    paymentMethod: row.payment_method,
    themeId: row.theme_id,
    isShared: !!row.is_shared,
    source: row.source,
    notes: row.notes,
  };
}

export function listByMonth(monthId) {
  return all("SELECT * FROM entries WHERE month_id = ? ORDER BY date, id", monthId).map(serialize);
}

export function create(monthId, data) {
  assertOpen(monthId);
  const cents = toCents(data.amount);
  if (!cents) throw httpError(400, "Montant requis");
  if (data.lineId) {
    const line = get("SELECT * FROM budget_lines WHERE id = ? AND month_id = ?", data.lineId, monthId);
    if (!line) throw httpError(400, "Ligne inconnue sur ce mois");
  }
  const { lastInsertRowid: id } = run(
    `INSERT INTO entries (month_id, line_id, label, amount_cents, date, account_id, to_account_id, payment_method, theme_id, is_shared, source, notes)
     VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?)`,
    monthId, data.lineId ?? null, data.label ?? null, cents, data.date ?? null,
    data.accountId ?? null, data.toAccountId ?? null, data.paymentMethod ?? null, data.themeId ?? null,
    data.isShared ? 1 : 0, data.source ?? "manuelle", data.notes ?? null
  );
  return serialize(get("SELECT * FROM entries WHERE id = ?", id));
}

export function update(id, data) {
  const existing = get("SELECT * FROM entries WHERE id = ?", id);
  if (!existing) throw httpError(404, "Entrée introuvable");
  assertOpen(existing.month_id);

  const val = (key, dbKey, transform = (v) => v) =>
    data[key] !== undefined ? transform(data[key]) : existing[dbKey];
  const cents = data.amount !== undefined ? toCents(data.amount) : existing.amount_cents;
  if (!cents) throw httpError(400, "Montant requis");

  run(
    `UPDATE entries SET label = ?, amount_cents = ?, date = ?, account_id = ?, to_account_id = ?,
       payment_method = ?, theme_id = ?, is_shared = ?, notes = ? WHERE id = ?`,
    val("label", "label"), cents, val("date", "date"),
    val("accountId", "account_id"), val("toAccountId", "to_account_id"),
    val("paymentMethod", "payment_method"),
    val("themeId", "theme_id"), val("isShared", "is_shared", (v) => (v ? 1 : 0)),
    val("notes", "notes"), id
  );
  return serialize(get("SELECT * FROM entries WHERE id = ?", id));
}

export function remove(id) {
  const existing = get("SELECT * FROM entries WHERE id = ?", id);
  if (!existing) throw httpError(404, "Entrée introuvable");
  assertOpen(existing.month_id);
  run("DELETE FROM entries WHERE id = ?", id);
  return { message: "Entrée supprimée" };
}

// ─── ☐ payé : crée l'entrée au prévu, à la date du jour récurrent ───
export function pay(monthId, lineId) {
  const month = assertOpen(monthId);
  const line = get("SELECT * FROM budget_lines WHERE id = ? AND month_id = ?", lineId, monthId);
  if (!line) throw httpError(404, "Ligne introuvable sur ce mois");
  if (line.kind !== "fixe") throw httpError(400, "Seule une ligne fixe se marque « payée »");
  if (!line.planned_amount_cents) throw httpError(400, "Le montant prévu de la ligne est vide");

  const existing = get("SELECT id FROM entries WHERE line_id = ? AND source = 'paye'", lineId);
  if (existing) throw httpError(409, "Déjà marquée payée");

  const day = line.recurring_day
    ? `${month.period}-${String(line.recurring_day).padStart(2, "0")}`
    : null;

  return create(monthId, {
    lineId,
    amount: fromCents(line.planned_amount_cents),
    date: day,
    accountId: line.from_account_id ?? line.to_account_id ?? null,
    toAccountId: line.from_account_id ? line.to_account_id : null, // les deux si la ligne est un mouvement entre comptes
    paymentMethod: line.payment_method,
    themeId: line.theme_id,
    isShared: !!line.is_shared,
    source: "paye",
  });
}

// Décocher : ne retire que l'entrée créée par « payé » (jamais les saisies manuelles)
export function unpay(monthId, lineId) {
  assertOpen(monthId);
  const entry = get("SELECT * FROM entries WHERE line_id = ? AND source = 'paye'", lineId);
  if (!entry) throw httpError(404, "Aucune entrée « payé » sur cette ligne");
  run("DELETE FROM entries WHERE id = ?", entry.id);
  return { message: "Marquage payé retiré" };
}
