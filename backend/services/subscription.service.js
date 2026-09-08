import { all, get, run, toCents, fromCents, httpError } from "../db/index.js";

// Tracker d'abonnements — bac à sable persistant : AUCUNE écriture d'ici ne touche
// le template, les mois ou les enveloppes. La simulation par ligne (`sim`) remplace
// le prix dans les totaux simulés ; un abonnement hypothétique se crée à prix 0 avec
// juste une simulation, une résiliation se simule avec sim = 0.
//
// C'est ce cloisonnement qui fait tout l'intérêt de la page : on y répond à « et si
// je résiliais Netflix et prenais Spotify Famille ? » sans qu'aucun chiffre du budget
// réel ne bouge. Les données y sont une COPIE, jamais un lien.

const PERIODS = ["mensuel", "annuel", "hebdo"];

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    themeId: row.theme_id,
    themeName: row.theme_name ?? null,
    period: row.period,
    price: fromCents(row.price_cents),
    sim: row.sim_cents === null ? null : fromCents(row.sim_cents),
    day: row.day,
    month: row.month,
    isActive: !!row.is_active,
  };
}

const LIST_SQL = `
  SELECT s.*, t.name AS theme_name FROM tracker_subscriptions s
  LEFT JOIN themes t ON t.id = s.theme_id
`;

export function list() {
  return all(`${LIST_SQL} ORDER BY s.is_active DESC, s.name COLLATE NOCASE`).map(serialize);
}

/**
 * Contrôle et normalise un abonnement, à la création comme à la modification.
 *
 * Le même code sert les deux, avec `existing` en repli : un champ absent garde sa
 * valeur. Le mois n'est conservé que pour un abonnement annuel — sur un mensuel il
 * n'aurait aucun sens, et le laisser traîner produirait des échéances fantômes.
 *
 * @param {object} data Les champs envoyés.
 * @param {object} [existing] La ligne actuelle, pour une modification.
 * @returns {object} Les valeurs prêtes à écrire.
 */
function validate(data, existing = {}) {
  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name) throw httpError(400, "Le nom de l'abonnement est requis");
  const period = data.period !== undefined ? data.period : (existing.period || "mensuel");
  if (!PERIODS.includes(period)) throw httpError(400, "Périodicité invalide (mensuel, annuel ou hebdo)");
  const price = data.price !== undefined ? toCents(data.price) : (existing.price_cents ?? 0);
  if (price === null || price < 0) throw httpError(400, "Prix invalide");
  const sim = data.sim !== undefined ? (data.sim === null || data.sim === "" ? null : toCents(data.sim)) : (existing.sim_cents ?? null);
  if (sim !== null && sim < 0) throw httpError(400, "Simulation invalide");
  const day = data.day !== undefined ? (Number(data.day) || null) : (existing.day ?? null);
  const month = data.month !== undefined ? (Number(data.month) || null) : (existing.month ?? null);
  if (day !== null && (day < 1 || day > (period === "hebdo" ? 7 : 31))) throw httpError(400, "Jour invalide");
  if (month !== null && (month < 1 || month > 12)) throw httpError(400, "Mois invalide");
  const themeId = data.themeId !== undefined ? (data.themeId || null) : (existing.theme_id ?? null);
  const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : (existing.is_active ?? 1);
  return { name, period, price, sim, day, month: period === "annuel" ? month : null, themeId, isActive };
}

export function create(data) {
  const v = validate(data);
  const { lastInsertRowid: id } = run(
    "INSERT INTO tracker_subscriptions (name, theme_id, period, price_cents, sim_cents, day, month, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    v.name, v.themeId, v.period, v.price, v.sim, v.day, v.month, v.isActive
  );
  return serialize(get(`${LIST_SQL} WHERE s.id = ?`, id));
}

export function update(id, data) {
  const existing = get("SELECT * FROM tracker_subscriptions WHERE id = ?", id);
  if (!existing) throw httpError(404, "Abonnement introuvable");
  const v = validate(data, existing);
  run(
    "UPDATE tracker_subscriptions SET name = ?, theme_id = ?, period = ?, price_cents = ?, sim_cents = ?, day = ?, month = ?, is_active = ? WHERE id = ?",
    v.name, v.themeId, v.period, v.price, v.sim, v.day, v.month, v.isActive, id
  );
  return serialize(get(`${LIST_SQL} WHERE s.id = ?`, id));
}

export function remove(id) {
  if (!get("SELECT id FROM tracker_subscriptions WHERE id = ?", id)) throw httpError(404, "Abonnement introuvable");
  run("DELETE FROM tracker_subscriptions WHERE id = ?", id);
  return { message: "Abonnement supprimé" };
}

/**
 * Import initial : peuple le tracker à partir du budget réel.
 *
 * Deux sources : les lignes du mois dont la catégorie contient « abonnement », et les
 * lignes mensualisées du template — une charge annuelle lissée EST un abonnement, elle
 * entre donc en « annuel » avec son échéance.
 *
 * C'est une COPIE, à sens unique : les doublons de nom sont ignorés, et rien ne reste
 * lié aux sources. Modifier un prix ici ne touche pas au budget, et inversement.
 *
 * @returns {{imported: number, subscriptions: Array}}
 */
export function importCurrent() {
  const month = get("SELECT * FROM months WHERE closed_at IS NULL ORDER BY period DESC LIMIT 1")
    || get("SELECT * FROM months ORDER BY period DESC LIMIT 1");
  const existingNames = new Set(all("SELECT lower(name) AS n FROM tracker_subscriptions").map((r) => r.n));
  let imported = 0;

  if (month) {
    const subs = all(
      `SELECT b.* FROM budget_lines b JOIN categories c ON c.id = b.category_id
       WHERE b.month_id = ? AND b.is_pot = 0 AND lower(c.name) LIKE '%abonnement%'`, month.id
    );
    for (const l of subs) {
      if (existingNames.has(l.label.toLowerCase())) continue;
      run("INSERT INTO tracker_subscriptions (name, theme_id, period, price_cents, day) VALUES (?, ?, 'mensuel', ?, ?)",
        l.label, l.theme_id, l.planned_amount_cents, l.recurring_day);
      existingNames.add(l.label.toLowerCase());
      imported++;
    }
  }

  // Mensualisées : des charges annuelles lissées — importées en « annuel » avec leur échéance
  for (const l of all("SELECT * FROM budget_lines WHERE month_id IS NULL AND envelope_id IS NOT NULL")) {
    if (existingNames.has(l.label.toLowerCase())) continue;
    run("INSERT INTO tracker_subscriptions (name, theme_id, period, price_cents, day, month) VALUES (?, ?, 'annuel', ?, ?, ?)",
      l.label, l.theme_id, l.planned_amount_cents, l.recurring_day, l.anchor_month);
    existingNames.add(l.label.toLowerCase());
    imported++;
  }

  return { imported, subscriptions: list() };
}
