import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";

// ─── Périodicité : « tous les N mois », ancrée sur un mois ───
const monthIndex = (period) => { const [y, m] = period.split("-").map(Number); return y * 12 + (m - 1); };
const periodOf = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;

// La ligne tombe-t-elle sur ce mois ('YYYY-MM') ?
export function cycleMatches(line, period) {
  const interval = line.interval_months || 1;
  if (interval <= 1 || !line.anchor_month) return true;
  const [, m] = period.split("-").map(Number);
  return (((m - line.anchor_month) % interval) + interval) % interval === 0;
}

// Prochaine occurrence (date ISO) à partir d'un mois donné inclus
export function nextDueDate(line, fromPeriod) {
  const interval = line.interval_months || 1;
  const day = String(line.recurring_day || 1).padStart(2, "0");
  let idx = monthIndex(fromPeriod);
  for (let i = 0; i < 24; i++) {
    const p = periodOf(idx + i);
    if (cycleMatches(line, p)) return `${p}-${day}`;
  }
  return null;
}
const currentPeriod = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; };

// Sérialisation commune des lignes budgétaires (template et mois)
export function serialize(row) {
  return {
    intervalMonths: row.interval_months || 1,
    anchorMonth: row.anchor_month,
    envelopeId: row.envelope_id,     // mensualisée : enveloppe liée
    nextDue: row.month_id === null && (row.interval_months || 1) > 1 ? nextDueDate(row, currentPeriod()) : null,
    id: row.id,
    monthId: row.month_id,
    templateLineId: row.template_line_id,
    label: row.label,
    categoryId: row.category_id,
    themeId: row.theme_id,
    plannedAmount: fromCents(row.planned_amount_cents),
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    paymentMethod: row.payment_method,
    isShared: !!row.is_shared,
    recurringDay: row.recurring_day,
    sortOrder: row.sort_order,
    notes: row.notes,
    // Cagnotte (partage) : le prévu est calculé à partir des ½ rattachés
    isPot: !!row.is_pot,
    potPartnerName: row.pot_partner_name,
    potPartnerPaid: fromCents(row.pot_partner_paid_cents ?? 0),
    potMyShare: row.pot_my_share ?? 50,
    potLineId: row.pot_line_id, // cagnotte par défaut des ½ de cette ligne
  };
}

// monthId === null → lignes du template
export function listByMonth(monthId) {
  const rows = monthId === null
    ? all("SELECT * FROM budget_lines WHERE month_id IS NULL ORDER BY sort_order, id")
    : all("SELECT * FROM budget_lines WHERE month_id = ? ORDER BY sort_order, id", monthId);
  return rows.map(serialize);
}

export function getById(id) {
  const row = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!row) throw httpError(404, "Ligne introuvable");
  return serialize(row);
}

export function create(monthId, data) {
  const label = (data.label || "").trim();
  if (!label) throw httpError(400, "Le libellé de la ligne est requis");
  if (data.fromAccountId && data.toAccountId && data.fromAccountId === data.toAccountId) {
    throw httpError(400, "Depuis et Vers sont le même compte : un virement doit en changer (ou laissez Vers sur « extérieur »)");
  }
  const interval = Math.max(1, Number(data.intervalMonths) || 1);
  const anchor = interval > 1 ? (Number(data.anchorMonth) || null) : null;
  if (interval > 1 && !anchor) throw httpError(400, "Indiquez le mois d'ancrage pour une ligne non mensuelle");

  const scope = monthId === null ? "month_id IS NULL" : "month_id = ?";
  const max = monthId === null
    ? get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_lines WHERE ${scope}`).m
    : get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_lines WHERE ${scope}`, monthId).m;

  const { lastInsertRowid: id } = run(
    `INSERT INTO budget_lines
      (month_id, template_line_id, label, category_id, theme_id, planned_amount_cents,
       from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes,
       is_pot, pot_partner_name, pot_partner_paid_cents, pot_my_share, pot_line_id,
       interval_months, anchor_month)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    monthId, data.templateLineId ?? null, label,
    data.categoryId ?? null, data.themeId ?? null,
    data.isPot ? 0 : (toCents(data.plannedAmount) ?? 0),
    data.fromAccountId ?? null, data.toAccountId ?? null,
    data.paymentMethod ?? null, data.isShared ? 1 : 0,
    data.recurringDay ?? null, max + 1, data.notes ?? null,
    data.isPot ? 1 : 0, data.potPartnerName ?? null, toCents(data.potPartnerPaid) ?? 0,
    data.potMyShare ?? 50, data.potLineId ?? null,
    interval, anchor
  );
  return getById(Number(id));
}

export function update(id, data) {
  const existing = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!existing) throw httpError(404, "Ligne introuvable");

  const label = data.label !== undefined ? String(data.label).trim() : existing.label;
  if (!label) throw httpError(400, "Le libellé de la ligne est requis");
  const fromAcc = data.fromAccountId !== undefined ? (data.fromAccountId || null) : existing.from_account_id;
  const toAcc = data.toAccountId !== undefined ? (data.toAccountId || null) : existing.to_account_id;
  if (fromAcc && toAcc && fromAcc === toAcc) {
    throw httpError(400, "Depuis et Vers sont le même compte : un virement doit en changer (ou laissez Vers sur « extérieur »)");
  }

  const val = (key, dbKey, transform = (v) => v) =>
    data[key] !== undefined ? transform(data[key]) : existing[dbKey];

  const isPot = data.isPot !== undefined ? (data.isPot ? 1 : 0) : existing.is_pot;
  const interval = data.intervalMonths !== undefined ? Math.max(1, Number(data.intervalMonths) || 1) : (existing.interval_months || 1);
  const anchor = interval > 1
    ? (data.anchorMonth !== undefined ? (Number(data.anchorMonth) || null) : existing.anchor_month)
    : null;
  if (interval > 1 && !anchor) throw httpError(400, "Indiquez le mois d'ancrage pour une ligne non mensuelle");
  run(
    `UPDATE budget_lines SET label = ?, category_id = ?, theme_id = ?,
       planned_amount_cents = ?, from_account_id = ?, to_account_id = ?, payment_method = ?,
       is_shared = ?, recurring_day = ?, notes = ?,
       is_pot = ?, pot_partner_name = ?, pot_partner_paid_cents = ?, pot_my_share = ?, pot_line_id = ?,
       interval_months = ?, anchor_month = ?
     WHERE id = ?`,
    label,
    val("categoryId", "category_id"),
    val("themeId", "theme_id"),
    isPot ? 0 : val("plannedAmount", "planned_amount_cents", toCents),
    val("fromAccountId", "from_account_id"),
    val("toAccountId", "to_account_id"),
    val("paymentMethod", "payment_method"),
    val("isShared", "is_shared", (v) => (v ? 1 : 0)),
    val("recurringDay", "recurring_day"),
    val("notes", "notes"),
    isPot,
    val("potPartnerName", "pot_partner_name"),
    val("potPartnerPaid", "pot_partner_paid_cents", (v) => toCents(v) ?? 0),
    val("potMyShare", "pot_my_share"),
    val("potLineId", "pot_line_id"),
    interval, anchor,
    id
  );
  // Ligne mensualisée : la cible et l'échéance de l'enveloppe suivent la ligne
  const updated = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (updated.month_id === null && updated.envelope_id) {
    run("UPDATE envelopes SET name = ?, target_amount_cents = ?, deadline = ? WHERE id = ?",
      updated.label, updated.planned_amount_cents, nextDueDate(updated, currentPeriod()), updated.envelope_id);
  }
  return getById(id);
}

// ─── Mensualisation : enveloppe liée à une ligne non mensuelle du template ───
// enabled → crée l'enveloppe (nom = libellé, cible = prévu, échéance = prochaine occurrence) sur le compte choisi
// (aucun = virtuelle sur le compte principal) ; disabled → délie (l'enveloppe reste, à clôturer si vide).
export function setMonthlyized(lineId, { enabled, accountId = null }) {
  const line = get("SELECT * FROM budget_lines WHERE id = ? AND month_id IS NULL", lineId);
  if (!line) throw httpError(404, "Ligne du template introuvable");
  if (enabled) {
    if ((line.interval_months || 1) <= 1) throw httpError(400, "Une ligne mensuelle n'a pas besoin d'être mensualisée");
    if (line.envelope_id && get("SELECT id FROM envelopes WHERE id = ?", line.envelope_id)) return getById(lineId);
    const mainId = get("SELECT id FROM accounts WHERE is_main = 1 LIMIT 1")?.id ?? null;
    const { lastInsertRowid } = run(
      "INSERT INTO envelopes (name, account_id, target_amount_cents, deadline) VALUES (?, ?, ?, ?)",
      line.label, accountId || mainId, line.planned_amount_cents, nextDueDate(line, currentPeriod())
    );
    run("UPDATE budget_lines SET envelope_id = ? WHERE id = ?", Number(lastInsertRowid), lineId);
  } else if (line.envelope_id) {
    run("UPDATE budget_lines SET envelope_id = NULL WHERE id = ?", lineId);
    // Les copies des mois ouverts suivent
    run("UPDATE budget_lines SET envelope_id = NULL WHERE template_line_id = ?", lineId);
  }
  return getById(lineId);
}

// orders = [{ id, order }]
export function reorder(orders) {
  tx(() => {
    for (const { id, order } of orders) {
      run("UPDATE budget_lines SET sort_order = ? WHERE id = ?", order, id);
    }
  });
}

export function remove(id, { force = false } = {}) {
  const existing = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!existing) throw httpError(404, "Ligne introuvable");
  const entryCount = get("SELECT COUNT(*) AS n FROM entries WHERE line_id = ?", id).n;
  if (entryCount > 0 && !force) {
    throw httpError(409, `Cette ligne a ${entryCount} entrée(s) qui seront supprimées avec elle.`);
  }
  run("DELETE FROM budget_lines WHERE id = ?", id); // les entrées suivent (CASCADE)
  return { message: "Ligne supprimée" };
}

// « Appliquer au mois » : la ligne du template est copiée dans un mois (ou sa copie mise à jour).
// Le réel du mois n'est jamais touché ; seule la définition de la ligne est propagée.
export function applyToMonth(templateLineId, monthId) {
  const tpl = get("SELECT * FROM budget_lines WHERE id = ? AND month_id IS NULL", templateLineId);
  if (!tpl) throw httpError(404, "Ligne du template introuvable");
  const month = get("SELECT * FROM months WHERE id = ?", monthId);
  if (!month) throw httpError(404, "Mois introuvable");
  if (month.closed_at) throw httpError(409, "Ce mois est clôturé");

  // Cagnotte par défaut des ½ : on vise la copie de la cagnotte dans ce mois, si elle existe
  const potCopy = tpl.pot_line_id
    ? get("SELECT id FROM budget_lines WHERE month_id = ? AND template_line_id = ?", monthId, tpl.pot_line_id)?.id ?? null
    : null;

  const copy = get("SELECT * FROM budget_lines WHERE month_id = ? AND template_line_id = ?", monthId, tpl.id);
  if (copy) {
    run(
      `UPDATE budget_lines SET label = ?, category_id = ?, theme_id = ?, planned_amount_cents = ?,
         from_account_id = ?, to_account_id = ?, payment_method = ?, is_shared = ?, recurring_day = ?,
         is_pot = ?, pot_partner_name = ?, pot_partner_paid_cents = ?, pot_my_share = ?, pot_line_id = ?,
         interval_months = ?, anchor_month = ?, envelope_id = ? WHERE id = ?`,
      tpl.label, tpl.category_id, tpl.theme_id, tpl.planned_amount_cents,
      tpl.from_account_id, tpl.to_account_id, tpl.payment_method, tpl.is_shared, tpl.recurring_day,
      tpl.is_pot, tpl.pot_partner_name, tpl.pot_partner_paid_cents, tpl.pot_my_share, potCopy,
      tpl.interval_months || 1, tpl.anchor_month, tpl.envelope_id, copy.id
    );
    return { ...getById(copy.id), created: false };
  }

  const max = get("SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_lines WHERE month_id = ?", monthId).m;
  const { lastInsertRowid } = run(
    `INSERT INTO budget_lines
      (month_id, template_line_id, label, category_id, theme_id, planned_amount_cents,
       from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes,
       is_pot, pot_partner_name, pot_partner_paid_cents, pot_my_share, pot_line_id,
       interval_months, anchor_month, envelope_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    monthId, tpl.id, tpl.label, tpl.category_id, tpl.theme_id, tpl.planned_amount_cents,
    tpl.from_account_id, tpl.to_account_id, tpl.payment_method, tpl.is_shared, tpl.recurring_day, max + 1, tpl.notes,
    tpl.is_pot, tpl.pot_partner_name, tpl.pot_partner_paid_cents, tpl.pot_my_share, potCopy,
    tpl.interval_months || 1, tpl.anchor_month, tpl.envelope_id
  );
  return { ...getById(Number(lastInsertRowid)), created: true };
}

// « Reporter dans le template » : la ligne du mois devient le nouveau standard
export function applyToTemplate(id) {
  const line = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!line) throw httpError(404, "Ligne introuvable");
  if (!line.month_id) throw httpError(400, "Cette ligne est déjà dans le template");
  if (!line.template_line_id) throw httpError(400, "Ligne propre à ce mois : ajoutez-la au template depuis l'écran Template");
  const template = get("SELECT * FROM budget_lines WHERE id = ? AND month_id IS NULL", line.template_line_id);
  if (!template) throw httpError(404, "La ligne d'origine n'existe plus dans le template");

  run(
    `UPDATE budget_lines SET label = ?, category_id = ?, theme_id = ?,
       planned_amount_cents = ?, from_account_id = ?, to_account_id = ?, payment_method = ?,
       is_shared = ?, recurring_day = ?,
       is_pot = ?, pot_partner_name = ?, pot_partner_paid_cents = ?, pot_my_share = ? WHERE id = ?`,
    line.label, line.category_id, line.theme_id,
    line.planned_amount_cents, line.from_account_id, line.to_account_id, line.payment_method,
    line.is_shared, line.recurring_day,
    line.is_pot, line.pot_partner_name, line.pot_partner_paid_cents, line.pot_my_share, template.id
  );
  return getById(template.id);
}
