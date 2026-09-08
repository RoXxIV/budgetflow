// Les investissements : ce qu'on y a mis, ce que ça vaut, ce que ça a rapporté.
//
// TROIS TABLES, TROIS NATURES DE FAITS. Un `asset` est le placement lui-même ; les
// `asset_movements` sont les versements et retraits, des faits certains ; les
// `asset_valuations` sont ce que le placement valait à une date, une observation qu'on
// relève de temps en temps.
//
// LA VALEUR EST « VIVANTE ». On ne demande pas de revaloriser après chaque versement :
// la dernière valorisation sert d'ANCRAGE, ajusté des mouvements postérieurs à sa date.
// Sans cet ajustement, verser 200 € après la dernière valorisation ferait apparaître
// une moins-value de 200 € qui n'existe pas.
//
// UN RETRAIT N'EST PAS UNE PERTE. D'où la performance : (valeur + retiré − investi).
// Retirer 1 000 € d'un placement n'appauvrit personne, l'argent a juste changé d'endroit.

import { all, get, run, toCents, fromCents, httpError } from "../db/index.js";

// Une saisie datée dans un mois clôturé est refusée
function assertPeriodOpen(date) {
  const month = get("SELECT * FROM months WHERE period = ?", String(date).substring(0, 7));
  if (month?.closed_at) throw httpError(409, `La date ${String(date).substring(0, 10)} tombe dans ${month.period}, un mois clôturé : changez la date, ou rouvrez ce mois pour y saisir`);
}

const mainAccountId = () => get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;

// ─── Actifs ──────────────────────────────────────────────

/**
 * Met un actif en forme, avec sa valeur vivante et sa performance.
 *
 * `value` reste null tant qu'aucune valorisation n'a été saisie : on connaît alors
 * l'investi, pas ce que ça vaut, et afficher l'un pour l'autre serait mentir.
 *
 * @param {object} row La ligne `assets`.
 * @returns {object} L'actif exposé par l'API.
 */
function serialize(row) {
  const invested = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM asset_movements WHERE asset_id = ? AND kind = 'versement'", row.id).s;
  const withdrawn = get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM asset_movements WHERE asset_id = ? AND kind = 'retrait'", row.id).s;
  const last = get("SELECT * FROM asset_valuations WHERE asset_id = ? ORDER BY date DESC, id DESC LIMIT 1", row.id);
  // Valeur vivante : la dernière valorisation saisie est le point d'ancrage, ajusté des
  // versements et retraits STRICTEMENT postérieurs à sa date (un versement d'hier n'est
  // pas une moins-value). Ressaisir une valorisation remplace l'ancrage ; une valorisation
  // datée du jour d'un mouvement est présumée le refléter déjà.
  let value = last ? last.value_cents : null;
  if (last) {
    value += get(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'versement' THEN amount_cents ELSE -amount_cents END), 0) AS s
       FROM asset_movements WHERE asset_id = ? AND date > ?`, row.id, last.date
    ).s;
  }
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

// Tous les actifs, les ouverts d'abord, par ordre alphabétique insensible à la casse
export function list() {
  return all(`${LIST_SQL} ORDER BY a.closed_at IS NOT NULL, a.name COLLATE NOCASE`).map(serialize);
}

export function getById(id) {
  const row = get(`${LIST_SQL} WHERE a.id = ?`, id);
  if (!row) throw httpError(404, "Actif introuvable");
  return serialize(row);
}

// Crée un actif. `monthlyDca` est le versement programmé : il alimentera le ☐ versé
// et la ligne « à venir » du reste à vivre.
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

// Suppression réservée à un actif sans mouvement : sinon la clôture, qui garde tout
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

/**
 * Enregistre un versement ou un retrait.
 *
 * Le compte de contrepartie est celui d'où vient (ou où va) l'argent : c'est lui qui
 * fait bouger les soldes dans le bilan du mois. À défaut, le compte principal — un
 * mouvement sans contrepartie ne déplacerait rien et laisserait le bilan faux.
 *
 * @param {number} assetId L'actif.
 * @param {object} params `{ kind, amount, date, counterpartAccountId, notes, source }`.
 * @returns {object} L'actif à jour.
 */
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

/**
 * ☐ versé : le DCA du mois, une seule fois par mois.
 *
 * N'IMPORTE QUEL mouvement du mois bloque la case, pas seulement un DCA précédent :
 * c'est la même règle que le ☐ payé des lignes — le réel remplace le prévu. Evan
 * arrondit souvent son versement à la main (155 € au lieu de 150 €) ; laisser la case
 * en rajouter ferait compter l'argent deux fois.
 *
 * @param {number} monthId Le mois, ouvert.
 * @param {number} assetId L'actif, qui doit avoir un DCA défini.
 * @returns {object} L'actif à jour.
 */
export function dca(monthId, assetId) {
  const month = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!month) throw httpError(404, "Mois introuvable");
  if (month.closed_at) throw httpError(409, `${month.period} est clôturé`);
  const asset = get("SELECT * FROM assets WHERE id = ?", assetId);
  if (!asset) throw httpError(404, "Actif introuvable");
  if (!asset.monthly_dca_cents) throw httpError(400, "Aucun versement mensuel prévu sur cet actif");
  const start = `${month.period}-01`;
  // Même règle que le ☐ payé des lignes : dès qu'un mouvement existe ce mois-ci
  // (DCA ou versement manuel), le réel remplace le prévu — pas de second versement par la case
  const existing = get(
    "SELECT id, source FROM asset_movements WHERE asset_id = ? AND date >= ? AND date < date(?, '+1 month')",
    assetId, start, start
  );
  if (existing) {
    throw httpError(409, existing.source === "dca"
      ? "DCA déjà versé ce mois"
      : "Cet actif a déjà un mouvement ce mois-ci : le réel remplace le versement prévu");
  }
  const today = new Date().toISOString().substring(0, 10);
  const date = today.startsWith(month.period) ? today : start;
  return addMovement(assetId, { kind: "versement", amount: fromCents(asset.monthly_dca_cents), date, source: "dca" });
}

// Décocher : ne retire que le mouvement créé par la case, jamais une saisie manuelle
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

// Pose un nouvel ancrage de valeur. Ressaisir à la même date remplace l'ancrage :
// les mouvements du jour sont présumés déjà reflétés dans le chiffre relevé.
export function addValuation(assetId, { value, date = null }) {
  if (!get("SELECT id FROM assets WHERE id = ?", assetId)) throw httpError(404, "Actif introuvable");
  const cents = toCents(value);
  if (cents === null || cents < 0) throw httpError(400, "Valeur requise");
  // Même garde que les mouvements : une valorisation change la valeur d'actif et le patrimoine,
  // elle ne se pose pas dans un mois clôturé (revue du 04/09)
  assertPeriodOpen(date ?? new Date().toISOString().substring(0, 10));
  run("INSERT INTO asset_valuations (asset_id, date, value_cents) VALUES (?, COALESCE(?, date('now')), ?)", assetId, date, cents);
  return getById(assetId);
}

export function removeValuation(assetId, valuationId) {
  const v = get("SELECT * FROM asset_valuations WHERE id = ? AND asset_id = ?", valuationId, assetId);
  if (!v) throw httpError(404, "Valorisation introuvable");
  assertPeriodOpen(v.date);
  run("DELETE FROM asset_valuations WHERE id = ?", valuationId);
  return getById(assetId);
}
