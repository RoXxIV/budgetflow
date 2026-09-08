import { all, get, fromCents } from "../db/index.js";

// Moyennes mensuelles réelles, par thème et par catégorie — la matière du bouton
// « importer ma moyenne » du plan de financement.
//
// Deux précautions qui changent tout :
//  - le mois EN COURS est exclu : il est incomplet, il tirerait chaque moyenne vers
//    le bas d'autant plus fort que l'historique est court ;
//  - seules les dépenses comptent. Une moyenne globale de dépenses mélangerait les
//    versements d'enveloppes et les DCA aux vraies charges, et donnerait un « reste »
//    négatif qui ne veut rien dire.

const round2 = (n) => Math.round(n * 100) / 100;
const currentPeriod = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; };

/**
 * Moyennes mensuelles par thème et par catégorie, sur les mois révolus.
 *
 * @returns {{months: number, from: string|null, to: string|null,
 *   themes: Array<{id: number, name: string, average: number}>,
 *   categories: Array<{id: number, name: string, type: string, average: number}>}}
 */
export function averages() {
  const now = currentPeriod();
  const months = all("SELECT id, period FROM months WHERE period < ? ORDER BY period", now);
  const n = months.length;
  if (!n) return { months: 0, from: null, to: null, themes: [], categories: [] };

  const ids = months.map((m) => m.id);
  const marks = ids.map(() => "?").join(",");

  // Le réel, entrée par entrée : c'est ce qui a été dépensé, pas ce qui était prévu
  const parTheme = all(
    `SELECT t.id, t.name, COALESCE(SUM(e.amount_cents), 0) AS c
     FROM themes t
     LEFT JOIN entries e ON e.theme_id = t.id AND e.month_id IN (${marks})
     GROUP BY t.id, t.name ORDER BY c DESC`, ...ids
  );

  const parCategorie = all(
    `SELECT c.id, c.name, c.type, COALESCE(SUM(e.amount_cents), 0) AS cents
     FROM categories c
     LEFT JOIN budget_lines b ON b.category_id = c.id AND b.month_id IN (${marks})
     LEFT JOIN entries e ON e.line_id = b.id
     GROUP BY c.id, c.name, c.type ORDER BY cents DESC`, ...ids
  );

  return {
    months: n,
    from: months[0].period,
    to: months[n - 1].period,
    themes: parTheme
      .map((t) => ({ id: t.id, name: t.name, average: round2(fromCents(t.c) / n) }))
      .filter((t) => t.average > 0),
    categories: parCategorie
      .map((c) => ({ id: c.id, name: c.name, type: c.type, average: round2(fromCents(c.cents) / n) }))
      .filter((c) => c.average > 0),
  };
}
