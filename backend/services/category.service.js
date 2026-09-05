import { all, get, run, tx, httpError } from "../db/index.js";

const TYPES = ["depense", "revenu", "epargne", "transfert"];

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    color: row.color,
    sortOrder: row.sort_order,
    ...(row.tpl_n !== undefined ? { templateLines: row.tpl_n, monthLines: row.month_n } : {}),
  };
}

// La liste porte les compteurs d'usage (colonne « utilisé par » de la page Paramètres)
export function list() {
  return all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM budget_lines b WHERE b.category_id = c.id AND b.month_id IS NULL) AS tpl_n,
       (SELECT COUNT(*) FROM budget_lines b WHERE b.category_id = c.id AND b.month_id IS NOT NULL) AS month_n
     FROM categories c ORDER BY c.sort_order, c.id`
  ).map(serialize);
}

export function create({ name, type = "depense", color = "#6b7280" }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom de la catégorie est requis");
  if (get("SELECT id FROM categories WHERE lower(name) = lower(?)", name)) {
    throw httpError(409, `La catégorie « ${name} » existe déjà`);
  }
  if (!TYPES.includes(type)) throw httpError(400, "Type de catégorie invalide");
  const max = get("SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories").m;
  const { lastInsertRowid: id } = run(
    "INSERT INTO categories (name, type, color, sort_order) VALUES (?, ?, ?, ?)",
    name, type, color, max + 1
  );
  return serialize(get("SELECT * FROM categories WHERE id = ?", id));
}

export function update(id, data) {
  const existing = get("SELECT * FROM categories WHERE id = ?", id);
  if (!existing) throw httpError(404, "Catégorie introuvable");
  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name) throw httpError(400, "Le nom de la catégorie est requis");
  if (get("SELECT id FROM categories WHERE lower(name) = lower(?) AND id != ?", name, id)) {
    throw httpError(409, `La catégorie « ${name} » existe déjà`);
  }
  const type = data.type !== undefined ? data.type : existing.type;
  if (!TYPES.includes(type)) throw httpError(400, "Type de catégorie invalide");
  const color = data.color !== undefined ? data.color : existing.color;
  run("UPDATE categories SET name = ?, type = ?, color = ? WHERE id = ?", name, type, color, id);
  return serialize(get("SELECT * FROM categories WHERE id = ?", id));
}

// orders = [{ id, order }]
export function reorder(orders) {
  tx(() => {
    for (const { id, order } of orders) {
      run("UPDATE categories SET sort_order = ? WHERE id = ?", order, id);
    }
  });
  return list();
}

// Nombre de lignes (template + mois) rattachées : le garde-fou de suppression s'appuie dessus
export function usage(id) {
  return {
    templateLines: get("SELECT COUNT(*) AS n FROM budget_lines WHERE category_id = ? AND month_id IS NULL", id).n,
    monthLines: get("SELECT COUNT(*) AS n FROM budget_lines WHERE category_id = ? AND month_id IS NOT NULL", id).n,
  };
}

export function remove(id, { force = false } = {}) {
  const existing = get("SELECT * FROM categories WHERE id = ?", id);
  if (!existing) throw httpError(404, "Catégorie introuvable");
  const u = usage(id);
  if (!force && (u.templateLines + u.monthLines) > 0) {
    const err = httpError(409, `Cette catégorie est utilisée par ${u.templateLines} ligne(s) du template et ${u.monthLines} ligne(s) de mois : elles deviendront « sans catégorie ».`);
    err.payload = { code: "IN_USE", ...u };
    throw err;
  }
  run("DELETE FROM categories WHERE id = ?", id); // lignes conservées, category_id → NULL
  return { message: "Catégorie supprimée" };
}
