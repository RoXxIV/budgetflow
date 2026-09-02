import { all, fromCents } from "../db/index.js";

/**
 * Agrégats de la page Stats — le réel vient des entrées, comme partout dans l'app.
 * Exclusions : virements système (related_line_id, ou entrée sans ligne avec un « Vers »)
 * et catégories de type « transfert ». Montants en euros, un point par mois existant.
 */
export function overview() {
  const months = all("SELECT * FROM months ORDER BY period");
  const periods = months.map((m) => m.period);
  const idx = Object.fromEntries(periods.map((p, i) => [p, i]));
  const zeros = () => periods.map(() => 0);

  // ─── Épargne & investissements : solde de début de mois (snapshot) par compte ───
  const savings = all(
    "SELECT * FROM accounts WHERE is_active = 1 AND type IN ('epargne','investissement') ORDER BY name"
  ).map((a) => {
    const points = periods.map(() => null); // null = solde inconnu ce mois-là (trou dans la courbe)
    all(
      "SELECT m.period AS p, s.balance_cents AS b FROM account_snapshots s JOIN months m ON m.id = s.month_id WHERE s.account_id = ?",
      a.id
    ).forEach((r) => { points[idx[r.p]] = fromCents(r.b); });
    return { accountId: a.id, name: a.name, type: a.type, points };
  });

  // ─── Dépenses par thème et par mois (les mois à zéro comptent : le lissé est honnête) ───
  const themes = all("SELECT * FROM themes ORDER BY name")
    .map((t) => ({ id: t.id, name: t.name, color: t.color, points: zeros() }));
  const byTheme = Object.fromEntries(themes.map((t) => [t.id, t]));
  all(
    `SELECT m.period AS p, COALESCE(e.theme_id, l.theme_id) AS tid, SUM(e.amount_cents) AS s
     FROM entries e
     JOIN months m ON m.id = e.month_id
     LEFT JOIN budget_lines l ON l.id = e.line_id
     LEFT JOIN categories c ON c.id = l.category_id
     WHERE e.related_line_id IS NULL
       AND ((l.id IS NOT NULL AND COALESCE(c.type, 'depense') = 'depense')
         OR (l.id IS NULL AND e.to_account_id IS NULL))
     GROUP BY p, tid`
  ).forEach((r) => { if (r.tid && byTheme[r.tid]) byTheme[r.tid].points[idx[r.p]] = fromCents(r.s); });

  // ─── Réel par catégorie (hors transfert) et par mois ───
  const categories = all("SELECT * FROM categories WHERE type != 'transfert' ORDER BY sort_order, id")
    .map((c) => ({ id: c.id, name: c.name, color: c.color, type: c.type, points: zeros() }));
  const byCat = Object.fromEntries(categories.map((c) => [c.id, c]));
  all(
    `SELECT m.period AS p, l.category_id AS cid, SUM(e.amount_cents) AS s
     FROM entries e
     JOIN months m ON m.id = e.month_id
     JOIN budget_lines l ON l.id = e.line_id
     JOIN categories c ON c.id = l.category_id
     WHERE e.related_line_id IS NULL AND c.type != 'transfert'
     GROUP BY p, cid`
  ).forEach((r) => { if (byCat[r.cid]) byCat[r.cid].points[idx[r.p]] = fromCents(r.s); });

  // ─── Totaux par type de catégorie (réel + prévu), hors transferts ───
  const types = periods.map((p) => ({
    period: p,
    real: { depense: 0, revenu: 0, epargne: 0 },
    planned: { depense: 0, revenu: 0, epargne: 0 },
  }));
  all(
    `SELECT m.period AS p, c.type AS t, SUM(e.amount_cents) AS s
     FROM entries e
     JOIN months m ON m.id = e.month_id
     JOIN budget_lines l ON l.id = e.line_id
     JOIN categories c ON c.id = l.category_id
     WHERE e.related_line_id IS NULL AND c.type IN ('depense','revenu','epargne')
     GROUP BY p, t`
  ).forEach((r) => { types[idx[r.p]].real[r.t] = fromCents(r.s); });
  all(
    `SELECT m.period AS p, COALESCE(c.type, 'depense') AS t, SUM(bl.planned_amount_cents) AS s
     FROM budget_lines bl
     JOIN months m ON m.id = bl.month_id
     LEFT JOIN categories c ON c.id = bl.category_id
     WHERE bl.is_pot = 0 AND COALESCE(c.type, 'depense') IN ('depense','revenu','epargne')
     GROUP BY p, t`
  ).forEach((r) => { types[idx[r.p]].planned[r.t] = fromCents(r.s); });

  return { periods, savings, themes, categories, types };
}
