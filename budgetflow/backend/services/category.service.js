import { all, get, run, tx, httpError } from "../db/index.js";

const TYPES = ["depense", "revenu", "epargne", "transfert"];

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    color: row.color,
    sortOrder: row.sort_order,
  };
}

export function list() {
  return all("SELECT * FROM categories ORDER BY sort_order, id").map(serialize);
}

export function create({ name, type = "depense", color = "#6b7280" }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom de la catégorie est requis");
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

export function remove(id) {
  const existing = get("SELECT * FROM categories WHERE id = ?", id);
  if (!existing) throw httpError(404, "Catégorie introuvable");
  // Garde-fou à venir quand les lignes existeront (compter les références)
  run("DELETE FROM categories WHERE id = ?", id);
  return { message: "Catégorie supprimée" };
}
