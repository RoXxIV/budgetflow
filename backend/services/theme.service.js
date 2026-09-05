import { all, get, run, tx, httpError } from "../db/index.js";

function serialize(row) {
  return {
    id: row.id, name: row.name, color: row.color,
    ...(row.lines_n !== undefined ? { lines: row.lines_n, entries: row.entries_n, calculators: row.calcs_n } : {}),
  };
}

// La liste porte les compteurs d'usage (colonne « utilisé par » de la page Paramètres)
export function list() {
  return all(
    `SELECT t.*,
       (SELECT COUNT(*) FROM budget_lines b WHERE b.theme_id = t.id) AS lines_n,
       (SELECT COUNT(*) FROM entries e WHERE e.theme_id = t.id) AS entries_n,
       (SELECT COUNT(*) FROM calculators c WHERE c.theme_id = t.id) AS calcs_n
     FROM themes t ORDER BY t.name COLLATE NOCASE`
  ).map(serialize);
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

export function usage(id) {
  return {
    lines: get("SELECT COUNT(*) AS n FROM budget_lines WHERE theme_id = ?", id).n,
    entries: get("SELECT COUNT(*) AS n FROM entries WHERE theme_id = ?", id).n,
    // Les calculateurs référencent aussi un thème (leur régularisation le pose) : sans ce compte,
    // un thème « inutilisé » se supprimait en débranchant un calculateur en silence
    calculators: get("SELECT COUNT(*) AS n FROM calculators WHERE theme_id = ?", id).n,
  };
}

export function remove(id, { force = false } = {}) {
  const existing = get("SELECT * FROM themes WHERE id = ?", id);
  if (!existing) throw httpError(404, "Thème introuvable");
  const u = usage(id);
  if (!force && (u.lines + u.entries + u.calculators) > 0) {
    const err = httpError(409, `Ce thème est utilisé par ${u.lines} ligne(s), ${u.entries} entrée(s) et ${u.calculators} calculateur(s) : ils deviendront « sans thème ». Fusionnez plutôt.`);
    err.payload = { code: "IN_USE", ...u };
    throw err;
  }
  run("DELETE FROM themes WHERE id = ?", id);
  return { message: "Thème supprimé" };
}

// Fusion : toutes les références du thème source passent sur la cible, la source disparaît
export function merge(sourceId, targetId) {
  const source = get("SELECT * FROM themes WHERE id = ?", sourceId);
  const target = get("SELECT * FROM themes WHERE id = ?", targetId);
  if (!source || !target) throw httpError(404, "Thème introuvable");
  if (source.id === target.id) throw httpError(400, "Même thème");
  const u = usage(sourceId);
  tx(() => {
    run("UPDATE budget_lines SET theme_id = ? WHERE theme_id = ?", targetId, sourceId);
    run("UPDATE entries SET theme_id = ? WHERE theme_id = ?", targetId, sourceId);
    run("UPDATE calculators SET theme_id = ? WHERE theme_id = ?", targetId, sourceId);
    run("DELETE FROM themes WHERE id = ?", sourceId);
  });
  return { message: `« ${source.name} » fusionné dans « ${target.name} » (${u.lines} ligne(s), ${u.entries} entrée(s))`, moved: u };
}
