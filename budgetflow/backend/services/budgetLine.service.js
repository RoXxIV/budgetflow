import { all, get, run, tx, toCents, fromCents, httpError } from "../db/index.js";

// Sérialisation commune des lignes budgétaires (template et mois)
export function serialize(row) {
  return {
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

  const scope = monthId === null ? "month_id IS NULL" : "month_id = ?";
  const max = monthId === null
    ? get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_lines WHERE ${scope}`).m
    : get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_lines WHERE ${scope}`, monthId).m;

  const { lastInsertRowid: id } = run(
    `INSERT INTO budget_lines
      (month_id, template_line_id, label, category_id, theme_id, planned_amount_cents,
       from_account_id, to_account_id, payment_method, is_shared, recurring_day, sort_order, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    monthId, data.templateLineId ?? null, label,
    data.categoryId ?? null, data.themeId ?? null,
    toCents(data.plannedAmount) ?? 0,
    data.fromAccountId ?? null, data.toAccountId ?? null,
    data.paymentMethod ?? null, data.isShared ? 1 : 0,
    data.recurringDay ?? null, max + 1, data.notes ?? null
  );
  return getById(Number(id));
}

export function update(id, data) {
  const existing = get("SELECT * FROM budget_lines WHERE id = ?", id);
  if (!existing) throw httpError(404, "Ligne introuvable");

  const label = data.label !== undefined ? String(data.label).trim() : existing.label;
  if (!label) throw httpError(400, "Le libellé de la ligne est requis");

  const val = (key, dbKey, transform = (v) => v) =>
    data[key] !== undefined ? transform(data[key]) : existing[dbKey];

  run(
    `UPDATE budget_lines SET label = ?, category_id = ?, theme_id = ?,
       planned_amount_cents = ?, from_account_id = ?, to_account_id = ?, payment_method = ?,
       is_shared = ?, recurring_day = ?, notes = ? WHERE id = ?`,
    label,
    val("categoryId", "category_id"),
    val("themeId", "theme_id"),
    val("plannedAmount", "planned_amount_cents", toCents),
    val("fromAccountId", "from_account_id"),
    val("toAccountId", "to_account_id"),
    val("paymentMethod", "payment_method"),
    val("isShared", "is_shared", (v) => (v ? 1 : 0)),
    val("recurringDay", "recurring_day"),
    val("notes", "notes"),
    id
  );
  return getById(id);
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
       is_shared = ?, recurring_day = ? WHERE id = ?`,
    line.label, line.category_id, line.theme_id,
    line.planned_amount_cents, line.from_account_id, line.to_account_id, line.payment_method,
    line.is_shared, line.recurring_day, template.id
  );
  return getById(template.id);
}
