import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";

// Une saisie datée dans un mois clôturé est refusée
function assertPeriodOpen(date) {
  const month = get("SELECT * FROM months WHERE period = ?", String(date).substring(0, 7));
  if (month?.closed_at) throw httpError(409, `La date ${String(date).substring(0, 10)} tombe dans ${month.period}, un mois clôturé : changez la date, ou rouvrez ce mois pour y saisir`);
}

const mainAccountId = () => get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;

// ─── Actifs ──────────────────────────────────────────────
function serialize(row) {
  const invested = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM asset_movements WHERE asset_id = ? AND kind = 'versement'", row.id).s;
  const withdrawn = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM asset_movements WHERE asset_id = ? AND kind = 'retrait'", row.id).s;
  const last = get("SELECT * FROM asset_valuations WHERE asset_id = ? ORDER BY date DESC, id DESC LIMIT 1", row.id);
  const value = last ? last.value_cents : null;
  // Performance = (valeur + retiré − investi) / investi — un retrait n'est pas une perte
  const gain = value !== null && invested > 0 ? value + withdrawn - invested : null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    accountId: row.account_id,
    accountName: row.account_name ?? null,
    monthlyDca: fromCents(row.monthly_dca_cents),
    isClosed: !!row.closed_at,
    invested: fromCents(invested),
    withdrawn: fromCents(withdrawn),
    value: fromCents(value),
    valuationDate: last?.date ?? null,
    gain: fromCents(gain),
    gainPct: gain !== null ? Math.round((gain / invested) * 10000) / 100 : null,
  };
}

const LIST_SQL = "SELECT a.*, acc.name AS account_name FROM assets a LEFT JOIN accounts acc ON acc.id = a.account_id";

export function list() {
  return all(`${LIST_SQL} ORDER BY a.closed_at IS NOT NULL, a.name COLLATE NOCASE`).map(serialize);
}

export function getById(id) {
  const row = get(`${LIST_SQL} WHERE a.id = ?`, id);
  if (!row) throw httpError(404, "Actif introuvable");
  return serialize(row);
}

export function create({ name, type = null, accountId = null, monthlyDca = 0 }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom de l'actif est requis");
  const { lastInsertRowid: id } = run(
    "INSERT INTO assets (name, type, account_id, monthly_dca_cents) VALUES (?, ?, ?, ?)",
    name, type || null, accountId || null, toCents(monthlyDca) ?? 0
  );
  return getById(Number(id));
}

export function update(id, data) {
  const existing = get("SELECT * FROM assets WHERE id = ?", id);
  if (!existing) throw httpError(404, "Actif introuvable");
  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name) throw httpError(400, "Le nom de l'actif est requis");
  const closedAt = data.isClosed !== undefined
    ? (data.isClosed ? (existing.closed_at || new Date().toISOString()) : null)
    : existing.closed_at;
  run(
    "UPDATE assets SET name = ?, type = ?, account_id = ?, monthly_dca_cents = ?, closed_at = ? WHERE id = ?",
    name,
    data.type !== undefined ? (data.type || null) : existing.type,
    data.accountId !== undefined ? (data.accountId || null) : existing.account_id,
    data.monthlyDca !== undefined ? (toCents(data.monthlyDca) ?? 0) : existing.monthly_dca_cents,
    closedAt, id
  );
  return getById(id);
}

export function remove(id) {
  if (!get("SELECT id FROM assets WHERE id = ?", id)) throw httpError(404, "Actif introuvable");
  const n = get("SELECT COUNT(*) AS n FROM asset_movements WHERE asset_id = ?", id).n;
  if (n > 0) throw httpError(409, `Cet actif a ${n} mouvement(s). Clôturez-le pour garder l'historique.`);
  run("DELETE FROM assets WHERE id = ?", id);
  return { message: "Actif supprimé" };
}

// ─── Mouvements ──────────────────────────────────────────
function serializeMovement(m) {
  return {
    id: m.id,
    assetId: m.asset_id,
    assetName: m.asset_name ?? null,
    kind: m.kind,
    amount: fromCents(m.amount_cents),
    date: m.date,
    counterpartAccountId: m.counterpart_account_id,
    counterpartAccountName: m.counterpart_account_name ?? null,
    source: m.source,
    notes: m.notes,
  };
}

const MOVEMENT_SQL = `
  SELECT m.*, a.name AS asset_name, acc.name AS counterpart_account_name
  FROM asset_movements m
  JOIN assets a ON a.id = m.asset_id
  LEFT JOIN accounts acc ON acc.id = m.counterpart_account_id`;

export function listMovements(assetId) {
  return all(`${MOVEMENT_SQL} WHERE m.asset_id = ? ORDER BY m.date DESC, m.id DESC`, assetId).map(serializeMovement);
}

export function listMovementsByPeriod(period) {
  const start = `${period}-01`;
  return all(`${MOVEMENT_SQL} WHERE m.date >= ? AND m.date < date(?, '+1 month') ORDER BY m.date DESC, m.id DESC`, start, start)
    .map(serializeMovement);
}

export function addMovement(assetId, { kind = "versement", amount, date = null, counterpartAccountId = null, notes = null, source = "manuelle" }) {
  const asset = get("SELECT * FROM assets WHERE id = ?", assetId);
  if (!asset) throw httpError(404, "Actif introuvable");
  if (asset.closed_at) throw httpError(409, "Actif clôturé");
  if (!["versement", "retrait"].includes(kind)) throw httpError(400, "Type de mouvement invalide");
  const cents = toCents(amount);
  if (!cents || cents < 0) throw httpError(400, "Montant requis (positif)");
  const d = date || new Date().toISOString().substring(0, 10);
  assertPeriodOpen(d);
  run(
    "INSERT INTO asset_movements (asset_id, kind, amount_cents, date, counterpart_account_id, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    assetId, kind, cents, d, counterpartAccountId || mainAccountId(), source, notes
  );
  return getById(assetId);
}

export function removeMovement(assetId, movementId) {
  const m = get("SELECT * FROM asset_movements WHERE id = ? AND asset_id = ?", movementId, assetId);
  if (!m) throw httpError(404, "Mouvement introuvable");
  assertPeriodOpen(m.date);
  run("DELETE FROM asset_movements WHERE id = ?", movementId);
  return getById(assetId);
}

// ☐ versé : le DCA du mois, une seule fois par mois
export function dca(monthId, assetId) {
  const month = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!month) throw httpError(404, "Mois introuvable");
  if (month.closed_at) throw httpError(409, `${month.period} est clôturé`);
  const asset = get("SELECT * FROM assets WHERE id = ?", assetId);
  if (!asset) throw httpError(404, "Actif introuvable");
  if (!asset.monthly_dca_cents) throw httpError(400, "Aucun versement mensuel prévu sur cet actif");
  const start = `${month.period}-01`;
  const existing = get(
    "SELECT id FROM asset_movements WHERE asset_id = ? AND source = 'dca' AND date >= ? AND date < date(?, '+1 month')",
    assetId, start, start
  );
  if (existing) throw httpError(409, "DCA déjà versé ce mois");
  const today = new Date().toISOString().substring(0, 10);
  const date = today.startsWith(month.period) ? today : start;
  return addMovement(assetId, { kind: "versement", amount: fromCents(asset.monthly_dca_cents), date, source: "dca" });
}

export function undca(monthId, assetId) {
  const month = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!month) throw httpError(404, "Mois introuvable");
  const start = `${month.period}-01`;
  const existing = get(
    "SELECT id FROM asset_movements WHERE asset_id = ? AND source = 'dca' AND date >= ? AND date < date(?, '+1 month')",
    assetId, start, start
  );
  if (!existing) throw httpError(404, "Aucun DCA versé ce mois");
  return removeMovement(assetId, existing.id);
}

// ─── Valorisations ───────────────────────────────────────
export function listValuations(assetId) {
  return all("SELECT * FROM asset_valuations WHERE asset_id = ? ORDER BY date DESC, id DESC", assetId)
    .map((v) => ({ id: v.id, date: v.date, value: fromCents(v.value_cents) }));
}

export function addValuation(assetId, { value, date = null }) {
  if (!get("SELECT id FROM assets WHERE id = ?", assetId)) throw httpError(404, "Actif introuvable");
  const cents = toCents(value);
  if (cents === null || cents < 0) throw httpError(400, "Valeur requise");
  run("INSERT INTO asset_valuations (asset_id, date, value_cents) VALUES (?, COALESCE(?, date('now')), ?)", assetId, date, cents);
  return getById(assetId);
}

export function removeValuation(assetId, valuationId) {
  const v = get("SELECT * FROM asset_valuations WHERE id = ? AND asset_id = ?", valuationId, assetId);
  if (!v) throw httpError(404, "Valorisation introuvable");
  run("DELETE FROM asset_valuations WHERE id = ?", valuationId);
  return getById(assetId);
}
