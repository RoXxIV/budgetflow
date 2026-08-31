import { all, get, run, httpError } from "../db/index.js";

function serialize(row) {
  return { id: row.id, name: row.name, color: row.color };
}

export function list() {
  return all("SELECT * FROM themes ORDER BY name COLLATE NOCASE").map(serialize);
}

export function create({ name, color = "#6b7280" }) {
  name = (name || "").trim();
  if (!name) throw httpError(400, "Le nom du thème est requis");
  const dup = get("SELECT id FROM themes WHERE name = ? COLLATE NOCASE", name);
  if (dup) throw httpError(409, `Le thème « ${name} » existe déjà`);
  const { lastInsertRowid: id } = run("INSERT INTO themes (name, color) VALUES (?, ?)", name, color);
  return serialize(get("SELECT * FROM themes WHERE id = ?", id));
}

export function update(id, data) {
  const existing = get("SELECT * FROM themes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Thème introuvable");
  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name) throw httpError(400, "Le nom du thème est requis");
  const dup = get("SELECT id FROM themes WHERE name = ? COLLATE NOCASE AND id != ?", name, id);
  if (dup) throw httpError(409, `Le thème « ${name} » existe déjà`);
  const color = data.color !== undefined ? data.color : existing.color;
  run("UPDATE themes SET name = ?, color = ? WHERE id = ?", name, color, id);
  return serialize(get("SELECT * FROM themes WHERE id = ?", id));
}

export function remove(id) {
  const existing = get("SELECT * FROM themes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Thème introuvable");
  // Garde-fou + fusion viendront avec les entrées (compter les références avant de supprimer)
  run("DELETE FROM themes WHERE id = ?", id);
  return { message: "Thème supprimé" };
}
